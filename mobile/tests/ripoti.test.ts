// Ripoti kamili za ofisi: madereva na wateja hawachanganyiki, APK/link, maombi na kila dereva alichofanya, online sasa.
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
    remoteAddress: `10.12.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...extra },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

const A = { lat: -5.6, lng: 32.8 };
const B = { lat: -5.615, lng: 32.81 };

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
  assert.equal((await call('POST', '/api/driver/online', { online: true, ...at }, key, { 'x-naya-client': 'apk' })).status, 200);
}
const get = async (url: string) => {
  const res = await call('GET', url, undefined, 'admin');
  assert.equal(res.status, 200, `${url}: ${res.json?.message}`);
  return res.json.data;
};

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  for (const [name, p] of [[`Pickup Rp${s}`, A], [`Dest Rp${s}`, B]] as const) {
    const row = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(row.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 1000, 500, 1500, 100, 1.3), ('BAJAJI', 1500, 700, 2500, 500, 1.3)`,
  );
  await makeUser('admin', `0770${s}`, 'Ofisi Ripoti', null, 'ADMIN');
  await makeUser('p1', `0771${s}`, `Mteja APK ${s}`, 'PASSENGER');
  await makeUser('p2', `0772${s}`, `Mteja Link ${s}`, 'PASSENGER');
  await makeDriver('d1', `0773${s}`, `Boda Karibu ${s}`, `MC ${s.slice(-3)} RP1`, { lat: A.lat - 0.0004, lng: A.lng });
  await makeDriver('d2', `0774${s}`, `Boda Mbali ${s}`, `MC ${s.slice(-3)} RP2`, { lat: A.lat - 0.004, lng: A.lng });
  // Wateja wanafungua app: p1 kwenye APK, p2 kwenye link
  await call('GET', '/api/account', undefined, 'p1', { 'x-naya-client': 'apk' });
  await call('GET', '/api/account', undefined, 'p2', { 'x-naya-client': 'web' });
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

describe('Ripoti kamili za ofisi', () => {
  let rideId = '';

  it('mteja si ofisi: ripoti zinakataliwa (403)', async () => {
    assert.equal((await call('GET', '/api/admin/ripoti/madereva', undefined, 'p1')).status, 403);
    assert.equal((await call('GET', '/api/admin/ripoti/wateja.csv', undefined, 'p1')).status, 403);
  });

  it('ombi: d1 anakataa, d2 anakubali (data ya ripoti ya maombi)', async () => {
    const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
    rideId = res.json.data.id;
    const o1 = (await call('GET', '/api/driver/state', undefined, 'd1')).json.data.offer;
    await call('POST', `/api/driver/offers/${o1.id}/decline`, {}, 'd1');
    const o2 = (await call('GET', '/api/driver/state', undefined, 'd2')).json.data.offer;
    assert.equal((await call('POST', `/api/driver/offers/${o2.id}/accept`, {}, 'd2')).status, 200);
  });

  it('1. madereva walioidhinishwa tu — hakuna mteja kwenye orodha', async () => {
    const r = await get(`/api/admin/ripoti/madereva?q=${s}`);
    const names = r.rows.map((x: any) => x.name);
    assert.ok(names.includes(`Boda Karibu ${s}`) && names.includes(`Boda Mbali ${s}`), JSON.stringify(names));
    assert.ok(!names.some((x: string) => x.startsWith('Mteja ')), 'mteja yuko kwenye ripoti ya madereva');
    const d1 = r.rows.find((x: any) => x.name.startsWith('Boda Karibu'));
    assert.equal(d1.status, 'APPROVED');
    assert.equal(d1.online, true);
    assert.equal(d1.declined, 1);
    assert.equal(d1.client, 'apk');
    assert.ok(r.summary.approved >= 2);
    for (const x of r.rows) assert.equal('password_hash' in x, false);
  });

  it('2. wateja tu — madereva hawamo; utafutaji kwa namba 07…', async () => {
    const r = await get(`/api/admin/ripoti/wateja?q=${s}`);
    const names = r.rows.map((x: any) => x.name);
    assert.ok(names.includes(`Mteja APK ${s}`) && names.includes(`Mteja Link ${s}`), JSON.stringify(names));
    assert.ok(!names.some((x: string) => x.startsWith('Boda ')), 'dereva yuko kwenye ripoti ya wateja');
    const p1 = r.rows.find((x: any) => x.name.startsWith('Mteja APK'));
    assert.equal(p1.requested, 1);
    const byPhone = await get(`/api/admin/ripoti/wateja?q=0771${s}`);
    assert.ok(byPhone.rows.map((x: any) => x.name).includes(`Mteja APK ${s}`));
    assert.ok(!byPhone.rows.map((x: any) => x.name).includes(`Mteja Link ${s}`));
  });

  it('3. APK dhidi ya link: kila mteja yuko kundi lake sahihi', async () => {
    const apk = (await get(`/api/admin/ripoti/wateja?q=${s}&client=apk`)).rows.map((x: any) => x.name);
    assert.ok(apk.includes(`Mteja APK ${s}`) && !apk.includes(`Mteja Link ${s}`), JSON.stringify(apk));
    const web = (await get(`/api/admin/ripoti/wateja?q=${s}&client=web`)).rows.map((x: any) => x.name);
    assert.ok(web.includes(`Mteja Link ${s}`) && !web.includes(`Mteja APK ${s}`), JSON.stringify(web));
    const summary = await get('/api/admin/ripoti/app');
    assert.ok(summary.passengers.apk >= 1 && summary.passengers.web >= 1);
    assert.ok(summary.drivers.apk >= 2);
    assert.equal(summary.days.length, 30);
  });

  it('4. maombi: abiria, hali, na kila dereva aliyepewa alifanya nini', async () => {
    const r = await get(`/api/admin/ripoti/maombi?q=Mteja APK ${s}`);
    assert.equal(r.rows.length, 1);
    const row = r.rows[0];
    assert.equal(row.id, rideId);
    assert.equal(row.status, 'ACCEPTED');
    assert.equal(row.driverName, `Boda Mbali ${s}`);
    assert.ok(Number.isInteger(row.secondsToDriver));
    const byName = Object.fromEntries(row.offers.map((o: any) => [o.name, o.status]));
    assert.deepEqual(byName, { [`Boda Karibu ${s}`]: 'DECLINED', [`Boda Mbali ${s}`]: 'ACCEPTED' });
    const d1 = r.drivers.find((x: any) => x.name === `Boda Karibu ${s}`);
    assert.equal(d1.declined, 1);
  });

  it('5. online sasa: d1 tayari kupokea ombi, d2 yuko safarini', async () => {
    const r = await get('/api/admin/ripoti/online');
    const d1 = r.rows.find((x: any) => x.name === `Boda Karibu ${s}`);
    const d2 = r.rows.find((x: any) => x.name === `Boda Mbali ${s}`);
    assert.equal(d1.readiness, 'READY');
    assert.equal(d1.nearPlace, `Pickup Rp${s}`);
    assert.equal(d2.readiness, 'ON_RIDE');
    assert.ok(r.summary.ready >= 1 && r.summary.onRide >= 1);
  });

  it('CSV kamili za kila ripoti (Excel)', async () => {
    for (const [url, header] of [
      ['/api/admin/ripoti/madereva.csv', 'Jina,Simu,Hali'],
      ['/api/admin/ripoti/wateja.csv', 'Jina,Simu,Alijisajili'],
      ['/api/admin/ripoti/maombi.csv?days=7', 'Muda,Hali,Chombo'],
      ['/api/admin/ripoti/online.csv', 'Jina,Simu,Plate'],
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${tokens.admin}` } });
      assert.equal(res.statusCode, 200, url);
      assert.match(String(res.headers['content-type']), /text\/csv/);
      assert.ok(res.body.replace(/^\uFEFF/, '').startsWith(header), `${url}: ${res.body.slice(0, 60)}`);
    }
    const m = await app.inject({ method: 'GET', url: `/api/admin/ripoti/maombi.csv?q=${encodeURIComponent('Mteja APK ' + s)}`, headers: { authorization: `Bearer ${tokens.admin}` } });
    assert.match(m.body, /Alikataa/);
    assert.match(m.body, /Alikubali/);
  });
});
