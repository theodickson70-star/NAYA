// Abliner (0.17.0) dhidi ya server BANDIA ya Abliner kwenye 127.0.0.1 — HAKUNA malipo halisi, hakuna mtandao wa nje.
// Server bandia inakagua kile nyaraka za Abliner zinadai: Bearer key, Idempotency-Key, saini ya deposit (hex HMAC-SHA256
// ya `${ts}.${body}` kwa webhook secret), sehemu za ombi. Webhooks zinasainiwa kama Abliner (x-webhook-*).
// Database ya MAJARIBIO tu.
import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

const KEY = 'tsl_live_TESTKEY_never_real_0000000000';
const SECRET = 'whsec_TEST_never_real_1111111111';
process.env.PAYMENT_PROVIDER = 'abliner';
process.env.ABLINER_API_KEY = KEY;
process.env.ABLINER_WEBHOOK_SECRET = SECRET;
process.env.RAILWAY_PUBLIC_DOMAIN = 'naya-production-e5cf.up.railway.app';

const { buildApp } = await import('../src/app.js');
const { db } = await import('../src/db/pool.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { hashPassword } = await import('../src/services/auth.js');
const { checkPendingPayments } = await import('../src/services/payments/index.js');
const { getProvider } = await import('../src/services/payments/provider.js');
const { mapStatus, sign } = await import('../src/services/payments/abliner.js');

// ------------------------------------------------------------------ server bandia ya Abliner
interface Seen { method: string; path: string; headers: IncomingMessage['headers']; body: string }
const seen: Seen[] = [];
const txs = new Map<string, Record<string, unknown>>(); // customer_reference → muamala
let mode: { deposit?: 'ok' | 'invalid_phone' | 'server_error'; withdrawal?: 'ok' | 'drop' | 'insufficient' } = {};
let counter = 0;
let mock: Server;

function hmac(ts: string, body: string) {
  return createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
}
function send(res: import('node:http').ServerResponse, status: number, json: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(json));
}

function startMock() {
  mock = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      seen.push({ method: req.method ?? '', path: url.pathname, headers: req.headers, body });
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { status: 'error', code: 'unauthorized', message: 'Invalid API key' });
      if (req.method === 'GET' && url.pathname === '/api/v1/balance') return send(res, 200, { balance: 250000, currency: 'TZS', balances: { TZS: 250000 } });
      if (req.method === 'GET' && url.pathname === '/api/v1/transactions') {
        const ref = url.searchParams.get('customer_reference');
        const id = url.searchParams.get('id');
        const data = [...txs.values()].filter((t) => (ref ? t.customer_reference === ref : id ? t.id === id : true));
        return send(res, 200, { status: 'success', data });
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/deposits') {
        if (!req.headers['idempotency-key']) return send(res, 400, { status: 'error', code: 'idempotency_key_required' });
        const ts = String(req.headers['x-abliner-timestamp'] ?? '');
        if (req.headers['x-abliner-signature'] !== hmac(ts, body)) return send(res, 401, { status: 'error', code: 'invalid_request_signature' });
        if (mode.deposit === 'invalid_phone') return send(res, 422, { status: 'error', code: 'invalid_phone', message: 'Invalid phone' });
        if (mode.deposit === 'server_error') return send(res, 502, { status: 'error', code: 'provider_error', retryable: true });
        const b = JSON.parse(body);
        const tx = { id: `dep-${++counter}`, type: 'deposit', flow: 'push', status: 'pending', amount: b.amount, currency: b.currency, method: b.method, payment_url: null, reference: `ABL${counter}`, customer_reference: b.reference, message: 'USSD push sent' };
        txs.set(b.reference, tx);
        return send(res, 200, tx);
      }
      if (req.method === 'POST' && url.pathname === '/api/v1/withdrawals') {
        if (mode.withdrawal === 'drop') return req.socket.destroy(); // jibu limepotea — hatujui kama pesa imetoka
        if (mode.withdrawal === 'insufficient') return send(res, 402, { status: 'error', code: 'insufficient_funds', message: 'Insufficient balance' });
        const b = JSON.parse(body);
        const tx = { id: `wd-${++counter}`, type: 'withdrawal', status: 'pending', amount: b.amount, currency: b.currency ?? 'TZS', method: b.method, recipient: b.recipient, reference: `ABLW${counter}`, customer_reference: b.reference };
        txs.set(b.reference, tx);
        return send(res, 200, tx);
      }
      send(res, 404, { status: 'error', code: 'not_found' });
    });
  });
  mock.unref(); // test ikishindwa, server bandia isizuie process kuisha
  return new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', () => resolve()));
}

// ------------------------------------------------------------------ NAYA
let app: FastifyInstance;
const s = String(Date.now()).slice(-6).replace(/^0/, '1');
const PASSWORD = 'NayaTest#2026';
const userIds: string[] = [];
const locationIds: string[] = [];
const promoIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let ip = 0;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.61.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any, body: res.body };
}

/** Webhook kama Abliner: saini ya `${ts}.${rawBody}`; id ileile kwenye kujaribu tena. */
let hookCounter = 0;
async function webhook(event: string, data: Record<string, unknown>, opts: { id?: string; ts?: number; badSig?: boolean } = {}) {
  const id = opts.id ?? `evt_${s}_${++hookCounter}`;
  const raw = JSON.stringify({ id, event, created_at: new Date().toISOString(), data });
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const res = await app.inject({
    method: 'POST',
    url: '/api/payments/callback/abliner',
    remoteAddress: '10.61.250.1',
    headers: { 'content-type': 'application/json', 'x-webhook-id': id, 'x-webhook-timestamp': ts, 'x-webhook-signature': opts.badSig ? hmac(ts, raw).replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) : hmac(ts, raw) },
    payload: raw,
  });
  return { status: res.statusCode, json: res.json() as any, id };
}

const A = { lat: -7.6, lng: 34.8 };
const B = { lat: -7.615, lng: 34.81 };
const NEAR_B = { lat: -7.6145, lng: 34.81 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function makeUser(key: string, phone: string, name: string, mode: string | null, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode, phone_verified_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [`255${phone.slice(1)}`, name, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: role === 'USER' ? 'app' : 'admin' })).json.data.token;
}
async function makeDriver(key: string, phone: string, name: string, plate: string) {
  await makeUser(key, phone, name, 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
     VALUES ($1, 'APPROVED', 'BODABODA', $2, 'Boxer', 'Nyekundu', 'DL123456', now() + interval '10 days')`,
    [ids[key], plate],
  );
}
const paidUntil = async (key: string) => new Date((await db.query('SELECT paid_until FROM naya.drivers WHERE user_id = $1', [ids[key]])).rows[0].paid_until).getTime();
const payment = async (id: string) => (await db.query('SELECT * FROM naya.payments WHERE id = $1', [id])).rows[0];
const ride = async (id: string) => (await db.query('SELECT * FROM naya.rides WHERE id = $1', [id])).rows[0];
async function rideState(id: string, until: (r: any) => boolean) {
  for (let i = 0; i < 60; i++) {
    const r = await ride(id);
    if (until(r)) return r;
    await wait(50);
  }
  return ride(id);
}
const posts = (path: string) => seen.filter((x) => x.method === 'POST' && x.path === path);
const pay = async (who: string, phone: string) => {
  await db.query(`UPDATE naya.payments SET created_at = now() - interval '3 minutes' WHERE user_id = $1 AND status = 'PENDING'`, [ids[who]]);
  return call('POST', '/api/driver/subscription/pay', { months: 1, network: 'MPESA', phone }, who);
};

async function promoRide(driver: string) {
  assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.0005, lng: A.lng }, driver)).status, 200);
  const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
  assert.equal(res.status, 201, res.json.message);
  const rideId = res.json.data.id;
  const offer = (await call('GET', '/api/driver/state', undefined, driver)).json.data.offer;
  assert.equal(offer?.ride.id, rideId, 'dereva hakupata ombi');
  assert.equal((await call('POST', `/api/driver/offers/${offer.id}/accept`, {}, driver)).status, 200);
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, driver)).status, 200);
  const pin = (await call('GET', '/api/rides/current', undefined, 'p1')).json.data.pin;
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/start`, { pin }, driver)).status, 200);
  await db.query(`UPDATE naya.rides SET started_at = now() - interval '6 minutes' WHERE id = $1`, [rideId]);
  await call('POST', '/api/driver/location', NEAR_B, driver);
  assert.equal((await call('POST', `/api/driver/rides/${rideId}/complete`, {}, driver)).status, 200);
  await call('POST', `/api/rides/${rideId}/close`, {}, 'p1');
  await call('POST', `/api/driver/rides/${rideId}/close`, {}, driver);
  await call('POST', '/api/driver/online', { online: false }, driver);
  return rideId as string;
}

let pausedBefore: string[] = [];
let feeBefore: unknown = null;
before(async () => {
  await startMock();
  process.env.ABLINER_API_BASE_URL = `http://127.0.0.1:${(mock.address() as AddressInfo).port}/api/v1/`; // "/api/v1/" inaondolewa yenyewe
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  pausedBefore = (await db.query(`UPDATE naya.promotions SET status = 'PAUSED' WHERE status = 'ACTIVE' RETURNING id`)).rows.map((r) => r.id);
  feeBefore = (await db.query(`SELECT value FROM naya.settings WHERE key = 'subscription'`)).rows[0]?.value ?? null;
  await db.query(
    `INSERT INTO naya.settings (key, value) VALUES ('subscription', '{"monthlyFee": 5000, "trialDays": 30, "graceDays": 3, "paymentInstructions": "Lipa ofisini."}')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
  await db.query(`INSERT INTO naya.settings (key, value) VALUES ('auto_payout', '{"enabled": true, "dailyLimit": 10000}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  for (const [name, p] of [[`Pickup AB${s}`, A], [`Dest AB${s}`, B]] as const) {
    const r = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(r.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 3000, 0, 3000, 100, 1.3), ('BAJAJI', 4000, 0, 4000, 100, 1.3)`,
  );
  await makeUser('admin', `0780${s}`, 'Ofisi Abliner', null, 'ADMIN');
  await makeUser('p1', `0781${s}`, `Mteja Abliner ${s}`, 'PASSENGER');
  await makeDriver('d1', `0764${s}`, `Boda Abliner ${s}`, `MC ${s.slice(-3)} AB1`);
  const promo = await call('POST', '/api/admin/promotions', { name: `Abliner ${s}`, title: 'Nusu bei', audience: 'ALL', discountPercent: 50 }, 'admin');
  promoIds.push(promo.json.data.id);
  await call('POST', `/api/admin/promotions/${promo.json.data.id}/status`, { status: 'ACTIVE' }, 'admin');
});

after(async () => {
  await db.query('DELETE FROM naya.payment_webhook_events WHERE event_id LIKE $1', [`evt_${s}_%`]);
  await db.query('DELETE FROM naya.promo_payouts WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.subscription_payments WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('UPDATE naya.rides SET promo_payment_id = NULL WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.payments WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.ride_offers WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.promotions WHERE id = ANY($1::uuid[])', [promoIds]);
  await db.query(`UPDATE naya.promotions SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])`, [pausedBefore]);
  if (feeBefore) await db.query(`UPDATE naya.settings SET value = $1 WHERE key = 'subscription'`, [JSON.stringify(feeBefore)]);
  await db.query(`UPDATE naya.settings SET updated_by = NULL WHERE updated_by = ANY($1::uuid[])`, [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
  await new Promise((r) => mock.close(r));
});

describe('Abliner — mipangilio', () => {
  it('inawashwa na PAYMENT_PROVIDER=abliner + funguo mbili tu; bila funguo → imezimwa', () => {
    assert.equal(getProvider()?.name, 'abliner');
    const key = process.env.ABLINER_API_KEY;
    delete process.env.ABLINER_API_KEY;
    assert.equal(getProvider(), null);
    process.env.ABLINER_API_KEY = key;
  });

  it('saini: hex HMAC-SHA256 ya `${ts}.${body}`; hali isiyojulikana kamwe si mafanikio', () => {
    assert.equal(sign(SECRET, '1700000000', '{"a":1}'), createHmac('sha256', SECRET).update('1700000000.{"a":1}').digest('hex'));
    assert.equal(mapStatus('completed'), 'SUCCESS');
    assert.equal(mapStatus('failed'), 'FAILED');
    assert.equal(mapStatus('pending'), 'PENDING');
    assert.equal(mapStatus('processing'), 'PENDING');
    assert.equal(mapStatus(undefined), 'PENDING');
  });

  it('ofisi: "Kagua muunganiko" → salio kupitia GET /balance; funguo hazionekani; si ofisi → 403', async () => {
    const r = await call('GET', '/api/admin/payments/provider-check', undefined, 'admin');
    assert.equal(r.status, 200);
    assert.equal(r.json.data.active, 'abliner');
    assert.equal(r.json.data.check.ok, true);
    assert.equal(r.json.data.check.balance, 250000);
    assert.equal(r.json.data.webhookUrl, 'https://naya-production-e5cf.up.railway.app/api/payments/callback/abliner');
    assert.ok(!r.body.includes(KEY) && !r.body.includes(SECRET));
    assert.equal((await call('GET', '/api/admin/payments/provider-check', undefined, 'd1')).status, 403);
    assert.equal((await call('GET', '/api/admin/payments/provider-check')).status, 401);
  });
});

describe('Abliner — ada ya mwezi (deposit / USSD push)', () => {
  let paymentId = '';
  let reference = '';

  it('ombi la deposit: Bearer, Idempotency-Key, saini sahihi, sehemu sahihi, callback_url ya NAYA', async () => {
    const r = await pay('d1', `0764${s}`);
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.status, 'PENDING');
    paymentId = r.json.data.id;
    reference = r.json.data.reference;
    const req = posts('/api/v1/deposits').at(-1)!;
    assert.equal(req.headers.authorization, `Bearer ${KEY}`);
    assert.equal(req.headers['idempotency-key'], reference);
    assert.equal(req.headers['x-abliner-signature'], hmac(String(req.headers['x-abliner-timestamp']), req.body));
    assert.ok(Math.abs(Number(req.headers['x-abliner-timestamp']) - Date.now() / 1000) < 30, 'timestamp ni sekunde');
    assert.deepEqual(JSON.parse(req.body), {
      amount: 5000,
      method: 'mobile',
      currency: 'TZS',
      phone: `255764${s}`,
      reference,
      callback_url: 'https://naya-production-e5cf.up.railway.app/api/payments/callback/abliner',
    });
    assert.equal((await payment(paymentId)).provider_ref, 'dep-' + String(counter));
  });

  it('webhook yenye saini mbaya au ya zamani (> sekunde 300) → 401, hakuna kinachobadilika', async () => {
    const before = await paidUntil('d1');
    const data = { id: 'dep-x', type: 'deposit', status: 'completed', amount: 5000, customer_reference: reference, provider_reference: 'MP123' };
    assert.equal((await webhook('transaction.completed', data, { badSig: true })).status, 401);
    assert.equal((await webhook('transaction.completed', data, { ts: Math.floor(Date.now() / 1000) - 301 })).status, 401);
    const noSig = await app.inject({ method: 'POST', url: '/api/payments/callback/abliner', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ event: 'transaction.completed', data }) });
    assert.equal(noSig.statusCode, 401);
    assert.equal((await payment(paymentId)).status, 'PENDING');
    assert.equal(await paidUntil('d1'), before);
  });

  it('webhook sahihi transaction.completed → SUCCESS, siku 30 zinaongezwa; kurudiwa (id ileile) → hakuna kuongeza tena', async () => {
    const before = await paidUntil('d1');
    const data = { id: 'dep-1', type: 'deposit', method: 'mobile', amount: 5000, currency: 'TZS', status: 'completed', reference: 'ABL1', customer_reference: reference, provider_reference: `MP${s}`, recipient: null };
    const first = await webhook('transaction.completed', data);
    assert.equal(first.status, 200);
    const p = await payment(paymentId);
    assert.equal(p.status, 'SUCCESS');
    assert.equal(p.provider_ref, `MP${s}`);
    const afterTs = await paidUntil('d1');
    assert.ok(Math.abs(afterTs - before - 30 * 86400_000) < 120_000);
    // Abliner inajaribu tena (saini mpya, id ileile)
    const again = await webhook('transaction.completed', data, { id: first.id });
    assert.equal(again.status, 200);
    assert.equal(again.json.data.duplicate, true);
    assert.equal(await paidUntil('d1'), afterTs);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM naya.subscription_payments WHERE payment_id = $1', [paymentId])).rows[0].n, 1);
    // tukio jipya (id tofauti) kwa muamala uleule → bado mara moja tu
    await webhook('transaction.completed', data);
    assert.equal(await paidUntil('d1'), afterTs);
    const ev = await db.query('SELECT outcome FROM naya.payment_webhook_events WHERE event_id = $1', [first.id]);
    assert.equal(ev.rows[0].outcome, 'APPLIED');
  });

  it('kiasi kikipingana → hakiandikwi kimelipwa', async () => {
    const r = await pay('d1', `0764${s}`);
    const ref = r.json.data.reference;
    const res = await webhook('transaction.completed', { id: 'dep-m', status: 'completed', amount: 500, customer_reference: ref });
    assert.equal(res.status, 200);
    assert.equal((await payment(r.json.data.id)).status, 'PENDING');
    // transaction.failed sahihi → FAILED
    await webhook('transaction.failed', { id: 'dep-m', status: 'failed', amount: 5000, customer_reference: ref });
    assert.equal((await payment(r.json.data.id)).status, 'FAILED');
  });

  it('tukio lisilotuhusu / reference isiyojulikana → 200 (Abliner isijaribu tena), hakuna kinachobadilika', async () => {
    assert.equal((await webhook('checkout.paid', { id: 'chk-1', reference: 'X' })).json.data.ignored, true);
    assert.equal((await webhook('transaction.completed', { id: 'dep-z', status: 'completed', amount: 1000, customer_reference: 'NOT-OURS-123' })).json.data.ignored, true);
  });

  it('Abliner ikikataa namba (422 invalid_phone) → FAILED na ujumbe unaoeleweka', async () => {
    mode = { deposit: 'invalid_phone' };
    const r = await pay('d1', `0764${s}`);
    mode = {};
    assert.equal(r.json.data.status, 'FAILED');
    assert.match(r.json.data.failureReason, /Namba ya simu si sahihi/);
  });

  it('Abliner ikijibu 5xx → PENDING (si FAILED); worker inauliza /transactions kwa reference yetu na kuthibitisha', async () => {
    mode = { deposit: 'server_error' };
    const r = await pay('d1', `0764${s}`);
    mode = {};
    assert.equal(r.json.data.status, 'PENDING');
    const ref = r.json.data.reference;
    // Kumbe push ilitumwa na mteja amelipa (Abliner ina muamala)
    txs.set(ref, { id: 'dep-late', type: 'deposit', status: 'completed', amount: 5000, customer_reference: ref, provider_reference: 'MPLATE' });
    await db.query(`UPDATE naya.payments SET created_at = now() - interval '1 minute' WHERE id = $1`, [r.json.data.id]);
    const before = await paidUntil('d1');
    await checkPendingPayments();
    const p = await payment(r.json.data.id);
    assert.equal(p.status, 'SUCCESS');
    assert.equal(p.provider_ref, 'MPLATE');
    assert.ok((await paidUntil('d1')) > before);
    const q = seen.filter((x) => x.path === '/api/v1/transactions').at(-1)!;
    assert.ok(q.method === 'GET');
  });
});

describe('Abliner — malipo ya ofa kwa bodaboda (withdrawal)', () => {
  it('safari safi → POST /withdrawals (method mobile, recipient, reference yetu); webhook withdrawal.completed → PAID', async () => {
    assert.equal((await call('POST', '/api/driver/payout-accounts', { network: 'MPESA', phone: `0764${s}`, accountName: 'Jina La Dereva', primary: true }, 'd1')).status, 200);
    const rideId = await promoRide('d1');
    const r = await rideState(rideId, (x) => x.promo_payout_state === 'PENDING' && x.promo_payment_id);
    assert.equal(r.promo_payout_state, 'PENDING');
    const p = await payment(r.promo_payment_id);
    const req = posts('/api/v1/withdrawals').at(-1)!;
    assert.equal(req.headers.authorization, `Bearer ${KEY}`);
    assert.deepEqual(JSON.parse(req.body), { amount: 1500, method: 'mobile', currency: 'TZS', recipient: `255764${s}`, reference: p.reference });
    const hook = await webhook('withdrawal.completed', { id: p.provider_ref, type: 'withdrawal', status: 'completed', amount: 1500, customer_reference: p.reference, provider_reference: `WD${s}` });
    assert.equal(hook.status, 200);
    assert.equal((await ride(rideId)).promo_payout_state, 'PAID');
    assert.equal((await payment(p.id)).status, 'SUCCESS');
    assert.equal((await db.query('SELECT amount FROM naya.promo_payouts WHERE payment_id = $1', [p.id])).rows[0].amount, 1500);
  });

  it('jibu la withdrawal likipotea → inabaki PENDING; worker HAITUMI tena (inauliza hali tu)', async () => {
    mode = { withdrawal: 'drop' };
    const rideId = await promoRide('d1');
    const r = await rideState(rideId, (x) => x.promo_payout_state === 'PENDING' && x.promo_payment_id);
    mode = {};
    await wait(200);
    const p = await payment(r.promo_payment_id);
    assert.equal(p.status, 'PENDING');
    const postsBefore = posts('/api/v1/withdrawals').length;
    await db.query(`UPDATE naya.payments SET created_at = now() - interval '1 minute' WHERE id = $1`, [p.id]);
    await checkPendingPayments();
    assert.equal(posts('/api/v1/withdrawals').length, postsBefore, 'hakuna kutuma mara ya pili');
    assert.equal((await payment(p.id)).status, 'PENDING');
    // ofisi haiwezi "Jaribu tena" wakati muamala haujathibitishwa
    assert.equal((await call('POST', `/api/admin/payments/rides/${rideId}/approve`, {}, 'admin')).status, 409);
    // Abliner inathibitisha baadaye kuwa imeshindwa → FAILED, ofisi inaweza kujaribu tena
    await webhook('withdrawal.failed', { id: 'wd-lost', status: 'failed', amount: 1500, customer_reference: p.reference });
    assert.equal((await payment(p.id)).status, 'FAILED');
    assert.equal((await ride(rideId)).promo_payout_state, 'FAILED');
  });

  it('salio la Abliner halitoshi (402) → FAILED na ujumbe kwa ofisi', async () => {
    mode = { withdrawal: 'insufficient' };
    const rideId = await promoRide('d1');
    const r = await rideState(rideId, (x) => x.promo_payout_state === 'FAILED');
    mode = {};
    assert.equal(r.promo_payout_state, 'FAILED');
    assert.match(r.promo_payout_note, /Salio la NAYA kwenye Abliner halitoshi/);
  });

  it('kikomo cha TSh 10,000 kwa dereva kwa siku (Dar es Salaam): kinazuia moja kwa moja NA "Tuma" ya ofisi', async () => {
    // Leo ameshatumiwa 1,500 (SUCCESS) — ongeza 7,500 nyingine zilizothibitishwa leo
    await db.query(
      `INSERT INTO naya.payments (kind, direction, user_id, amount, network, phone, provider, reference, status, completed_at)
       VALUES ('PROMO_PAYOUT', 'OUT', $1, 7500, 'MPESA', $2, 'abliner', $3, 'SUCCESS', now())`,
      [ids.d1, `255764${s}`, `NYOTEST${s}`],
    );
    const rideId = await promoRide('d1'); // 9,000 + 1,500 > 10,000
    const r = await rideState(rideId, (x) => x.promo_payout_state !== null);
    assert.equal(r.promo_payout_state, 'HELD');
    assert.match(r.promo_payout_note, /Kikomo cha malipo ya simu kwa dereva kwa siku \(TSh 10,000\)/);
    const approve = await call('POST', `/api/admin/payments/rides/${rideId}/approve`, {}, 'admin');
    assert.equal(approve.status, 409);
    assert.match(approve.json.message, /Kikomo/);
    // Jana haihesabiwi: malipo ya jana (saa za Dar) hayazuii
    await db.query(`UPDATE naya.payments SET created_at = (date_trunc('day', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam') - interval '1 minute' WHERE user_id = $1 AND kind = 'PROMO_PAYOUT'`, [ids.d1]);
    assert.equal((await call('POST', `/api/admin/payments/rides/${rideId}/approve`, {}, 'admin')).status, 200);
    assert.equal((await ride(rideId)).promo_payout_state, 'PENDING');
  });

  it('bila PAYMENT_PROVIDER=abliner, webhook ya abliner → 404 (hakuna kinachochakatwa)', async () => {
    process.env.PAYMENT_PROVIDER = 'none';
    assert.equal((await webhook('transaction.completed', { status: 'completed', customer_reference: 'x' })).status, 404);
    process.env.PAYMENT_PROVIDER = 'abliner';
  });
});
