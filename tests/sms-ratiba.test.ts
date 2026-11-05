// 0.29.0: kujiondoa kwenye SMS za matangazo (app + ofisi), hakiki inayoonyesha waliojiondoa na gharama (TSh),
// SMS zilizopangwa (kuunda, kutumwa muda ukifika, kujirudia, kusimamisha/kuendelea/kughairi), na SMS za moja kwa moja
// (karibu, bila kurudia, kikomo cha siku, waliojiondoa). SMS halisi hazitumwi (setSmsSenderForTests). DB ya majaribio tu.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { setSmsSenderForTests } from '../src/services/sms.js';
import { nextRun, runDueSchedules } from '../src/services/sms-center.js';
import { runAutoSms } from '../src/services/sms-auto.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6).replace(/^0/, '1');
const PASSWORD = 'NayaTest#2026';
const startedAt = new Date();
const userIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const sent: Array<{ phone: string; message: string }> = [];
let savedAuto: unknown = undefined;
let savedCenter: unknown = undefined;
let ip = 0;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.81.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}
const intl = (local: string) => `255${local.slice(1)}`;
const phoneOf = (key: string) => sentPhones[key];
const sentPhones: Record<string, string> = {};

async function makeUser(key: string, phone: string, name: string, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode, phone_verified_at) VALUES ($1, $2, $3, $4, 'PASSENGER', now()) RETURNING id`,
    [intl(phone), name, role, await hashPassword(PASSWORD)],
  );
  ids[key] = row.rows[0].id;
  sentPhones[key] = intl(phone);
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: role === 'USER' ? 'app' : 'admin' })).json.data.token;
}
async function waitDone(id: string) {
  for (let i = 0; i < 100; i++) {
    const c = (await db.query('SELECT * FROM naya.sms_campaigns WHERE id = $1', [id])).rows[0];
    if (c.status !== 'SENDING') return c;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('kutuma hakukuisha');
}
const ourNumbers = () => ['p1', 'p2', 'p3'].map((k) => `0${phoneOf(k).slice(3)}`).join('\n');

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  setSmsSenderForTests(async (phone, message) => {
    sent.push({ phone, message });
    return { ok: true, requestId: 'test' };
  });
  savedAuto = (await db.query(`SELECT value FROM naya.settings WHERE key = 'sms_auto'`)).rows[0]?.value;
  savedCenter = (await db.query(`SELECT value FROM naya.settings WHERE key = 'sms_center'`)).rows[0]?.value;
  await makeUser('admin', `0780${s}`, 'Ofisi Sms Ratiba', 'ADMIN');
  await makeUser('p1', `0781${s}`, `Mwanaidi Rajabu ${s}`);
  await makeUser('p2', `0782${s}`, `Hamisi Saidi ${s}`);
  await makeUser('p3', `0783${s}`, `Rehema Omari ${s}`);
});

after(async () => {
  setSmsSenderForTests(null);
  const restore = async (key: string, value: unknown) =>
    value === undefined
      ? db.query('DELETE FROM naya.settings WHERE key = $1', [key])
      : db.query('UPDATE naya.settings SET value = $2 WHERE key = $1', [key, JSON.stringify(value)]);
  await restore('sms_auto', savedAuto);
  await restore('sms_center', savedCenter);
  await db.query('DELETE FROM naya.sms_auto_log WHERE sent_at >= $1', [startedAt]);
  await db.query('DELETE FROM naya.sms_log WHERE phone IN (SELECT phone FROM naya.users WHERE id = ANY($1::uuid[]))', [userIds]);
  await db.query('DELETE FROM naya.sms_log WHERE campaign_id IN (SELECT id FROM naya.sms_campaigns WHERE created_by = ANY($1::uuid[]))', [userIds]);
  await db.query('DELETE FROM naya.sms_campaigns WHERE created_by = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.sms_schedules WHERE created_by = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await app.close();
  await db.end();
});

describe('NAYA 0.29.0 — kujiondoa, ratiba, SMS za moja kwa moja', () => {
  it('mteja anajiondoa mwenyewe kwenye app, na kurudi', async () => {
    let r = await call('GET', '/api/account', undefined, 'p1');
    assert.equal(r.json.data.smsMarketing, true);
    r = await call('PUT', '/api/account/sms-marketing', { receive: false }, 'p1');
    assert.equal(r.status, 200);
    assert.equal(r.json.data.smsMarketing, false);
    const row = (await db.query('SELECT sms_opt_out_at FROM naya.users WHERE id = $1', [ids.p1])).rows[0];
    assert.ok(row.sms_opt_out_at);
    r = await call('PUT', '/api/account/sms-marketing', { receive: 'hapana' }, 'p1');
    assert.equal(r.status, 400);
  });

  it('ofisi inamwondoa mtu; mteja hawezi kutumia njia ya ofisi', async () => {
    let r = await call('POST', `/api/admin/users/${ids.p2}/sms-marketing`, { receive: false }, 'admin');
    assert.equal(r.status, 200);
    assert.ok(r.json.data.user.smsOptOutAt);
    r = await call('POST', `/api/admin/users/${ids.p2}/sms-marketing`, { receive: true }, 'admin');
    assert.equal(r.json.data.user.smsOptOutAt, null);
    r = await call('POST', `/api/admin/users/${ids.p2}/sms-marketing`, { receive: false }, 'p1');
    assert.equal(r.status, 403);
    const audit = await db.query(`SELECT action FROM naya.audit_logs WHERE actor_id = $1 AND target_id = $2 ORDER BY created_at`, [ids.admin, ids.p2]);
    assert.deepEqual(audit.rows.map((a) => a.action), ['user.sms_marketing_off', 'user.sms_marketing_on']);
  });

  it('hakiki: waliojiondoa wanarukwa (isipokuwa ujumbe muhimu) na gharama kwa TSh', async () => {
    let r = await call('PUT', '/api/admin/sms-center/settings', { pricePerSms: 25 }, 'admin');
    assert.equal(r.status, 200);
    assert.equal(r.json.data.pricePerSms, 25);
    assert.equal((await call('PUT', '/api/admin/sms-center/settings', { pricePerSms: 5000 }, 'admin')).status, 400);
    const msg = 'Habari {jina}, NAYA ina ofa mpya wiki hii.';
    r = await call('POST', '/api/admin/sms-center/preview', { audience: 'NUMBERS', numbers: ourNumbers(), message: msg }, 'admin');
    assert.equal(r.status, 200);
    assert.equal(r.json.data.count, 2); // p1 amejiondoa
    assert.equal(r.json.data.skippedOptOut, 1);
    assert.equal(r.json.data.cost, r.json.data.units * 25);
    r = await call('POST', '/api/admin/sms-center/preview', { audience: 'NUMBERS', numbers: ourNumbers(), message: msg, important: true }, 'admin');
    assert.equal(r.json.data.count, 3);
    assert.equal(r.json.data.skippedOptOut, 0);
  });

  it('kutuma sasa: aliyejiondoa hapati; historia ina gharama na idadi iliyorukwa', async () => {
    sent.length = 0;
    const r = await call(
      'POST',
      '/api/admin/sms-center/send',
      { audience: 'NUMBERS', numbers: ourNumbers(), message: 'Habari {jina}, karibu tena NAYA.', expectedCount: 2 },
      'admin',
    );
    assert.equal(r.status, 201);
    assert.equal(r.json.data.skippedOptOut, 1);
    await waitDone(r.json.data.id);
    assert.equal(sent.length, 2);
    assert.ok(!sent.some((m) => m.phone === phoneOf('p1')));
    const o = await call('GET', '/api/admin/sms-center', undefined, 'admin');
    const c = o.json.data.campaigns.find((x: any) => x.id === r.json.data.id);
    assert.equal(c.skippedOptOut, 1);
    assert.equal(c.cost, c.units * 25);
    assert.ok(o.json.data.optedOut >= 1);
    assert.ok(o.json.data.auto.rules.length === 3);
  });

  it('ratiba: inakataa muda uliopita, inatumwa muda ukifika, na inajirudia', async () => {
    let r = await call(
      'POST',
      '/api/admin/sms-center/schedules',
      { audience: 'NUMBERS', numbers: ourNumbers(), message: 'Kumbusho {jina}', runAt: new Date(Date.now() - 60_000).toISOString(), repeat: 'NONE' },
      'admin',
    );
    assert.equal(r.status, 400);
    r = await call(
      'POST',
      '/api/admin/sms-center/schedules',
      { audience: 'NUMBERS', numbers: ourNumbers(), message: 'Kumbusho la wiki {jina}', runAt: new Date(Date.now() + 3_600_000).toISOString(), repeat: 'WEEKLY' },
      'admin',
    );
    assert.equal(r.status, 201);
    const sched = r.json.data.find((x: any) => x.message === 'Kumbusho la wiki {jina}');
    assert.equal(sched.status, 'ACTIVE');
    assert.equal(sched.numberCount, 3);

    // Haijafika muda: haitumwi
    sent.length = 0;
    await runDueSchedules();
    assert.equal((await db.query('SELECT runs FROM naya.sms_schedules WHERE id = $1', [sched.id])).rows[0].runs, 0);

    // Muda umefika
    const due = new Date(Date.now() - 1000);
    await db.query('UPDATE naya.sms_schedules SET run_at = $2 WHERE id = $1', [sched.id, due]);
    assert.ok((await runDueSchedules()) >= 1);
    const row = (await db.query('SELECT * FROM naya.sms_schedules WHERE id = $1', [sched.id])).rows[0];
    assert.equal(row.runs, 1);
    assert.equal(row.status, 'ACTIVE');
    assert.equal(new Date(row.run_at).getTime(), due.getTime() + 7 * 86_400_000);
    assert.ok(row.last_campaign_id);
    assert.match(row.last_note, /watu 2/);
    const c = await waitDone(row.last_campaign_id);
    assert.equal(c.schedule_id, sched.id);
    assert.equal(c.skipped_opt_out, 1);
    assert.equal(sent.length, 2);
    assert.ok(sent.every((m) => m.message.startsWith('Kumbusho la wiki ')));

    // Mara ya pili haitumwi tena mpaka wiki ijayo
    sent.length = 0;
    await runDueSchedules();
    assert.equal(sent.length, 0);
  });

  it('ratiba: kusimamisha, kuendelea, kughairi; ya mara moja inaisha baada ya kutumwa', async () => {
    let r = await call(
      'POST',
      '/api/admin/sms-center/schedules',
      { audience: 'NUMBERS', numbers: ourNumbers(), message: 'Mara moja tu {jina}', runAt: new Date(Date.now() + 7_200_000).toISOString() },
      'admin',
    );
    const id = r.json.data.find((x: any) => x.message === 'Mara moja tu {jina}').id;
    r = await call('POST', `/api/admin/sms-center/schedules/${id}/pause`, undefined, 'admin');
    assert.equal(r.json.data.find((x: any) => x.id === id).status, 'PAUSED');
    await db.query('UPDATE naya.sms_schedules SET run_at = now() - interval \'1 minute\' WHERE id = $1', [id]);
    sent.length = 0;
    await runDueSchedules();
    assert.equal(sent.length, 0); // imesimamishwa
    r = await call('POST', `/api/admin/sms-center/schedules/${id}/resume`, undefined, 'admin');
    assert.equal(r.json.data.find((x: any) => x.id === id).status, 'ACTIVE');
    await runDueSchedules();
    const row = (await db.query('SELECT * FROM naya.sms_schedules WHERE id = $1', [id])).rows[0];
    assert.equal(row.status, 'DONE');
    await waitDone(row.last_campaign_id);
    assert.equal(sent.length, 2);
    r = await call('POST', `/api/admin/sms-center/schedules/${id}/cancel`, undefined, 'admin');
    assert.equal(r.status, 409); // imeshaisha
    assert.equal((await call('POST', `/api/admin/sms-center/schedules/${id}/futa`, undefined, 'admin')).status, 400);
    assert.equal((await call('POST', '/api/admin/sms-center/schedules', { audience: 'CUSTOMERS', message: 'x', runAt: 'kesho' }, 'p1')).status, 403);
  });

  it('kujirudia kila siku: muda unaofuata ni saa ileile', () => {
    const d = new Date('2026-11-05T06:00:00Z');
    assert.equal(nextRun(d, 'DAILY')!.toISOString(), '2026-11-06T06:00:00.000Z');
    assert.equal(nextRun(d, 'WEEKLY')!.toISOString(), '2026-11-12T06:00:00.000Z');
    assert.equal(nextRun(d, 'NONE'), null);
  });

  it('SMS ya karibu: mteja mpya anaipata mara moja tu, aliyejiondoa hapati, na kikomo cha siku', async () => {
    // Wote watatu "walijiunga saa 2 zilizopita"
    await db.query(`UPDATE naya.users SET created_at = now() - interval '2 hours' WHERE id = ANY($1::uuid[])`, [[ids.p1, ids.p2, ids.p3]]);
    let r = await call('PUT', '/api/admin/sms-center/auto/WELCOME', { enabled: true, message: 'Karibu NAYA {jina}!', days: 1, dailyCap: 1000 }, 'admin');
    assert.equal(r.status, 200);
    const welcome = r.json.data.rules.find((x: any) => x.rule === 'WELCOME');
    assert.equal(welcome.enabled, true);
    assert.ok(welcome.waiting >= 2);
    assert.equal((await call('PUT', '/api/admin/sms-center/auto/WELCOME', { enabled: true, message: 'Karibu {haijulikani}', days: 1, dailyCap: 5 }, 'admin')).status, 400);
    assert.equal((await call('PUT', '/api/admin/sms-center/auto/HAKUNA', { enabled: true, message: 'Karibu', days: 1, dailyCap: 5 }, 'admin')).status, 400);

    sent.length = 0;
    for (let i = 0; i < 40 && (!sent.some((m) => m.phone === phoneOf('p2')) || !sent.some((m) => m.phone === phoneOf('p3'))); i++) await runAutoSms({ force: true });
    const toP2 = sent.filter((m) => m.phone === phoneOf('p2'));
    assert.equal(toP2.length, 1);
    assert.match(toP2[0].message, /^Karibu NAYA Hamisi!/);
    assert.equal(sent.filter((m) => m.phone === phoneOf('p3')).length, 1);
    assert.equal(sent.filter((m) => m.phone === phoneOf('p1')).length, 0); // amejiondoa

    // Haipati tena
    sent.length = 0;
    await runAutoSms({ force: true });
    assert.equal(sent.filter((m) => [phoneOf('p2'), phoneOf('p3')].includes(m.phone)).length, 0);
    const log = await db.query('SELECT ok FROM naya.sms_auto_log WHERE user_id = $1', [ids.p2]);
    assert.deepEqual(log.rows.map((l) => l.ok), [true]);

    // Kikomo cha siku: kimeshafikiwa → hakuna mpya
    await call('PUT', '/api/admin/sms-center/auto/WELCOME', { enabled: true, message: 'Karibu NAYA {jina}!', days: 1, dailyCap: 1 }, 'admin');
    await call('PUT', '/api/account/sms-marketing', { receive: true }, 'p1');
    sent.length = 0;
    await runAutoSms({ force: true });
    assert.equal(sent.length, 0);

    // Ikizimwa: hakuna kinachotumwa
    await call('PUT', '/api/admin/sms-center/auto/WELCOME', { enabled: false, message: 'Karibu NAYA {jina}!', days: 1, dailyCap: 1000 }, 'admin');
    await runAutoSms({ force: true });
    assert.equal(sent.length, 0);
    const audit = await db.query(`SELECT count(*)::int AS n FROM naya.audit_logs WHERE actor_id = $1 AND action = 'sms.auto_rule'`, [ids.admin]);
    assert.ok(audit.rows[0].n >= 3);
  });

  it('mteja aliyepotea: siku zinakaguliwa', async () => {
    assert.equal((await call('PUT', '/api/admin/sms-center/auto/INACTIVE_CUSTOMER', { enabled: true, message: 'Tumekukumbuka {jina}', days: 1, dailyCap: 5 }, 'admin')).status, 400);
    const r = await call('PUT', '/api/admin/sms-center/auto/INACTIVE_CUSTOMER', { enabled: false, message: 'Tumekukumbuka {jina}', days: 30, dailyCap: 50 }, 'admin');
    assert.equal(r.status, 200);
    assert.equal(r.json.data.rules.find((x: any) => x.rule === 'INACTIVE_CUSTOMER').days, 30);
  });
});
