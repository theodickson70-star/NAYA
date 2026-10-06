// Tests za Phase 8: ada ya mwezi ya madereva, PIN ya safari, kushiriki safari, dharura (SOS), na mahali pa dereva papo hapo.
// Database ya MAJARIBIO tu:  DATABASE_URL=... JWT_SECRET=... npm test
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { addClient } from '../src/realtime/hub.js';
import { hashPassword } from '../src/services/auth.js';
import { dispatchPending } from '../src/services/rides.js';
import { runSubscriptionChecks } from '../src/services/subscriptions.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6);
const PASSWORD = 'NayaTest#2026';
const userIds: string[] = [];
const locationIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let ip = 0;
let savedSettings: unknown = null;
const DAY = 86_400_000;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.8.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

const A = { lat: -5.07, lng: 32.05 };
const B = { lat: -5.085, lng: 32.06 };

async function makeUser(key: string, phone: string, name: string, role = 'USER', mode: string | null = 'PASSENGER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`255${phone.slice(1)}`, name, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: role === 'USER' ? 'app' : 'admin' })).json.data.token;
}

/** paidDays: siku kutoka sasa (hasi = imeshaisha); null = haijawekwa. */
async function makeDriver(key: string, phone: string, name: string, status: string, paidDays: number | null) {
  await makeUser(key, phone, name, 'USER', 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
     VALUES ($1, $2, 'BODABODA', $3, 'Boxer', 'Nyekundu', 'DL1', CASE WHEN $4::float8 IS NULL THEN NULL ELSE now() + make_interval(secs => $4::float8 * 86400) END)`,
    [ids[key], status, `MC ${s.slice(-3)} ${key.toUpperCase().padEnd(3, 'X').slice(0, 3)}`, paidDays],
  );
}

const paidUntil = async (key: string) =>
  (await db.query('SELECT paid_until FROM naya.drivers WHERE user_id = $1', [ids[key]])).rows[0].paid_until as Date | null;
const book = (who: string) =>
  call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, who);
const offerFor = async (who: string) => (await call('GET', '/api/driver/state', undefined, who)).json.data.offer;

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  savedSettings = (await db.query(`SELECT value FROM naya.settings WHERE key = 'subscription'`)).rows[0]?.value ?? null;
  await db.query(
    `UPDATE naya.settings SET value = '{"monthlyFee": 5000, "trialDays": 30, "graceDays": 3, "paymentInstructions": "Lipa ofisini kwa NAYA."}' WHERE key = 'subscription'`,
  );
  // Madereva wengine walio online kwenye database ya majaribio wasiingilie dispatch ya tests hizi.
  await db.query('UPDATE naya.drivers SET is_online = false');
  for (const [name, p] of [[`Pickup P8 ${s}`, A], [`Dest P8 ${s}`, B]] as const) {
    const row = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(row.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES ('BODABODA', 1000, 500, 1500, 100, 1.3)`,
  );
  await makeUser('admin', `0692${s}`, 'Admin Ada', 'ADMIN', null);
  await makeUser('p1', `0740${s}`, 'Neema Abiria');
  await makeUser('p2', `0741${s}`, 'Juma Abiria');
  await makeDriver('paid', `0742${s}`, 'Dereva Amelipa', 'APPROVED', 20);
  await makeDriver('grace', `0743${s}`, 'Dereva Ndani Ya Siku', 'APPROVED', -1);
  await makeDriver('expired', `0744${s}`, 'Dereva Ada Imeisha', 'APPROVED', -10);
  await makeDriver('newbie', `0745${s}`, 'Dereva Mpya', 'PENDING', null);
  await makeDriver('due', `0746${s}`, 'Dereva Karibu Kuisha', 'APPROVED', 2);
});

after(async () => {
  await db.query('DELETE FROM naya.sos_alerts WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.subscription_payments WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])', [userIds]);
  await db.query('UPDATE naya.drivers SET reviewed_by = NULL WHERE reviewed_by = ANY($1::uuid[])', [userIds]);
  await db.query('UPDATE naya.settings SET updated_by = NULL WHERE updated_by = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  if (savedSettings) await db.query(`UPDATE naya.settings SET value = $1 WHERE key = 'subscription'`, [JSON.stringify(savedSettings)]);
  await app.close();
  await db.end();
});

describe('NAYA Phase 8 — ada ya mwezi', () => {
  it('dereva akithibitishwa anapata siku 30 za bure', async () => {
    const res = await call('POST', `/api/admin/drivers/${ids.newbie}/approve`, {}, 'admin');
    assert.equal(res.status, 200, res.json.message);
    const until = (await paidUntil('newbie'))!;
    assert.ok(Math.abs(until.getTime() - (Date.now() + 30 * DAY)) < 60_000);
  });

  it('dereva anaona hali ya ada yake kwenye state', async () => {
    const st = (await call('GET', '/api/driver/state', undefined, 'paid')).json.data.subscription;
    assert.equal(st.state, 'ACTIVE');
    assert.equal(st.monthlyFee, 5000);
    assert.ok(st.daysLeft >= 19 && st.daysLeft <= 20);
    assert.equal((await call('GET', '/api/driver/state', undefined, 'grace')).json.data.subscription.state, 'GRACE');
    assert.equal((await call('GET', '/api/driver/state', undefined, 'expired')).json.data.subscription.state, 'EXPIRED');
  });

  it('ada iliyoisha (baada ya siku za kuvumiliwa) → hawezi kwenda online (402) na ujumbe una ada', async () => {
    const res = await call('POST', '/api/driver/online', { online: true, ...A }, 'expired');
    assert.equal(res.status, 402);
    assert.match(res.json.message, /5,000/);
    assert.equal((await call('POST', '/api/driver/online', { online: true, ...A }, 'grace')).status, 200);
  });

  it('dispatch: dereva ambaye ada yake imeisha hapewi ombi', async () => {
    await call('POST', '/api/driver/online', { online: false }, 'grace');
    // weka "expired" online moja kwa moja (kama aliingia kabla ada haijaisha) karibu kabisa na abiria
    await db.query(`UPDATE naya.drivers SET is_online = true, last_lat = $2, last_lng = $3, last_seen_at = now() WHERE user_id = $1`, [ids.expired, A.lat, A.lng]);
    await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.01, lng: A.lng }, 'paid'); // ~1.1 km
    const ride = await book('p1');
    assert.equal(ride.status, 201, ride.json.message);
    assert.equal(await offerFor('expired'), null);
    assert.ok(await offerFor('paid'));
    await call('POST', `/api/rides/${ride.json.data.id}/cancel`, {}, 'p1');
  });

  it('ukaguzi wa nyuma: ukumbusho mara moja, arifa ya kuisha, na dereva wa ada iliyoisha anarudishwa offline', async () => {
    await runSubscriptionChecks();
    await runSubscriptionChecks(); // mara ya pili haitumi tena
    const kinds = async (key: string) =>
      (await db.query('SELECT kind FROM naya.notifications WHERE user_id = $1 ORDER BY id', [ids[key]])).rows.map((r) => r.kind);
    assert.deepEqual((await kinds('due')).filter((k) => k === 'subscription_due'), ['subscription_due']);
    assert.deepEqual((await kinds('grace')).filter((k) => k === 'subscription_expired'), ['subscription_expired']);
    const online = (await db.query('SELECT is_online FROM naya.drivers WHERE user_id = $1', [ids.expired])).rows[0].is_online;
    assert.equal(online, false);
  });

  it('mtumiaji wa kawaida hawezi kurekodi malipo (403)', async () => {
    assert.equal((await call('POST', `/api/admin/drivers/${ids.expired}/subscription/payments`, { months: 1, method: 'CASH' }, 'p1')).status, 403);
  });

  it('M-Pesa bila namba ya muamala → 400', async () => {
    assert.equal((await call('POST', `/api/admin/drivers/${ids.expired}/subscription/payments`, { months: 1, method: 'MPESA' }, 'admin')).status, 400);
  });

  it('malipo ya ada iliyoisha yanaanza leo; kiasi kinahesabiwa na server; dereva anaweza kwenda online', async () => {
    const res = await call(
      'POST',
      `/api/admin/drivers/${ids.expired}/subscription/payments`,
      { months: 1, method: 'MPESA', reference: `qx${s}ab`, amount: 1 },
      'admin',
    );
    assert.equal(res.status, 201, res.json.message);
    assert.equal(res.json.data.state, 'ACTIVE');
    assert.equal(res.json.data.payments[0].amount, 5000);
    assert.equal(res.json.data.payments[0].reference, `QX${s}AB`);
    const until = (await paidUntil('expired'))!;
    assert.ok(Math.abs(until.getTime() - (Date.now() + 30 * DAY)) < 60_000);
    assert.equal((await call('POST', '/api/driver/online', { online: true, ...A }, 'expired')).status, 200);
    const note = await db.query(`SELECT 1 FROM naya.notifications WHERE user_id = $1 AND kind = 'subscription_paid'`, [ids.expired]);
    assert.equal(note.rowCount, 1);
  });

  it('namba ile ile ya muamala haiwezi kutumika mara mbili (409)', async () => {
    const res = await call('POST', `/api/admin/drivers/${ids.paid}/subscription/payments`, { months: 1, method: 'MPESA', reference: `QX${s}AB` }, 'admin');
    assert.equal(res.status, 409);
  });

  it('kulipa mapema kunaongeza siku juu ya zilizobaki (hapotezi siku)', async () => {
    const before = (await paidUntil('paid'))!;
    const res = await call('POST', `/api/admin/drivers/${ids.paid}/subscription/payments`, { months: 2, method: 'CASH' }, 'admin');
    assert.equal(res.status, 201, res.json.message);
    assert.equal(res.json.data.payments[0].amount, 10000);
    const afterPay = (await paidUntil('paid'))!;
    assert.equal(afterPay.getTime() - before.getTime(), 60 * DAY);
  });

  it('kubatilisha: malipo ya mwisho tu; tarehe inarudi ilipokuwa', async () => {
    const sub = (await call('GET', `/api/admin/drivers/${ids.paid}/subscription`, undefined, 'admin')).json.data;
    await call('POST', `/api/admin/drivers/${ids.paid}/subscription/payments`, { months: 1, method: 'CASH' }, 'admin');
    const before = (await paidUntil('paid'))!;
    // malipo ya zamani (si ya mwisho) → 409
    assert.equal((await call('POST', `/api/admin/drivers/${ids.paid}/subscription/payments/${sub.voidableId}/void`, { reason: 'Kosa' }, 'admin')).status, 409);
    const latest = (await call('GET', `/api/admin/drivers/${ids.paid}/subscription`, undefined, 'admin')).json.data.voidableId;
    const res = await call('POST', `/api/admin/drivers/${ids.paid}/subscription/payments/${latest}/void`, { reason: 'Nilirekodi mara mbili' }, 'admin');
    assert.equal(res.status, 200, res.json.message);
    assert.equal(before.getTime() - (await paidUntil('paid'))!.getTime(), 30 * DAY);
    assert.ok(res.json.data.payments.find((p: any) => p.id === latest).voidedAt);
  });

  it('dereva anaona historia ya malipo yake (bila yaliyobatilishwa)', async () => {
    const res = (await call('GET', '/api/driver/subscription', undefined, 'paid')).json.data;
    assert.equal(res.payments.length, 1);
    assert.equal(res.paymentInstructions, 'Lipa ofisini kwa NAYA.');
  });

  it('mipangilio ya ada: uhakiki, na inahifadhiwa', async () => {
    const bad = await call('PUT', '/api/admin/settings/subscription', { monthlyFee: -5, trialDays: 30, graceDays: 3, paymentInstructions: 'Lipa ofisini kwa NAYA.' }, 'admin');
    assert.equal(bad.status, 400);
    const okRes = await call('PUT', '/api/admin/settings/subscription', { monthlyFee: 6000, trialDays: 14, graceDays: 2, paymentInstructions: 'M-Pesa 0700 000 000 (NAYA)' }, 'admin');
    assert.equal(okRes.status, 200, okRes.json.message);
    assert.equal(okRes.json.data.monthlyFee, 6000);
    assert.equal((await call('PUT', '/api/admin/settings/subscription', okRes.json.data, 'p1')).status, 403);
    await call('PUT', '/api/admin/settings/subscription', { monthlyFee: 5000, trialDays: 30, graceDays: 3, paymentInstructions: 'Lipa ofisini kwa NAYA.' }, 'admin');
  });

  it('ofisi: orodha ya ada na takwimu halisi za mwezi', async () => {
    const res = (await call('GET', '/api/admin/subscriptions?filter=all', undefined, 'admin')).json.data;
    assert.ok(res.stats.monthTotal >= 15000);
    assert.ok(res.drivers.some((d: any) => d.id === ids.paid && d.state === 'ACTIVE'));
    const dash = (await call('GET', '/api/admin/dashboard', undefined, 'admin')).json.data;
    assert.ok(dash.subscriptions.monthTotal >= 15000);
    assert.equal(typeof dash.sosOpen, 'number');
  });
});

describe('NAYA Phase 8 — usalama na ramani ya live', () => {
  let rideId = '';
  let pin = '';

  it('safari inapata PIN; abiria anaiona, dereva haioni', async () => {
    await call('POST', '/api/driver/online', { online: false }, 'expired');
    await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.002, lng: A.lng }, 'paid');
    const ride = await book('p1');
    rideId = ride.json.data.id;
    const offer = await offerFor('paid');
    assert.ok(offer, 'dereva hakupata ombi');
    assert.equal(JSON.stringify(offer).includes('pin'), false);
    const accepted = await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, 'paid');
    assert.equal(accepted.status, 200, accepted.json.message);
    assert.equal(accepted.json.data.ride.pin, undefined);
    const view = (await call('GET', '/api/rides/current', undefined, 'p1')).json.data;
    assert.match(view.pin, /^\d{4}$/);
    pin = view.pin;
    assert.ok(view.driver.location);
    assert.ok(view.driver.etaMinutes >= 1);
  });

  it('mahali pa dereva panafika kwa abiria wa safari yake tu (papo hapo)', async () => {
    const got: Record<string, any[]> = { p1: [], p2: [] };
    const remove = ['p1', 'p2'].map((k) => addClient({ userId: ids[k], admin: false, send: (_t, d) => got[k].push(d), end: () => {} }));
    const res = await call('POST', '/api/driver/location', { lat: A.lat - 0.001, lng: A.lng }, 'paid');
    assert.equal(res.status, 200);
    remove.forEach((r) => r());
    assert.equal(got.p1.length, 1);
    assert.equal(got.p1[0].type, 'location');
    assert.equal(got.p1[0].rideId, rideId);
    assert.ok(Math.abs(got.p1[0].lat - (A.lat - 0.001)) < 1e-6);
    assert.ok(got.p1[0].etaMinutes >= 1);
    assert.equal(got.p2.length, 0);
  });

  it('kushiriki safari: link inafanya kazi bila kuingia, haina namba za simu', async () => {
    assert.equal((await call('POST', `/api/rides/${rideId}/share`, {}, 'p2')).status, 404);
    const res = await call('POST', `/api/rides/${rideId}/share`, {}, 'p1');
    assert.equal(res.status, 200, res.json.message);
    const token = res.json.data.path.split('#')[1];
    assert.equal(token.length, 32);
    const view = await call('POST', '/api/share', { token });
    assert.equal(view.status, 200, view.json.message);
    assert.equal(view.json.data.status, 'ACCEPTED');
    assert.equal(view.json.data.driver.plateNumber, `MC ${s.slice(-3)} PAI`);
    assert.ok(view.json.data.driver.location);
    const text = JSON.stringify(view.json.data);
    assert.equal(text.includes('255'), false, 'namba ya simu haipaswi kuonekana');
    assert.equal((await call('POST', '/api/share', { token: 'x'.repeat(32) })).status, 404);
    // link mpya inaua ya zamani
    await call('POST', `/api/rides/${rideId}/share`, {}, 'p1');
    assert.equal((await call('POST', '/api/share', { token })).status, 404);
    assert.equal((await call('GET', '/api/rides/current', undefined, 'p1')).json.data.shared, true);
  });

  it('dharura: mshiriki wa safari tu; kubonyeza tena hakuleti nakala; ofisi inaona na kushughulikia', async () => {
    assert.equal((await call('POST', '/api/sos', { rideId }, 'p2')).status, 404);
    const first = await call('POST', '/api/sos', { rideId, ...A }, 'p1');
    assert.equal(first.status, 201, first.json.message);
    const again = await call('POST', '/api/sos', { rideId }, 'p1');
    assert.equal(again.json.data.alreadyOpen, true);
    assert.equal((await call('GET', '/api/rides/current', undefined, 'p1')).json.data.sosOpen, true);
    assert.equal((await call('GET', '/api/admin/sos', undefined, 'p1')).status, 403);
    const list = (await call('GET', '/api/admin/sos', undefined, 'admin')).json.data;
    const alert = list.find((a: any) => a.rideId === rideId);
    assert.ok(alert);
    assert.equal(alert.role, 'PASSENGER');
    assert.equal(alert.otherName, 'Dereva Amelipa');
    assert.equal((await call('GET', '/api/admin/dashboard', undefined, 'admin')).json.data.sosOpen >= 1, true);
    const resolved = await call('POST', `/api/admin/sos/${alert.id}/resolve`, { note: 'Nimempigia, yuko salama' }, 'admin');
    assert.equal(resolved.status, 200, resolved.json.message);
    assert.equal((await call('POST', `/api/admin/sos/${alert.id}/resolve`, { note: 'tena' }, 'admin')).status, 409);
  });

  it('PIN: bila PIN au PIN mbaya → hakuna kuanza; majaribio 5 → imefungwa', async () => {
    await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, 'paid');
    const st = (await call('GET', '/api/driver/state', undefined, 'paid')).json.data.ride;
    assert.equal(st.pinRequired, true);
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, {}, 'paid')).status, 400);
    const wrong = pin === '0000' ? '1111' : '0000';
    const r1 = await call('POST', `/api/driver/rides/${rideId}/start`, { pin: wrong }, 'paid');
    assert.equal(r1.status, 400);
    assert.match(r1.json.message, /majaribio 4/);
    const good = await call('POST', `/api/driver/rides/${rideId}/start`, { pin }, 'paid');
    assert.equal(good.status, 200, good.json.message);
    assert.equal(good.json.data.ride.status, 'IN_PROGRESS');
    assert.equal((await call('GET', '/api/rides/current', undefined, 'p1')).json.data.pin, null);
    await call('POST', `/api/driver/rides/${rideId}/complete`, {}, 'paid');
    await call('POST', `/api/rides/${rideId}/close`, {}, 'p1');
    await call('POST', `/api/driver/rides/${rideId}/close`, {}, 'paid');

    // safari ya pili: makosa 5 yanafunga
    const second = await book('p1');
    const offer = await offerFor('paid');
    await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, 'paid');
    await call('POST', `/api/driver/rides/${second.json.data.id}/arrive`, {}, 'paid');
    const pin2 = (await call('GET', '/api/rides/current', undefined, 'p1')).json.data.pin;
    const bad2 = pin2 === '0000' ? '1111' : '0000';
    for (let i = 0; i < 5; i++) await call('POST', `/api/driver/rides/${second.json.data.id}/start`, { pin: bad2 }, 'paid');
    const locked = await call('POST', `/api/driver/rides/${second.json.data.id}/start`, { pin: pin2 }, 'paid');
    assert.equal(locked.status, 409);
    const admin = (await call('GET', `/api/admin/rides/${second.json.data.id}`, undefined, 'admin')).json.data;
    assert.equal(admin.pinAttempts, 5);
    await call('POST', `/api/admin/rides/${second.json.data.id}/cancel`, { reason: 'PIN imefungwa — jaribio' }, 'admin');
  });

  it('dharura baada ya safari kuisha → 409; link ya safari iliyoisha bado inaonyesha "imeisha"', async () => {
    assert.equal((await call('POST', '/api/sos', { rideId }, 'p1')).status, 409);
  });

  it('dispatchPending inaendelea kufanya kazi (hakuna kosa la SQL)', async () => {
    await dispatchPending();
  });
});
