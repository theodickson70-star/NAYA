// 0.19.1 Ruhusa ya NAYA Staff kwenye akaunti iliyopo (dereva / abiria aliyekwisha jisajili).
// Namba moja = akaunti moja: ofisi inampa ruhusa ya staff; udereva wake hauguswi. Database ya MAJARIBIO tu.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6).replace(/^0/, '1');
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
    remoteAddress: `10.72.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  let json: any = null;
  try {
    json = res.json();
  } catch {
    json = null;
  }
  return { status: res.statusCode, json };
}
const login = (phone: string, password: string, portal = 'app') => call('POST', '/api/auth/login', { phone, password, portal });

async function makeUser(key: string, local: string, name: string, role: 'USER' | 'ADMIN', mode: string | null) {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode, phone_verified_at)
     VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [`255${local.slice(1)}`, name, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(ids[key]);
  tokens[key] = (await login(local, PASSWORD, role === 'ADMIN' ? 'admin' : 'app')).json.data.token;
}

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  await makeUser('admin', `0776${s}`, 'Ofisi Ruhusa Test', 'ADMIN', null);
  await makeUser('driver', `0777${s}`, 'Loveness John', 'USER', 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
     VALUES ($1, 'APPROVED', 'BODABODA', $2, 'Boxer', 'Nyekundu', 'DL555444', now() + interval '30 days')`,
    [ids.driver, `MC ${s.slice(-3)} LJN`],
  );
  await makeUser('passenger', `0778${s}`, 'Abiria Wa Kawaida', 'USER', 'PASSENGER');
});

after(async () => {
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[]) OR created_by = ANY($2::uuid[])', [locationIds, userIds]);
  await db.query('UPDATE naya.drivers SET registered_by = NULL, reviewed_by = NULL WHERE user_id = ANY($1::uuid[]) OR registered_by = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.drivers WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])', [userIds]);
  await db.query('UPDATE naya.users SET created_by = NULL, staff_added_by = NULL WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await app.close();
  await db.end();
});

describe('Ruhusa ya NAYA Staff — kumpa dereva aliyepo', () => {
  it('kabla ya ruhusa: dereva haoni chaguo la staff na kazi za staff zinamkataa', async () => {
    const acc = await call('GET', '/api/account', undefined, 'driver');
    assert.equal(acc.status, 200);
    assert.equal(acc.json.data.staffAccess, false);
    assert.equal((await call('GET', '/api/staff/home', undefined, 'driver')).status, 403);
    assert.equal((await call('GET', '/api/account', undefined, 'passenger')).json.data.staffAccess, false);
  });

  it('ofisi inaangalia namba: akaunti ipo (dereva) → inaweza kupewa ruhusa', async () => {
    const r = await call('POST', '/api/admin/staff/lookup', { phone: `0777${s}` }, 'admin');
    assert.equal(r.status, 200, r.json?.message);
    assert.equal(r.json.data.exists, true);
    assert.equal(r.json.data.kind, 'DRIVER');
    assert.equal(r.json.data.driverStatus, 'APPROVED');
    assert.equal(r.json.data.canLink, true);
    assert.equal((await call('POST', '/api/admin/staff/lookup', { phone: `0779${s}` }, 'admin')).json.data.exists, false);
    // si ofisi → hapana
    assert.equal((await call('POST', '/api/admin/staff/lookup', { phone: `0777${s}` }, 'driver')).status, 403);
    // namba ya ofisi haiwezi kuwa staff
    const adm = (await call('POST', '/api/admin/staff/lookup', { phone: `0776${s}` }, 'admin')).json.data;
    assert.equal(adm.canLink, false);
    assert.equal((await call('POST', '/api/admin/staff', { fullName: 'Ofisi', phone: `0776${s}`, linkExisting: true }, 'admin')).status, 409);
  });

  it('bila uthibitisho → 409; kwa uthibitisho → ruhusa bila password mpya, token ya dereva inaendelea', async () => {
    const no = await call('POST', '/api/admin/staff', { fullName: 'Loveness John', phone: `0777${s}` }, 'admin');
    assert.equal(no.status, 409);
    const r = await call('POST', '/api/admin/staff', { fullName: 'Loveness J', phone: `0777${s}`, linkExisting: true }, 'admin');
    assert.equal(r.status, 201, r.json?.message);
    assert.equal(r.json.data.linked, true);
    assert.equal(r.json.data.id, ids.driver);
    assert.equal(r.json.data.fullName, 'Loveness John'); // jina la akaunti linabaki
    assert.equal(r.json.data.tempPassword, undefined);
    // mara ya pili → tayari ni staff
    assert.equal((await call('POST', '/api/admin/staff', { fullName: 'Loveness John', phone: `0777${s}`, linkExisting: true }, 'admin')).status, 409);

    const acc = (await call('GET', '/api/account', undefined, 'driver')).json.data;
    assert.equal(acc.staffAccess, true);
    assert.equal(acc.activeMode, 'DRIVER');
    assert.equal(acc.driverStatus, 'APPROVED');
    assert.equal((await call('GET', '/api/staff/home', undefined, 'driver')).status, 200);
    assert.equal((await call('GET', '/api/driver/state', undefined, 'driver')).status, 200);
    // password yake ile ile bado inafanya kazi
    assert.equal((await login(`0777${s}`, PASSWORD)).status, 200);

    const list = (await call('GET', '/api/admin/staff', undefined, 'admin')).json.data;
    const me = list.find((x: any) => x.id === ids.driver);
    assert.equal(me.kind, 'LINKED');
    assert.equal(me.driverStatus, 'APPROVED');
    assert.equal(me.status, 'ACTIVE');
    assert.ok(!JSON.stringify(list).includes('password_hash'));
  });

  it('anafanya kazi za staff; hawezi kujisajili mwenyewe kama dereva', async () => {
    const self = await call(
      'POST',
      '/api/staff/drivers',
      { fullName: 'Loveness John', phone: `0777${s}`, vehicleType: 'BODABODA', plateNumber: `MC ${s.slice(-3)} LJX`, vehicleMake: 'Boxer', vehicleColor: 'Nyeusi', licenseNumber: 'DL111222' },
      'driver',
    );
    assert.equal(self.status, 409);
    const r = await call(
      'POST',
      '/api/staff/drivers',
      { fullName: 'Dereva Wa Loveness', phone: `0779${s}`, vehicleType: 'BODABODA', plateNumber: `MC ${s.slice(-3)} LJY`, vehicleMake: 'Boxer', vehicleColor: 'Nyeusi', licenseNumber: 'DL333444' },
      'driver',
    );
    assert.equal(r.status, 201, r.json?.message);
    userIds.push(r.json.data.id);
    const loc = await call('POST', '/api/staff/locations', { name: `Stendi Loveness ${s}`, category: 'STAND', lat: -5.07, lng: 32.05 }, 'driver');
    assert.equal(loc.status, 201, loc.json?.message);
    locationIds.push(loc.json.data.id);
    const list = (await call('GET', '/api/admin/staff', undefined, 'admin')).json.data;
    const me = list.find((x: any) => x.id === ids.driver);
    assert.equal(me.driversRegistered, 1);
    assert.equal(me.locationsPending, 1);
  });

  it('ofisi haiwezi kubadilisha password yake (anatumia yake mwenyewe)', async () => {
    assert.equal((await call('POST', `/api/admin/staff/${ids.driver}/reset-password`, {}, 'admin')).status, 409);
    assert.equal((await login(`0777${s}`, PASSWORD)).status, 200);
  });

  it('kusimamisha kunaondoa ruhusa ya staff TU — udereva unaendelea; kurudisha kunarudisha', async () => {
    const r = await call('POST', `/api/admin/staff/${ids.driver}/suspend`, {}, 'admin');
    assert.equal(r.status, 200, r.json?.message);
    assert.equal(r.json.data.find((x: any) => x.id === ids.driver).status, 'SUSPENDED');
    const home = await call('GET', '/api/staff/home', undefined, 'driver');
    assert.equal(home.status, 403);
    assert.match(home.json.message, /imesimamishwa/);
    // akaunti yake ya dereva haijaguswa: token ile ile, account, driver state
    const acc = await call('GET', '/api/account', undefined, 'driver');
    assert.equal(acc.status, 200);
    assert.equal(acc.json.data.staffAccess, false);
    assert.equal(acc.json.data.user.status, 'ACTIVE');
    assert.equal((await call('GET', '/api/driver/state', undefined, 'driver')).status, 200);
    assert.equal((await login(`0777${s}`, PASSWORD)).status, 200);

    assert.equal((await call('POST', `/api/admin/staff/${ids.driver}/activate`, {}, 'admin')).status, 200);
    assert.equal((await call('GET', '/api/staff/home', undefined, 'driver')).status, 200);
  });

  it('abiria wa kawaida pia anaweza kupewa ruhusa; wengine hawaguswi', async () => {
    const look = (await call('POST', '/api/admin/staff/lookup', { phone: `0778${s}` }, 'admin')).json.data;
    assert.equal(look.kind, 'PASSENGER');
    const r = await call('POST', '/api/admin/staff', { fullName: 'Abiria Wa Kawaida', phone: `0778${s}`, linkExisting: true }, 'admin');
    assert.equal(r.status, 201, r.json?.message);
    assert.equal((await call('GET', '/api/account', undefined, 'passenger')).json.data.staffAccess, true);
    // hawezi kuingia ofisini
    assert.equal((await login(`0778${s}`, PASSWORD, 'admin')).status, 403);
  });
});
