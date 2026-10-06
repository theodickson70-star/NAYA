// Tests za Phase 5+6: kuagiza, kumpata dereva (dispatch), hali za safari, kughairi, rating, mapato, ofisi, usalama.
// Database ya MAJARIBIO tu:  DATABASE_URL=... JWT_SECRET=... npm test
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

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.5.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

// Maeneo ya majaribio karibu na Urambo
const A = { lat: -5.07, lng: 32.05 }; // pickup
const B = { lat: -5.085, lng: 32.06 }; // destination
const NEAR_A = { lat: -5.0705, lng: 32.0502 }; // ~60 m kutoka A
const FAR_A = { lat: -5.0835, lng: 32.05 }; // ~1.5 km kutoka A

async function makeUser(key: string, phone: string, name: string, role = 'USER', mode: string | null = 'PASSENGER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`255${phone.slice(1)}`, name, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  const portal = role === 'USER' ? 'app' : 'admin';
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal })).json.data.token;
}

async function makeDriver(key: string, phone: string, name: string, vehicle: 'BODABODA' | 'BAJAJI', status = 'APPROVED', plate = '') {
  await makeUser(key, phone, name, 'USER', 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number)
     VALUES ($1, $2, $3, $4, 'Boxer', 'Nyekundu', 'DL123456')`,
    [ids[key], status, vehicle, plate],
  );
}

const requestBody = (vehicleType = 'BODABODA') => ({
  pickup: { locationId: locationIds[0] },
  destination: { locationId: locationIds[1] },
  vehicleType,
});
const state = async (who: string) => (await call('GET', '/api/driver/state', undefined, who)).json.data;

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  for (const [name, p] of [[`Pickup R${s}`, A], [`Dest R${s}`, B]] as const) {
    const row = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(row.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 1000, 500, 1500, 100, 1.3), ('BAJAJI', 1500, 700, 2500, 500, 1.3)`,
  );
  await makeUser('admin', `0690${s}`, 'Admin Safari', 'ADMIN', null);
  await makeUser('p1', `0720${s}`, 'Abiria Moja');
  await makeUser('p2', `0721${s}`, 'Abiria Mbili');
  await makeDriver('d1', `0722${s}`, 'Dereva Karibu', 'BODABODA', 'APPROVED', `MC ${s.slice(-3)} AAA`);
  await makeDriver('d2', `0723${s}`, 'Dereva Mbali', 'BODABODA', 'APPROVED', `MC ${s.slice(-3)} BBB`);
  await makeDriver('d3', `0724${s}`, 'Dereva Bajaji', 'BAJAJI', 'APPROVED', `MC ${s.slice(-3)} CCC`);
  await makeDriver('d4', `0725${s}`, 'Dereva Hajathibitishwa', 'BODABODA', 'PENDING', `MC ${s.slice(-3)} DDD`);
});

after(async () => {
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.ride_offers WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

describe('NAYA Phase 5+6 — safari', () => {
  let rideId = '';

  it('kuagiza bila dereva online: SEARCHING, nauli imehesabiwa na server', async () => {
    const res = await call('POST', '/api/rides', { ...requestBody(), fare: 1 }, 'p1');
    assert.equal(res.status, 201, res.json.message);
    assert.equal(res.json.data.status, 'SEARCHING');
    const est = await call('POST', '/api/fares/estimate', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] } }, 'p1');
    const boda = est.json.data.options.find((o: any) => o.vehicleType === 'BODABODA');
    assert.equal(res.json.data.fare, boda.fare);
    assert.notEqual(res.json.data.fare, 1);
    rideId = res.json.data.id;
  });

  it('abiria hawezi kuwa na safari mbili zinazoendelea (409)', async () => {
    assert.equal((await call('POST', '/api/rides', requestBody(), 'p1')).status, 409);
  });

  it('abiria mwingine hawezi kuona wala kughairi safari isiyo yake (404)', async () => {
    assert.equal((await call('POST', `/api/rides/${rideId}/cancel`, {}, 'p2')).status, 404);
    assert.equal((await call('GET', `/api/rides/${rideId}/driver-photo`, undefined, 'p2')).status, 404);
  });

  it('abiria anaghairi; skrini ya safari inafungwa', async () => {
    const res = await call('POST', `/api/rides/${rideId}/cancel`, { reason: 'Nimebadili mpango' }, 'p1');
    assert.equal(res.json.data.status, 'CANCELLED');
    assert.equal((await call('GET', '/api/rides/current', undefined, 'p1')).json.data, null);
  });

  it('dereva asiyethibitishwa hawezi kwenda online (403); online bila mahali inakataliwa (400)', async () => {
    assert.equal((await call('POST', '/api/driver/online', { online: true, locationId: locationIds[0] }, 'd4')).status, 403);
    assert.equal((await call('POST', '/api/driver/online', { online: true }, 'd1')).status, 400);
    assert.equal((await call('POST', '/api/driver/online', { online: true, lat: -6.8, lng: 39.28 }, 'd1')).status, 400);
  });

  it('madereva wanaenda online (eneo la orodha au GPS)', async () => {
    const d1 = await call('POST', '/api/driver/online', { online: true, ...NEAR_A }, 'd1');
    assert.equal(d1.status, 200, d1.json.message);
    assert.equal(d1.json.data.online, true);
    assert.equal((await call('POST', '/api/driver/online', { online: true, ...FAR_A }, 'd2')).status, 200);
    assert.equal((await call('POST', '/api/driver/online', { online: true, locationId: locationIds[0] }, 'd3')).status, 200);
  });

  it('ombi linaenda kwa dereva wa aina sahihi aliye karibu zaidi', async () => {
    const res = await call('POST', '/api/rides', requestBody(), 'p1');
    rideId = res.json.data.id;
    const s1 = await state('d1');
    assert.ok(s1.offer, 'd1 hakupata ombi');
    assert.equal(s1.offer.ride.id, rideId);
    assert.ok(s1.offer.secondsLeft > 10 && s1.offer.secondsLeft <= 20);
    assert.equal((await state('d2')).offer, null);
    assert.equal((await state('d3')).offer, null); // bajaji haipewi ombi la bodaboda
  });

  it('dereva mwingine hawezi kukubali ombi lisilo lake (404)', async () => {
    const offerId = (await state('d1')).offer.id;
    assert.equal((await call('POST', `/api/driver/offers/${offerId}/accept`, {}, 'd2')).status, 404);
  });

  it('dereva akikataa, ombi linaenda kwa anayefuata', async () => {
    const offerId = (await state('d1')).offer.id;
    await call('POST', `/api/driver/offers/${offerId}/decline`, {}, 'd1');
    const s2 = await state('d2');
    assert.equal(s2.offer?.ride.id, rideId);
    assert.ok(s2.offer.distanceToPickupKm > 1);
  });

  it('ombi likiisha muda na hakuna dereva mwingine → NO_DRIVER baada ya muda wa kutafuta', async () => {
    await db.query(`UPDATE naya.ride_offers SET expires_at = now() - interval '1 second' WHERE ride_id = $1 AND status = 'PENDING'`, [rideId]);
    await dispatchPending();
    assert.equal((await state('d2')).offer, null);
    assert.equal((await call('GET', '/api/rides/current', undefined, 'p1')).json.data.status, 'SEARCHING');
    await db.query(`UPDATE naya.rides SET search_started_at = now() - interval '10 minutes' WHERE id = $1`, [rideId]);
    await dispatchPending();
    const current = await call('GET', '/api/rides/current', undefined, 'p1');
    assert.equal(current.json.data.status, 'NO_DRIVER');
    assert.equal((await call('POST', `/api/rides/${rideId}/close`, {}, 'p1')).status, 200);
    assert.equal((await call('GET', '/api/rides/current', undefined, 'p1')).json.data, null);
  });

  it('kukubali mara mbili kwa wakati mmoja: moja tu inafaulu', async () => {
    rideId = (await call('POST', '/api/rides', requestBody(), 'p1')).json.data.id;
    const offerId = (await state('d1')).offer.id;
    const [a, b] = await Promise.all([
      call('POST', `/api/driver/offers/${offerId}/accept`, {}, 'd1'),
      call('POST', `/api/driver/offers/${offerId}/accept`, {}, 'd1'),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const ride = (await call('GET', '/api/rides/current', undefined, 'p1')).json.data;
    assert.equal(ride.status, 'ACCEPTED');
    assert.equal(ride.driver.name, 'Dereva Karibu');
    assert.equal(ride.driver.plateNumber, `MC ${s.slice(-3)} AAA`);
    assert.ok(ride.driver.distanceToPickupKm < 0.5);
  });

  it('dereva hawezi kwenda offline wala kubadili mode akiwa na safari (409)', async () => {
    assert.equal((await call('POST', '/api/driver/online', { online: false }, 'd1')).status, 409);
    assert.equal((await call('PUT', '/api/account/mode', { mode: 'PASSENGER' }, 'd1')).status, 409);
  });

  it('hatua za safari zinafuata mpangilio: nimefika → anza → maliza', async () => {
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/complete`, {}, 'd1')).status, 409);
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, 'd2')).status, 404);
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, 'd1')).json.data.ride.status, 'ARRIVED');
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, {}, 'd1')).json.data.ride.status, 'IN_PROGRESS');
    assert.equal((await call('POST', `/api/rides/${rideId}/cancel`, {}, 'p1')).status, 409); // imeshaanza
    assert.equal((await call('POST', `/api/rides/${rideId}/rate`, { rating: 5 }, 'p1')).status, 409); // bado haijaisha
    const done = await call('POST', `/api/driver/rides/${rideId}/complete`, {}, 'd1');
    assert.equal(done.json.data.ride.status, 'COMPLETED');
    assert.equal(done.json.data.earnings.today.trips, 1);
    assert.equal(done.json.data.earnings.today.total, done.json.data.ride.fare);
  });

  it('rating: abiria kwa dereva, dereva kwa abiria — mara moja tu', async () => {
    assert.equal((await call('POST', `/api/rides/${rideId}/rate`, { rating: 6 }, 'p1')).status, 400);
    assert.equal((await call('POST', `/api/rides/${rideId}/rate`, { rating: 5, comment: 'Safi sana' }, 'p1')).status, 200);
    assert.equal((await call('POST', `/api/rides/${rideId}/rate`, { rating: 4 }, 'p1')).status, 409);
    assert.equal((await call('GET', '/api/rides/current', undefined, 'p1')).json.data, null);
    const rated = await call('POST', `/api/driver/rides/${rideId}/rate`, { rating: 4 }, 'd1');
    assert.equal(rated.json.data.ride, null);
    const history = await call('GET', '/api/rides/history', undefined, 'p1');
    assert.equal(history.json.data[0].status, 'COMPLETED');
  });

  it('dereva akighairi baada ya kukubali → abiria anatafutiwa dereva mwingine', async () => {
    rideId = (await call('POST', '/api/rides', requestBody(), 'p1')).json.data.id;
    const offerId = (await state('d1')).offer.id;
    await call('POST', `/api/driver/offers/${offerId}/accept`, {}, 'd1');
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/cancel`, { reason: '' }, 'd1')).status, 400);
    const cancelled = await call('POST', `/api/driver/rides/${rideId}/cancel`, { reason: 'Pancha' }, 'd1');
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.json.data.ride, null);
    const ride = (await call('GET', '/api/rides/current', undefined, 'p1')).json.data;
    assert.equal(ride.status, 'SEARCHING');
    assert.equal(ride.redispatched, true);
    assert.equal(ride.driver, null);
    assert.equal((await state('d1')).offer, null); // hapewi tena safari aliyoighairi
    assert.equal((await state('d2')).offer?.ride.id, rideId);
  });

  it('ofisi inaona safari zinazoendelea, historia yake, na inaweza kuighairi', async () => {
    const list = await call('GET', '/api/admin/rides?scope=active', undefined, 'admin');
    assert.ok(list.json.data.some((r: any) => r.id === rideId));
    const detail = await call('GET', `/api/admin/rides/${rideId}`, undefined, 'admin');
    const transitions = detail.json.data.timeline.map((t: any) => t.to);
    assert.deepEqual(transitions, ['SEARCHING', 'ACCEPTED', 'SEARCHING']);
    assert.ok(detail.json.data.offers.length >= 2);
    assert.equal((await call('GET', '/api/admin/rides', undefined, 'p1')).status, 403);
    const cancelled = await call('POST', `/api/admin/rides/${rideId}/cancel`, { reason: 'Majaribio ya ofisi' }, 'admin');
    assert.equal(cancelled.json.data.status, 'CANCELLED');
    assert.equal(cancelled.json.data.cancelledBy, 'ADMIN');
    assert.equal((await state('d2')).offer, null);
    await call('POST', `/api/rides/${rideId}/close`, {}, 'p1');
  });

  it('bajaji: ombi linaenda kwa dereva wa bajaji tu', async () => {
    rideId = (await call('POST', '/api/rides', requestBody('BAJAJI'), 'p2')).json.data.id;
    assert.equal((await state('d3')).offer?.ride.id, rideId);
    assert.equal((await state('d1')).offer, null);
    await call('POST', `/api/rides/${rideId}/cancel`, {}, 'p2');
  });

  it('dereva aliye online hawezi kuagiza safari kama abiria (409)', async () => {
    assert.equal((await call('POST', '/api/rides', requestBody(), 'd1')).status, 409);
  });

  it('maombi mawili ya abiria kwa wakati mmoja: moja tu inakubaliwa', async () => {
    const [a, b] = await Promise.all([call('POST', '/api/rides', requestBody(), 'p2'), call('POST', '/api/rides', requestBody(), 'p2')]);
    assert.deepEqual([a.status, b.status].sort(), [201, 409]);
    const active = await db.query(`SELECT count(*)::int AS n FROM naya.rides WHERE passenger_id = $1 AND status = 'SEARCHING'`, [ids.p2]);
    assert.equal(active.rows[0].n, 1);
  });

  it('dashboard ya ofisi: takwimu za safari na madereva online', async () => {
    const dash = await call('GET', '/api/admin/dashboard', undefined, 'admin');
    assert.ok(dash.json.data.rides.completedToday >= 1);
    assert.ok(dash.json.data.rides.valueToday > 0);
    assert.ok(dash.json.data.rides.driversOnline >= 3);
    assert.ok(dash.json.data.rides.active >= 1);
  });

  it('kwenda offline kunarudisha ombi kwa dispatch', async () => {
    const current = (await call('GET', '/api/rides/current', undefined, 'p2')).json.data;
    const holder = (await state('d1')).offer ? 'd1' : 'd2';
    assert.equal((await call('POST', '/api/driver/online', { online: false }, holder)).json.data.online, false);
    const other = holder === 'd1' ? 'd2' : 'd1';
    assert.equal((await state(other)).offer?.ride.id, current.id);
  });
});
