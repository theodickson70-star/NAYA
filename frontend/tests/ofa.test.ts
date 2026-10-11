// Ofa za wateja: punguzo linalohesabiwa na server, ofa moja kwa safari, mteja mpya (safari 2, punguzo la juu 1,500),
// kikomo cha dereva kwa wiki, bajeti, na malipo ya NAYA kwa dereva (namba ya pesa ya simu, salio, kumbukumbu ya muamala).
// Database ya MAJARIBIO tu.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { dispatchPending } from '../src/services/rides.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6);
const PASSWORD = 'NayaTest#2026';
const userIds: string[] = [];
const locationIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let ip = 0;

async function call(method: 'GET' | 'POST', url: string, body?: unknown, who?: string, extra: Record<string, string> = {}) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.14.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...extra },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

const A = { lat: -5.8, lng: 33.0 };
const B = { lat: -5.815, lng: 33.01 };
const promoIds: string[] = [];

async function makeUser(key: string, phone: string, name: string, mode: string | null, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`255${phone.slice(1)}`, name, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: role === 'USER' ? 'app' : 'admin' })).json.data.token;
}
async function makeDriver(key: string, phone: string, name: string, plate: string, at: { lat: number; lng: number }) {
  await makeUser(key, phone, name, 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
     VALUES ($1, 'APPROVED', 'BODABODA', $2, 'Boxer', 'Nyekundu', 'DL123456', now() + interval '30 days')`,
    [ids[key], plate],
  );
  assert.equal((await call('POST', '/api/driver/online', { online: true, ...at }, key)).status, 200);
}
const trip = { pickup: { locationId: '' }, destination: { locationId: '' }, vehicleType: 'BODABODA' };
const order = async (who: string) => {
  const res = await call('POST', '/api/rides', trip, who);
  assert.equal(res.status, 201, res.json.message);
  return res.json.data;
};
const state = async (who: string) => (await call('GET', '/api/driver/state', undefined, who)).json.data;
/** Dereva anakubali, anafika, anaanza kwa PIN na kumaliza safari. */
async function finish(passenger: string, driver: string, rideId: string) {
  const offer = (await state(driver)).offer;
  assert.equal(offer?.ride.id, rideId, `${driver} hakupata ombi`);
  assert.equal((await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, driver)).status, 200);
  await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, driver);
  const pin = (await call('GET', '/api/rides/current', undefined, passenger)).json.data.pin;
  await call('POST', `/api/driver/rides/${rideId}/start`, { pin }, driver);
  const done = await call('POST', `/api/driver/rides/${rideId}/complete`, {}, driver);
  assert.equal(done.status, 200, done.json.message);
  await call('POST', `/api/rides/${rideId}/close`, {}, passenger);
  await call('POST', `/api/driver/rides/${rideId}/close`, {}, driver);
  return done.json.data.ride;
}
async function createPromo(body: Record<string, unknown>) {
  const res = await call('POST', '/api/admin/promotions', body, 'admin');
  assert.equal(res.status, 201, res.json.message);
  promoIds.push(res.json.data.id);
  assert.equal((await call('POST', `/api/admin/promotions/${res.json.data.id}/status`, { status: 'ACTIVE' }, 'admin')).status, 200);
  return res.json.data.id as string;
}

let pausedBefore: string[] = [];
before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  // Ofa nyingine zilizo hai kwenye DB ya majaribio zisiingilie
  pausedBefore = (await db.query(`UPDATE naya.promotions SET status = 'PAUSED' WHERE status = 'ACTIVE' RETURNING id`)).rows.map((r) => r.id);
  for (const [name, p] of [[`Pickup O${s}`, A], [`Dest O${s}`, B]] as const) {
    const row = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(row.rows[0].id);
  }
  trip.pickup.locationId = locationIds[0];
  trip.destination.locationId = locationIds[1];
  // Nauli ya kila safari ya majaribio: TSh 5,000
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 5000, 0, 5000, 100, 1.3), ('BAJAJI', 6000, 0, 6000, 100, 1.3)`,
  );
  await makeUser('admin', `0780${s}`, 'Ofisi Ofa', null, 'ADMIN');
  for (const p of ['p1', 'p2', 'p3', 'p4']) await makeUser(p, `078${p.slice(1)}${s}`, `Mteja ${p} ${s}`, 'PASSENGER');
  await makeDriver('d1', `0786${s}`, `Boda Ofa Karibu ${s}`, `MC ${s.slice(-3)} OF1`, { lat: A.lat - 0.0004, lng: A.lng });
  await makeDriver('d2', `0787${s}`, `Boda Ofa Mbali ${s}`, `MC ${s.slice(-3)} OF2`, { lat: A.lat - 0.004, lng: A.lng });
});

after(async () => {
  await db.query('DELETE FROM naya.promo_payouts WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.ride_offers WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.promotions WHERE id = ANY($1::uuid[])', [promoIds]);
  await db.query(`UPDATE naya.promotions SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])`, [pausedBefore]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

describe('Ofa za wateja', () => {
  let allId = '';
  let newId = '';
  let rideId = '';

  it('ofa mbili za sasa zimeandaliwa (zimesimamishwa mpaka ofisi iwashe)', async () => {
    const seeded = await db.query(`SELECT name, audience, discount_percent, max_discount, per_customer_limit, per_driver_limit, per_driver_period FROM naya.promotions WHERE created_by IS NULL ORDER BY priority DESC`);
    assert.ok(seeded.rows.length >= 2);
    const [fresh, all] = seeded.rows;
    assert.deepEqual([fresh.audience, fresh.discount_percent, fresh.max_discount, fresh.per_customer_limit], ['NEW_CUSTOMERS', 50, 1500, 2]);
    assert.deepEqual([all.audience, all.discount_percent, all.per_driver_limit, all.per_driver_period], ['ALL', 50, 3, 'WEEK']);
  });

  it('mteja si ofisi: hawezi kuunda ofa (403); ofa batili inakataliwa (400)', async () => {
    assert.equal((await call('POST', '/api/admin/promotions', { name: 'x' }, 'p1')).status, 403);
    const bad = await call('POST', '/api/admin/promotions', { name: 'Ofa', title: 'Ofa', audience: 'ALL', discountPercent: 150 }, 'admin');
    assert.equal(bad.status, 400);
  });

  it('ofisi inaunda na kuwasha ofa: nusu bei kwa wote (dereva 1 kwa wiki) na mteja mpya (safari 2, hadi 1,500)', async () => {
    allId = await createPromo({ name: `Wote ${s}`, title: 'Nusu bei!', audience: 'ALL', discountPercent: 50, perDriverLimit: 1, perDriverPeriod: 'WEEK' });
    newId = await createPromo({ name: `Mpya ${s}`, title: 'Karibu NAYA', audience: 'NEW_CUSTOMERS', discountPercent: 50, maxDiscount: 1500, perCustomerLimit: 2, priority: 10 });
    const list = (await call('GET', '/api/admin/promotions', undefined, 'admin')).json.data;
    assert.ok(list.promotions.find((p: any) => p.id === allId).live);
  });

  it('makadirio: ofa moja tu, yenye punguzo kubwa zaidi (TSh 5,000 → 2,500 kwa "wote", si 1,500 ya mteja mpya)', async () => {
    const est = (await call('POST', '/api/fares/estimate', { pickup: trip.pickup, destination: trip.destination }, 'p1')).json.data;
    const boda = est.options.find((o: any) => o.vehicleType === 'BODABODA');
    assert.equal(boda.fare, 5000);
    assert.equal(boda.promo.promotionId, allId);
    assert.equal(boda.promo.discount, 2500);
    assert.equal(boda.promo.passengerPays, 2500);
    const offers = (await call('GET', '/api/offers', undefined, 'p1')).json.data;
    assert.equal(offers.length, 2);
  });

  it('safari ya ofa: abiria analipa 2,500, dereva anaona NAYA inamlipa 2,500; ikikamilika NAYA inamdai dereva', async () => {
    const ride = await order('p1');
    rideId = ride.id;
    assert.equal(ride.passengerPays, 2500);
    assert.equal(ride.promo.discount, 2500);
    const offer = (await state('d1')).offer;
    assert.equal(offer.ride.passengerPays, 2500);
    const done = await finish('p1', 'd1', rideId);
    assert.equal(done.passengerPays, 2500);
    const wallet = (await call('GET', '/api/driver/promo-wallet', undefined, 'd1')).json.data;
    assert.deepEqual([wallet.rides, wallet.earned, wallet.paid, wallet.balance], [1, 2500, 0, 2500]);
  });

  it('kikomo cha dereva (1 kwa wiki): safari ya ofa inayofuata inaenda kwa dereva mwenye nafasi (d2), si d1 aliye karibu', async () => {
    const ride = await order('p2');
    assert.equal(ride.promo?.discount, 2500);
    assert.equal((await state('d1')).offer, null);
    assert.equal((await state('d2')).offer?.ride.id, ride.id);
    rideId = ride.id;
  });

  it('d2 akikataa na hakuna dereva mwingine mwenye nafasi: safari inaendelea BILA ofa kwa d1, mteja anaambiwa', async () => {
    const o = (await state('d2')).offer;
    await call('POST', `/api/driver/offers/${o.id}/decline`, {}, 'd2');
    const s1 = await state('d1');
    assert.equal(s1.offer?.ride.id, rideId);
    assert.equal(s1.offer.ride.promo, null);
    assert.equal(s1.offer.ride.passengerPays, 5000);
    const n = await db.query(`SELECT 1 FROM naya.notifications WHERE user_id = $1 AND kind = 'promo_dropped'`, [ids.p2]);
    assert.equal(n.rows.length, 1);
    await call('POST', `/api/rides/${rideId}/cancel`, { reason: 'jaribio' }, 'p2');
    await call('POST', `/api/rides/${rideId}/close`, {}, 'p2');
  });

  it('kama madereva wote walio karibu wamefikia kikomo: ofa haitumiki tangu mwanzo (bei kamili inaonyeshwa)', async () => {
    await call('POST', '/api/driver/online', { online: false }, 'd2');
    const ride = await order('p2');
    assert.equal(ride.promo, null);
    assert.equal(ride.passengerPays, 5000);
    await call('POST', `/api/rides/${ride.id}/cancel`, { reason: 'jaribio' }, 'p2');
    await call('POST', `/api/rides/${ride.id}/close`, {}, 'p2');
    assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.004, lng: A.lng }, 'd2')).status, 200);
  });

  it('mteja mpya (ofa ya "wote" imesimamishwa): safari 2 kwa nusu bei hadi 1,500 — ya 3 bei kamili', async () => {
    assert.equal((await call('POST', `/api/admin/promotions/${allId}/status`, { status: 'PAUSED' }, 'admin')).status, 200);
    for (const k of [1, 2]) {
      const ride = await order('p3');
      assert.equal(ride.promo?.discount, 1500, `safari ${k}`);
      assert.equal(ride.passengerPays, 3500);
      await finish('p3', 'd1', ride.id);
    }
    const third = await order('p3');
    assert.equal(third.promo, null);
    await call('POST', `/api/rides/${third.id}/cancel`, { reason: 'jaribio' }, 'p3');
    await call('POST', `/api/rides/${third.id}/close`, {}, 'p3');
  });

  it('mteja aliyewahi kusafiri bila ofa si "mteja mpya"', async () => {
    // p1 alisafiri kwa ofa ya "wote" → si mpya kwa ofa ya mteja mpya
    const offers = (await call('GET', '/api/offers', undefined, 'p1')).json.data;
    assert.equal(offers.some((o: any) => o.id === newId), false);
  });

  it('safari iliyoghairiwa inarudisha nafasi ya mteja', async () => {
    const ride = await order('p4');
    assert.equal(ride.promo?.discount, 1500);
    await call('POST', `/api/rides/${ride.id}/cancel`, { reason: 'jaribio' }, 'p4');
    await call('POST', `/api/rides/${ride.id}/close`, {}, 'p4');
    const offers = (await call('GET', '/api/offers', undefined, 'p4')).json.data;
    assert.equal(offers.find((o: any) => o.id === newId)?.ridesLeft, 2);
  });

  it('bajeti ikiisha, ofa inasimama yenyewe kwa wateja', async () => {
    await db.query('UPDATE naya.promotions SET budget = $2 WHERE id = $1', [newId, 3000]);
    const est = (await call('POST', '/api/fares/estimate', { pickup: trip.pickup, destination: trip.destination }, 'p4')).json.data;
    assert.equal(est.options.find((o: any) => o.vehicleType === 'BODABODA').promo, null);
    await db.query('UPDATE naya.promotions SET budget = NULL WHERE id = $1', [newId]);
  });

  it('dereva anaweka namba ya kupokea malipo (namba mbovu inakataliwa)', async () => {
    assert.equal((await call('POST', '/api/driver/payout-accounts', { network: 'MPESA', phone: '123', accountName: 'Boda Ofa' }, 'd1')).status, 400);
    const ok1 = await call('POST', '/api/driver/payout-accounts', { network: 'MPESA', phone: '0754 111 222', accountName: 'Boda Ofa Karibu' }, 'd1');
    assert.equal(ok1.status, 200, ok1.json.message);
    assert.equal(ok1.json.data[0].phone, '255754111222');
    assert.equal(ok1.json.data[0].primary, true);
  });

  it('ofisi: ripoti ya malipo — d1 anadai 2,500 + 1,500 + 1,500 = 5,500 na namba yake inaonekana', async () => {
    const r = (await call('GET', `/api/admin/promo-payouts?q=${s}`, undefined, 'admin')).json.data;
    const d1 = r.rows.find((x: any) => x.id === ids.d1);
    assert.deepEqual([d1.rides, d1.earned, d1.paid, d1.balance], [3, 5500, 0, 5500]);
    assert.equal(d1.payPhone, '255754111222');
    assert.equal(d1.network, 'MPESA');
  });

  it('ofisi inaandika malipo: lazima namba ya muamala, kiasi kisizidi deni, muamala mmoja hautumiki mara mbili', async () => {
    const accountId = (await call('GET', '/api/driver/promo-wallet', undefined, 'd1')).json.data.accounts[0].id;
    assert.equal((await call('POST', `/api/admin/promo-payouts/${ids.d1}`, { amount: 9000, accountId, reference: 'QWE123ABC' }, 'admin')).status, 409);
    assert.equal((await call('POST', `/api/admin/promo-payouts/${ids.d1}`, { amount: 3000, accountId }, 'admin')).status, 400);
    const paid = await call('POST', `/api/admin/promo-payouts/${ids.d1}`, { amount: 3000, accountId, reference: `QWE${s}` }, 'admin');
    assert.equal(paid.status, 200, paid.json.message);
    assert.equal(paid.json.data.balance, 2500);
    assert.equal((await call('POST', `/api/admin/promo-payouts/${ids.d1}`, { amount: 500, accountId, reference: `qwe${s}` }, 'admin')).status, 409);
    const wallet = (await call('GET', '/api/driver/promo-wallet', undefined, 'd1')).json.data;
    assert.deepEqual([wallet.earned, wallet.paid, wallet.balance], [5500, 3000, 2500]);
    const n = await db.query(`SELECT body FROM naya.notifications WHERE user_id = $1 AND kind = 'promo_payout'`, [ids.d1]);
    assert.match(n.rows[0].body, /TSh 3,000/);
  });

  it('malipo yaliyokosewa yanafutwa (deni linarudi), na CSV ya malipo inapakuliwa', async () => {
    const detail = (await call('GET', `/api/admin/promo-payouts/${ids.d1}`, undefined, 'admin')).json.data;
    const v = await call('POST', `/api/admin/promo-payouts/void/${detail.payouts[0].id}`, { reason: 'Nimekosea kiasi' }, 'admin');
    assert.equal(v.json.data.balance, 5500);
    const csv = await app.inject({ method: 'GET', url: '/api/admin/promo-payouts.csv', headers: { authorization: `Bearer ${tokens.admin}` } });
    assert.equal(csv.statusCode, 200);
    assert.match(csv.body, /Namba ya kutumia pesa/);
    assert.match(csv.body, /255754111222/);
  });

  it('takwimu za ofa: safari, gharama ya NAYA, wateja', async () => {
    const d = (await call('GET', `/api/admin/promotions/${newId}`, undefined, 'admin')).json.data;
    assert.equal(d.stats.completed, 2);
    assert.equal(d.stats.cost, 3000);
    assert.equal(d.stats.customers, 1);
    assert.ok(d.rides.length >= 2);
  });
});
