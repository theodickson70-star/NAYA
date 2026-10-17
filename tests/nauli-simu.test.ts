// 0.22.0 Nauli kwa simu — abiria analipa akifika (kampuni BANDIA ya majaribio: collect → PENDING mpaka simulator ithibitishe;
// namba inayoishia 0000 → ombi linashindwa papo hapo). Inakagua: ada juu ya nauli, pesa kwenye wallet ya dereva, namba 3,
// cash / deni, kuzuiwa kuagiza ukiwa na deni, kulipa deni, ofisi kufuta deni, malipo yaliyochelewa (mara mbili). DB ya majaribio tu.
process.env.PAYMENT_PROVIDER = 'simulator';

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { applyResult } from '../src/services/payments/index.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6).replace(/^0/, '1');
const PASSWORD = 'NayaTest#2026';
const PIN = '4827';
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
    remoteAddress: `10.75.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}
const intl = (local: string) => `255${local.slice(1)}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const A = { lat: -8.2, lng: 35.4 };
const B = { lat: -8.215, lng: 35.41 };
const NEAR_B = { lat: -8.2145, lng: 35.41 };

async function makeUser(key: string, phone: string, name: string, mode: string | null, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode, phone_verified_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [intl(phone), name, role, await hashPassword(PASSWORD), mode],
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
const wallet = async (who: string) => (await call('GET', '/api/driver/wallet', undefined, who)).json.data;
const ledgerSum = async (key: string) =>
  Number((await db.query('SELECT coalesce(sum(amount), 0) AS s FROM naya.wallet_entries WHERE driver_id = $1', [ids[key]])).rows[0].s);
const dbBalance = async (key: string) => (await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids[key]])).rows[0]?.balance;
const credit = (key: string, amount: number) => call('POST', `/api/admin/wallets/${ids[key]}/adjust`, { amount, reason: 'Majaribio ya wallet' }, 'admin');
const clearHold = (key: string) => db.query('UPDATE naya.wallets SET hold_until = NULL WHERE driver_id = $1', [ids[key]]);
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
  await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, driver);
  const pin = (await db.query('SELECT start_pin FROM naya.rides WHERE id = $1', [rideId])).rows[0].start_pin;
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, pin ? { pin } : {}, driver)).status, 200);
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
before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  pausedBefore = (await db.query(`UPDATE naya.promotions SET status = 'PAUSED' WHERE status = 'ACTIVE' RETURNING id`)).rows.map((r) => r.id);
  feeBefore = (await db.query(`SELECT value FROM naya.settings WHERE key = 'subscription'`)).rows[0]?.value ?? null;
  await db.query(
    `INSERT INTO naya.settings (key, value) VALUES ('subscription', '{"monthlyFee": 5000, "trialDays": 30, "graceDays": 3, "paymentInstructions": "Lipa ofisini."}')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
  await db.query(`DELETE FROM naya.settings WHERE key = 'driver_wallet'`); // chaguo-msingi: ofa → wallet
  for (const [name, p] of [[`Pickup N${s}`, A], [`Dest N${s}`, B]] as const) {
    const r = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(r.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 3000, 0, 3000, 100, 1.3), ('BAJAJI', 4000, 0, 4000, 100, 1.3)`,
  );
  await makeUser('admin', `0740${s}`, 'Ofisi Nauli', null, 'ADMIN');
  await makeUser('p1', `0741${s}`, `Abiria Nauli ${s}`, 'PASSENGER');
  await makeUser('p2', `0742${s}`, `Abiria Nauli Pili ${s}`, 'PASSENGER');
  await makeDriver('d1', `0744${s}`, `Boda Nauli ${s}`, `MC ${s.slice(-3)} NL1`);
  await makeDriver('d2', `0747${s}`, `Boda Nauli Pili ${s}`, `MC ${s.slice(-3)} NL2`);
  const promo = await call('POST', '/api/admin/promotions', { name: `Nauli ${s}`, title: 'Nusu bei', audience: 'ALL', discountPercent: 50 }, 'admin');
  promoIds.push(promo.json.data.id);
});


after(async () => {
  await db.query('DELETE FROM naya.wallet_entries WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.promo_payouts WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.subscription_payments WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('UPDATE naya.rides SET promo_payment_id = NULL, fare_payment_id = NULL WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.payments WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.ride_offers WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])', [userIds]);
  await db.query(`DELETE FROM naya.audit_logs WHERE action = 'ride_fare.double_paid' AND details->>'reference' LIKE 'NYN%' AND created_at > now() - interval '1 hour'`);
  await db.query('DELETE FROM naya.promotions WHERE id = ANY($1::uuid[])', [promoIds]);
  await db.query(`UPDATE naya.promotions SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])`, [pausedBefore]);
  if (feeBefore) await db.query(`UPDATE naya.settings SET value = $1 WHERE key = 'subscription'`, [JSON.stringify(feeBefore)]);
  await db.query(`DELETE FROM naya.settings WHERE key IN ('driver_wallet', 'ride_payments')`);
  await db.query(`UPDATE naya.settings SET updated_by = NULL WHERE updated_by = ANY($1::uuid[])`, [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

const passengerRide = async (rideId: string) => {
  const r = (await call('GET', '/api/rides/current', undefined, 'p1')).json.data;
  assert.equal(r?.id, rideId, 'safari ya sasa ya abiria');
  return r;
};
const enable = (on = true) => call('PUT', '/api/admin/settings/ride-payments', { enabled: on, feePercent: 3, feeMin: 100 }, 'admin');
const lastPay = async (pax = 'p1') => (await db.query(`SELECT * FROM naya.payments WHERE user_id = $1 AND kind = 'RIDE_FARE' ORDER BY created_at DESC LIMIT 1`, [ids[pax]])).rows[0];
const confirm = (ref: string, success = true) => call('POST', `/api/payments/simulator/${ref}`, { success });
const closeRide = async (rideId: string, pax = 'p1') => {
  await call('POST', `/api/rides/${rideId}/close`, {}, pax);
};
async function plainRide(driver: string, pax = 'p1') {
  // Safari ya kawaida (ofa zimesimamishwa) — haifungwi, ili skrini ya "umefika" ibaki (malipo yanafanyika hapo)
  assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.0005, lng: A.lng }, driver)).status, 200);
  const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, pax);
  assert.equal(res.status, 201, res.json.message);
  const rideId = res.json.data.id;
  const offer = (await call('GET', '/api/driver/state', undefined, driver)).json.data.offer;
  assert.equal(offer?.ride.id, rideId, 'dereva hakupata ombi');
  assert.equal((await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, driver)).status, 200);
  await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, driver);
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, {}, driver)).status, 200);
  await db.query(`UPDATE naya.rides SET started_at = now() - interval '6 minutes' WHERE id = $1`, [rideId]);
  await call('POST', '/api/driver/location', NEAR_B, driver);
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/complete`, {}, driver)).status, 200);
  await call('POST', `/api/driver/rides/${rideId}/close`, {}, driver);
  await call('POST', '/api/driver/online', { online: false }, driver);
  return rideId as string;
}

describe('Nauli kwa simu — imezimwa (chaguo-msingi)', () => {
  it('ikizimwa: hakuna farePay, kulipa → 409, deni → 403, cash bado inaandikwa', async () => {
    const rideId = await plainRide('d1');
    const view = await passengerRide(rideId);
    assert.equal(view.status, 'COMPLETED');
    assert.equal(view.farePay, null);
    assert.equal((await call('POST', `/api/rides/${rideId}/pay`, { phone: `0741${s}` }, 'p1')).status, 409);
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/settle`, { how: 'DEBT' }, 'd1')).status, 403);
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/settle`, { how: 'CASH' }, 'd1')).status, 200);
    assert.equal((await db.query('SELECT fare_settlement FROM naya.rides WHERE id = $1', [rideId])).rows[0].fare_settlement, 'CASH');
  });
});

describe('Nauli kwa simu — imewashwa', () => {
  let rideId = '';
  it('ofisi inawasha (ada 3%, chini TSh 100); abiria anaona nauli + ada = jumla', async () => {
    const r = await enable();
    assert.equal(r.status, 200, r.json.message);
    rideId = await plainRide('d1');
    const v = (await passengerRide(rideId)).farePay;
    assert.equal(v.enabled, true);
    assert.equal(v.due, 3000);
    assert.equal(v.fee, 100); // 3% ya 3000 = 90 → chini 100
    assert.equal(v.total, 3100);
    assert.equal(v.canPay, true);
    assert.equal(v.numbersLeft, 3);
  });

  it('abiria analipa kwa simu → ombi linasubiri; dereva hawezi kuandika cash wakati huo; ikithibitishwa → wallet ya dereva +3000', async () => {
    const before = Number((await db.query('SELECT coalesce(balance, 0) AS b FROM naya.wallets WHERE driver_id = $1', [ids.d1])).rows[0]?.b ?? 0);
    const r = await call('POST', `/api/rides/${rideId}/pay`, { phone: `0741${s}` }, 'p1');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.status, 'PENDING');
    assert.equal(r.json.data.amount, 3100);
    assert.equal((await call('POST', `/api/rides/${rideId}/pay`, { phone: `0741${s}` }, 'p1')).status, 409, 'ombi moja kwa wakati');
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/settle`, { how: 'CASH' }, 'd1')).status, 409, 'abiria analipa sasa');
    const p = await lastPay();
    assert.equal(p.meta.fare, 3000);
    assert.equal(p.meta.fee, 100);
    await confirm(p.reference);
    await confirm(p.reference); // callback mara mbili → hakuna kuongeza mara mbili
    const ride = (await db.query('SELECT fare_settlement, fare_payment_id FROM naya.rides WHERE id = $1', [rideId])).rows[0];
    assert.equal(ride.fare_settlement, 'MOBILE');
    assert.equal(ride.fare_payment_id, p.id);
    const after = Number((await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids.d1])).rows[0].balance);
    assert.equal(after - before, 3000, 'dereva anapata nauli kamili (ada inabebwa na abiria)');
    const e = await db.query(`SELECT count(*)::int AS n FROM naya.wallet_entries WHERE ride_id = $1 AND kind = 'RIDE_EARNING'`, [rideId]);
    assert.equal(e.rows[0].n, 1);
    const note = await db.query(`SELECT 1 FROM naya.notifications WHERE user_id = $1 AND kind = 'ride_fare_wallet'`, [ids.d1]);
    assert.equal(note.rowCount, 1);
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/settle`, { how: 'DEBT' }, 'd1')).status, 409, 'imeshalipwa');
    assert.equal((await call('POST', `/api/rides/${rideId}/pay`, { phone: `0741${s}` }, 'p1')).status, 409, 'imeshalipwa');
    await closeRide(rideId);
  });

  it('namba zisizo na pesa: hadi namba 3 tofauti; ya nne → 409 (lipa taslimu); kurudia namba ileile kunaruhusiwa', async () => {
    const id = await plainRide('d1');
    for (const n of ['0741110000', '0742220000', '0743330000']) {
      const r = await call('POST', `/api/rides/${id}/pay`, { phone: n }, 'p1');
      assert.equal(r.status, 200, r.json.message);
      assert.equal(r.json.data.status, 'FAILED');
    }
    const v = (await passengerRide(id)).farePay;
    assert.equal(v.numbersLeft, 0);
    assert.equal(v.last.status, 'FAILED');
    assert.equal((await call('POST', `/api/rides/${id}/pay`, { phone: '0744440000' }, 'p1')).status, 409);
    assert.equal((await call('POST', `/api/rides/${id}/pay`, { phone: '0741110000' }, 'p1')).status, 200, 'namba ileile');
    assert.equal((await call('POST', `/api/driver/rides/${id}/settle`, { how: 'CASH' }, 'd1')).status, 200);
    await closeRide(id);
  });

  it('dereva: "Hajalipa" → deni; abiria anazuiwa kuagiza (402) mpaka alipe kwa simu; pesa inaenda wallet ya dereva', async () => {
    const id = await plainRide('d2');
    assert.equal((await call('POST', `/api/driver/rides/${id}/settle`, { how: 'DEBT' }, 'd1')).status, 404, 'si dereva wake');
    assert.equal((await call('POST', `/api/driver/rides/${id}/settle`, { how: 'DEBT' }, 'd2')).status, 200);
    await closeRide(id);
    const blocked = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
    assert.equal(blocked.status, 402);
    assert.match(blocked.json.message, /deni/i);
    const debt = (await call('GET', '/api/passenger/debt', undefined, 'p1')).json.data;
    assert.equal(debt.due, 3000);
    assert.equal(debt.total, 3100);
    assert.equal(debt.rides.length, 1);
    const before = Number((await db.query('SELECT coalesce(balance, 0) AS b FROM naya.wallets WHERE driver_id = $1', [ids.d2])).rows[0]?.b ?? 0);
    const pay = await call('POST', '/api/passenger/debt/pay', { phone: `0741${s}` }, 'p1');
    assert.equal(pay.status, 200, pay.json.message);
    assert.equal((await call('POST', '/api/passenger/debt/pay', { phone: `0741${s}` }, 'p1')).status, 409, 'ombi moja kwa wakati');
    await confirm((await lastPay()).reference);
    const r = (await db.query('SELECT fare_settlement, debt_cleared_at, debt_cleared_how FROM naya.rides WHERE id = $1', [id])).rows[0];
    assert.equal(r.fare_settlement, 'DEBT');
    assert.ok(r.debt_cleared_at);
    assert.equal(r.debt_cleared_how, 'MOBILE');
    const after = Number((await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids.d2])).rows[0].balance);
    assert.equal(after - before, 3000);
    assert.equal((await call('GET', '/api/passenger/debt', undefined, 'p1')).json.data.due, 0);
  });

  it('ofisi: orodha ya madeni, "Samehe deni" → abiria anaagiza tena, wallet haiguswi; si ofisi → 403', async () => {
    const id = await plainRide('d2');
    assert.equal((await call('POST', `/api/driver/rides/${id}/settle`, { how: 'DEBT' }, 'd2')).status, 200);
    await closeRide(id);
    const sum = (await call('GET', '/api/admin/ride-payments/summary', undefined, 'admin')).json.data;
    assert.ok(sum.debts.n >= 1);
    const list = (await call('GET', '/api/admin/ride-debts?open=1', undefined, 'admin')).json.data;
    assert.ok(list.some((d: any) => d.id === id && d.amount === 3000));
    assert.equal((await call('GET', '/api/admin/ride-debts', undefined, 'p1')).status, 403);
    const bal = Number((await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids.d2])).rows[0].balance);
    const c = await call('POST', `/api/admin/ride-debts/${id}/clear`, { how: 'FORGIVEN', note: 'Majaribio: amesamehewa' }, 'admin');
    assert.equal(c.status, 200, c.json.message);
    assert.equal((await call('POST', `/api/admin/ride-debts/${id}/clear`, { how: 'FORGIVEN', note: 'mara ya pili' }, 'admin')).status, 409);
    assert.equal(Number((await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids.d2])).rows[0].balance), bal);
    const ok2 = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
    assert.notEqual(ok2.status, 402, ok2.json.message);
    if (ok2.status === 201) await call('POST', `/api/rides/${ok2.json.data.id}/cancel`, { reason: 'Majaribio' }, 'p1');
  });

  it('ombi la PIN linazuia cash kwa dakika 3 tu; likithibitishwa baada ya dereva kuandika cash → hakuna kuongeza wallet, ofisi inajulishwa', async () => {
    const id = await plainRide('d1');
    const r = await call('POST', `/api/rides/${id}/pay`, { phone: `0741${s}` }, 'p1');
    assert.equal(r.status, 200, r.json.message);
    const p = await lastPay();
    assert.equal((await call('POST', `/api/driver/rides/${id}/settle`, { how: 'CASH' }, 'd1')).status, 409, 'ombi bado linasubiri');
    await db.query(`UPDATE naya.payments SET created_at = now() - interval '4 minutes' WHERE id = $1`, [p.id]);
    assert.equal((await call('POST', `/api/driver/rides/${id}/settle`, { how: 'CASH' }, 'd1')).status, 200, 'baada ya dakika 3');
    const bal = Number((await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids.d1])).rows[0].balance);
    await confirm(p.reference);
    assert.equal(Number((await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids.d1])).rows[0].balance), bal, 'dereva hapati mara mbili');
    assert.equal((await db.query('SELECT fare_settlement FROM naya.rides WHERE id = $1', [id])).rows[0].fare_settlement, 'CASH');
    const audit = await db.query(`SELECT 1 FROM naya.audit_logs WHERE action = 'ride_fare.double_paid' AND target_id = $1`, [p.id]);
    assert.equal(audit.rowCount, 1);
    await closeRide(id);
  });

  it('ombi lililoandikwa "limeshindwa" likithibitishwa baadaye kuwa limelipwa → linakubaliwa (pesa ya abiria haipotei)', async () => {
    const id = await plainRide('d1', 'p2');
    assert.equal((await call('POST', `/api/rides/${id}/pay`, { phone: `0741${s}` }, 'p2')).status, 200);
    const p = await lastPay('p2');
    await applyResult(p.reference, { status: 'FAILED', message: 'Kampuni ya malipo haikujibu' });
    assert.equal((await lastPay('p2')).status, 'FAILED');
    const bal = Number((await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids.d1])).rows[0].balance);
    await applyResult(p.reference, { status: 'SUCCESS', providerRef: 'LATE-OK' });
    assert.equal((await lastPay('p2')).status, 'SUCCESS');
    assert.equal((await db.query('SELECT fare_settlement FROM naya.rides WHERE id = $1', [id])).rows[0].fare_settlement, 'MOBILE');
    assert.equal(Number((await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids.d1])).rows[0].balance), bal + 3000);
    await closeRide(id, 'p2');
  });

  it('dereva haoni namba za mlipaji', async () => {
    const id = await plainRide('d1', 'p2');
    assert.equal((await call('POST', `/api/rides/${id}/pay`, { phone: '0741110000' }, 'p2')).status, 200);
    const st = (await call('GET', '/api/driver/state', undefined, 'd1')).json.data;
    const fp = st.ride?.id === id ? st.ride.farePay : null;
    if (fp) {
      assert.deepEqual(fp.numbersUsed, []);
      assert.equal(fp.last, null);
      assert.ok(!JSON.stringify(fp).includes('0741110000') && !JSON.stringify(fp).includes('255741110000'));
    }
    assert.equal((await call('POST', `/api/driver/rides/${id}/settle`, { how: 'CASH' }, 'd1')).status, 200);
    await closeRide(id, 'p2');
  });

  it('0.22.1 malipo ya mapema: dereva akishakubali abiria analipa; wallet inaongezwa safari ikikamilika tu', async () => {
    assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.0005, lng: A.lng }, 'd2')).status, 200);
    const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p2');
    assert.equal(res.status, 201, res.json.message);
    const id = res.json.data.id;
    assert.equal((await call('POST', `/api/rides/${id}/pay`, { phone: `0742${s}` }, 'p2')).status, 409, 'bado inatafuta dereva');
    const offer = (await call('GET', '/api/driver/state', undefined, 'd2')).json.data.offer;
    assert.equal((await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, 'd2')).status, 200);
    const cur = (await call('GET', '/api/rides/current', undefined, 'p2')).json.data;
    assert.equal(cur.farePay.canPay, true, 'dereva amekubali → anaweza kulipa');
    assert.equal(cur.farePay.early, true);
    const r = await call('POST', `/api/rides/${id}/pay`, { phone: `0742${s}` }, 'p2');
    assert.equal(r.status, 200, r.json.message);
    const bal0 = Number((await db.query('SELECT coalesce(balance, 0) AS b FROM naya.wallets WHERE driver_id = $1', [ids.d2])).rows[0]?.b ?? 0);
    await confirm((await lastPay('p2')).reference);
    assert.equal((await db.query('SELECT fare_settlement FROM naya.rides WHERE id = $1', [id])).rows[0].fare_settlement, 'MOBILE');
    assert.equal(Number((await db.query('SELECT coalesce(balance, 0) AS b FROM naya.wallets WHERE driver_id = $1', [ids.d2])).rows[0]?.b ?? 0), bal0, 'bado haijaingia — safari inaendelea');
    const drv = (await call('GET', '/api/driver/state', undefined, 'd2')).json.data.ride;
    assert.equal(drv.farePay.settlement, 'MOBILE');
    await call('POST', `/api/driver/rides/${id}/arrive`, {}, 'd2');
    assert.equal((await call('POST', `/api/driver/rides/${id}/start`, {}, 'd2')).status, 200);
    await db.query(`UPDATE naya.rides SET started_at = now() - interval '6 minutes' WHERE id = $1`, [id]);
    await call('POST', '/api/driver/location', NEAR_B, 'd2');
    assert.equal((await call('POST', `/api/driver/rides/${id}/complete`, {}, 'd2')).status, 200);
    assert.equal(Number((await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids.d2])).rows[0].balance), bal0 + 3000, 'safari imekamilika → +3000');
    assert.equal((await call('POST', `/api/driver/rides/${id}/settle`, { how: 'CASH' }, 'd2')).status, 409, 'imeshalipwa');
    const { checkPendingPayments } = await import('../src/services/payments/index.js');
    await checkPendingPayments();
    assert.equal(Number((await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids.d2])).rows[0].balance), bal0 + 3000, 'worker haiongezi mara mbili');
    await call('POST', `/api/driver/rides/${id}/close`, {}, 'd2');
    await call('POST', '/api/driver/online', { online: false }, 'd2');
    await closeRide(id, 'p2');
  });

  it('0.22.1 abiria akilipa kisha kughairi → "itarudishwa"; ofisi inaandika "Nimerudisha"; dereva hapati', async () => {
    assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.0005, lng: A.lng }, 'd2')).status, 200);
    const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p2');
    assert.equal(res.status, 201, res.json.message);
    const id = res.json.data.id;
    const offer = (await call('GET', '/api/driver/state', undefined, 'd2')).json.data.offer;
    assert.equal((await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, 'd2')).status, 200);
    assert.equal((await call('POST', `/api/rides/${id}/pay`, { phone: `0742${s}` }, 'p2')).status, 200);
    await confirm((await lastPay('p2')).reference);
    const bal = Number((await db.query('SELECT coalesce(balance, 0) AS b FROM naya.wallets WHERE driver_id = $1', [ids.d2])).rows[0]?.b ?? 0);
    assert.equal((await call('POST', `/api/rides/${id}/cancel`, { reason: 'Nimebadilisha mpango' }, 'p2')).status, 200);
    const row = (await db.query('SELECT fare_refund FROM naya.rides WHERE id = $1', [id])).rows[0];
    assert.equal(row.fare_refund, 'NEEDED');
    const sum = (await call('GET', '/api/admin/ride-payments/summary', undefined, 'admin')).json.data;
    assert.ok(sum.refunds.n >= 1);
    const list = (await call('GET', '/api/admin/ride-refunds?open=1', undefined, 'admin')).json.data;
    assert.ok(list.some((x: any) => x.id === id && x.amount === 3100));
    assert.equal((await call('POST', `/api/admin/ride-refunds/${id}/done`, { note: 'Send ABL123' }, 'admin')).status, 200);
    assert.equal((await call('POST', `/api/admin/ride-refunds/${id}/done`, { note: 'tena' }, 'admin')).status, 409);
    assert.equal((await db.query('SELECT fare_refund FROM naya.rides WHERE id = $1', [id])).rows[0].fare_refund, 'DONE');
    assert.equal(Number((await db.query('SELECT coalesce(balance, 0) AS b FROM naya.wallets WHERE driver_id = $1', [ids.d2])).rows[0]?.b ?? 0), bal, 'dereva hapati');
    await call('POST', '/api/driver/online', { online: false }, 'd2');
    await closeRide(id, 'p2');
  });

  it('ledger: salio la wallet = jumla ya miamala (madereva wote wa majaribio)', async () => {
    for (const k of ['d1', 'd2']) {
      const w = await db.query('SELECT balance FROM naya.wallets WHERE driver_id = $1', [ids[k]]);
      const e = await db.query('SELECT coalesce(sum(amount), 0)::int AS s FROM naya.wallet_entries WHERE driver_id = $1', [ids[k]]);
      assert.equal(Number(w.rows[0]?.balance ?? 0), e.rows[0].s, k);
    }
  });
});
