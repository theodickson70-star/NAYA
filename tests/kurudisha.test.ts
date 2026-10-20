// 0.24.0 Ofisi kumrudishia mteja pesa (salio / simu), vikomo, safari moja haizidi alicholipa. (Msingi: 0.23.0 Salio la abiria (NAYA Wallet) — kuweka pesa kwa simu, kikomo, kulipa safari / deni kwa salio, kurudishiwa safari ikighairiwa,
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
    remoteAddress: `10.77.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
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
  for (const [name, p] of [[`Pickup R${s}`, A], [`Dest R${s}`, B]] as const) {
    const r = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(r.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 3000, 0, 3000, 100, 1.3), ('BAJAJI', 4000, 0, 4000, 100, 1.3)`,
  );
  await makeUser('admin', `0750${s}`, 'Ofisi Nauli', null, 'ADMIN');
  await makeUser('p1', `0751${s}`, `Abiria Nauli ${s}`, 'PASSENGER');
  await makeUser('p2', `0752${s}`, `Abiria Nauli Pili ${s}`, 'PASSENGER');
  await makeDriver('d1', `0753${s}`, `Boda Nauli ${s}`, `MC ${s.slice(-3)} RF1`);
  await makeDriver('d2', `0758${s}`, `Boda Nauli Pili ${s}`, `MC ${s.slice(-3)} RF2`);
  const promo = await call('POST', '/api/admin/promotions', { name: `Rudisha ${s}`, title: 'Nusu bei', audience: 'ALL', discountPercent: 50 }, 'admin');
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
  await db.query(`DELETE FROM naya.settings WHERE key IN ('driver_wallet', 'ride_payments', 'customer_wallet', 'refunds')`);
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


const money = async (who = 'p1') => (await call('GET', `/api/admin/users/${ids[who]}/money`, undefined, 'admin')).json.data;
const refund = (body: object, who = 'p1', as = 'admin') => call('POST', `/api/admin/users/${ids[who]}/refund`, body, as);

describe('Kumrudishia mteja pesa', () => {
  it('kwenye Salio la NAYA (bila safari): papo hapo, mstari wa REFUND wenye jina la ofisi; mteja anajulishwa', async () => {
    const r = await refund({ amount: 2000, to: 'SALIO', reason: 'COMPENSATION', note: 'Pole kwa kuchelewa kwa dereva' });
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.balance, 2000);
    assert.equal(r.json.data.entries[0].kind, 'REFUND');
    assert.equal(r.json.data.entries[0].createdBy, 'Ofisi Nauli');
    const n = await db.query(`SELECT 1 FROM naya.notifications WHERE user_id = $1 AND kind = 'customer_refund'`, [ids.p1]);
    assert.equal(n.rowCount, 1);
    const a = await db.query(`SELECT 1 FROM naya.audit_logs WHERE action = 'customer.refund_salio' AND target_id = $1`, [ids.p1]);
    assert.equal(a.rowCount, 1);
  });

  it('si ofisi → 403; sababu au maelezo yakikosekana → 400; kikomo cha marejesho moja → 403', async () => {
    assert.equal((await refund({ amount: 1000, to: 'SALIO', reason: 'OTHER', note: 'jaribio la mtu' }, 'p1', 'p1')).status, 403);
    assert.equal((await refund({ amount: 1000, to: 'SALIO', note: 'hakuna sababu' })).status, 400);
    assert.equal((await refund({ amount: 1000, to: 'SALIO', reason: 'OTHER', note: 'x' })).status, 400);
    assert.equal((await call('PUT', '/api/admin/settings/refunds', { maxPerRefund: 5000 }, 'admin')).status, 200);
    assert.equal((await refund({ amount: 6000, to: 'SALIO', reason: 'OTHER', note: 'zaidi ya kikomo' })).status, 403);
    assert.equal((await call('PUT', '/api/admin/settings/refunds', { maxPerRefund: 50000 }, 'admin')).status, 200);
  });

  it('safari iliyolipwa kwa simu kisha ikaghairiwa → kwa simu: haizidi alicholipa; inafaulu → Marejesho DONE; mara ya pili → 409', async () => {
    assert.equal((await call('PUT', '/api/admin/settings/ride-payments', { enabled: true, feePercent: 3, feeMin: 100 }, 'admin')).status, 200);
    assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.0005, lng: A.lng }, 'd1')).status, 200);
    const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
    assert.equal(res.status, 201, res.json.message);
    const id = res.json.data.id;
    const offer = (await call('GET', '/api/driver/state', undefined, 'd1')).json.data.offer;
    assert.equal((await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, 'd1')).status, 200);
    assert.equal((await call('POST', `/api/rides/${id}/pay`, { phone: `0751${s}` }, 'p1')).status, 200);
    const pay = (await db.query(`SELECT * FROM naya.payments WHERE user_id = $1 AND kind = 'RIDE_FARE' ORDER BY created_at DESC LIMIT 1`, [ids.p1])).rows[0];
    await call('POST', `/api/payments/simulator/${pay.reference}`, { success: true });
    assert.equal((await call('POST', `/api/rides/${id}/cancel`, { reason: 'Majaribio' }, 'p1')).status, 200);
    await call('POST', '/api/driver/online', { online: false }, 'd1');
    assert.equal((await db.query('SELECT fare_refund FROM naya.rides WHERE id = $1', [id])).rows[0].fare_refund, 'NEEDED');
    const m = await money();
    assert.ok(m.rides.some((r: any) => r.id === id && r.fareRefund === 'NEEDED' && r.paidByPhone === pay.amount));
    const over = await refund({ amount: pay.amount + 1, to: 'PHONE', reason: 'RIDE_NOT_DONE', note: 'Safari ilighairiwa', rideId: id });
    assert.equal(over.status, 409);
    const ok = await refund({ amount: pay.amount, to: 'PHONE', reason: 'RIDE_NOT_DONE', note: 'Safari ilighairiwa', rideId: id });
    assert.equal(ok.status, 200, ok.json.message);
    assert.equal(ok.json.data.last.status, 'SUCCESS');
    const p = (await db.query(`SELECT * FROM naya.payments WHERE user_id = $1 AND kind = 'CUSTOMER_REFUND' ORDER BY created_at DESC LIMIT 1`, [ids.p1])).rows[0];
    assert.equal(p.direction, 'OUT');
    assert.equal(p.amount, pay.amount);
    assert.equal(p.phone, `255751${s}`);
    assert.equal((await db.query('SELECT fare_refund FROM naya.rides WHERE id = $1', [id])).rows[0].fare_refund, 'DONE');
    assert.equal((await refund({ amount: 100, to: 'SALIO', reason: 'RIDE_NOT_DONE', note: 'Tena kwa salio', rideId: id })).status, 409, 'amesharudishiwa yote');
    const sms = await db.query(`SELECT 1 FROM naya.notifications WHERE user_id = $1 AND kind = 'customer_refund' AND body LIKE '%imekurudishia%'`, [ids.p1]);
    assert.ok(sms.rowCount! >= 1);
  });

  it('kutuma kukishindwa (namba haina akaunti) → FAILED, hakihesabiwi kwenye kikomo; kikomo cha siku kinazuia', async () => {
    const f = await refund({ amount: 1000, to: 'PHONE', phone: '0751110000', reason: 'BAD_SERVICE', note: 'Huduma mbovu' });
    assert.equal(f.status, 200, f.json.message);
    assert.equal(f.json.data.last.status, 'FAILED');
    const left = (await money()).limits.phoneLeftToday;
    assert.equal((await call('PUT', '/api/admin/settings/refunds', { dailyPhoneCap: 1000 }, 'admin')).status, 200);
    const capped = await refund({ amount: 1000, to: 'PHONE', reason: 'BAD_SERVICE', note: 'Kikomo cha siku' });
    assert.equal(capped.status, 403);
    assert.ok(left >= 0);
    assert.equal((await call('PUT', '/api/admin/settings/refunds', { dailyPhoneCap: 200000 }, 'admin')).status, 200);
  });

  it('ledger ya salio = jumla ya miamala', async () => {
    const w = Number((await db.query('SELECT balance FROM naya.customer_wallets WHERE user_id = $1', [ids.p1])).rows[0].balance);
    const e = Number((await db.query('SELECT coalesce(sum(amount), 0) AS s FROM naya.customer_wallet_entries WHERE user_id = $1', [ids.p1])).rows[0].s);
    assert.equal(w, e);
  });
});
