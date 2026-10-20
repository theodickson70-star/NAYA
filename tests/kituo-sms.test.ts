// 0.26.0 Kituo cha SMS: templates (za mwanzo + kuongeza/kuhariri/kuondoa), kujaza {maneno}, hakiki (idadi, sehemu, matatizo),
// kutuma kwa namba/kundi (idadi lazima ilingane na hakiki), kuzuia kutuma mara mbili, kushindwa kwa Beem, kusimamisha,
// na ruhusa. SMS halisi hazitumwi (setSmsSenderForTests). DB ya majaribio tu.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { setSmsSenderForTests } from '../src/services/sms.js';
import { markInterruptedCampaigns, render, smsParts } from '../src/services/sms-center.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6).replace(/^0/, '1');
const PASSWORD = 'NayaTest#2026';
const userIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const sent: Array<{ phone: string; message: string }> = [];
const campaignIds: string[] = [];
const templateIds: string[] = [];
let ip = 0;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.79.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}
const intl = (local: string) => `255${local.slice(1)}`;
const okSender = async (phone: string, message: string) => {
  sent.push({ phone, message });
  return { ok: true, requestId: 'test' };
};

async function makeUser(key: string, phone: string, name: string, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode, phone_verified_at) VALUES ($1, $2, $3, $4, 'PASSENGER', now()) RETURNING id`,
    [intl(phone), name, role, await hashPassword(PASSWORD)],
  );
  ids[key] = row.rows[0].id;
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
const numbers = (from: number, n: number) => Array.from({ length: n }, (_, i) => `0768${s.slice(0, 3)}${String(from + i).padStart(3, '0')}`);

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  setSmsSenderForTests(okSender);
  await makeUser('admin', `0770${s}`, 'Ofisi Sms Kituo', 'ADMIN');
  await makeUser('p1', `0771${s}`, `Zuhura Kassim ${s}`);
  await makeUser('d1', `0772${s}`, `Shabani Boda ${s}`);
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, license_number, paid_until) VALUES ($1, 'APPROVED', 'BODABODA', $2, 'DL1', now() + interval '1 day')`,
    [ids.d1, `MC ${s.slice(-3)} KSM`],
  );
});

after(async () => {
  setSmsSenderForTests(null);
  await db.query('DELETE FROM naya.sms_log WHERE campaign_id = ANY($1::uuid[])', [campaignIds]);
  await db.query(`DELETE FROM naya.sms_log WHERE phone LIKE $1`, [`255768${s.slice(0, 3)}%`]);
  await db.query('DELETE FROM naya.sms_log WHERE phone IN (SELECT phone FROM naya.users WHERE id = ANY($1::uuid[]))', [userIds]);
  await db.query('DELETE FROM naya.sms_campaigns WHERE id = ANY($1::uuid[]) OR created_by = ANY($2::uuid[])', [campaignIds, userIds]);
  await db.query('DELETE FROM naya.sms_templates WHERE id = ANY($1::uuid[])', [templateIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.drivers WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await app.close();
  await db.end();
});

describe('NAYA 0.26.0 — Kituo cha SMS', () => {
  it('kujaza maneno na kuhesabu SMS', () => {
    const t = render('Habari {jina}, ada inaisha {ada_hadi}. Plate {plate}. {link}', {
      full_name: 'Asha Juma Ali',
      plate_number: 'MC 1 A',
      paid_until: new Date('2026-11-05T12:00:00Z'),
    });
    assert.match(t, /^Habari Asha, ada inaisha 05\/11\/2026\. Plate MC 1 A\. https:\/\/.+\/app\/$/);
    assert.equal(render('Habari {jina}', { full_name: null, plate_number: null, paid_until: null }), 'Habari ndugu');
    assert.equal(smsParts('a'.repeat(160)), 1);
    assert.equal(smsParts('a'.repeat(161)), 2);
    assert.equal(smsParts('a'.repeat(306)), 2);
    assert.equal(smsParts('a'.repeat(307)), 3);
  });

  it('ofisi: templates za mwanzo za wateja na madereva + idadi ya makundi', async () => {
    const res = await call('GET', '/api/admin/sms-center', undefined, 'admin');
    assert.equal(res.status, 200);
    const d = res.json.data;
    assert.equal(d.enabled, true);
    assert.ok(d.templates.some((t: any) => t.audience === 'CUSTOMERS' && t.title === 'Karibu NAYA'));
    assert.ok(d.templates.some((t: any) => t.audience === 'DRIVERS' && t.title === 'Ada inakaribia kuisha'));
    assert.ok(d.sizes.DRIVERS >= 1 && d.sizes.CUSTOMERS >= 1 && d.sizes.DRIVERS_FEE_DUE >= 1);
    assert.equal((await call('GET', '/api/admin/sms-center', undefined, 'p1')).status, 403);
  });

  it('templates: kuongeza, kuhariri, kuondoa; neno lisilojulikana linakataliwa', async () => {
    const bad = await call('POST', '/api/admin/sms-templates', { audience: 'DRIVERS', title: 'Mbaya', body: 'Habari {jinaa}, karibu' }, 'admin');
    assert.equal(bad.status, 400);
    assert.match(bad.json.message, /\{jinaa\}/);
    const created = await call('POST', '/api/admin/sms-templates', { audience: 'DRIVERS', title: `Mvua ${s}`, body: 'Habari {jina}, mvua kubwa leo. Endesha kwa uangalifu.' }, 'admin');
    assert.equal(created.status, 201, created.json.message);
    const t = created.json.data.find((x: any) => x.title === `Mvua ${s}`);
    templateIds.push(t.id);
    const upd = await call('PUT', `/api/admin/sms-templates/${t.id}`, { audience: 'ALL', title: `Mvua ${s}`, body: 'NAYA: Mvua kubwa leo, {jina}. Vaeni koti la mvua.' }, 'admin');
    assert.equal(upd.status, 200);
    assert.equal(upd.json.data.find((x: any) => x.id === t.id).audience, 'ALL');
    const del = await call('POST', `/api/admin/sms-templates/${t.id}/archive`, {}, 'admin');
    assert.equal(del.status, 200);
    assert.equal(del.json.data.some((x: any) => x.id === t.id), false);
  });

  it('hakiki: idadi, namba zisizo sahihi, mfano uliojazwa, na matatizo', async () => {
    const res = await call('POST', '/api/admin/sms-center/preview', {
      audience: 'NUMBERS',
      message: 'Habari {jina}, karibu NAYA.',
      numbers: `0771${s}, 0771${s}\n12345\n${numbers(1, 2).join(' ')}`,
    }, 'admin');
    assert.equal(res.status, 200, res.json.message);
    const d = res.json.data;
    assert.equal(d.count, 3, 'namba zinazojirudia zinahesabiwa mara moja');
    assert.equal(d.invalidCount, 1);
    assert.deepEqual(d.problems, []);
    assert.equal(d.units, 3);
    assert.equal(d.samples.find((x: any) => x.phone === intl(`0771${s}`)).text, 'Habari Zuhura, karibu NAYA.');
    assert.ok(d.samples.some((x: any) => x.text === 'Habari ndugu, karibu NAYA.'));

    const probs = (await call('POST', '/api/admin/sms-center/preview', { audience: 'NUMBERS', message: 'Ofa: [andika ofa] {xyz}', numbers: `0771${s}` }, 'admin')).json.data.problems;
    assert.equal(probs.length, 2);
    const long = (await call('POST', '/api/admin/sms-center/preview', { audience: 'NUMBERS', message: 'a'.repeat(470), numbers: `0771${s}` }, 'admin')).json.data;
    assert.equal(long.maxParts, 4);
    assert.ok(long.problems.some((p: string) => /mrefu/.test(p)));
  });

  let firstId = '';
  it('kutuma kwa namba: idadi lazima ilingane; kila mtu anapata SMS yake; historia + sms_log', async () => {
    const list = [`0771${s}`, ...numbers(10, 2)];
    const body = { audience: 'NUMBERS', message: 'Habari {jina}, NAYA inakusalimu.', numbers: list.join('\n') };
    const wrong = await call('POST', '/api/admin/sms-center/send', { ...body, expectedCount: 5 }, 'admin');
    assert.equal(wrong.status, 409);
    assert.match(wrong.json.message, /Idadi ya watu imebadilika/);
    const before = sent.length;
    const res = await call('POST', '/api/admin/sms-center/send', { ...body, expectedCount: 3 }, 'admin');
    assert.equal(res.status, 201, res.json.message);
    firstId = res.json.data.id;
    campaignIds.push(firstId);
    const c = await waitDone(firstId);
    assert.equal(c.status, 'DONE');
    assert.equal(c.sent, 3);
    assert.equal(c.failed, 0);
    assert.equal(c.units, 3);
    const mine = sent.slice(before);
    assert.equal(mine.find((m) => m.phone === intl(`0771${s}`))?.message, 'Habari Zuhura, NAYA inakusalimu.');
    assert.equal(mine.filter((m) => m.message === 'Habari ndugu, NAYA inakusalimu.').length, 2);
    const logs = (await db.query('SELECT kind, status FROM naya.sms_log WHERE campaign_id = $1', [firstId])).rows;
    assert.equal(logs.length, 3);
    assert.ok(logs.every((l) => l.kind === 'campaign' && l.status === 'SENT'));

    const again = await call('POST', '/api/admin/sms-center/send', { ...body, expectedCount: 3 }, 'admin');
    assert.equal(again.status, 409, 'ujumbe uleule ndani ya dakika 2');
    const hist = (await call('GET', '/api/admin/sms-center', undefined, 'admin')).json.data.campaigns;
    assert.equal(hist[0].id, firstId);
    assert.equal(hist[0].createdBy, 'Ofisi Sms Kituo');
  });

  it('kundi la madereva (ada inaisha): {ada_hadi} na {plate} vinajazwa', async () => {
    const pv = (await call('POST', '/api/admin/sms-center/preview', { audience: 'DRIVERS_FEE_DUE', message: `Habari {jina} ({plate}), ada inaisha {ada_hadi}. ${s}` }, 'admin')).json.data;
    assert.ok(pv.count >= 1);
    const before = sent.length;
    const res = await call('POST', '/api/admin/sms-center/send', { audience: 'DRIVERS_FEE_DUE', message: `Habari {jina} ({plate}), ada inaisha {ada_hadi}. ${s}`, expectedCount: pv.count }, 'admin');
    assert.equal(res.status, 201, res.json.message);
    campaignIds.push(res.json.data.id);
    await waitDone(res.json.data.id);
    const mine = sent.slice(before).find((m) => m.phone === intl(`0772${s}`));
    assert.match(mine!.message, new RegExp(`^Habari Shabani \\(MC ${s.slice(-3)} KSM\\), ada inaisha \\d{2}/\\d{2}/\\d{4}\\.`));
    assert.equal(sent.slice(before).some((m) => m.phone === intl(`0771${s}`)), false, 'abiria hayumo kwenye kundi la madereva');
  });

  it('Beem ikishindwa: zilizoshindwa zinaonekana pamoja na sababu', async () => {
    setSmsSenderForTests(async (phone) => (phone.endsWith('021') ? { ok: false, error: 'Beem 400: Invalid number' } : okSender(phone, '')));
    const list = numbers(20, 2);
    const res = await call('POST', '/api/admin/sms-center/send', { audience: 'NUMBERS', message: `Jaribio ${s} la kushindwa`, numbers: list.join(','), expectedCount: 2 }, 'admin');
    assert.equal(res.status, 201);
    campaignIds.push(res.json.data.id);
    const c = await waitDone(res.json.data.id);
    assert.equal(c.sent, 1);
    assert.equal(c.failed, 1);
    const detail = (await call('GET', `/api/admin/sms-center/campaigns/${res.json.data.id}`, undefined, 'admin')).json.data;
    assert.equal(detail.failures.length, 1);
    assert.match(detail.failures[0].error, /Invalid number/);
    setSmsSenderForTests(okSender);
  });

  it('kusimamisha katikati: SMS zilizobaki hazitumwi', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    setSmsSenderForTests(async (phone, message) => {
      await gate;
      return okSender(phone, message);
    });
    const list = numbers(100, 25);
    const res = await call('POST', '/api/admin/sms-center/send', { audience: 'NUMBERS', message: `Jaribio ${s} la kusimamisha`, numbers: list.join('\n'), expectedCount: 25 }, 'admin');
    assert.equal(res.status, 201);
    const id = res.json.data.id;
    campaignIds.push(id);
    const stop = await call('POST', `/api/admin/sms-center/campaigns/${id}/stop`, {}, 'admin');
    assert.equal(stop.status, 200);
    release();
    await new Promise((r) => setTimeout(r, 300));
    const c = (await db.query('SELECT * FROM naya.sms_campaigns WHERE id = $1', [id])).rows[0];
    assert.equal(c.status, 'STOPPED');
    assert.ok(c.sent < 25, `zilizotumwa ${c.sent}`);
    assert.equal((await call('POST', `/api/admin/sms-center/campaigns/${id}/stop`, {}, 'admin')).status, 409);
    setSmsSenderForTests(okSender);
  });

  it('kinga: [maneno ya kujaza] yanazuia kutuma; bila SMS → 409; server ikianza upya → "imesimamishwa"', async () => {
    const res = await call('POST', '/api/admin/sms-center/send', { audience: 'NUMBERS', message: 'Ofa: [andika ofa hapa]', numbers: `0771${s}`, expectedCount: 1 }, 'admin');
    assert.equal(res.status, 400);
    assert.match(res.json.message, /\[ \]/);
    const row = await db.query(`INSERT INTO naya.sms_campaigns (audience, target_key, message, total, created_by) VALUES ('NUMBERS', 'x', 'x jaribio', 1, $1) RETURNING id`, [ids.admin]);
    campaignIds.push(row.rows[0].id);
    assert.ok((await markInterruptedCampaigns()) >= 1);
    assert.equal((await db.query('SELECT status FROM naya.sms_campaigns WHERE id = $1', [row.rows[0].id])).rows[0].status, 'STOPPED');
    setSmsSenderForTests(null);
    const off = await call('POST', '/api/admin/sms-center/send', { audience: 'NUMBERS', message: `Habari ${s} bila funguo`, numbers: `0771${s}`, expectedCount: 1 }, 'admin');
    assert.equal(off.status, 409);
    assert.equal((await call('POST', '/api/admin/sms-center/send', { audience: 'NUMBERS', message: 'Habari', numbers: `0771${s}`, expectedCount: 1 }, 'p1')).status, 403);
    setSmsSenderForTests(okSender);
  });
});
