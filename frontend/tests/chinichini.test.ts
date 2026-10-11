// Kosa #1: dereva hapokei maombi skrini ikiwa imezimwa.
// - Dereva mwenye APK (token ya Firebase) anaendelea kupewa maombi hata kama simu haijatuma mahali kwa dakika kadhaa.
// - Dereva asiyejibu maombi 2 mfululizo anawekwa offline na kuarifiwa (asiwazuie wateja).
// - Huduma ya chinichini ya APK inaambiwa 409 dereva akiwa offline ili ijisimamishe.
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
    remoteAddress: `10.9.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...extra },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

// Mbali na maeneo ya tests nyingine ili madereva wao wasiingilie
const A = { lat: -5.2, lng: 32.3 };
const B = { lat: -5.215, lng: 32.31 };
const NEAR_A = { lat: -5.2004, lng: 32.3002 };
const FAR_A = { lat: -5.212, lng: 32.3 };

async function makeUser(key: string, phone: string, name: string, mode: string) {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode) VALUES ($1, $2, 'USER', $3, $4) RETURNING id`,
    [`255${phone.slice(1)}`, name, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: 'app' })).json.data.token;
}

async function makeDriver(key: string, phone: string, name: string, plate: string) {
  await makeUser(key, phone, name, 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
     VALUES ($1, 'APPROVED', 'BODABODA', $2, 'Boxer', 'Nyekundu', 'DL123456', now() + interval '30 days')`,
    [ids[key], plate],
  );
}

const state = async (who: string) => (await call('GET', '/api/driver/state', undefined, who)).json.data;
const order = async () => {
  const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
  assert.equal(res.status, 201, res.json.message);
  return res.json.data.id as string;
};
/** Simu "imezimwa skrini" kwa dakika 5: hakuna ping. */
const screenOff = () => db.query(`UPDATE naya.drivers SET last_seen_at = now() - interval '5 minutes' WHERE user_id = ANY($1::uuid[])`, [[ids.d1, ids.d2]]);
const expireOffers = (rideId: string) =>
  db.query(`UPDATE naya.ride_offers SET expires_at = now() - interval '1 second' WHERE ride_id = $1 AND status = 'PENDING'`, [rideId]);

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  for (const [name, p] of [[`Pickup C${s}`, A], [`Dest C${s}`, B]] as const) {
    const row = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(row.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 1000, 500, 1500, 100, 1.3), ('BAJAJI', 1500, 700, 2500, 500, 1.3)`,
  );
  await makeUser('p1', `0740${s}`, 'Abiria Chinichini', 'PASSENGER');
  await makeDriver('d1', `0741${s}`, 'Dereva APK', `MC ${s.slice(-3)} APK`);
  await makeDriver('d2', `0742${s}`, 'Dereva Kivinjari', `MC ${s.slice(-3)} WEB`);
  // d1 ana APK (token ya Firebase); d2 anatumia kivinjari tu.
  await db.query(`INSERT INTO naya.fcm_tokens (token, user_id) VALUES ($1, $2)`, [`test-token-${s}`, ids.d1]);
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

describe('Kosa #1 — maombi skrini ikiwa imezimwa', () => {
  let rideId = '';

  it('madereva wanaenda online', async () => {
    assert.equal((await call('POST', '/api/driver/online', { online: true, ...FAR_A }, 'd1')).status, 200);
    assert.equal((await call('POST', '/api/driver/online', { online: true, ...NEAR_A }, 'd2')).status, 200);
  });

  it('skrini imezimwa dakika 5: dereva mwenye APK bado anapewa ombi; wa kivinjari (karibu zaidi) hapewi', async () => {
    await screenOff();
    rideId = await order();
    const s1 = await state('d1');
    assert.equal(s1.offer?.ride.id, rideId, 'dereva wa APK hakupata ombi');
    assert.equal((await state('d2')).offer, null);
  });

  it('ombi 1 likiisha bila jibu: bado yuko online', async () => {
    await expireOffers(rideId);
    await dispatchPending();
    const row = await db.query('SELECT is_online FROM naya.drivers WHERE user_id = $1', [ids.d1]);
    assert.equal(row.rows[0].is_online, true);
    assert.equal((await call('POST', `/api/rides/${rideId}/cancel`, {}, 'p1')).status, 200);
  });

  it('maombi 2 mfululizo bila jibu: anawekwa offline na kuarifiwa', async () => {
    await screenOff();
    rideId = await order();
    assert.equal((await state('d1')).offer?.ride.id, rideId);
    await expireOffers(rideId);
    await dispatchPending();
    const row = await db.query('SELECT is_online FROM naya.drivers WHERE user_id = $1', [ids.d1]);
    assert.equal(row.rows[0].is_online, false);
    const n = await db.query(`SELECT title FROM naya.notifications WHERE user_id = $1 AND kind = 'auto_offline'`, [ids.d1]);
    assert.equal(n.rows.length, 1);
    assert.equal(n.rows[0].title, 'Umewekwa offline');
    assert.equal((await call('POST', `/api/rides/${rideId}/cancel`, {}, 'p1')).status, 200);
  });

  it('huduma ya APK inaambiwa 409 dereva akiwa offline; kivinjari kinaendelea kupata 200', async () => {
    const svc = await call('POST', '/api/driver/location', NEAR_A, 'd1', { 'x-naya-client': 'android-service' });
    assert.equal(svc.status, 409);
    assert.equal((await call('POST', '/api/driver/location', NEAR_A, 'd1')).status, 200);
  });

  it('akirudi online, maombi yaliyokosa kabla hayamrudishi offline mara moja', async () => {
    assert.equal((await call('POST', '/api/driver/online', { online: true, ...FAR_A }, 'd1')).status, 200);
    await screenOff();
    rideId = await order();
    assert.equal((await state('d1')).offer?.ride.id, rideId);
    await expireOffers(rideId);
    await dispatchPending();
    const row = await db.query('SELECT is_online FROM naya.drivers WHERE user_id = $1', [ids.d1]);
    assert.equal(row.rows[0].is_online, true);
    assert.equal((await call('POST', `/api/rides/${rideId}/cancel`, {}, 'p1')).status, 200);
    const svc = await call('POST', '/api/driver/location', FAR_A, 'd1', { 'x-naya-client': 'android-service' });
    assert.equal(svc.status, 200);
  });
});
