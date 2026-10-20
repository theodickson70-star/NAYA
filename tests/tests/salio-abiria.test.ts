// 0.23.0 Salio la abiria (NAYA Wallet) — kuweka pesa kwa simu, kikomo, kulipa safari / deni kwa salio, kurudishiwa safari ikighairiwa,
// ofisi kumrudishia abiria salio. (Kumbukumbu ya awali: 0.22.0 Nauli kwa simu) — abiria analipa akifika (kampuni BANDIA ya majaribio: collect → PENDING mpaka simulator ithibitishe;
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
    remoteAddress: `10.76.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
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
  for (const [name, p] of [[`Pickup S${s}`, A], [`Dest S${s}`, B]] as const) {
    const r = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(r.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 3000, 0, 3000, 100, 1.3), ('BAJAJI', 4000, 0, 4000, 100, 1.3)`,
  );
  await makeUser('admin', `0760${s}`, 'Ofisi Nauli', null, 'ADMIN');
  await makeUser('p1', `0761${s}`, `Abiria Nauli ${s}`, 'PASSENGER');
  await makeUser('p2', `0762${s}`, `Abiria Nauli Pili ${s}`, 'PASSENGER');
  await makeDriver('d1', `0764${s}`, `Boda Nauli ${s}`, `MC ${s.slice(-3)} SL1`);
  await makeDriver('d2', `0763${s}`, `Boda Nauli Pili ${s}`, `MC ${s.slice(-3)} SL2`);
  const promo = await call('POST', '/api/admin/promotions', { name: `Salio ${s}`, title: 'Nusu bei', audience: 'ALL', discountPercent: 50 }, 'admin');
  promoIds.push(promo.json.data.id);
});


after(async () => {
  await db.query('DELETE FROM naya.wallet_entries WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.promo_payouts WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.subscription_payments WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('UPDATE naya.rides SET promo_payment_id = NULL, fare_payment_id = NULL WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.customer_wallet_entries WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.customer_wallets WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.payments WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.ride_offers WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])', [userIds]);
  await db.query(`DELETE FROM naya.audit_logs WHERE action = 'ride_fare.double_paid' AND details->>'reference' LIKE 'NYN%' AND created_at > now() - interval '1 hour'`);
  await db.query('DELETE FROM naya.promotions WHERE id = ANY($1::uuid[])', [promoIds]);
  await db.query(`UPDATE naya.promotions SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])`, [pausedBefore]);
  if (feeBefore) await db.query(`UPDATE naya.settings SET value = $1 WHERE key = 'subscription'`, [JSON.stringify(feeBefore)]);
  await db.query(`DELETE FROM naya.settings WHERE key IN ('driver_wallet', 'ride_payments', 'customer_wallet')`);
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


const cw = async (who = 'p1') => (await call('GET', '/api/passenger/wallet', undefined, who)).json.data;
const cwBal = async (key: string) => Number((await db.query('SELECT coalesce(balance, 0) AS b FROM naya.customer_wallets WHERE user_id = $1', [ids[key]])).rows[0]?.b ?? 0);
const cwLedger = async (key: string) => Number((await db.query('SELECT coalesce(sum(amount), 0) AS s FROM naya.customer_wallet_entries WHERE user_id = $1', [ids[key]])).rows[0].s);
const dwBal = async (key: string) => Number((await db.query('SELECT coalesce(balance, 0) AS b FROM naya.wallets WHERE driver_id = $1', [ids[key]])).rows[0]?.b ?? 0);
const lastTopup = async (who = 'p1') => (await db.query(`SELECT * FROM naya.payments WHERE user_id = $1 AND kind = 'CUSTOMER_TOPUP' ORDER BY created_at DESC LIMIT 1`, [ids[who]])).rows[0];
async function acceptedRide(driver: string, pax = 'p1') {
  assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.0005, lng: A.lng }, driver)).status, 200);
  const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, pax);
  assert.equal(res.status, 201, res.json.message);
  const rideId = res.json.data.id as string;
  const offer = (await call('GET', '/api/driver/state', undefined, driver)).json.data.offer;
  assert.equal((await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, driver)).status, 200);
  return rideId;
}
async function finish(rideId: string, driver: string) {
  await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, driver);
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, {}, driver)).status, 200);
  await db.query(`UPDATE naya.rides SET started_at = now() - interval '6 minutes' WHERE id = $1`, [rideId]);
  await call('POST', '/api/driver/location', NEAR_B, driver);
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/complete`, {}, driver)).status, 200);
  await call('POST', `/api/driver/rides/${rideId}/close`, {}, driver);
  await call('POST', '/api/driver/online', { online: false }, driver);
}

describe('Salio la abiria — kuwasha na kuweka pesa', () => {
  it('imezimwa kwa chaguo-msingi: kuweka pesa → 409', async () => {
    const w = await cw();
    assert.equal(w.enabled, false);
    assert.equal(w.maxBalance, 15000);
    assert.equal((await call('POST', '/api/passenger/wallet/topup', { amount: 5000, phone: `0761${s}` }, 'p1')).status, 409);
  });

  it('ofisi inawasha; quote: kiasi + ada; juu ya kikomo (15,000) au chini ya kiwango → kukataliwa', async () => {
    assert.equal((await call('PUT', '/api/admin/settings/ride-payments', { feePercent: 3, feeMin: 100 }, 'admin')).status, 200);
    const r = await call('PUT', '/api/admin/settings/customer-wallet', { enabled: true }, 'admin');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.maxBalance, 15000);
    const q = await call('GET', '/api/passenger/wallet/quote?amount=10000', undefined, 'p1');
    assert.equal(q.status, 200, q.json.message);
    assert.deepEqual(q.json.data, { amount: 10000, fee: 300, total: 10300 });
    assert.equal((await call('GET', '/api/passenger/wallet/quote?amount=16000', undefined, 'p1')).status, 409);
    assert.equal((await call('GET', '/api/passenger/wallet/quote?amount=100', undefined, 'p1')).status, 400);
  });

  it('kuweka 10,000: salio halibadiliki mpaka mtandao uthibitishe; uthibitisho mara mbili → mara moja tu', async () => {
    const r = await call('POST', '/api/passenger/wallet/topup', { amount: 10000, phone: `0761${s}` }, 'p1');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.status, 'PENDING');
    assert.equal(r.json.data.amount, 10300);
    assert.equal(await cwBal('p1'), 0);
    assert.equal((await call('POST', '/api/passenger/wallet/topup', { amount: 1000, phone: `0761${s}` }, 'p1')).status, 409, 'ombi moja kwa wakati');
    const p = await lastTopup();
    await call('POST', `/api/payments/simulator/${p.reference}`, { success: true });
    await call('POST', `/api/payments/simulator/${p.reference}`, { success: true });
    assert.equal(await cwBal('p1'), 10000);
    const w = await cw();
    assert.equal(w.balance, 10000);
    assert.equal(w.room, 5000);
    assert.equal(w.entries[0].kind, 'TOPUP');
    assert.equal((await call('POST', '/api/passenger/wallet/topup', { amount: 6000, phone: `0761${s}` }, 'p1')).status, 409, 'kikomo 15,000');
  });

  it('kuweka kukishindwa (namba haina pesa) → salio halibadiliki; uthibitisho uliochelewa unakubaliwa', async () => {
    const r = await call('POST', '/api/passenger/wallet/topup', { amount: 2000, phone: '0761110000' }, 'p1');
    assert.equal(r.status, 200);
    assert.equal(r.json.data.status, 'FAILED');
    assert.equal(await cwBal('p1'), 10000);
    const p = await lastTopup();
    const { applyResult } = await import('../src/services/payments/index.js');
    await applyResult(p.reference, { status: 'SUCCESS', providerRef: `LATE-TOPUP-${s}` });
    assert.equal(await cwBal('p1'), 12000, 'pesa ilifika baadaye → inaingia');
    assert.equal(await cwLedger('p1'), await cwBal('p1'));
  });
});

describe('Salio la abiria — kulipa safari', () => {
  it('dereva akishakubali: "Lipa kwa salio" → salio −3000; wallet ya dereva +3000 safari ikikamilika tu', async () => {
    const id = await acceptedRide('d1');
    const view = (await call('GET', '/api/rides/current', undefined, 'p1')).json.data;
    assert.equal(view.farePay.wallet.balance, 12000);
    assert.equal(view.farePay.wallet.canPay, true);
    const d0 = await dwBal('d1');
    const r = await call('POST', `/api/rides/${id}/pay-wallet`, {}, 'p1');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(await cwBal('p1'), 9000);
    assert.equal((await call('POST', `/api/rides/${id}/pay-wallet`, {}, 'p1')).status, 409, 'mara moja tu');
    assert.equal((await call('POST', `/api/rides/${id}/pay`, { phone: `0761${s}` }, 'p1')).status, 409, 'hakuna kulipa kwa simu tena');
    const drv = (await call('GET', '/api/driver/state', undefined, 'd1')).json.data.ride;
    assert.equal(drv.farePay.settlement, 'WALLET');
    assert.equal(drv.farePay.wallet, null, 'dereva haoni salio la abiria');
    assert.equal(await dwBal('d1'), d0, 'bado inaendelea');
    await finish(id, 'd1');
    assert.equal(await dwBal('d1'), d0 + 3000);
    const { checkPendingPayments } = await import('../src/services/payments/index.js');
    await checkPendingPayments();
    assert.equal(await dwBal('d1'), d0 + 3000, 'worker haiongezi mara mbili');
    assert.equal((await call('POST', `/api/driver/rides/${id}/settle`, { how: 'CASH' }, 'd1')).status, 409);
    await call('POST', `/api/rides/${id}/close`, {}, 'p1');
  });

  it('safari iliyolipwa kwa salio ikighairiwa → pesa inarudi kwenye salio papo hapo; dereva hapati', async () => {
    const id = await acceptedRide('d2');
    const d0 = await dwBal('d2');
    assert.equal((await call('POST', `/api/rides/${id}/pay-wallet`, {}, 'p1')).status, 200);
    assert.equal(await cwBal('p1'), 6000);
    assert.equal((await call('POST', `/api/rides/${id}/cancel`, { reason: 'Majaribio' }, 'p1')).status, 200);
    assert.equal(await cwBal('p1'), 9000, 'imerudi');
    const row = (await db.query('SELECT fare_refund FROM naya.rides WHERE id = $1', [id])).rows[0];
    assert.equal(row.fare_refund, 'DONE');
    assert.equal(await dwBal('d2'), d0);
    await call('POST', '/api/driver/online', { online: false }, 'd2');
  });

  it('salio lisipotosha → 409, hakuna kinachokatwa', async () => {
    await db.query(`UPDATE naya.fare_rules SET base_fare = 20000, minimum_fare = 20000 WHERE vehicle_type = 'BODABODA'`);
    const id = await acceptedRide('d1');
    const r = await call('POST', `/api/rides/${id}/pay-wallet`, {}, 'p1');
    assert.equal(r.status, 409);
    assert.match(r.json.message, /halitoshi/);
    assert.equal(await cwBal('p1'), 9000);
    await call('POST', `/api/rides/${id}/cancel`, { reason: 'Majaribio' }, 'p1');
    await call('POST', '/api/driver/online', { online: false }, 'd1');
    await db.query(`UPDATE naya.fare_rules SET base_fare = 3000, minimum_fare = 3000 WHERE vehicle_type = 'BODABODA'`);
  });

  it('maombi mawili kwa wakati mmoja (safari + safari nyingine haiwezekani) — kulipa safari ileile mara mbili sambamba → moja tu', async () => {
    const id = await acceptedRide('d1');
    const [a, b] = await Promise.all([call('POST', `/api/rides/${id}/pay-wallet`, {}, 'p1'), call('POST', `/api/rides/${id}/pay-wallet`, {}, 'p1')]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(await cwBal('p1'), 6000);
    await finish(id, 'd1');
    await call('POST', `/api/rides/${id}/close`, {}, 'p1');
  });
});

describe('Salio la abiria — deni na kurudishiwa', () => {
  it('deni linalipwa kwa salio → dereva anapata papo hapo; abiria anaagiza tena', async () => {
    assert.equal((await call('PUT', '/api/admin/settings/ride-payments', { enabled: true }, 'admin')).status, 200);
    const id = await acceptedRide('d2');
    await finish(id, 'd2');
    assert.equal((await call('POST', `/api/driver/rides/${id}/settle`, { how: 'DEBT' }, 'd2')).status, 200);
    await call('POST', `/api/rides/${id}/close`, {}, 'p1');
    const debt = (await call('GET', '/api/passenger/debt', undefined, 'p1')).json.data;
    assert.equal(debt.due, 3000);
    assert.equal(debt.wallet.canPay, true);
    const d0 = await dwBal('d2');
    const r = await call('POST', '/api/passenger/debt/pay-wallet', {}, 'p1');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.due, 0);
    assert.equal(await cwBal('p1'), 3000);
    assert.equal(await dwBal('d2'), d0 + 3000);
    assert.equal((await db.query('SELECT debt_cleared_how FROM naya.rides WHERE id = $1', [id])).rows[0].debt_cleared_how, 'WALLET');
    assert.equal((await call('POST', '/api/passenger/debt/pay-wallet', {}, 'p1')).status, 409, 'huna deni');
  });

  it('abiria anaomba kurudishiwa salio; ofisi inaandika "Nimerudisha" → salio 0; si ofisi → 403', async () => {
    assert.equal((await call('POST', '/api/passenger/wallet/cashout', { phone: `0761${s}` }, 'p1')).status, 200);
    assert.equal((await call('POST', '/api/passenger/wallet/cashout', { phone: `0761${s}` }, 'p1')).status, 409);
    // ombi likiwa wazi: hakuna kuweka pesa wala kulipa kwa salio (ofisi inatuma kiasi kilichoombwa)
    assert.equal((await call('POST', '/api/passenger/wallet/topup', { amount: 1000, phone: `0761${s}` }, 'p1')).status, 409);
    assert.equal((await call('POST', '/api/passenger/debt/pay-wallet', {}, 'p1')).status, 409);
    const sum = (await call('GET', '/api/admin/customer-wallets/summary', undefined, 'admin')).json.data;
    assert.ok(sum.cashouts.some((c: any) => c.id === ids.p1 && c.balance === 3000));
    assert.equal((await call('GET', '/api/admin/customer-wallets/summary', undefined, 'p1')).status, 403);
    assert.equal((await call('POST', `/api/admin/customer-wallets/${ids.p1}/cashout-done`, { amount: 5000, note: 'Send ABL-77' }, 'admin')).status, 409, 'zaidi ya salio');
    // abiria akighairi wakati ofisi inatuma → ofisi bado inaandika kiasi ilichotuma
    assert.equal((await call('POST', '/api/passenger/wallet/cashout/cancel', {}, 'p1')).status, 200);
    assert.equal((await call('POST', `/api/admin/customer-wallets/${ids.p1}/cashout-done`, { amount: 3000, note: 'Send ABL-77' }, 'admin')).status, 200);
    assert.equal(await cwBal('p1'), 0);
    assert.equal((await call('POST', `/api/admin/customer-wallets/${ids.p1}/cashout-done`, { amount: 100, note: 'tena' }, 'admin')).status, 409);
    const w = await cw();
    assert.equal(w.entries[0].kind, 'CASHOUT');
    assert.equal(w.cashout, null);
  });

  it('muhtasari wa wallet za madereva unahesabu salio za abiria pia (deni la NAYA)', async () => {
    assert.equal((await call('POST', `/api/admin/customer-wallets/${ids.p1}/adjust`, { amount: 1500, reason: 'Majaribio ya marekebisho' }, 'admin')).status, 200);
    const s1 = (await call('GET', '/api/admin/wallets/summary', undefined, 'admin')).json.data;
    assert.ok(s1.customerOwed >= 1500);
  });

  it('malipo ya simu yakithibitishwa baada ya safari kulipwa kwa salio → kiasi chote kinawekwa kwenye salio (mara moja)', async () => {
    assert.equal((await call('PUT', '/api/admin/settings/ride-payments', { enabled: true }, 'admin')).status, 200);
    assert.equal((await call('POST', `/api/admin/customer-wallets/${ids.p1}/adjust`, { amount: 5000, reason: 'Majaribio ya malipo yaliyozidi' }, 'admin')).status, 200);
    const id = await acceptedRide('d1');
    assert.equal((await call('POST', `/api/rides/${id}/pay`, { phone: `0761${s}` }, 'p1')).status, 200);
    const pay = (await db.query(`SELECT * FROM naya.payments WHERE user_id = $1 AND kind = 'RIDE_FARE' ORDER BY created_at DESC LIMIT 1`, [ids.p1])).rows[0];
    await db.query(`UPDATE naya.payments SET created_at = now() - interval '4 minutes' WHERE id = $1`, [pay.id]);
    const before = await cwBal('p1');
    assert.equal((await call('POST', `/api/rides/${id}/pay-wallet`, {}, 'p1')).status, 200, 'baada ya dakika 3');
    assert.equal(await cwBal('p1'), before - 3000);
    await call('POST', `/api/payments/simulator/${pay.reference}`, { success: true });
    await call('POST', `/api/payments/simulator/${pay.reference}`, { success: true });
    assert.equal(await cwBal('p1'), before - 3000 + pay.amount, 'nauli + ada iliyolipwa kwa simu imerudi kwenye salio');
    assert.equal((await db.query('SELECT fare_settlement FROM naya.rides WHERE id = $1', [id])).rows[0].fare_settlement, 'WALLET');
    await finish(id, 'd1');
    await call('POST', `/api/rides/${id}/close`, {}, 'p1');
  });

  it('ledger: salio = jumla ya miamala (abiria na madereva)', async () => {
    assert.equal(await cwLedger('p1'), await cwBal('p1'));
    for (const k of ['d1', 'd2']) {
      const e = await db.query('SELECT coalesce(sum(amount), 0)::int AS s FROM naya.wallet_entries WHERE driver_id = $1', [ids[k]]);
      assert.equal(e.rows[0].s, await dwBal(k), k);
    }
  });
});
