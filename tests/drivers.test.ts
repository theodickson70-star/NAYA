// Tests za app moja ya NAYA (abiria ↔ dereva) + Phase 3: chombo, nyaraka, uthibitisho wa ofisi.
// Zinaendeshwa dhidi ya database ya MAJARIBIO tu:  DATABASE_URL=... JWT_SECRET=... npm test
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';

let app: FastifyInstance;
const suffix = String(Date.now()).slice(-6);
const driverPhone = `0713${suffix}`;
const driver2Phone = `0714${suffix}`;
const adminPhone = `0689${suffix}`;
const customerPhone = `0715${suffix}`;
const PASSWORD = 'NayaTest#2026';
const plateDigits = suffix.slice(-3);
const PLATE = `MC ${plateDigits} NYA`;
const ids: string[] = [];

const JPEG = (size = 2000) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(size)]);
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(500)]);
let ipCounter = 0;
const nextIp = () => `10.3.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, token?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: nextIp(),
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

async function upload(type: string, content: Buffer, token: string, contentType = 'image/jpeg') {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/drivers/me/documents/${type}`,
    remoteAddress: nextIp(),
    headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
    payload: content,
  });
  return { status: res.statusCode, json: res.json() as any };
}

const vehicle = (plate: string) => ({
  vehicleType: 'BODABODA',
  plateNumber: plate,
  vehicleMake: 'Boxer',
  vehicleModel: 'BM 150',
  vehicleColor: 'Nyekundu',
  licenseNumber: 'dl4001234567',
});

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  const hash = await hashPassword(PASSWORD);
  const admin = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash) VALUES ($1, 'Admin Madereva', 'ADMIN', $2)
     ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`,
    [`255${adminPhone.slice(1)}`, hash],
  );
  const customer = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash) VALUES ($1, 'Abiria Tu', 'USER', $2)
     ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id`,
    [`255${customerPhone.slice(1)}`, hash],
  );
  ids.push(admin.rows[0].id, customer.rows[0].id);
});

after(async () => {
  await db.query(
    `DELETE FROM naya.document_files WHERE id IN (
       SELECT storage_key::uuid FROM naya.driver_documents WHERE driver_id = ANY($1::uuid[]))`,
    [ids],
  );
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])', [ids]);
  await db.query('UPDATE naya.drivers SET reviewed_by = NULL WHERE reviewed_by = ANY($1::uuid[])', [ids]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [ids]);
  await app.close();
  await db.end();
});

describe('NAYA Phase 3 — madereva', () => {
  let driverToken = '';
  let driver2Token = '';
  let adminToken = '';
  let customerToken = '';
  let driverId = '';

  it('akaunti mpya: role USER, bado hajachagua mode; huduma za dereva bado hazipo (404)', async () => {
    const reg = await call('POST', '/api/auth/register', { fullName: 'Juma Dereva', phone: driverPhone, password: PASSWORD });
    assert.equal(reg.status, 201);
    assert.equal(reg.json.data.user.role, 'USER');
    assert.equal(reg.json.data.user.activeMode, null);
    driverToken = reg.json.data.token;
    driverId = reg.json.data.user.id;
    ids.push(driverId);

    const acc = await call('GET', '/api/account', undefined, driverToken);
    assert.equal(acc.status, 200);
    assert.equal(acc.json.data.activeMode, null);
    assert.equal(acc.json.data.driverStatus, null);
    const early = await call('GET', '/api/drivers/me', undefined, driverToken);
    assert.equal(early.status, 404);
    assert.match(early.json.message, /mode ya Dereva/);

    const reg2 = await call('POST', '/api/auth/register', { fullName: 'Asha Dereva', phone: driver2Phone, password: PASSWORD });
    driver2Token = reg2.json.data.token;
    ids.push(reg2.json.data.user.id);
    await call('PUT', '/api/account/mode', { mode: 'DRIVER' }, driver2Token);

    const admin = await call('POST', '/api/auth/login', { phone: adminPhone, password: PASSWORD, portal: 'admin' });
    adminToken = admin.json.data.token;
    const customer = await call('POST', '/api/auth/login', { phone: customerPhone, password: PASSWORD, portal: 'app' });
    customerToken = customer.json.data.token;
  });

  it('mode isiyo sahihi inakataliwa (400)', async () => {
    assert.equal((await call('PUT', '/api/account/mode', { mode: 'ADMIN' }, driverToken)).status, 400);
  });

  it('kuchagua Dereva kunafungua ombi la udereva kwenye akaunti ile ile', async () => {
    const res = await call('PUT', '/api/account/mode', { mode: 'DRIVER' }, driverToken);
    assert.equal(res.status, 200);
    assert.equal(res.json.data.activeMode, 'DRIVER');
    assert.equal(res.json.data.driverStatus, 'INCOMPLETE');
    assert.equal(res.json.data.canDrive, false);
    assert.equal(res.json.data.user.id, driverId);
    const me = await call('GET', '/api/drivers/me', undefined, driverToken);
    assert.equal(me.json.data.driver.status, 'INCOMPLETE');
    assert.equal(me.json.data.requirements.missingDocuments.length, 4);
  });

  it('kubadili Abiria ↔ Dereva: hakuna akaunti mpya, ombi la udereva linabaki', async () => {
    const toPassenger = await call('PUT', '/api/account/mode', { mode: 'PASSENGER' }, driverToken);
    assert.equal(toPassenger.json.data.activeMode, 'PASSENGER');
    assert.equal(toPassenger.json.data.driverStatus, 'INCOMPLETE');
    const back = await call('PUT', '/api/account/mode', { mode: 'DRIVER' }, driverToken);
    assert.equal(back.json.data.activeMode, 'DRIVER');
    const users = await db.query('SELECT count(*)::int AS n FROM naya.users WHERE phone = $1', [`255${driverPhone.slice(1)}`]);
    assert.equal(users.rows[0].n, 1);
    const drivers = await db.query('SELECT count(*)::int AS n FROM naya.drivers WHERE user_id = $1', [driverId]);
    assert.equal(drivers.rows[0].n, 1);
    // Akiingia tena, anarudi kwenye mode ya mwisho
    const login = await call('POST', '/api/auth/login', { phone: driverPhone, password: PASSWORD, portal: 'app' });
    assert.equal(login.json.data.user.activeMode, 'DRIVER');
  });

  it('ofisi na app zimetengana: admin haingii kwenye app, mtumiaji haingii ofisini', async () => {
    assert.equal((await call('POST', '/api/auth/login', { phone: adminPhone, password: PASSWORD, portal: 'app' })).status, 403);
    assert.equal((await call('POST', '/api/auth/login', { phone: driverPhone, password: PASSWORD, portal: 'admin' })).status, 403);
    assert.equal((await call('GET', '/api/account', undefined, adminToken)).status, 403);
    // jina la zamani la portal ya dereva bado linafanya kazi
    assert.equal((await call('POST', '/api/auth/login', { phone: driverPhone, password: PASSWORD, portal: 'driver' })).status, 200);
  });

  it('chombo: plate mbaya inakataliwa; plate inapangwa upya kuwa "MC 123 ABC"', async () => {
    const bad = await call('PUT', '/api/drivers/me/vehicle', vehicle('ABC'), driverToken);
    assert.equal(bad.status, 400);
    assert.match(bad.json.message, /plate/);
    const good = await call('PUT', '/api/drivers/me/vehicle', vehicle(`mc-${plateDigits}-nya`), driverToken);
    assert.equal(good.status, 200);
    assert.equal(good.json.data.driver.plateNumber, PLATE);
    assert.equal(good.json.data.driver.licenseNumber, 'DL4001234567');
    assert.equal(good.json.data.requirements.vehicleComplete, true);
  });

  it('plate moja haiwezi kuwa ya madereva wawili (409)', async () => {
    const dup = await call('PUT', '/api/drivers/me/vehicle', vehicle(PLATE), driver2Token);
    assert.equal(dup.status, 409);
  });

  it('hawezi kutuma kabla ya nyaraka zote (409)', async () => {
    assert.equal((await call('POST', '/api/drivers/me/submit', {}, driverToken)).status, 409);
  });

  it('faili hatari au zisizo sahihi zinakataliwa', async () => {
    const exe = await upload('DRIVING_LICENSE', Buffer.concat([Buffer.from('MZ'), randomBytes(200)]), driverToken);
    assert.equal(exe.status, 400);
    const mismatch = await upload('DRIVING_LICENSE', PNG(), driverToken, 'image/jpeg');
    assert.equal(mismatch.status, 400);
    const text = await upload('DRIVING_LICENSE', Buffer.from('hello'), driverToken, 'text/plain');
    assert.equal(text.status, 400);
    const zip = await upload('DRIVING_LICENSE', Buffer.from('PK\x03\x04abc'), driverToken, 'application/zip');
    assert.equal(zip.status, 415);
    assert.match(zip.json.message, /JPG/);
    const huge = await upload('DRIVING_LICENSE', JPEG(3 * 1024 * 1024 + 10), driverToken);
    assert.equal(huge.status, 413);
    assert.match(huge.json.message, /MB 3/);
  });

  it('anapakia nyaraka 4; kubadilisha moja hakuachi faili la zamani', async () => {
    for (const type of ['PROFILE_PHOTO', 'DRIVING_LICENSE', 'NATIONAL_ID', 'VEHICLE_PHOTO']) {
      const res = await upload(type, JPEG(), driverToken);
      assert.equal(res.status, 200, `${type}: ${res.json.message}`);
    }
    const replaced = await upload('VEHICLE_PHOTO', PNG(), driverToken, 'image/png');
    assert.equal(replaced.status, 200);
    assert.equal(replaced.json.data.requirements.canSubmit, true);
    assert.equal(JSON.stringify(replaced.json).includes('storage'), false);

    const files = await db.query(
      `SELECT count(*)::int AS n FROM naya.document_files f
        WHERE f.id IN (SELECT storage_key::uuid FROM naya.driver_documents WHERE driver_id = $1)`,
      [driverId],
    );
    assert.equal(files.rows[0].n, 4);
  });

  it('anaona faili lake; dereva mwingine hawezi kuliona; abiria tu hana nyaraka', async () => {
    const own = await app.inject({
      method: 'GET',
      url: '/api/drivers/me/documents/VEHICLE_PHOTO/file',
      headers: { authorization: `Bearer ${driverToken}` },
    });
    assert.equal(own.statusCode, 200);
    assert.equal(own.headers['content-type'], 'image/png');
    const other = await call('GET', '/api/drivers/me/documents/VEHICLE_PHOTO/file', undefined, driver2Token);
    assert.equal(other.status, 404);
    assert.equal((await call('GET', '/api/drivers/me/documents/VEHICLE_PHOTO/file', undefined, customerToken)).status, 404);
    assert.equal((await upload('PROFILE_PHOTO', JPEG(), customerToken)).status, 404);
  });

  it('anatuma → PENDING; wakati wa ukaguzi hawezi kubadilisha', async () => {
    const sub = await call('POST', '/api/drivers/me/submit', {}, driverToken);
    assert.equal(sub.status, 200);
    assert.equal(sub.json.data.driver.status, 'PENDING');
    assert.equal((await upload('PROFILE_PHOTO', JPEG(), driverToken)).status, 403);
  });

  it('ofisi tu: mteja na dereva hawawezi kuona orodha ya madereva', async () => {
    assert.equal((await call('GET', '/api/admin/drivers', undefined, customerToken)).status, 403);
    assert.equal((await call('GET', '/api/admin/drivers', undefined, driverToken)).status, 403);
    assert.equal((await call('POST', `/api/admin/drivers/${driverId}/approve`, {}, driverToken)).status, 403);
    const list = await call('GET', '/api/admin/drivers?status=PENDING', undefined, adminToken);
    assert.equal(list.status, 200);
    assert.ok(list.json.data.drivers.some((d: any) => d.id === driverId));
    assert.ok(list.json.data.counts.PENDING >= 1);
    const search = await call('GET', `/api/admin/drivers?q=${encodeURIComponent(PLATE)}`, undefined, adminToken);
    assert.equal(search.json.data.drivers[0].id, driverId);
  });

  it('ofisi inaona nyaraka na maelezo ya dereva', async () => {
    const detail = await call('GET', `/api/admin/drivers/${driverId}`, undefined, adminToken);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.data.documents.length, 4);
    assert.equal(JSON.stringify(detail.json).includes('password'), false);
    const file = await app.inject({
      method: 'GET',
      url: `/api/admin/drivers/${driverId}/documents/DRIVING_LICENSE/file`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers['content-type'], 'image/jpeg');
  });

  it('kukataa: sababu ni lazima; dereva anaona sababu na nyaraka ya kubadilisha', async () => {
    assert.equal((await call('POST', `/api/admin/drivers/${driverId}/reject`, { reason: '' }, adminToken)).status, 400);
    const rej = await call(
      'POST',
      `/api/admin/drivers/${driverId}/reject`,
      { reason: 'Picha ya leseni haisomeki', documents: ['DRIVING_LICENSE'] },
      adminToken,
    );
    assert.equal(rej.status, 200);
    assert.equal(rej.json.data.driver.status, 'REJECTED');

    const me = await call('GET', '/api/drivers/me', undefined, driverToken);
    assert.equal(me.json.data.driver.rejectionReason, 'Picha ya leseni haisomeki');
    assert.deepEqual(me.json.data.requirements.rejectedDocuments, ['DRIVING_LICENSE']);
    assert.equal(me.json.data.requirements.canSubmit, false);
    // hawezi kuthibitishwa akiwa REJECTED
    assert.equal((await call('POST', `/api/admin/drivers/${driverId}/approve`, {}, adminToken)).status, 409);
  });

  it('anarekebisha, anatuma tena, ofisi inamthibitisha; kila hatua imeandikwa', async () => {
    assert.equal((await upload('DRIVING_LICENSE', JPEG(), driverToken)).status, 200);
    assert.equal((await call('POST', '/api/drivers/me/submit', {}, driverToken)).json.data.driver.status, 'PENDING');
    const ok = await call('POST', `/api/admin/drivers/${driverId}/approve`, {}, adminToken);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.data.driver.status, 'APPROVED');
    assert.ok(ok.json.data.documents.every((d: any) => d.status === 'APPROVED'));
    const acc = await call('GET', '/api/account', undefined, driverToken);
    assert.equal(acc.json.data.canDrive, true);
    const actions = ok.json.data.history.map((h: any) => h.action);
    assert.deepEqual(actions.slice(0, 4), ['driver.approved', 'driver.submitted', 'driver.rejected', 'driver.submitted']);
    // akithibitishwa hawezi kubadilisha nyaraka mwenyewe
    assert.equal((await upload('PROFILE_PHOTO', JPEG(), driverToken)).status, 403);
  });

  it('kusimamisha na kurudisha dereva', async () => {
    const sus = await call('POST', `/api/admin/drivers/${driverId}/suspend`, { reason: 'Malalamiko ya wateja' }, adminToken);
    assert.equal(sus.json.data.driver.status, 'SUSPENDED');
    const back = await call('POST', `/api/admin/drivers/${driverId}/reinstate`, {}, adminToken);
    assert.equal(back.json.data.driver.status, 'APPROVED');
  });

  it('dashboard ya ofisi inaonyesha hali za madereva', async () => {
    const dash = await call('GET', '/api/admin/dashboard', undefined, adminToken);
    assert.ok(dash.json.data.drivers.APPROVED >= 1);
    assert.ok(dash.json.data.drivers.INCOMPLETE >= 1);
  });

  it('id isiyo sahihi inarudisha 400/404, si 500', async () => {
    assert.equal((await call('GET', '/api/admin/drivers/si-id', undefined, adminToken)).status, 400);
    const missing = await call('GET', '/api/admin/drivers/00000000-0000-4000-8000-000000000000', undefined, adminToken);
    assert.equal(missing.status, 404);
  });
});
