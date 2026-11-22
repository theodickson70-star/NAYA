// NAYA Staff (0.19.0): akaunti zinazotengenezwa na ofisi, zinaingia kwenye app, zinasajili bodaboda na kupendekeza maeneo.
// Database ya MAJARIBIO tu.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
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
const JPEG = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(1500)]);

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string, raw?: { buf: Buffer; type: string }) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.71.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...(raw ? { 'content-type': raw.type } : {}) },
    ...(raw ? { payload: raw.buf } : body !== undefined ? { payload: body as object } : {}),
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

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash) VALUES ($1, 'Ofisi Staff Test', 'ADMIN', $2) RETURNING id`,
    [`255786${s}`, await hashPassword(PASSWORD)],
  );
  ids.admin = row.rows[0].id;
  userIds.push(ids.admin);
  tokens.admin = (await login(`0786${s}`, PASSWORD, 'admin')).json.data.token;
});

after(async () => {
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[]) OR created_by = ANY($2::uuid[])', [locationIds, userIds]);
  await db.query('UPDATE naya.drivers SET registered_by = NULL, reviewed_by = NULL WHERE user_id = ANY($1::uuid[]) OR registered_by = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])', [userIds]);
  await db.query('UPDATE naya.users SET created_by = NULL WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await app.close();
  await db.end();
});

describe('NAYA Staff — akaunti', () => {
  it('ofisi inatengeneza staff: password ya muda inaonyeshwa mara moja; si ofisi → 403', async () => {
    const r = await call('POST', '/api/admin/staff', { fullName: 'Juma Staff', phone: `0787${s}` }, 'admin');
    assert.equal(r.status, 201, r.json?.message);
    assert.match(r.json.data.tempPassword, /^[A-Za-z0-9]{10}$/);
    ids.staff = r.json.data.id;
    userIds.push(ids.staff);
    tokens.staffTemp = r.json.data.tempPassword;
    assert.equal((await call('POST', '/api/admin/staff', { fullName: 'Juma Staff', phone: `0787${s}` }, 'admin')).status, 409);
    const list = (await call('GET', '/api/admin/staff', undefined, 'admin')).json.data;
    assert.ok(list.some((x: any) => x.id === ids.staff && x.mustChangePassword === true));
    assert.ok(!JSON.stringify(list).includes('password_hash'));
  });

  it('staff anaingia kwenye APP (si ofisi); lazima abadilishe password ya muda kabla ya kazi', async () => {
    assert.equal((await login(`0787${s}`, tokens.staffTemp, 'admin')).status, 403);
    const l = await login(`0787${s}`, tokens.staffTemp);
    assert.equal(l.status, 200);
    assert.equal(l.json.data.user.role, 'STAFF');
    tokens.staff = l.json.data.token;
    const acc = (await call('GET', '/api/account', undefined, 'staff')).json.data;
    assert.equal(acc.staff, true);
    assert.equal(acc.mustChangePassword, true);
    assert.equal((await call('GET', '/api/staff/home', undefined, 'staff')).status, 403);
    const ch = await call('POST', '/api/account/password', { currentPassword: tokens.staffTemp, newPassword: PASSWORD }, 'staff');
    assert.equal(ch.status, 200, ch.json?.message);
    tokens.staff = ch.json.data.token;
    assert.equal((await call('GET', '/api/account', undefined, 'staff')).json.data.mustChangePassword, false);
    assert.equal((await call('GET', '/api/staff/home', undefined, 'staff')).status, 200);
  });

  it('staff hawezi kufika ofisi, safari wala malipo', async () => {
    for (const url of ['/api/admin/dashboard', '/api/admin/staff', '/api/admin/payments/wallet', '/api/rides/current', '/api/driver/state', '/api/payments/config']) {
      assert.equal((await call('GET', url, undefined, 'staff')).status, 403, url);
    }
    assert.equal((await call('POST', '/api/admin/locations/00000000-0000-4000-8000-000000000000/review', { approve: true }, 'staff')).status, 403);
  });
});

describe('NAYA Staff — kusajili bodaboda', () => {
  const plate = `MC ${s.slice(-3)} STF`;
  it('anasajili dereva mpya: akaunti + chombo; namba/plate iliyopo → 409', async () => {
    const body = { fullName: 'Dereva Wa Staff', phone: `0788${s}`, vehicleType: 'BODABODA', plateNumber: plate, vehicleMake: 'Boxer', vehicleColor: 'Nyekundu', licenseNumber: 'DL998877' };
    const r = await call('POST', '/api/staff/drivers', body, 'staff');
    assert.equal(r.status, 201, r.json?.message);
    ids.driver = r.json.data.id;
    userIds.push(ids.driver);
    tokens.driverTemp = r.json.data.tempPassword;
    assert.equal((await call('POST', '/api/staff/drivers', body, 'staff')).status, 409);
    assert.equal((await call('POST', '/api/staff/drivers', { ...body, phone: `0789${s}` }, 'staff')).status, 409); // plate
    assert.equal((await call('POST', '/api/staff/drivers', { ...body, phone: `0786${s}` }, 'staff')).status, 409); // namba ya ofisi
  });

  it('bila nyaraka hawezi kutuma; akipiga picha zote → inasubiri uthibitisho wa ofisi', async () => {
    assert.equal((await call('POST', `/api/staff/drivers/${ids.driver}/submit`, {}, 'staff')).status, 409);
    for (const t of ['PROFILE_PHOTO', 'DRIVING_LICENSE', 'NATIONAL_ID', 'VEHICLE_PHOTO']) {
      const up = await call('PUT', `/api/staff/drivers/${ids.driver}/documents/${t}`, undefined, 'staff', { buf: JPEG(), type: 'image/jpeg' });
      assert.equal(up.status, 200, `${t}: ${up.json?.message}`);
    }
    const sub = await call('POST', `/api/staff/drivers/${ids.driver}/submit`, {}, 'staff');
    assert.equal(sub.status, 200, sub.json?.message);
    assert.equal(sub.json.data.driver.status, 'PENDING');
    const mine = (await call('GET', '/api/staff/drivers', undefined, 'staff')).json.data;
    assert.ok(mine.some((d: any) => d.id === ids.driver && d.status === 'PENDING' && d.docsUploaded === 4));
    assert.equal((await call('GET', '/api/staff/home', undefined, 'staff')).json.data.counts.driversPending, 1);
  });

  it('staff mwingine haoni wala kubadilisha dereva huyu', async () => {
    const r = await call('POST', '/api/admin/staff', { fullName: 'Neema Staff', phone: `0785${s}` }, 'admin');
    ids.staff2 = r.json.data.id;
    userIds.push(ids.staff2);
    const t = (await login(`0785${s}`, r.json.data.tempPassword)).json.data.token;
    tokens.staff2 = (await app.inject({ method: 'POST', url: '/api/account/password', headers: { authorization: `Bearer ${t}` }, payload: { currentPassword: r.json.data.tempPassword, newPassword: PASSWORD } })).json().data.token;
    assert.equal((await call('GET', `/api/staff/drivers/${ids.driver}`, undefined, 'staff2')).status, 404);
    assert.equal((await call('PUT', `/api/staff/drivers/${ids.driver}/documents/NATIONAL_ID`, undefined, 'staff2', { buf: JPEG(), type: 'image/jpeg' })).status, 404);
  });

  it('ofisi inaona "amesajiliwa na Juma Staff" na ndiyo inathibitisha; dereva anaingia na kubadilisha password', async () => {
    const detail = (await call('GET', `/api/admin/drivers/${ids.driver}`, undefined, 'admin')).json.data;
    assert.equal(detail.registeredBy.name, 'Juma Staff');
    const list = (await call('GET', `/api/admin/drivers?status=PENDING&q=${encodeURIComponent(plate)}`, undefined, 'admin')).json.data;
    assert.equal(list.drivers[0].registeredBy, 'Juma Staff');
    assert.equal((await call('POST', `/api/admin/drivers/${ids.driver}/approve`, {}, 'admin')).status, 200);
    const l = await login(`0788${s}`, tokens.driverTemp);
    assert.equal(l.status, 200);
    tokens.driver = l.json.data.token;
    const acc = (await call('GET', '/api/account', undefined, 'driver')).json.data;
    assert.equal(acc.user.mustChangePassword, true);
    assert.equal(acc.activeMode, 'DRIVER');
    assert.equal(acc.driverStatus, 'APPROVED');
    const ch = await call('POST', '/api/account/password', { currentPassword: tokens.driverTemp, newPassword: PASSWORD }, 'driver');
    assert.equal(ch.status, 200);
    tokens.driver = ch.json.data.token;
    assert.equal((await call('GET', '/api/staff/drivers', undefined, 'staff')).json.data.find((d: any) => d.id === ids.driver).driverLoggedIn, true);
  });
});

describe('NAYA Staff — maeneo', () => {
  it('eneo la staff linasubiri ofisi (wateja hawalioni); ofisi ikiidhinisha → linaonekana', async () => {
    const r = await call('POST', '/api/staff/locations', { name: `Stendi Staff ${s}`, category: 'STAND', lat: -5.0712, lng: 32.0491 }, 'staff');
    assert.equal(r.status, 201, r.json?.message);
    assert.equal(r.json.data.reviewStatus, 'PENDING');
    locationIds.push(r.json.data.id);
    assert.equal((await call('POST', '/api/staff/locations', { name: `Stendi Staff ${s}`, category: 'STAND', lat: -5.0712, lng: 32.0491 }, 'staff')).status, 409);
    const pub = (await call('GET', `/api/locations?q=${encodeURIComponent(`Stendi Staff ${s}`)}`, undefined, 'driver')).json.data;
    assert.equal(pub.length, 0);
    const adminList = (await call('GET', `/api/admin/locations?q=${encodeURIComponent(`Stendi Staff ${s}`)}`, undefined, 'admin')).json.data;
    assert.equal(adminList.length, 0, 'halichanganyiki na maeneo ya kawaida');
    const pending = (await call('GET', '/api/admin/locations/pending', undefined, 'admin')).json.data;
    const p = pending.find((x: any) => x.id === r.json.data.id);
    assert.equal(p.proposedBy, 'Juma Staff');
    assert.equal((await call('POST', `/api/admin/locations/${r.json.data.id}/review`, { approve: true }, 'admin')).status, 200);
    assert.equal((await call('POST', `/api/admin/locations/${r.json.data.id}/review`, { approve: true }, 'admin')).status, 409);
    const after = (await call('GET', `/api/locations?q=${encodeURIComponent(`Stendi Staff ${s}`)}`, undefined, 'driver')).json.data;
    assert.equal(after.length, 1);
  });

  it('ofisi ikikataa → staff anaona sababu', async () => {
    const r = await call('POST', '/api/staff/locations', { name: `Soko Staff ${s}`, category: 'MARKET', lat: -5.08, lng: 32.06 }, 'staff');
    locationIds.push(r.json.data.id);
    await call('POST', `/api/admin/locations/${r.json.data.id}/review`, { approve: false, note: 'Liko nje ya Urambo' }, 'admin');
    const mine = (await call('GET', '/api/staff/locations', undefined, 'staff')).json.data.find((x: any) => x.id === r.json.data.id);
    assert.equal(mine.reviewStatus, 'REJECTED');
    assert.equal(mine.reviewNote, 'Liko nje ya Urambo');
  });
});

describe('NAYA Staff — kusimamishwa', () => {
  it('ofisi ikimsimamisha: anatolewa papo hapo na hawezi kuingia; akirudishwa anaingia tena', async () => {
    assert.equal((await call('POST', `/api/admin/staff/${ids.staff}/suspend`, {}, 'admin')).status, 200);
    assert.notEqual((await call('GET', '/api/staff/home', undefined, 'staff')).status, 200);
    assert.equal((await login(`0787${s}`, PASSWORD)).status, 403);
    await call('POST', `/api/admin/staff/${ids.staff}/activate`, {}, 'admin');
    assert.equal((await login(`0787${s}`, PASSWORD)).status, 200);
    const reset = await call('POST', `/api/admin/staff/${ids.staff}/reset-password`, {}, 'admin');
    assert.equal((await login(`0787${s}`, reset.json.data.tempPassword)).json.data.user.mustChangePassword, true);
  });
});
