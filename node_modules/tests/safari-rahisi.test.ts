// Safari rahisi (0.14.2): safari za kawaida HAZINA PIN (kama Bolt); PIN inabaki kwa safari za ofa tu.
// GPS ya dereva inafanya kazi ya kinga ya kusahau: "Nimefika" yenyewe, "Anza" yenyewe, ukumbusho wa kumaliza,
// kumaliza yenyewe baada ya dakika 5 / saa 3, kitufe cha abiria "Nimefika — maliza safari", na alama za kutiliwa shaka.
// Database ya MAJARIBIO tu.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { autoCompleteRides } from '../src/services/rides.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6);
const PASSWORD = 'NayaTest#2026';
const userIds: string[] = [];
const locationIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let ip = 0;

async function call(method: 'GET' | 'POST', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.21.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

// Eneo la majaribio peke yake (madereva wa majaribio mengine hawaingilii)
const A = { lat: -6.2, lng: 33.4 }; // mahali pa kumchukua abiria
const B = { lat: -6.215, lng: 33.41 }; // unakoenda (~km 2)
const START = { lat: -6.2036, lng: 33.4 }; // ~m 400 kutoka A: dereva anaanzia hapa
const NEAR_A = { lat: -6.2005, lng: 33.4002 }; // ~m 60 kutoka A
const FAR_A = { lat: -6.214, lng: 33.4 }; // ~km 1.5 kutoka A
const TOWARD_B = { lat: -6.2035, lng: 33.4025 }; // ~m 480 kutoka A, kuelekea B
const AWAY = { lat: -6.186, lng: 33.39 }; // ~km 1.9 kutoka A, upande wa pili wa B
const NEAR_B = { lat: -6.214, lng: 33.41 }; // ~m 110 kutoka B

async function makeUser(key: string, phone: string, name: string, mode: string | null, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`255${phone.slice(1)}`, name, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: role === 'USER' ? 'app' : 'admin' })).json.data.token;
}

const trip = { pickup: { locationId: '' }, destination: { locationId: '' }, vehicleType: 'BODABODA' };
const ping = (at: { lat: number; lng: number }) => call('POST', '/api/driver/location', at, 'd1');
const passengerRide = async () => (await call('GET', '/api/rides/current', undefined, 'p1')).json.data;
const driverRide = async () => (await call('GET', '/api/driver/state', undefined, 'd1')).json.data.ride;
const row = async (id: string) => (await db.query('SELECT * FROM naya.rides WHERE id = $1', [id])).rows[0];

/** Abiria anaagiza, dereva anakubali (dereva yuko START, m 400 kutoka A). */
async function acceptedRide() {
  assert.equal((await ping(START)).status, 200);
  const res = await call('POST', '/api/rides', trip, 'p1');
  assert.equal(res.status, 201, res.json.message);
  const offer = (await call('GET', '/api/driver/state', undefined, 'd1')).json.data.offer;
  assert.equal(offer?.ride.id, res.json.data.id, 'dereva hakupata ombi');
  assert.equal((await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, 'd1')).status, 200);
  return res.json.data.id as string;
}
async function closeBoth(rideId: string) {
  await call('POST', `/api/rides/${rideId}/close`, {}, 'p1');
  await call('POST', `/api/driver/rides/${rideId}/close`, {}, 'd1');
}

let pausedBefore: string[] = [];
before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  pausedBefore = (await db.query(`UPDATE naya.promotions SET status = 'PAUSED' WHERE status = 'ACTIVE' RETURNING id`)).rows.map((r) => r.id);
  for (const [name, p] of [[`Pickup S${s}`, A], [`Dest S${s}`, B]] as const) {
    const r = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(r.rows[0].id);
  }
  trip.pickup.locationId = locationIds[0];
  trip.destination.locationId = locationIds[1];
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 1000, 500, 1500, 100, 1.3), ('BAJAJI', 1500, 700, 2500, 500, 1.3)`,
  );
  await makeUser('admin', `0791${s}`, 'Ofisi Safari Rahisi', null, 'ADMIN');
  await makeUser('p1', `0792${s}`, `Abiria Rahisi ${s}`, 'PASSENGER');
  await makeUser('p2', `0793${s}`, `Abiria Mwingine ${s}`, 'PASSENGER');
  await makeUser('d1', `0794${s}`, `Boda Rahisi ${s}`, 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
     VALUES ($1, 'APPROVED', 'BODABODA', $2, 'Boxer', 'Nyekundu', 'DL123456', now() + interval '30 days')`,
    [ids.d1, `MC ${s.slice(-3)} SR1`],
  );
  assert.equal((await call('POST', '/api/driver/online', { online: true, ...START }, 'd1')).status, 200);
});

after(async () => {
  await db.query('DELETE FROM naya.ride_offers WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  await db.query(`UPDATE naya.promotions SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])`, [pausedBefore]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

describe('Safari rahisi — bila PIN, GPS inasaidia', () => {
  it('safari ya kawaida haina PIN', async () => {
    const rideId = await acceptedRide();
    const view = await passengerRide();
    assert.equal(view.pin, null);
    assert.equal((await row(rideId)).start_pin, null);
    await call('POST', `/api/rides/${rideId}/cancel`, {}, 'p1');
    await closeBoth(rideId);
  });

  it('"Nimefika" ya mkono inakataliwa dereva akiwa zaidi ya km 1 kutoka kwa abiria', async () => {
    const rideId = await acceptedRide();
    await ping(FAR_A);
    const res = await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, 'd1');
    assert.equal(res.status, 409);
    assert.match(res.json.message, /Bado hujafika kwa abiria/);
    assert.equal((await row(rideId)).status, 'ACCEPTED');
    await call('POST', `/api/rides/${rideId}/cancel`, {}, 'p1');
    await closeBoth(rideId);
  });

  it('GPS: Nimefika yenyewe (m 100) → Anza yenyewe akiondoka kuelekea unakoenda → ukumbusho karibu na unakoenda → kumaliza yenyewe baada ya dakika 5', async () => {
    const rideId = await acceptedRide();
    await ping(NEAR_A);
    let r = await row(rideId);
    assert.equal(r.status, 'ARRIVED');
    assert.equal(r.auto_arrived, true);
    assert.equal((await passengerRide()).status, 'ARRIVED');

    await ping(TOWARD_B);
    r = await row(rideId);
    assert.equal(r.status, 'IN_PROGRESS');
    assert.equal(r.auto_started, true);
    assert.equal((await passengerRide()).autoStarted, true);
    const started = await db.query(`SELECT title FROM naya.notifications WHERE user_id = $1 AND ride_id = $2 AND title = 'Safari imeanza'`, [ids.d1, rideId]);
    assert.equal(started.rowCount, 1, 'dereva hakujulishwa kuwa safari imeanza');

    // Bado mbali na unakoenda: hakuna kumaliza
    await autoCompleteRides();
    assert.equal((await row(rideId)).status, 'IN_PROGRESS');

    await ping(NEAR_B);
    r = await row(rideId);
    assert.ok(r.near_dest_at, 'near_dest_at haikuwekwa');
    assert.equal((await driverRide()).nearDestination, true);
    await ping(NEAR_B); // ping ya pili haitumi ukumbusho tena
    const reminders = await db.query(`SELECT 1 FROM naya.notifications WHERE user_id = $1 AND ride_id = $2 AND title = 'Umefika?'`, [ids.d1, rideId]);
    assert.equal(reminders.rowCount, 1);

    await autoCompleteRides(); // bado dakika 5 hazijapita
    assert.equal((await row(rideId)).status, 'IN_PROGRESS');
    await db.query(`UPDATE naya.rides SET near_dest_at = now() - interval '6 minutes' WHERE id = $1`, [rideId]);
    await autoCompleteRides();
    r = await row(rideId);
    assert.equal(r.status, 'COMPLETED');
    assert.equal(r.completed_by, 'AUTO');
    assert.deepEqual(r.flags, []);
    const view = await passengerRide();
    assert.equal(view.status, 'COMPLETED');
    assert.equal(view.completedBy, 'AUTO');
    await closeBoth(rideId);
  });

  it('dereva akiondoka upande mwingine (si kuelekea unakoenda) safari haianzi yenyewe; akianza mbali → START_FAR', async () => {
    const rideId = await acceptedRide();
    await ping(NEAR_A);
    await ping(AWAY);
    assert.equal((await row(rideId)).status, 'ARRIVED');
    const started = await call('POST', `/api/driver/rides/${rideId}/start`, {}, 'd1');
    assert.equal(started.status, 200, started.json.message);
    assert.deepEqual((await row(rideId)).flags, ['START_FAR']);
    await ping(NEAR_B);
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/complete`, {}, 'd1')).status, 200);
    const admin = (await call('GET', `/api/admin/rides/${rideId}`, undefined, 'admin')).json.data;
    assert.ok(admin.flags.includes('START_FAR'));
    assert.equal(admin.completedBy, 'DRIVER');
    await closeBoth(rideId);
  });

  it('abiria: "Nimefika — maliza safari" → COMPLETED; ikiwa mbali na unakoenda na fupi mno → ENDED_FAR + TOO_SHORT', async () => {
    const rideId = await acceptedRide();
    await ping(NEAR_A);
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, {}, 'd1')).status, 200);
    assert.equal((await call('POST', `/api/rides/${rideId}/complete`, {}, 'p2')).status, 404);
    const done = await call('POST', `/api/rides/${rideId}/complete`, {}, 'p1');
    assert.equal(done.status, 200, done.json.message);
    assert.equal(done.json.data.status, 'COMPLETED');
    assert.equal(done.json.data.completedBy, 'PASSENGER');
    const r = await row(rideId);
    assert.deepEqual([...r.flags].sort(), ['ENDED_FAR', 'TOO_SHORT']);
    assert.equal((await call('POST', `/api/rides/${rideId}/complete`, {}, 'p1')).status, 409);
    const told = await db.query(`SELECT 1 FROM naya.notifications WHERE user_id = $1 AND ride_id = $2 AND title = 'Abiria amefika'`, [ids.d1, rideId]);
    assert.equal(told.rowCount, 1, 'dereva hakujulishwa');
    // Ripoti ya maombi inaonyesha alama na aliyemaliza
    const report = (await call('GET', `/api/admin/ripoti/maombi?days=1&q=${encodeURIComponent(`Abiria Rahisi ${s}`)}`, undefined, 'admin')).json.data;
    const line = report.rows.find((x: any) => x.id === rideId);
    assert.ok(line, 'safari haipo kwenye ripoti');
    assert.equal(line.completedBy, 'PASSENGER');
    assert.deepEqual([...line.flags].sort(), ['ENDED_FAR', 'TOO_SHORT']);
    await closeBoth(rideId);
  });

  it('safari ya ofa (yenye PIN): GPS haianzi yenyewe — dereva anakumbushwa PIN mara moja tu', async () => {
    const rideId = await acceptedRide();
    await db.query(`UPDATE naya.rides SET start_pin = '5512' WHERE id = $1`, [rideId]); // iga safari ya ofa
    await ping(NEAR_A);
    assert.equal((await driverRide()).pinRequired, true);
    await ping(TOWARD_B);
    await ping(TOWARD_B);
    const r = await row(rideId);
    assert.equal(r.status, 'ARRIVED');
    assert.ok(r.flags.includes('PIN_REMINDED'));
    const reminders = await db.query(`SELECT 1 FROM naya.notifications WHERE user_id = $1 AND ride_id = $2 AND title = 'Ingiza PIN ya abiria'`, [ids.d1, rideId]);
    assert.equal(reminders.rowCount, 1);
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, {}, 'd1')).status, 400);
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, { pin: '5512' }, 'd1')).status, 200);
    // Ofisi haioni alama ya ndani PIN_REMINDED
    const admin = (await call('GET', `/api/admin/rides/${rideId}`, undefined, 'admin')).json.data;
    assert.equal(admin.flags.includes('PIN_REMINDED'), false);
    await ping(NEAR_B);
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/complete`, {}, 'd1')).status, 200);
    await closeBoth(rideId);
  });

  it('safari isiyomalizwa kwa saa 3 inajifunga yenyewe na alama AUTO_TIMEOUT', async () => {
    const rideId = await acceptedRide();
    await ping(NEAR_A);
    assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, {}, 'd1')).status, 200);
    await db.query(`UPDATE naya.rides SET started_at = now() - interval '4 hours' WHERE id = $1`, [rideId]);
    await autoCompleteRides();
    const r = await row(rideId);
    assert.equal(r.status, 'COMPLETED');
    assert.equal(r.completed_by, 'AUTO');
    assert.deepEqual(r.flags, ['AUTO_TIMEOUT']);
    await closeBoth(rideId);
  });
});
