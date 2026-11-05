// 0.28.0 SMS kupitia RodSMS (badala ya Beem): RODSMS_API_KEY + SMS_SENDER_ID=NAYA.
// RodSMS BANDIA (server ndogo ya localhost) — hakuna SMS halisi inayotumwa. Pia: nakala za code hazionekani kwenye mtandao.
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';

const calls: Array<{ method: string; url: string; auth: string | undefined; body: any }> = [];
let server: Server;
const hits429 = new Map<string, number>();

function handle(req: IncomingMessage, raw: string) {
  const body = raw ? JSON.parse(raw) : null;
  calls.push({ method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, body });
  if (req.headers.authorization !== 'Bearer rodsms_live_test') return [401, { success: false, error: { code: 'unauthorized', message: 'Invalid API key' }, request_id: 'req_x' }] as const;
  if (req.url === '/api/v1/balance') return [200, { success: true, data: { credits: 1500, currency: 'TZS' } }] as const;
  if (req.url === '/api/v1/sender-ids') return [200, { success: true, data: [{ sender_id: 'NAYA', status: 'APPROVED' }, { sender_id: 'PROMO', status: 'PENDING' }] }] as const;
  if (req.url === '/api/v1/messages') {
    const to: string = body.recipient;
    if (to.endsWith('0422')) return [402, { success: false, error: { code: 'insufficient_credits', message: 'Not enough' }, request_id: 'req_2' }] as const;
    if (to.endsWith('0403')) return [403, { success: false, error: { code: 'sender_id_unusable', message: 'x' } }] as const;
    if (to.endsWith('0429') && (hits429.get(to) ?? 0) === 0) {
      hits429.set(to, 1);
      return [429, { success: false, error: { code: 'rate_limited', message: 'Slow down' } }, { 'retry-after': '1' }] as const;
    }
    return [202, { success: true, data: { id: `msg_${calls.length}`, estimated_segments: 1, reserved_credits: 1 }, request_id: 'req_1' }] as const;
  }
  return [404, { success: false, error: { code: 'not_found' } }] as const;
}

let sms: typeof import('../src/services/sms.js');
let db: typeof import('../src/db/pool.js')['db'];
let app: import('fastify').FastifyInstance;
const s = String(Date.now()).slice(-6).replace(/^0/, '1');
const phone = (end: string) => `255766${s.slice(0, 2)}${end}`;
const PASSWORD = 'NayaTest#2026';
let adminToken = '';

before(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const [status, json, headers] = handle(req, raw) as readonly [number, unknown, Record<string, string>?];
      res.writeHead(status, { 'content-type': 'application/json', ...(headers ?? {}) });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  process.env.RODSMS_API_KEY = 'rodsms_live_test';
  process.env.RODSMS_BASE_URL = `http://127.0.0.1:${port}/api/v1/`;
  process.env.RODSMS_RATE_PER_MIN = '6000';
  process.env.SMS_SENDER_ID = 'NAYA';
  delete process.env.ABLINER_API_KEY;
  delete process.env.SMS_PROVIDER;
  delete process.env.BEEM_API_KEY;
  delete process.env.BEEM_SECRET_KEY;
  sms = await import('../src/services/sms.js');
  ({ db } = await import('../src/db/pool.js'));
  const { runMigrations } = await import('../src/db/migrate.js');
  const { buildApp } = await import('../src/app.js');
  const { hashPassword } = await import('../src/services/auth.js');
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  await db.query(`INSERT INTO naya.users (phone, full_name, role, password_hash) VALUES ($1, 'Ofisi SMS RodSMS', 'ADMIN', $2)`, [
    `255767${s}`,
    await hashPassword(PASSWORD),
  ]);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: `0767${s}`, password: PASSWORD, portal: 'admin' } });
  adminToken = login.json().data.token;
});

after(async () => {
  await db.query(`DELETE FROM naya.sms_log WHERE phone LIKE $1`, [`255766${s.slice(0, 2)}%`]);
  await db.query(`DELETE FROM naya.audit_logs WHERE actor_id IN (SELECT id FROM naya.users WHERE phone = $1)`, [`255767${s}`]);
  await db.query(`DELETE FROM naya.users WHERE phone = $1`, [`255767${s}`]);
  delete process.env.RODSMS_API_KEY;
  delete process.env.RODSMS_BASE_URL;
  delete process.env.RODSMS_RATE_PER_MIN;
  delete process.env.SMS_SENDER_ID;
  await app.close();
  await db.end();
  server.close();
});

const lastLog = async (to: string) => (await db.query('SELECT * FROM naya.sms_log WHERE phone = $1 ORDER BY id DESC LIMIT 1', [to])).rows[0];

describe('NAYA 0.28.0 — SMS kupitia RodSMS', () => {
  it('RodSMS inachaguliwa yenyewe (RODSMS_API_KEY + SMS_SENDER_ID, bila Beem)', () => {
    assert.equal(sms.smsProvider()?.name, 'rodsms');
    assert.equal(sms.smsEnabled(), true);
    assert.equal(sms.smsSenderLabel(), 'NAYA');
    assert.equal(sms.smsSetupHint(), null);
  });

  it('kutuma: POST /api/v1/messages na Bearer key, sender_id NAYA, recipient 255…, sms_type; sms_log SENT', async () => {
    const to = phone('0001');
    const ok = await sms.sendSms(to, 'NAYA: Namba yako ni 123456 — usimpe mtu.', 'otp_verify_phone');
    assert.equal(ok, true);
    const c = calls.filter((x) => x.url === '/api/v1/messages').at(-1)!;
    assert.equal(c.method, 'POST');
    assert.equal(c.auth, 'Bearer rodsms_live_test');
    assert.deepEqual(c.body, { sender_id: 'NAYA', recipient: to, message: 'NAYA: Namba yako ni 123456 - usimpe mtu.', sms_type: 'transactional' });
    const log = await lastLog(to);
    assert.equal(log.status, 'SENT');
    assert.match(log.request_id, /^msg_\d+$/);
  });

  it('salio limeisha / Sender ID haitumiki → FAILED na maelezo ya Kiswahili', async () => {
    const to = phone('0422');
    assert.equal(await sms.sendSms(to, 'Jaribio', 'admin_test'), false);
    const log = await lastLog(to);
    assert.equal(log.status, 'FAILED');
    assert.match(log.error, /RodSMS 402 \(insufficient_credits\): Salio la SMS kwenye RodSMS limeisha/);
    const to2 = phone('0403');
    assert.equal(await sms.sendSms(to2, 'Jaribio', 'admin_test'), false);
    assert.match((await lastLog(to2)).error, /sender_id_unusable.*Sender ID haijaidhinishwa/);
  });

  it('kikomo cha kasi (429) → inasubiri kisha inajaribu mara moja tena', async () => {
    const to = phone('0429');
    const before = calls.length;
    assert.equal(await sms.sendSms(to, 'Jaribio la kasi', 'campaign'), true);
    assert.equal(calls.slice(before).filter((x) => x.url === '/api/v1/messages').length, 2);
  });

  it('ofisi: salio la SMS (1,500), Sender ID NAYA imeidhinishwa, SMS ya majaribio inafika', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/sms', headers: { authorization: `Bearer ${adminToken}` } });
    assert.equal(res.statusCode, 200);
    const d = res.json().data;
    assert.equal(d.provider, 'rodsms');
    assert.equal(d.providerLabel, 'RodSMS');
    assert.equal(d.balance, 1500);
    assert.equal(d.senderId, 'NAYA');
    assert.equal(d.senderStatus, 'approved');
    const t = await app.inject({ method: 'POST', url: '/api/admin/sms/test', headers: { authorization: `Bearer ${adminToken}` }, payload: { phone: `0766${s.slice(0, 2)}0002` } });
    assert.equal(t.statusCode, 200);
    assert.equal(t.json().data.ok, true);
    assert.equal(t.json().data.provider, 'RodSMS');
    const dash = (await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: { authorization: `Bearer ${adminToken}` } })).json().data;
    if (dash?.sms) assert.equal(dash.sms.provider, 'RodSMS');
  });

  it('funguo zisizo sahihi → kosa linaeleza RODSMS_API_KEY', async () => {
    process.env.RODSMS_API_KEY = 'rodsms_live_wrong';
    try {
      const to = phone('0003');
      assert.equal(await sms.sendSms(to, 'Jaribio', 'admin_test'), false);
      assert.match((await lastLog(to)).error, /RodSMS 401 \(unauthorized\): .*RODSMS_API_KEY/);
    } finally {
      process.env.RODSMS_API_KEY = 'rodsms_live_test';
    }
  });

  it('usalama: nakala za code/database ndani ya frontend hazionekani; kurasa halisi zinafunguka', async () => {
    for (const url of ['/src/app.ts', '/database/migrations/001_init.sql', '/package.json', '/tests/', '/frontend/admin/', '/src%2Fapp.ts', '//src/app.ts', '/.env.example']) {
      assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404, url);
    }
    assert.equal((await app.inject({ method: 'GET', url: '/admin/' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/shared/naya.css' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  });
});
