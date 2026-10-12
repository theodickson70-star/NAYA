// Tests za Phase 9: SMS (Beem) — kuthibitisha namba ya simu, "umesahau password?", na SMS za taarifa muhimu.
// SMS halisi hazitumwi: tunanasa ujumbe kwa setSmsSenderForTests.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { setSmsSenderForTests, toGsm } from '../src/services/sms.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6);
const PASSWORD = 'NayaTest#2026';
const phones: string[] = [];
const sent: Array<{ phone: string; message: string }> = [];
let ip = 0;

async function call(method: 'GET' | 'POST', url: string, body?: unknown, token?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.9.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

const local = (p: string) => `0${p.slice(3)}`;
const codeFrom = (message: string) => message.match(/\b(\d{6})\b/)?.[1] ?? '';
async function waitForSms(phone: string, count: number) {
  for (let i = 0; i < 50; i++) {
    const mine = sent.filter((m) => m.phone === phone);
    if (mine.length >= count) return mine[count - 1];
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`SMS haikufika kwa ${phone}`);
}
/** Ruka sekunde 60 za kusubiri kati ya SMS (tests tu). */
const skipCooldown = (phone: string) => db.query(`UPDATE naya.otp_codes SET created_at = created_at - interval '2 minutes' WHERE phone = $1`, [phone]);

async function register(phone: string, name: string) {
  phones.push(`255${phone.slice(1)}`);
  const res = await call('POST', '/api/auth/register', { fullName: name, phone, password: PASSWORD, acceptTerms: true });
  assert.equal(res.status, 201, res.json.message);
  return res.json.data.token as string;
}

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
});

after(async () => {
  setSmsSenderForTests(null);
  await db.query('DELETE FROM naya.otp_codes WHERE phone = ANY($1)', [phones]);
  await db.query('DELETE FROM naya.sms_log WHERE phone = ANY($1)', [phones]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id IN (SELECT id FROM naya.users WHERE phone = ANY($1)) OR target_id IN (SELECT id FROM naya.users WHERE phone = ANY($1))', [phones]);
  await db.query('UPDATE naya.drivers SET reviewed_by = NULL WHERE reviewed_by IN (SELECT id FROM naya.users WHERE phone = ANY($1))', [phones]);
  await db.query('DELETE FROM naya.users WHERE phone = ANY($1)', [phones]);
  await app.close();
  await db.end();
});

describe('NAYA Phase 9 — SMS zimezimwa (hakuna funguo za Beem)', () => {
  it('mtumiaji mpya haombwi kuthibitisha; "umesahau password" inasema wasiliana na ofisi', async () => {
    setSmsSenderForTests(null);
    const token = await register(`0750${s}`, 'Bila Sms');
    const account = (await call('GET', '/api/account', undefined, token)).json.data;
    assert.equal(account.verificationRequired, false);
    assert.equal(account.smsEnabled, false);
    const forgot = await call('POST', '/api/auth/password/forgot', { phone: `0750${s}` });
    assert.equal(forgot.status, 503);
    assert.match(forgot.json.message, /ofisi/);
  });
});

describe('NAYA Phase 9 — SMS zimewashwa', () => {
  let token = '';
  const phone = `0751${s}`;
  const full = `255751${s}`;

  before(() => {
    setSmsSenderForTests(async (to, message) => {
      sent.push({ phone: to, message });
      return { ok: true, requestId: 'test' };
    });
  });

  it('kujisajili kunatuma SMS yenye code ya tarakimu 6; akaunti inahitaji kuthibitishwa', async () => {
    token = await register(phone, 'Neema Sms');
    const sms = await waitForSms(full, 1);
    assert.match(codeFrom(sms.message), /^\d{6}$/);
    assert.match(sms.message, /^NAYA:/);
    const account = (await call('GET', '/api/account', undefined, token)).json.data;
    assert.equal(account.verificationRequired, true);
    assert.equal(account.phoneVerified, false);
  });

  it('bila kuthibitisha: hawezi kuagiza safari (403)', async () => {
    const res = await call('POST', '/api/rides', { pickup: { lat: -5.07, lng: 32.05 }, destination: { locationId: '00000000-0000-0000-0000-000000000000' }, vehicleType: 'BODABODA' }, token);
    assert.equal(res.status, 403);
    assert.match(res.json.message, /Thibitisha namba/);
  });

  it('kuomba code tena mara moja → subiri (429)', async () => {
    const res = await call('POST', '/api/auth/phone/send-code', {}, token);
    assert.equal(res.status, 429);
    assert.match(res.json.message, /Subiri sekunde/);
  });

  it('code mbaya → majaribio yanapungua; code sahihi → namba imethibitishwa', async () => {
    const code = codeFrom((await waitForSms(full, 1)).message);
    const wrong = code === '000000' ? '111111' : '000000';
    const bad = await call('POST', '/api/auth/phone/verify', { code: wrong }, token);
    assert.equal(bad.status, 400);
    assert.match(bad.json.message, /majaribio 4/);
    assert.equal((await call('POST', '/api/auth/phone/verify', { code: '12ab' }, token)).status, 400);
    const good = await call('POST', '/api/auth/phone/verify', { code }, token);
    assert.equal(good.status, 200, good.json.message);
    const account = (await call('GET', '/api/account', undefined, token)).json.data;
    assert.equal(account.verificationRequired, false);
    assert.equal(account.phoneVerified, true);
    assert.equal((await call('POST', '/api/auth/phone/send-code', {}, token)).status, 409);
  });

  it('code inafungwa baada ya majaribio 5 mabaya', async () => {
    const other = `0752${s}`;
    const t2 = await register(other, 'Juma Sms');
    const code = codeFrom((await waitForSms(`255752${s}`, 1)).message);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await call('POST', '/api/auth/phone/verify', { code: wrong }, t2);
    assert.equal((await call('POST', '/api/auth/phone/verify', { code }, t2)).status, 400);
    await skipCooldown(`255752${s}`);
    const again = await call('POST', '/api/auth/phone/send-code', {}, t2);
    assert.equal(again.status, 200, again.json.message);
    const fresh = codeFrom((await waitForSms(`255752${s}`, 2)).message);
    assert.equal((await call('POST', '/api/auth/phone/verify', { code: fresh }, t2)).status, 200);
  });

  it('umesahau password: jibu ni lile lile kwa namba isiyosajiliwa (na hakuna SMS inayotumwa)', async () => {
    const before = sent.length;
    const unknown = await call('POST', '/api/auth/password/forgot', { phone: `0759${s}` });
    phones.push(`255759${s}`);
    const known = await call('POST', '/api/auth/password/forgot', { phone });
    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.deepEqual(Object.keys(unknown.json.data), Object.keys(known.json.data));
    const sms = await waitForSms(full, 2);
    assert.match(sms.message, /password/);
    assert.equal(sent.slice(before).filter((m) => m.phone === `255759${s}`).length, 0);
  });

  it('kubadilisha password kwa code: vifaa vya zamani vinatolewa, password mpya inafanya kazi, code haitumiki mara mbili', async () => {
    const code = codeFrom((await waitForSms(full, 2)).message);
    const wrong = code === '000000' ? '111111' : '000000';
    assert.equal((await call('POST', '/api/auth/password/reset', { phone, code: wrong, password: 'MpyaKabisa#2026' })).status, 400);
    assert.equal((await call('POST', '/api/auth/password/reset', { phone, code, password: 'fupi' })).status, 400);
    const res = await call('POST', '/api/auth/password/reset', { phone, code, password: 'MpyaKabisa#2026' });
    assert.equal(res.status, 200, res.json.message);
    assert.equal((await call('GET', '/api/auth/me', undefined, token)).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: 'app' })).status, 401);
    assert.equal((await call('POST', '/api/auth/login', { phone, password: 'MpyaKabisa#2026', portal: 'app' })).status, 200);
    assert.equal((await call('POST', '/api/auth/password/reset', { phone, code, password: 'Nyingine#2026' })).status, 400);
  });

  it('kumbukumbu ya SMS haina code (aina na matokeo tu)', async () => {
    const rows = (await db.query('SELECT * FROM naya.sms_log WHERE phone = $1', [full])).rows;
    assert.ok(rows.length >= 2);
    assert.ok(rows.every((r) => r.status === 'SENT' && r.kind.startsWith('otp_')));
    assert.equal(Object.keys(rows[0]).includes('message'), false);
    const otp = (await db.query('SELECT code_hash FROM naya.otp_codes WHERE phone = $1', [full])).rows;
    assert.ok(otp.every((r) => Buffer.isBuffer(r.code_hash) && r.code_hash.length === 32));
  });

  it('dereva akithibitishwa anapata SMS (taarifa muhimu)', async () => {
    const adminPhone = `0693${s}`;
    phones.push(`255693${s}`);
    await db.query(`INSERT INTO naya.users (phone, full_name, role, password_hash) VALUES ($1, 'Admin Sms', 'ADMIN', $2)`, [
      `255693${s}`,
      await hashPassword(PASSWORD),
    ]);
    const adminToken = (await call('POST', '/api/auth/login', { phone: adminPhone, password: PASSWORD, portal: 'admin' })).json.data.token;
    const driverPhone = `0753${s}`;
    const dt = await register(driverPhone, 'Dereva Sms');
    const id = (await call('GET', '/api/account', undefined, dt)).json.data.user.id;
    await db.query(`INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number) VALUES ($1, 'PENDING', 'BODABODA', $2)`, [id, `MC ${s.slice(-3)} SMS`]);
    assert.equal((await call('POST', `/api/admin/drivers/${id}/approve`, {}, adminToken)).status, 200);
    const sms = await waitForSms(`255753${s}`, 2);
    assert.match(sms.message, /Umethibitishwa kuwa dereva/);

    const overview = await call('GET', '/api/admin/sms', undefined, adminToken);
    assert.equal(overview.status, 200);
    assert.equal(overview.json.data.enabled, true);
    assert.ok(overview.json.data.sentToday >= 4);
    assert.equal(JSON.stringify(overview.json.data.recent).includes('code'), false);
    assert.equal((await call('GET', '/api/admin/sms', undefined, dt)).status, 403);
  });

  it('Beem ikishindwa: inaandikwa FAILED, na mtumiaji anaambiwa ajaribu tena (503)', async () => {
    setSmsSenderForTests(async () => ({ ok: false, error: 'Beem 401 (code 120): Invalid Authentication Parameters' }));
    const t = await register(`0754${s}`, 'Sms Imeshindwa');
    // subiri SMS ya usajili (inatumwa nyuma ya pazia) iandikwe, kisha ruka muda wa kusubiri
    for (let i = 0; i < 50; i++) {
      const n = (await db.query('SELECT count(*)::int AS n FROM naya.sms_log WHERE phone = $1', [`255754${s}`])).rows[0].n;
      if (n > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await skipCooldown(`255754${s}`);
    const res = await call('POST', '/api/auth/phone/send-code', {}, t);
    assert.equal(res.status, 503);
    const failed = (await db.query(`SELECT count(*)::int AS n FROM naya.sms_log WHERE phone = $1 AND status = 'FAILED'`, [`255754${s}`])).rows[0].n;
    assert.ok(failed >= 1);
  });

  it('herufi zisizo za GSM zinabadilishwa (SMS isiwe ghali)', () => {
    assert.equal(toGsm('Lipa TSh 5,000 — sasa · asante'), 'Lipa TSh 5,000 - sasa - asante');
  });
});
