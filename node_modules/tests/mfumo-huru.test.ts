// 0.16.2 "Mfumo huru" (madereva wachache): kila dereva aliyeidhinishwa na yuko online anapokea maombi bila vikwazo —
// ada haitozwi, simu "iliyolala" inapewa, mfumo haumweki offline, ombi kwa wote walio karibu kwa pamoja.
// Database ya MAJARIBIO tu.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { getDispatchSettings, saveDispatchSettings } from '../src/services/dispatch-rules.js';
import { candidatesForRide, dispatchPending, offlineUnseenDrivers } from '../src/services/rides.js';
import { runSubscriptionChecks } from '../src/services/subscriptions.js';

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
    remoteAddress: `10.12.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

const A = { lat: -5.5, lng: 32.7 };
const B = { lat: -5.515, lng: 32.71 };
// d1 kawaida · d2 ada imeisha zamani · d3 simu haijaonekana dakika 40 · d4 kawaida (mbali kidogo) · b1 bajaji
const DRIVERS = [
  { key: 'd1', vehicle: 'BODABODA', dlat: 0.0005 },
  { key: 'd2', vehicle: 'BODABODA', dlat: 0.001 },
  { key: 'd3', vehicle: 'BODABODA', dlat: 0.002 },
  { key: 'd4', vehicle: 'BODABODA', dlat: 0.004 },
  { key: 'b1', vehicle: 'BAJAJI', dlat: 0.0007 },
];
const BODA = ['d1', 'd2', 'd3', 'd4'];

async function makeUser(key: string, phone: string, name: string, mode: string) {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode) VALUES ($1, $2, 'USER', $3, $4) RETURNING id`,
    [`255${phone.slice(1)}`, name, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: 'app' })).json.data.token;
}
const offeredFor = async (rideId: string) =>
  (await db.query(`SELECT driver_id FROM naya.ride_offers WHERE ride_id = $1 AND status = 'PENDING'`, [rideId])).rows
    .map((r) => Object.keys(ids).find((k) => ids[k] === r.driver_id))
    .sort();
const isOnline = async (key: string) => (await db.query('SELECT is_online FROM naya.drivers WHERE user_id = $1', [ids[key]])).rows[0].is_online;
const order = async () => {
  const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
  assert.equal(res.status, 201, res.json.message);
  return res.json.data.id as string;
};

before(async () => {
  await runMigrations(() => {});
  // Hali ya kuanzia: kama production baada ya migration 024 (mfumo huru umewashwa)
  await db.query(`INSERT INTO naya.settings (key, value) VALUES ('dispatch', '{"openMode": true}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  app = await buildApp({ logger: false });
  for (const [name, p] of [[`Pickup H${s}`, A], [`Dest H${s}`, B]] as const) {
    const row = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(row.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 1000, 500, 1500, 100, 1.3), ('BAJAJI', 1500, 700, 2500, 500, 1.3)`,
  );
  await makeUser('p1', `0740${s}`, 'Abiria Huru', 'PASSENGER');
  for (const [i, d] of DRIVERS.entries()) {
    await makeUser(d.key, `074${i + 1}${s}`, `Dereva Huru ${d.key}`, 'DRIVER');
    await db.query(
      `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
       VALUES ($1, 'APPROVED', $2, $3, 'Boxer', 'Nyekundu', 'DL123456', now() + interval '30 days')`,
      [ids[d.key], d.vehicle, `MC ${s.slice(-3)} H${i + 1}`],
    );
  }
  // d2: ada iliisha siku 90 zilizopita (zaidi ya siku za kuvumiliwa)
  await db.query(`UPDATE naya.drivers SET paid_until = now() - interval '90 days' WHERE user_id = $1`, [ids.d2]);
});

after(async () => {
  await db.query(`UPDATE naya.settings SET value = '{"openMode": true}' WHERE key = 'dispatch'`);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.ride_offers WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('UPDATE naya.settings SET updated_by = NULL WHERE updated_by = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

describe('Mfumo huru — madereva wachache wanapokea maombi bila vikwazo', () => {
  let rideId = '';

  it('umewashwa kwa chaguo-msingi', async () => {
    assert.equal((await getDispatchSettings()).openMode, true);
  });

  it('dereva mwenye ada iliyoisha anaweza kwenda online; app haimzuii', async () => {
    for (const d of DRIVERS) {
      const res = await call('POST', '/api/driver/online', { online: true, lat: A.lat - d.dlat, lng: A.lng }, d.key);
      assert.equal(res.status, 200, `${d.key}: ${res.json.message}`);
    }
    const st = (await call('GET', '/api/driver/state', undefined, 'd2')).json.data;
    assert.equal(st.online, true);
    assert.equal(st.subscription.state, 'EXPIRED');
    assert.equal(st.subscription.waived, true);
    assert.equal((await call('GET', '/api/driver/subscription', undefined, 'd2')).json.data.waived, true);
  });

  it('ombi linaenda kwa madereva WOTE wa bodaboda walio karibu kwa pamoja — hata ada imeisha au simu imelala', async () => {
    await db.query(`UPDATE naya.drivers SET last_seen_at = now() - interval '40 minutes' WHERE user_id = $1`, [ids.d3]);
    rideId = await order();
    assert.deepEqual(await offeredFor(rideId), BODA);
    const offer = (await call('GET', '/api/driver/state', undefined, 'd1')).json.data.offer;
    assert.equal(offer.totalSeconds, 20);
    // ofisi: wote wanaweza kupewa, hakuna "Ada imeisha"
    const list = (await candidatesForRide(rideId)) as any[];
    assert.ok(!list.some((c) => c.reasons.some((r: string) => /Ada/.test(r))));
  });

  it('wasipojibu mara mbili, hakuna anayewekwa offline na mfumo', async () => {
    for (let i = 0; i < 2; i++) {
      await db.query(`UPDATE naya.ride_offers SET expires_at = now() - interval '1 second' WHERE ride_id = $1 AND status = 'PENDING'`, [rideId]);
      await dispatchPending();
      await call('POST', `/api/rides/${rideId}/cancel`, { reason: 'jaribio' }, 'p1');
      await call('POST', `/api/rides/${rideId}/close`, {}, 'p1');
      if (i === 0) rideId = await order();
    }
    for (const k of BODA) assert.equal(await isOnline(k), true, k);
    await db.query(`UPDATE naya.drivers SET last_seen_at = now() - interval '2 hours' WHERE user_id = $1`, [ids.d4]);
    assert.deepEqual(await offlineUnseenDrivers(true), []);
    await runSubscriptionChecks();
    assert.equal(await isOnline('d4'), true);
    assert.equal(await isOnline('d2'), true); // ada imeisha — bado online
  });

  it('ofisi ikizima mfumo huru: sheria za kawaida zinarudi (ada iliyoisha haipewi, wimbi la 2)', async () => {
    await db.query(`UPDATE naya.drivers SET last_seen_at = now() WHERE user_id = ANY($1::uuid[])`, [BODA.map((k) => ids[k])]);
    assert.equal((await saveDispatchSettings(ids.p1, { openMode: false })).openMode, false);
    rideId = await order();
    const offered = await offeredFor(rideId);
    assert.equal(offered.length, 2);
    assert.ok(!offered.includes('d2'));
    const list = (await candidatesForRide(rideId)) as any[];
    assert.match(list.find((c) => c.id === ids.d2).reasons.join(' '), /Ada ya mwezi imeisha/);
    assert.equal((await call('POST', '/api/driver/online', { online: false }, 'd2')).status, 200);
    assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat, lng: A.lng }, 'd2')).status, 402);
    await call('POST', `/api/rides/${rideId}/cancel`, { reason: 'jaribio' }, 'p1');
    assert.equal((await saveDispatchSettings(ids.p1, { openMode: true })).openMode, true);
    assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat, lng: A.lng }, 'd2')).status, 200);
  });
});
