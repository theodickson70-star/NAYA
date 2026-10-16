// 0.20.0 — Jina la mwenye namba (Name Lookup) na Control Number ya ada, kwa kampuni BANDIA ya majaribio (simulator).
//   simulator: namba ...8888 → mtandao haukuithibitisha; ...9999 → huduma haipatikani; SIM_NAMES='2557…=JINA' kubadilisha jina.
// Database ya MAJARIBIO tu.
process.env.PAYMENT_PROVIDER = 'simulator';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { checkPendingPayments } from '../src/services/payments/index.js';
import { namesMatch, titleCase } from '../src/services/name-lookup.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6).replace(/^0/, '1');
const PASSWORD = 'NayaTest#2026';
const userIds: string[] = [];
const locationIds: string[] = [];
const promoIds: string[] = [];
const phones: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let ip = 0;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.73.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}
const intl = (local: string) => `255${local.slice(1)}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const A = { lat: -7.9, lng: 35.1 };
const B = { lat: -7.915, lng: 35.11 };
const NEAR_B = { lat: -7.9145, lng: 35.11 };

async function makeUser(key: string, phone: string, name: string, mode: string | null, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode, phone_verified_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [intl(phone), name, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  phones.push(intl(phone));
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
  for (let i = 0; i < 60; i++) {
    const r = await ride(id);
    if (until(r)) return r;
    await wait(50);
  }
  return ride(id);
}
async function promoRide(driver: string) {
  assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.0005, lng: A.lng }, driver)).status, 200);
  const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
  assert.equal(res.status, 201, res.json.message);
  const rideId = res.json.data.id;
  const offer = (await call('GET', '/api/driver/state', undefined, driver)).json.data.offer;
  assert.equal(offer?.ride.id, rideId, 'dereva hakupata ombi');
  assert.equal((await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, driver)).status, 200);
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, driver)).status, 200);
  const pin = (await call('GET', '/api/rides/current', undefined, 'p1')).json.data.pin;
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, { pin }, driver)).status, 200);
  await db.query(`UPDATE naya.rides SET started_at = now() - interval '6 minutes' WHERE id = $1`, [rideId]);
  await call('POST', '/api/driver/location', NEAR_B, driver);
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/complete`, {}, driver)).status, 200);
  await call('POST', `/api/rides/${rideId}/close`, {}, 'p1');
  await call('POST', `/api/driver/rides/${rideId}/close`, {}, driver);
  await call('POST', '/api/driver/online', { online: false }, driver);
  return rideId as string;
}

let pausedBefore: string[] = [];
let feeBefore: unknown = null;
let payoutBefore: unknown = null;
before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  pausedBefore = (await db.query(`UPDATE naya.promotions SET status = 'PAUSED' WHERE status = 'ACTIVE' RETURNING id`)).rows.map((r) => r.id);
  feeBefore = (await db.query(`SELECT value FROM naya.settings WHERE key = 'subscription'`)).rows[0]?.value ?? null;
  payoutBefore = (await db.query(`SELECT value FROM naya.settings WHERE key = 'auto_payout'`)).rows[0]?.value ?? null;
  await db.query(
    `INSERT INTO naya.settings (key, value) VALUES ('subscription', '{"monthlyFee": 5000, "trialDays": 30, "graceDays": 3, "paymentInstructions": "Lipa ofisini."}')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
  await db.query(`INSERT INTO naya.settings (key, value) VALUES ('auto_payout', '{"enabled": true, "dailyLimit": 10000, "minPayout": 1000}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  // Majaribio haya ni ya malipo ya ofa ya MOJA KWA MOJA (si wallet) — mfumo huo bado unapatikana kwenye mipangilio.
  await db.query(`INSERT INTO naya.settings (key, value) VALUES ('driver_wallet', '{"promoToWallet": false}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  for (const [name, p] of [[`Pickup NL${s}`, A], [`Dest NL${s}`, B]] as const) {
    const r = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(r.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 3000, 0, 3000, 100, 1.3), ('BAJAJI', 4000, 0, 4000, 100, 1.3)`,
  );
  await makeUser('admin', `0790${s}`, 'Ofisi Majina', null, 'ADMIN');
  await makeUser('p1', `0791${s}`, `Abiria Majina ${s}`, 'PASSENGER');
  await makeDriver('d1', `0754${s}`, `Boda Majina ${s}`, `MC ${s.slice(-3)} NL1`);
  await makeDriver('d2', `0756${s}`, `Boda Kikomo ${s}`, `MC ${s.slice(-3)} NL2`);
  const promo = await call('POST', '/api/admin/promotions', { name: `Majina ${s}`, title: 'Nusu bei', audience: 'ALL', discountPercent: 50 }, 'admin');
  promoIds.push(promo.json.data.id);
  await call('POST', `/api/admin/promotions/${promo.json.data.id}/status`, { status: 'ACTIVE' }, 'admin');
});

after(async () => {
  await db.query(`DELETE FROM naya.settings WHERE key = 'driver_wallet'`);
  delete process.env.SIM_NAMES;
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
  if (payoutBefore) await db.query(`UPDATE naya.settings SET value = $1 WHERE key = 'auto_payout'`, [JSON.stringify(payoutBefore)]);
  await db.query(`UPDATE naya.settings SET updated_by = NULL WHERE updated_by = ANY($1::uuid[])`, [userIds]);
  await db.query(`DELETE FROM naya.phone_names WHERE phone LIKE $1 OR phone LIKE $2 OR phone IN ('255754128888', '255754129999')`, [`%${s}`, `2557650%${s.slice(-3)}`]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

describe('Jina la mwenye namba', () => {
  it('kulinganisha majina na herufi', () => {
    assert.equal(titleCase('AULERIA GERVAS NANGALE'), 'Auleria Gervas Nangale');
    assert.equal(namesMatch('JOHN JUMA DOE', 'John Doe'), true);
    assert.equal(namesMatch('JOHN JUMA DOE', 'Asha Ali'), false);
    assert.equal(namesMatch(null, 'Asha'), false);
  });

  it('dereva anaandika namba → jina na mtandao; abiria → 403; bila kuingia → 401', async () => {
    const r = await call('POST', '/api/name-lookup', { phone: `0754 ${s.slice(0, 3)} ${s.slice(3)}`, purpose: 'PAYOUT' }, 'd1');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.available, true);
    assert.equal(r.json.data.found, true);
    assert.equal(r.json.data.name, `MTEJA MAJARIBIO ${s.slice(-4)}`);
    assert.equal(r.json.data.displayName, `Mteja Majaribio ${s.slice(-4)}`);
    assert.equal(r.json.data.network, 'MPESA');
    assert.equal((await call('POST', '/api/name-lookup', { phone: `0754${s}` }, 'p1')).status, 403);
    assert.equal((await call('POST', '/api/name-lookup', { phone: `0754${s}` })).status, 401);
    const nf = await call('POST', '/api/name-lookup', { phone: '0754128888' }, 'd1');
    assert.equal(nf.json.data.found, false);
    assert.equal(nf.json.data.available, true);
    const down = await call('POST', '/api/name-lookup', { phone: '0754129999' }, 'd1');
    assert.equal(down.json.data.available, false);
    // ofisi pia
    assert.equal((await call('POST', '/api/name-lookup', { phone: `0754${s}`, purpose: 'STAFF' }, 'admin')).json.data.found, true);
    // kila ombi linaandikwa
    const logged = await db.query('SELECT count(*)::int AS n FROM naya.name_lookups WHERE user_id = $1', [ids.d1]);
    assert.ok(logged.rows[0].n >= 2);
  });

  it('kikomo: dereva namba 15 tofauti kwa saa 24; namba ileile tena haihesabiwi', async () => {
    for (let i = 0; i < 15; i++) {
      const r = await call('POST', '/api/name-lookup', { phone: `07650${String(i).padStart(2, '0')}${s.slice(-3)}` }, 'd2');
      assert.equal(r.status, 200, `${i}: ${r.json.message}`);
    }
    assert.equal((await call('POST', '/api/name-lookup', { phone: `0765099${s.slice(-3)}` }, 'd2')).status, 429);
    assert.equal((await call('POST', '/api/name-lookup', { phone: `0765000${s.slice(-3)}` }, 'd2')).status, 200);
    await db.query('DELETE FROM naya.name_lookups WHERE user_id = $1', [ids.d2]);
  });

  it('ofisi → Ongeza staff: namba mpya inaleta jina la mtandao', async () => {
    const r = await call('POST', '/api/admin/staff/lookup', { phone: `0762${s}` }, 'admin');
    assert.equal(r.status, 200);
    assert.equal(r.json.data.exists, false);
    assert.equal(r.json.data.networkName, `Mteja Majaribio ${s.slice(-4)}`);
  });
});

describe('Namba za malipo zinazothibitishwa na mtandao', () => {
  it('bila jina → jina la mtandao linahifadhiwa (imethibitishwa); namba isiyothibitishwa → 409', async () => {
    const r = await call('POST', '/api/driver/payout-accounts', { network: 'MPESA', phone: `0754${s}` }, 'd1');
    assert.equal(r.status, 200, r.json.message);
    const a = r.json.data[0];
    assert.equal(a.accountName, `MTEJA MAJARIBIO ${s.slice(-4)}`);
    assert.equal(a.verified, true);
    assert.equal(a.nameChanged, null);
    assert.equal((await call('POST', '/api/driver/payout-accounts', { network: 'MPESA', phone: '0754128888' }, 'd1')).status, 409);
  });

  it('huduma isipopatikana: jina la dereva mwenyewe linahitajika', async () => {
    assert.equal((await call('POST', '/api/driver/payout-accounts', { network: 'MPESA', phone: '0754129999' }, 'd2')).status, 400);
    const r = await call('POST', '/api/driver/payout-accounts', { network: 'MPESA', phone: '0754129999', accountName: 'Boda Kikomo' }, 'd2');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data[0].verified, false);
    assert.equal(r.json.data[0].accountName, 'Boda Kikomo');
  });

  it('kinga: jina la namba likibadilika kwenye mtandao → pesa HAITUMWI; dereva akithibitisha upya → inatumwa', async () => {
    // Laini "imehamishwa": mtandao sasa unasema ni ya mtu mwingine (na cache ni ya zamani)
    process.env.SIM_NAMES = `${intl(`0754${s}`)}=ASHA ALI MUSSA`;
    await db.query(`UPDATE naya.phone_names SET checked_at = now() - interval '2 days' WHERE phone = $1`, [intl(`0754${s}`)]);
    const rideId = await promoRide('d1');
    const r = await rideState(rideId, (x) => x.promo_payout_state === 'FAILED');
    assert.equal(r.promo_payout_state, 'FAILED');
    assert.match(r.promo_payout_note, /^Jina la namba ya malipo limebadilika/);
    const sent = await db.query(`SELECT count(*)::int AS n FROM naya.payments WHERE user_id = $1 AND kind = 'PROMO_PAYOUT' AND status = 'SUCCESS'`, [ids.d1]);
    assert.equal(sent.rows[0].n, 0);
    const wallet = (await call('GET', '/api/driver/promo-wallet', undefined, 'd1')).json.data;
    assert.equal(wallet.accounts[0].nameChanged.to, 'ASHA ALI MUSSA');
    const note = await db.query(`SELECT 1 FROM naya.notifications WHERE user_id = $1 AND kind = 'payout_name_changed'`, [ids.d1]);
    assert.equal(note.rowCount, 1);
    // Safari inayofuata inasubiri (HELD) bila kujaribu kutuma
    const second = await promoRide('d1');
    const r2 = await rideState(second, (x) => x.promo_payout_state === 'HELD');
    assert.equal(r2.promo_payout_state, 'HELD');
    // Dereva anathibitisha upya (ni namba yake kweli) → zote zinatumwa
    const again = await call('POST', '/api/driver/payout-accounts', { id: wallet.accounts[0].id, network: 'MPESA', phone: `0754${s}`, primary: true }, 'd1');
    assert.equal(again.status, 200, again.json.message);
    assert.equal(again.json.data[0].nameChanged, null);
    assert.equal(again.json.data[0].accountName, 'ASHA ALI MUSSA');
    const paid = await rideState(rideId, (x) => x.promo_payout_state === 'PAID');
    assert.equal(paid.promo_payout_state, 'PAID');
    assert.equal((await ride(second)).promo_payout_state, 'PAID');
    delete process.env.SIM_NAMES;
  });
});

describe('Control number ya ada ya mwezi', () => {
  let cn: any;
  it('dereva anapata control number ya kiasi kamili; ombi la pili la miezi ileile → ileile', async () => {
    const r = await call('POST', '/api/driver/subscription/control-number', { months: 2 }, 'd1');
    assert.equal(r.status, 200, r.json.message);
    cn = r.json.data;
    assert.equal(cn.status, 'PENDING');
    assert.equal(cn.channel, 'CONTROL_NUMBER');
    assert.match(cn.controlNumber, /^\d{6,}$/);
    assert.equal(cn.amount, 10000);
    assert.equal(cn.months, 2);
    assert.ok(cn.expiresAt);
    assert.equal((await call('POST', '/api/driver/subscription/control-number', { months: 2 }, 'd1')).json.data.id, cn.id);
    const sub = (await call('GET', '/api/driver/subscription', undefined, 'd1')).json.data;
    assert.equal(sub.online.controlNumbers, true);
    assert.equal(sub.online.control.length, 1);
    assert.equal(sub.online.pending, null); // si ombi la PIN
    // abiria / asiye dereva → hapana
    assert.notEqual((await call('POST', '/api/driver/subscription/control-number', { months: 1 }, 'p1')).status, 200);
  });

  it('haiishi muda baada ya dakika 15 kama ombi la PIN (inasubiri siku 7); worker haiiulizi kila dakika', async () => {
    await db.query(`UPDATE naya.payments SET created_at = now() - interval '1 hour', updated_at = now() - interval '1 hour' WHERE id = $1`, [cn.id]);
    const p = (await call('GET', `/api/payments/${cn.id}`, undefined, 'd1')).json.data;
    assert.equal(p.status, 'PENDING');
    // imeulizwa sasa hivi → worker inairuka mpaka dakika 10 zipite
    const before = (await db.query('SELECT updated_at FROM naya.payments WHERE id = $1', [cn.id])).rows[0].updated_at;
    await checkPendingPayments();
    const afterRow = (await db.query('SELECT updated_at, status FROM naya.payments WHERE id = $1', [cn.id])).rows[0];
    assert.equal(afterRow.status, 'PENDING');
    assert.equal(new Date(afterRow.updated_at).getTime(), new Date(before).getTime());
    // ombi la PIN bado linaruhusiwa (control number haizuii)
    const push = await call('POST', '/api/driver/subscription/pay', { months: 1, network: 'MPESA', phone: `0754${s}` }, 'd1');
    assert.equal(push.status, 200, push.json.message);
    await call('POST', `/api/payments/simulator/${push.json.data.reference}`, { success: false });
  });

  it('dereva akilipa → siku 60 zinaongezwa zenyewe, kumbukumbu ni "CONTROL"', async () => {
    const before = await paidUntil('d1');
    const r = await call('POST', `/api/payments/simulator/${cn.reference}`, { success: true });
    assert.equal(r.status, 200);
    const afterTs = await paidUntil('d1');
    assert.ok(Math.abs(afterTs - before - 60 * 86400_000) < 120_000, `${(afterTs - before) / 86400_000} siku`);
    const sp = await db.query('SELECT method, note FROM naya.subscription_payments WHERE payment_id = $1', [cn.id]);
    assert.equal(sp.rows[0].method, 'CONTROL');
    assert.match(sp.rows[0].note, /control number/);
    assert.equal((await call('GET', '/api/driver/subscription', undefined, 'd1')).json.data.online.control.length, 0);
  });

  it('control number iliyoisha muda → FAILED; ikilipwa baadaye bado inakubaliwa (pesa ya dereva haipotei)', async () => {
    const r = (await call('POST', '/api/driver/subscription/control-number', { months: 1 }, 'd1')).json.data;
    await db.query(
      `UPDATE naya.payments SET created_at = now() - interval '8 days', meta = meta || jsonb_build_object('expiresAt', to_json(now() - interval '1 day') #>> '{}') WHERE id = $1`,
      [r.id],
    );
    const p = (await call('GET', `/api/payments/${r.id}`, undefined, 'd1')).json.data;
    assert.equal(p.status, 'FAILED');
    const before = await paidUntil('d1');
    await call('POST', `/api/payments/simulator/${r.reference}`, { success: true });
    assert.equal((await call('GET', `/api/payments/${r.id}`, undefined, 'd1')).json.data.status, 'SUCCESS');
    assert.ok((await paidUntil('d1')) > before);
  });

  it('kikomo: control number 3 zisizolipwa', async () => {
    for (const m of [1, 2, 3]) assert.equal((await call('POST', '/api/driver/subscription/control-number', { months: m }, 'd1')).status, 200);
    assert.equal((await call('POST', '/api/driver/subscription/control-number', { months: 4 }, 'd1')).status, 409);
  });
});
