// Akaunti mpya (0.15.0): wasifu, picha ya mteja (dereva anaiona kwenye ombi na safarini tu), mtu wa dharura.
// Database ya MAJARIBIO tu.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6);
const PASSWORD = 'NayaTest#2026';
const PNG = readFileSync(new URL('../frontend/shared/brand/naya-192.png', import.meta.url));
const userIds: string[] = [];
const locationIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const phones: Record<string, string> = {};
let ip = 0;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string, contentType?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.41.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...(contentType ? { 'content-type': contentType } : {}) },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  let json: any = null;
  try {
    json = res.json();
  } catch {
    json = null;
  }
  return { status: res.statusCode, json, headers: res.headers, raw: res.rawPayload };
}

const A = { lat: -6.9, lng: 34.0 };
const B = { lat: -6.915, lng: 34.01 };

async function makeUser(key: string, phone: string, name: string, mode: string | null, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode, phone_verified_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [`255${phone.slice(1)}`, name, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  phones[key] = `255${phone.slice(1)}`;
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: role === 'USER' ? 'app' : 'admin' })).json.data.token;
}
async function makeDriver(key: string, phone: string, name: string, plate: string, status = 'APPROVED') {
  await makeUser(key, phone, name, 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
     VALUES ($1, $2, 'BODABODA', $3, 'Boxer', 'Nyekundu', 'DL123456', now() + interval '30 days')`,
    [ids[key], status, plate],
  );
}

let pausedBefore: string[] = [];
before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  pausedBefore = (await db.query(`UPDATE naya.promotions SET status = 'PAUSED' WHERE status = 'ACTIVE' RETURNING id`)).rows.map((r) => r.id);
  for (const [name, p] of [[`Pickup K${s}`, A], [`Dest K${s}`, B]] as const) {
    const r = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(r.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 1000, 500, 1500, 100, 1.3), ('BAJAJI', 1500, 700, 2500, 500, 1.3)`,
  );
  await makeUser('admin', `0760${s}`, 'Ofisi Akaunti', null, 'ADMIN');
  await makeUser('p1', `0761${s}`, `Neema Akaunti ${s}`, 'PASSENGER');
  await makeDriver('d1', `0762${s}`, `Baraka Akaunti ${s}`, `MC ${s.slice(-3)} AK1`);
  await makeDriver('d2', `0763${s}`, `Juma Akaunti ${s}`, `MC ${s.slice(-3)} AK2`);
  await makeDriver('d3', `0764${s}`, `Asha Inasubiri ${s}`, `MC ${s.slice(-3)} AK3`, 'PENDING');
  // d2 yuko mbali (km ~30) — hapati ombi
  assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.0005, lng: A.lng }, 'd1')).status, 200);
});

after(async () => {
  await db.query('DELETE FROM naya.sos_alerts WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.ride_offers WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  const files = (await db.query('SELECT photo_file_id FROM naya.users WHERE id = ANY($1::uuid[]) AND photo_file_id IS NOT NULL', [userIds])).rows.map((r) => r.photo_file_id);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.document_files WHERE id = ANY($1::uuid[])', [files]);
  await db.query(`UPDATE naya.promotions SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])`, [pausedBefore]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

describe('Akaunti: wasifu, picha, mtu wa dharura', () => {
  let rideId = '';

  it('wasifu: jina, simu, takwimu; bila picha mwanzoni', async () => {
    const r = await call('GET', '/api/account/profile', undefined, 'p1');
    assert.equal(r.status, 200);
    assert.equal(r.json.data.fullName, `Neema Akaunti ${s}`);
    assert.equal(r.json.data.hasPhoto, false);
    assert.equal(r.json.data.canEditName, true);
    assert.equal(r.json.data.stats.trips, 0);
    assert.equal((await call('GET', '/api/account', undefined, 'p1')).json.data.user.hasPhoto, false);
  });

  it('kubadilisha jina: mteja anaweza; dereva anayehakikiwa hawezi', async () => {
    const ok = await call('PUT', '/api/account/profile', { fullName: `Neema Juma ${s}` }, 'p1');
    assert.equal(ok.status, 200, ok.json?.message);
    assert.equal(ok.json.data.fullName, `Neema Juma ${s}`);
    assert.equal((await call('PUT', '/api/account/profile', { fullName: 'N' }, 'p1')).status, 400);
    const drv = await call('PUT', '/api/account/profile', { fullName: 'Jina Jingine' }, 'd3');
    assert.equal(drv.status, 400);
    assert.match(drv.json.message, /Msaada/);
    assert.equal((await call('GET', '/api/account/profile', undefined, 'd3')).json.data.canEditName, false);
  });

  it('picha: inapakiwa (picha tu), inaonekana kwa mwenyewe, akaunti inaonyesha hasPhoto', async () => {
    assert.equal((await call('PUT', '/api/account/photo', Buffer.from('%PDF-1.4 bandia'), 'p1', 'application/pdf')).status, 415);
    assert.equal((await call('PUT', '/api/account/photo', Buffer.from('si picha'), 'p1', 'image/png')).status, 400);
    const up = await call('PUT', '/api/account/photo', PNG, 'p1', 'image/png');
    assert.equal(up.status, 200, up.json?.message);
    assert.equal(up.json.data.hasPhoto, true);
    const me = await call('GET', '/api/account/photo', undefined, 'p1');
    assert.equal(me.status, 200);
    assert.equal(me.headers['content-type'], 'image/png');
    assert.equal(me.raw.length, PNG.length);
    const acc = (await call('GET', '/api/account', undefined, 'p1')).json.data;
    assert.equal(acc.user.hasPhoto, true);
    assert.ok(acc.user.photoVersion);
  });

  it('dereva aliyepewa ombi anaona picha na jina la kwanza la abiria; dereva mwingine haoni', async () => {
    const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
    assert.equal(res.status, 201, res.json?.message);
    rideId = res.json.data.id;
    const st = (await call('GET', '/api/driver/state', undefined, 'd1')).json.data;
    assert.equal(st.offer.ride.id, rideId);
    assert.equal(st.offer.passenger.firstName, 'Neema');
    assert.equal(st.offer.passenger.hasPhoto, true);
    assert.equal(JSON.stringify(st.offer).includes(phones.p1), false, 'namba ya abiria isionekane kabla ya kukubali');
    const photo = await call('GET', `/api/driver/rides/${rideId}/passenger-photo`, undefined, 'd1');
    assert.equal(photo.status, 200);
    assert.equal(photo.raw.length, PNG.length);
    assert.equal((await call('GET', `/api/driver/rides/${rideId}/passenger-photo`, undefined, 'd2')).status, 404);
    assert.equal((await call('GET', `/api/driver/rides/${rideId}/passenger-photo`, undefined, 'p1')).status, 404);
  });

  it('baada ya kukubali: safari ya dereva inaonyesha picha ya abiria', async () => {
    const offerId = (await call('GET', '/api/driver/state', undefined, 'd1')).json.data.offer.id;
    assert.equal((await call('POST', `/api/driver/offers/${offerId}/accept`, {}, 'd1')).status, 200);
    const ride = (await call('GET', '/api/driver/state', undefined, 'd1')).json.data.ride;
    assert.equal(ride.passenger.hasPhoto, true);
    assert.equal(ride.passenger.name, `Neema Juma ${s}`);
    assert.equal((await call('GET', `/api/driver/rides/${rideId}/passenger-photo`, undefined, 'd1')).status, 200);
  });

  it('mtu wa dharura: namba mbovu / namba yako mwenyewe zinakataliwa; inahifadhiwa na ofisi inaiona kwenye Dharura', async () => {
    assert.equal((await call('PUT', '/api/account/emergency', { name: 'Mama', phone: '12345' }, 'p1')).status, 400);
    assert.equal((await call('PUT', '/api/account/emergency', { name: 'Mama', phone: `0761${s}` }, 'p1')).status, 400);
    const ok = await call('PUT', '/api/account/emergency', { name: 'Mama Neema', phone: '0713 222 333' }, 'p1');
    assert.equal(ok.status, 200, ok.json?.message);
    assert.deepEqual(ok.json.data.emergency, { name: 'Mama Neema', phone: '255713222333' });
    assert.deepEqual((await call('GET', '/api/account', undefined, 'p1')).json.data.emergency, { name: 'Mama Neema', phone: '255713222333' });
    assert.equal((await call('POST', '/api/sos', { rideId, ...A }, 'p1')).status, 201);
    const alert = (await call('GET', '/api/admin/sos', undefined, 'admin')).json.data.find((x: any) => x.rideId === rideId);
    assert.equal(alert.emergencyPhone, '255713222333');
    assert.equal(alert.emergencyName, 'Mama Neema');
    const detail = (await call('GET', `/api/admin/users/${ids.p1}`, undefined, 'admin')).json.data.user;
    assert.equal(detail.emergencyPhone, '255713222333');
    assert.equal(detail.hasPhoto, true);
  });

  it('ofisi inaona picha ya mtumiaji; mtumiaji wa kawaida hawezi', async () => {
    assert.equal((await call('GET', `/api/admin/users/${ids.p1}/photo`, undefined, 'admin')).status, 200);
    assert.equal((await call('GET', `/api/admin/users/${ids.p1}/photo`, undefined, 'd1')).status, 403);
  });

  it('kuondoa picha na mtu wa dharura', async () => {
    const del = await call('POST', '/api/account/photo/delete', {}, 'p1');
    assert.equal(del.json.data.hasPhoto, false);
    assert.equal((await call('GET', '/api/account/photo', undefined, 'p1')).status, 404);
    assert.equal((await call('GET', `/api/driver/rides/${rideId}/passenger-photo`, undefined, 'd1')).status, 404);
    const em = await call('POST', '/api/account/emergency/delete', {}, 'p1');
    assert.equal(em.json.data.emergency, null);
  });

  it('ofa: jibu kamili lina "umeokoa" (saved)', async () => {
    const r = (await call('GET', '/api/offers?full=1', undefined, 'p1')).json.data;
    assert.deepEqual(r.saved, { rides: 0, amount: 0 });
  });
});
