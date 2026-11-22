// Malipo ya simu (0.16.0) kwa kampuni BANDIA ya majaribio (simulator):
//  1. Ada ya mwezi: ombi la PIN → uthibitisho → siku zinaongezwa zenyewe; kukataa / kuisha muda / callback mara mbili.
//  2. Malipo ya ofa ya papo hapo: safari safi → imetumwa; yenye alama / juu ya kikomo / bila namba → inasubiri ukaguzi;
//     kushindwa → kujaribu tena; kukataa → NAYA haidaiwi.
// Database ya MAJARIBIO tu.
process.env.PAYMENT_PROVIDER = 'simulator';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { getProvider } from '../src/services/payments/provider.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6).replace(/^0/, '1');
const PASSWORD = 'NayaTest#2026';
const userIds: string[] = [];
const locationIds: string[] = [];
const promoIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let ip = 0;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.52.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

const A = { lat: -7.2, lng: 34.4 };
const B = { lat: -7.215, lng: 34.41 };
const NEAR_B = { lat: -7.2145, lng: 34.41 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeUser(key: string, phone: string, name: string, mode: string | null, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode, phone_verified_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [`255${phone.slice(1)}`, name, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: role === 'USER' ? 'app' : 'admin' })).json.data.token;
}
async function makeDriver(key: string, phone: string, name: string, plate: string) {
  await makeUser(key, phone, name, 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
     VALUES ($1, 'APPROVED', 'BODABODA', $2, 'Boxer', 'Nyekundu', 'DL123456', now() + interval '10 days')`,
    [ids[key], plate],
  );
}
const paidUntil = async (key: string) => new Date((await db.query('SELECT paid_until FROM naya.drivers WHERE user_id = $1', [ids[key]])).rows[0].paid_until).getTime();
const ride = async (id: string) => (await db.query('SELECT * FROM naya.rides WHERE id = $1', [id])).rows[0];
async function rideState(id: string, until: (r: any) => boolean) {
  for (let i = 0; i < 40; i++) {
    const r = await ride(id);
    if (until(r)) return r;
    await wait(50);
  }
  return ride(id);
}
const simulate = (reference: string, success: boolean) => call('POST', `/api/payments/simulator/${reference}`, { success });

/** Safari ya ofa kamili: abiria p1 anaagiza, dereva anakubali, PIN, anamaliza (safi au mbali na unakoenda). */
async function promoRide(driver: string, opts: { clean?: boolean } = { clean: true }) {
  assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.0005, lng: A.lng }, driver)).status, 200);
  const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
  assert.equal(res.status, 201, res.json.message);
  const rideId = res.json.data.id;
  assert.ok(res.json.data.promo, 'safari haikupata ofa');
  const offer = (await call('GET', '/api/driver/state', undefined, driver)).json.data.offer;
  assert.equal(offer?.ride.id, rideId, 'dereva hakupata ombi');
  assert.equal((await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, driver)).status, 200);
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, driver)).status, 200);
  const pin = (await call('GET', '/api/rides/current', undefined, 'p1')).json.data.pin;
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, { pin }, driver)).status, 200);
  await db.query(`UPDATE naya.rides SET started_at = now() - interval '6 minutes' WHERE id = $1`, [rideId]);
  if (opts.clean !== false) await call('POST', '/api/driver/location', NEAR_B, driver);
  const done = await call('POST', `/api/driver/rides/${rideId}/complete`, {}, driver);
  assert.equal(done.status, 200, done.json.message);
  await call('POST', `/api/rides/${rideId}/close`, {}, 'p1');
  await call('POST', `/api/driver/rides/${rideId}/close`, {}, driver);
  await call('POST', '/api/driver/online', { online: false }, driver);
  return rideId as string;
}
const addAccount = (driver: string, phone: string, primary = true) =>
  call('POST', '/api/driver/payout-accounts', { network: 'MPESA', phone, accountName: 'Jina La Dereva', primary }, driver);

let pausedBefore: string[] = [];
let feeBefore: unknown = null;
before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  pausedBefore = (await db.query(`UPDATE naya.promotions SET status = 'PAUSED' WHERE status = 'ACTIVE' RETURNING id`)).rows.map((r) => r.id);
  feeBefore = (await db.query(`SELECT value FROM naya.settings WHERE key = 'subscription'`)).rows[0]?.value ?? null;
  await db.query(
    `INSERT INTO naya.settings (key, value) VALUES ('subscription', '{"monthlyFee": 5000, "trialDays": 30, "graceDays": 3, "paymentInstructions": "Lipa ofisini."}')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
  await db.query(`INSERT INTO naya.settings (key, value) VALUES ('auto_payout', '{"enabled": true, "dailyLimit": 10000}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  for (const [name, p] of [[`Pickup M${s}`, A], [`Dest M${s}`, B]] as const) {
    const r = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(r.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 3000, 0, 3000, 100, 1.3), ('BAJAJI', 4000, 0, 4000, 100, 1.3)`,
  );
  await makeUser('admin', `0770${s}`, 'Ofisi Malipo', null, 'ADMIN');
  await makeUser('p1', `0771${s}`, `Mteja Malipo ${s}`, 'PASSENGER');
  await makeDriver('d1', `0754${s}`, `Boda Malipo ${s}`, `MC ${s.slice(-3)} ML1`);
  await makeDriver('d2', `0755${s}`, `Boda Bila Namba ${s}`, `MC ${s.slice(-3)} ML2`);
  const promo = await call('POST', '/api/admin/promotions', { name: `Malipo ${s}`, title: 'Nusu bei', audience: 'ALL', discountPercent: 50 }, 'admin');
  promoIds.push(promo.json.data.id);
  await call('POST', `/api/admin/promotions/${promo.json.data.id}/status`, { status: 'ACTIVE' }, 'admin');
});

after(async () => {
  await db.query('DELETE FROM naya.promo_payouts WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.subscription_payments WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('UPDATE naya.rides SET promo_payment_id = NULL WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.payments WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.ride_offers WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.promotions WHERE id = ANY($1::uuid[])', [promoIds]);
  await db.query(`UPDATE naya.promotions SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])`, [pausedBefore]);
  if (feeBefore) await db.query(`UPDATE naya.settings SET value = $1 WHERE key = 'subscription'`, [JSON.stringify(feeBefore)]);
  await db.query(`UPDATE naya.settings SET updated_by = NULL WHERE updated_by = ANY($1::uuid[])`, [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

describe('Malipo ya simu — ada ya mwezi', () => {
  it('kampuni bandia haiwezi kuwashwa production', () => {
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    assert.equal(getProvider(), null);
    process.env.NODE_ENV = old;
    assert.equal(getProvider()?.name, 'simulator');
  });

  it('dereva anaona "Lipa kwa simu" na mtandao wake umechaguliwa', async () => {
    const sub = (await call('GET', '/api/driver/subscription', undefined, 'd1')).json.data;
    assert.equal(sub.online.enabled, true);
    assert.equal(sub.online.suggestedNetwork, 'MPESA'); // 0754…
    assert.equal(sub.online.pending, null);
    assert.equal((await call('POST', '/api/driver/subscription/pay', { months: 1, network: 'MPESA', phone: '0754' }, 'd1')).status, 400);
    assert.equal((await call('POST', '/api/driver/subscription/pay', { months: 1, network: 'MPESA', phone: `0754${s}` }, 'p1')).status, 404);
  });

  it('ombi la PIN → PENDING; mteja akiingiza PIN → siku 60 zinaongezwa zenyewe, risiti, mara moja tu', async () => {
    const before = await paidUntil('d1');
    const r = await call('POST', '/api/driver/subscription/pay', { months: 2, network: 'MPESA', phone: `0754${s}` }, 'd1');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.status, 'PENDING');
    assert.equal(r.json.data.amount, 10000);
    // ombi la pili ndani ya dakika 2 → 409
    assert.equal((await call('POST', '/api/driver/subscription/pay', { months: 1, network: 'MPESA', phone: `0754${s}` }, 'd1')).status, 409);
    assert.equal((await call('GET', '/api/driver/subscription', undefined, 'd1')).json.data.online.pending.id, r.json.data.id);
    assert.equal(await paidUntil('d1'), before, 'siku hazijaongezwa kabla ya uthibitisho');
    assert.equal((await simulate(r.json.data.reference, true)).status, 200);
    const after = await paidUntil('d1');
    assert.ok(Math.abs(after - before - 60 * 86400_000) < 120_000, 'siku 60 zimeongezwa');
    const p = (await call('GET', `/api/payments/${r.json.data.id}`, undefined, 'd1')).json.data;
    assert.equal(p.status, 'SUCCESS');
    assert.ok(p.providerRef);
    const sp = (await db.query('SELECT * FROM naya.subscription_payments WHERE payment_id = $1', [r.json.data.id])).rows;
    assert.equal(sp.length, 1);
    assert.equal(sp[0].recorded_by, null);
    assert.equal(sp[0].method, 'MPESA');
    assert.equal(sp[0].amount, 10000);
    // callback ya pili (kampuni ikirudia) haiongezi tena
    await call('POST', '/api/payments/callback/simulator', { reference: r.json.data.reference, success: true });
    assert.equal(await paidUntil('d1'), after);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM naya.subscription_payments WHERE driver_id = $1', [ids.d1])).rows[0].n, 1);
    const note = await db.query(`SELECT 1 FROM naya.notifications WHERE user_id = $1 AND title = 'Ada imepokelewa — asante!'`, [ids.d1]);
    assert.equal(note.rowCount, 1);
    // ofisi inaona "Kwa simu (NAYA)"
    const admin = (await call('GET', `/api/admin/drivers/${ids.d1}/subscription`, undefined, 'admin')).json.data;
    assert.equal(admin.payments[0].recordedBy, 'Kwa simu (NAYA)');
  });

  it('mteja akikataa / namba haina akaunti → imeshindwa, hakuna siku zinazoongezwa', async () => {
    const before = await paidUntil('d1');
    const bad = await call('POST', '/api/driver/subscription/pay', { months: 1, network: 'MPESA', phone: '0754990000' }, 'd1');
    assert.equal(bad.json.data.status, 'FAILED');
    assert.match(bad.json.data.failureReason, /haina akaunti/);
    await db.query(`UPDATE naya.payments SET created_at = now() - interval '3 minutes' WHERE user_id = $1`, [ids.d1]);
    const r = await call('POST', '/api/driver/subscription/pay', { months: 1, network: 'MPESA', phone: `0754${s}` }, 'd1');
    await simulate(r.json.data.reference, false);
    const p = (await call('GET', `/api/payments/${r.json.data.id}`, undefined, 'd1')).json.data;
    assert.equal(p.status, 'FAILED');
    assert.equal(await paidUntil('d1'), before);
    assert.equal((await call('GET', `/api/payments/${r.json.data.id}`, undefined, 'd2')).status, 404);
  });

  it('muda ukiisha bila jibu → imeshindwa; uthibitisho ukifika baadaye bado unaongeza siku (pesa ya dereva haipotei)', async () => {
    await db.query(`UPDATE naya.payments SET created_at = now() - interval '3 minutes' WHERE user_id = $1`, [ids.d1]);
    const before = await paidUntil('d1');
    const r = await call('POST', '/api/driver/subscription/pay', { months: 1, network: 'MPESA', phone: `0754${s}` }, 'd1');
    await db.query(`UPDATE naya.payments SET created_at = now() - interval '16 minutes' WHERE id = $1`, [r.json.data.id]);
    const timedOut = (await call('GET', `/api/payments/${r.json.data.id}`, undefined, 'd1')).json.data;
    assert.equal(timedOut.status, 'FAILED');
    assert.match(timedOut.failureReason, /Muda/);
    await simulate(r.json.data.reference, true);
    assert.equal((await call('GET', `/api/payments/${r.json.data.id}`, undefined, 'd1')).json.data.status, 'SUCCESS');
    assert.ok((await paidUntil('d1')) - before > 29 * 86400_000);
  });

  it('callback ya kampuni isiyotumika → 404', async () => {
    assert.equal((await call('POST', '/api/payments/callback/selcom', { reference: 'x' })).status, 404);
  });
});

describe('Malipo ya ofa ya papo hapo', () => {
  it('safari safi → NAYA inamtumia dereva papo hapo, deni linakuwa 0, dereva anajulishwa', async () => {
    assert.equal((await addAccount('d1', `0754${s}`)).status, 200);
    const rideId = await promoRide('d1');
    const r = await rideState(rideId, (x) => x.promo_payout_state === 'PAID');
    assert.equal(r.promo_payout_state, 'PAID');
    const payout = (await db.query('SELECT * FROM naya.promo_payouts WHERE payment_id = $1', [r.promo_payment_id])).rows[0];
    assert.equal(payout.amount, 1500);
    assert.equal(payout.paid_by, null);
    const wallet = (await call('GET', '/api/driver/promo-wallet', undefined, 'd1')).json.data;
    assert.equal(wallet.balance, 0);
    assert.equal(wallet.auto.enabled, true);
    assert.equal(wallet.trips[0].payoutState, 'PAID');
    assert.equal(wallet.payouts[0].automatic, true);
    const note = await db.query(`SELECT body FROM naya.notifications WHERE user_id = $1 AND title = 'Umelipwa na NAYA'`, [ids.d1]);
    assert.equal(note.rowCount, 1);
    assert.match(note.rows[0].body, /TSh 1,500/);
  });

  it('safari yenye alama (iliishia mbali na unakoenda) → inasubiri ukaguzi; ofisi ikiruhusu → inatumwa', async () => {
    const rideId = await promoRide('d1', { clean: false });
    const r = await rideState(rideId, (x) => x.promo_payout_state !== null);
    assert.equal(r.promo_payout_state, 'HELD');
    assert.match(r.promo_payout_note, /alama/);
    const q = (await call('GET', '/api/admin/payments/queue', undefined, 'admin')).json.data;
    assert.ok(q.held.some((h: any) => h.id === rideId));
    assert.equal((await call('POST', `/api/admin/payments/rides/${rideId}/approve`, {}, 'p1')).status, 403);
    assert.equal((await call('POST', `/api/admin/payments/rides/${rideId}/approve`, {}, 'admin')).status, 200);
    assert.equal((await ride(rideId)).promo_payout_state, 'PAID');
    assert.equal((await call('POST', `/api/admin/payments/rides/${rideId}/approve`, {}, 'admin')).status, 409);
  });

  it('kikomo cha siku kikifika → inasubiri ukaguzi; ofisi ikikataa → NAYA haidaiwi kiasi hicho', async () => {
    assert.equal((await call('PUT', '/api/admin/payments/auto-payout', { enabled: true, dailyLimit: 3500 }, 'admin')).status, 200);
    const rideId = await promoRide('d1'); // leo ameshatumiwa 3,000 → 3,000 + 1,500 > 3,500
    const r = await rideState(rideId, (x) => x.promo_payout_state !== null);
    assert.equal(r.promo_payout_state, 'HELD');
    assert.match(r.promo_payout_note, /Kikomo/);
    assert.equal((await call('GET', '/api/driver/promo-wallet', undefined, 'd1')).json.data.balance, 1500);
    assert.equal((await call('POST', `/api/admin/payments/rides/${rideId}/reject`, { reason: 'Safari hewa' }, 'admin')).status, 200);
    assert.equal((await ride(rideId)).promo_payout_state, 'REJECTED');
    assert.equal((await call('GET', '/api/driver/promo-wallet', undefined, 'd1')).json.data.balance, 0);
    await call('PUT', '/api/admin/payments/auto-payout', { enabled: true, dailyLimit: 10000 }, 'admin');
  });

  it('dereva bila namba → inasubiri; akiweka namba → inatumwa yenyewe', async () => {
    const rideId = await promoRide('d2');
    const r = await rideState(rideId, (x) => x.promo_payout_state !== null);
    assert.equal(r.promo_payout_state, 'HELD');
    assert.match(r.promo_payout_note, /hajaweka namba/);
    assert.equal((await addAccount('d2', `0755${s}`)).status, 200);
    assert.equal((await rideState(rideId, (x) => x.promo_payout_state === 'PAID')).promo_payout_state, 'PAID');
  });

  it('kutuma kukishindwa → FAILED; ofisi "Jaribu tena" baada ya dereva kurekebisha namba → inatumwa (jaribio la 2)', async () => {
    await addAccount('d2', '0755990000'); // namba mpya kuu isiyo na akaunti
    const rideId = await promoRide('d2');
    const r = await rideState(rideId, (x) => x.promo_payout_state !== null && x.promo_payout_state !== 'PENDING');
    assert.equal(r.promo_payout_state, 'FAILED');
    assert.equal((await call('GET', '/api/driver/promo-wallet', undefined, 'd2')).json.data.balance, 1500);
    const q = (await call('GET', '/api/admin/payments/queue', undefined, 'admin')).json.data;
    assert.ok(q.failed.some((f: any) => f.id === rideId));
    // Dereva anarudisha namba sahihi kuwa namba kuu
    const good = (await call('GET', '/api/driver/promo-wallet', undefined, 'd2')).json.data.accounts.find((a: any) => a.phone === `255755${s}`);
    assert.equal((await call('POST', '/api/driver/payout-accounts', { id: good.id, network: 'MPESA', phone: `0755${s}`, accountName: 'Jina La Dereva', primary: true }, 'd2')).status, 200);
    assert.equal((await call('POST', `/api/admin/payments/rides/${rideId}/approve`, {}, 'admin')).status, 200);
    const fixed = await ride(rideId);
    assert.equal(fixed.promo_payout_state, 'PAID');
    assert.equal((await db.query('SELECT attempt FROM naya.payments WHERE id = $1', [fixed.promo_payment_id])).rows[0].attempt, 2);
    assert.equal((await call('GET', '/api/driver/promo-wallet', undefined, 'd2')).json.data.balance, 0);
  });

  it('ofisi ikizima malipo ya papo hapo → malipo ni ya mkono kama zamani', async () => {
    await call('PUT', '/api/admin/payments/auto-payout', { enabled: false, dailyLimit: 10000 }, 'admin');
    const rideId = await promoRide('d1');
    await wait(300);
    assert.equal((await ride(rideId)).promo_payout_state, null);
    assert.equal((await call('GET', '/api/driver/promo-wallet', undefined, 'd1')).json.data.auto.enabled, false);
    await call('PUT', '/api/admin/payments/auto-payout', { enabled: true, dailyLimit: 10000 }, 'admin');
  });

  it('ofisi: miamala yote + CSV', async () => {
    const all = (await call('GET', `/api/admin/payments?q=${encodeURIComponent(`Boda Malipo ${s}`)}`, undefined, 'admin')).json.data;
    assert.ok(all.some((t: any) => t.kind === 'SUBSCRIPTION' && t.status === 'SUCCESS'));
    assert.ok(all.some((t: any) => t.kind === 'PROMO_PAYOUT' && t.status === 'SUCCESS'));
    const res = await app.inject({ method: 'GET', url: '/api/admin/payments.csv?kind=PROMO_PAYOUT', headers: { authorization: `Bearer ${tokens.admin}` } });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /Malipo ya ofa/);
    const o = (await call('GET', '/api/admin/payments/overview', undefined, 'admin')).json.data;
    assert.equal(o.config.enabled, true);
    assert.ok(o.totals.payoutCount >= 4);
  });
});
