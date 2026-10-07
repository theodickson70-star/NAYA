// Tests za Phase 10: app ya Android (APK) — usajili wa simu na Firebase Cloud Messaging (FCM).
// Hakuna kinachotumwa kwa Google: "service account" ni ya majaribio (ufunguo wa RSA uliotengenezwa hapa),
// na fetch inanaswa ili tuhakiki JWT, OAuth na ujumbe wa FCM kama Google ingeupokea.
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const SA = {
  type: 'service_account',
  project_id: 'naya-majaribio',
  client_email: 'fcm@naya-majaribio.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.googleapis.com/token',
};
// Kama Railway: JSON nzima (hapa kama base64 ili kuhakiki njia hiyo pia).
process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(JSON.stringify(SA)).toString('base64');

const { buildApp } = await import('../src/app.js');
const { db } = await import('../src/db/pool.js');
const { runMigrations } = await import('../src/db/migrate.js');
const { hashPassword } = await import('../src/services/auth.js');
const { env } = await import('../src/config/env.js');

// ------------------------------------------------------------------ Google ya bandia
interface Sent {
  token: string;
  data: Record<string, string>;
  android: { priority: string; ttl: string };
}
const sent: Sent[] = [];
let oauthCalls = 0;
const DEAD = 'dead-token-'.padEnd(40, 'x');
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === SA.token_uri) {
    oauthCalls += 1;
    const form = new URLSearchParams(String(init?.body));
    assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    const [h, c, sig] = form.get('assertion')!.split('.');
    const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'));
    assert.ok(ok, 'sahihi ya JWT si sahihi');
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    assert.equal(claims.iss, SA.client_email);
    assert.equal(claims.aud, SA.token_uri);
    assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
    return Response.json({ access_token: 'ya29.majaribio', expires_in: 3600 });
  }
  const m = /^https:\/\/fcm\.googleapis\.com\/v1\/projects\/([^/]+)\/messages:send$/.exec(url);
  if (m) {
    assert.equal(m[1], SA.project_id);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer ya29.majaribio');
    const { message } = JSON.parse(String(init?.body));
    assert.equal(message.notification, undefined, 'data messages tu — simu inaamua jinsi ya kulia');
    for (const v of Object.values(message.data)) assert.equal(typeof v, 'string');
    sent.push({ token: message.token, data: message.data, android: message.android });
    if (message.token === DEAD) return Response.json({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 });
    return Response.json({ name: `projects/${SA.project_id}/messages/1` });
  }
  return realFetch(input, init);
}) as typeof fetch;

// ------------------------------------------------------------------ Mazingira
let app: FastifyInstance;
const s = String(Date.now()).slice(-6);
const PASSWORD = 'NayaTest#2026';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
const userIds: string[] = [];
const locationIds: string[] = [];
const phoneTok = (key: string) => `fcm-${key}-${s}:`.padEnd(60, 'A');
let ip = 0;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.10.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

async function makeUser(key: string, phone: string, role = 'USER', mode: string | null = 'PASSENGER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`255${phone.slice(1)}`, `Mtumiaji ${key}`, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  await login(key, phone, role);
}
async function login(key: string, phone: string, role = 'USER') {
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: role === 'USER' ? 'app' : 'admin' })).json.data.token;
}

async function waitFor(pred: () => Sent | undefined, what: string) {
  for (let i = 0; i < 100; i++) {
    const hit = pred();
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`haikufika: ${what} — ${JSON.stringify(sent.map((x) => x.data.type))}`);
}

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  for (const [name, lat, lng] of [[`FCM Pickup ${s}`, -5.07, 32.05], [`FCM Dest ${s}`, -5.085, 32.06]] as const) {
    const row = await db.query(`INSERT INTO naya.locations (name, lat, lng) VALUES ($1, $2, $3) RETURNING id`, [name, lat, lng]);
    locationIds.push(row.rows[0].id);
  }
  await db.query('DELETE FROM naya.fare_rules');
  await db.query(`INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare) VALUES ('BODABODA', 1000, 500, 1500)`);
  await makeUser('admin', `0692${s}`, 'ADMIN', null);
  await makeUser('passenger', `0740${s}`);
  await makeUser('driver', `0741${s}`, 'USER', 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
     VALUES ($1, 'APPROVED', 'BODABODA', $2, 'Boxer', 'Bluu', 'DL1', now() + interval '30 days')`,
    [ids.driver, `MC ${s.slice(-3)} FCM`],
  );
});

after(async () => {
  globalThis.fetch = realFetch;
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

describe('NAYA Phase 10 — app ya Android (FCM)', () => {
  it('FIREBASE_SERVICE_ACCOUNT inasomwa (base64) na private key haitoki nje', async () => {
    assert.equal(env.firebaseServiceAccount?.projectId, SA.project_id);
    const res = await call('GET', '/api/push/fcm', undefined, 'driver');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data, { enabled: true });
    assert.deepEqual((await call('GET', '/api/push/fcm')).json.data, { enabled: true }); // ndiyo/hapana tu, kama public-key
  });

  it('kusajili simu: token mbaya inakataliwa, sahihi inahifadhiwa', async () => {
    assert.equal((await call('POST', '/api/push/fcm', { token: 'fupi' }, 'driver')).status, 400);
    assert.equal((await call('POST', '/api/push/fcm', { token: 'a b c <script>'.padEnd(40, 'x') }, 'driver')).status, 400);
    assert.equal((await call('POST', '/api/push/fcm', { token: phoneTok('driver') })).status, 401);
    const ok = await call('POST', '/api/push/fcm', { token: phoneTok('driver'), appVersion: '1.0.7' }, 'driver');
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.data, { registered: true, enabled: true });
    const row = await db.query('SELECT user_id, app_version FROM naya.fcm_tokens WHERE token = $1', [phoneTok('driver')]);
    assert.equal(row.rows[0].user_id, ids.driver);
    assert.equal(row.rows[0].app_version, '1.0.7');
  });

  it('ombi jipya: simu ya dereva inapata "offer" ya haraka (kengele) yenye muda wa kuisha', async () => {
    await call('POST', '/api/driver/online', { online: true, lat: -5.0702, lng: 32.0501 }, 'driver');
    const before = Date.now();
    const ride = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'passenger');
    assert.equal(ride.status, 201, ride.json?.message);
    const offer = await waitFor(() => sent.find((m) => m.data.type === 'offer'), 'offer');
    assert.equal(offer.token, phoneTok('driver'));
    assert.equal(offer.data.rideId, ride.json.data.id);
    assert.equal(offer.data.title, 'Ombi jipya la safari');
    assert.match(offer.data.body, /TSh/);
    assert.equal(offer.android.priority, 'HIGH');
    assert.equal(offer.android.ttl, '60s');
    const expires = Number(offer.data.expiresAt);
    assert.ok(expires >= before + 59_000 && expires <= Date.now() + 61_000, `expiresAt ${expires}`);
    assert.equal(oauthCalls, 1);

    // Abiria akighairi → simu ya dereva inyamaze.
    const cancel = await call('POST', `/api/rides/${ride.json.data.id}/cancel`, { reason: 'Nimebadili mpango' }, 'passenger');
    assert.equal(cancel.status, 200, cancel.json?.message);
    const stop = await waitFor(() => sent.find((m) => m.data.type === 'offer_cancel'), 'offer_cancel');
    assert.equal(stop.data.rideId, ride.json.data.id);
    assert.equal(stop.token, phoneTok('driver'));
    assert.equal(oauthCalls, 1, 'access token ya Google inatumika tena (cache)');
    await call('POST', `/api/rides/${ride.json.data.id}/close`, {}, 'passenger');
  });

  it('taarifa za kawaida zinaenda kama "notice"; abiria hapati ujumbe wa dereva', async () => {
    await call('POST', '/api/push/fcm', { token: phoneTok('passenger') }, 'passenger');
    sent.length = 0;
    await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'passenger');
    await waitFor(() => sent.find((m) => m.data.type === 'offer'), 'offer');
    const offerId = (await call('GET', '/api/driver/state', undefined, 'driver')).json.data.offer.id;
    assert.equal((await call('POST', `/api/driver/offers/${offerId}/accept`, {}, 'driver')).status, 200);
    const found = await waitFor(() => sent.find((m) => m.token === phoneTok('passenger') && m.data.type === 'notice'), 'notice');
    assert.equal(found.data.title, 'Dereva amepatikana');
    assert.equal(found.data.tag, 'driver_found');
    assert.equal(found.android.priority, 'HIGH');
    assert.equal(sent.some((m) => m.token === phoneTok('passenger') && m.data.type === 'offer'), false);
  });

  it('token iliyokufa (app imefutwa) inaondolewa; token ikihamia mtumiaji mwingine inafuata aliyeingia', async () => {
    await call('POST', '/api/push/fcm', { token: DEAD }, 'driver');
    sent.length = 0;
    const { sendFcm } = await import('../src/services/fcm.js');
    const delivered = await sendFcm(ids.driver, { data: { type: 'notice', title: 'Jaribio' }, urgent: false, ttlSeconds: 60 });
    assert.equal(delivered, 1);
    assert.equal((await db.query('SELECT 1 FROM naya.fcm_tokens WHERE token = $1', [DEAD])).rowCount, 0);

    // simu ile ile, mtu mwingine ameingia
    await call('POST', '/api/push/fcm', { token: phoneTok('driver') }, 'passenger');
    const owner = await db.query('SELECT user_id FROM naya.fcm_tokens WHERE token = $1', [phoneTok('driver')]);
    assert.equal(owner.rows[0].user_id, ids.passenger);
    await call('POST', '/api/push/fcm', { token: phoneTok('driver') }, 'driver');
  });

  it('ofisi inaona idadi ya madereva wenye app', async () => {
    const dash = await call('GET', '/api/admin/dashboard', undefined, 'admin');
    assert.equal(dash.status, 200);
    assert.equal(dash.json.data.app.enabled, true);
    assert.ok(dash.json.data.app.drivers >= 1);
  });

  it('kuondoa simu moja, na kutoka (logout) kunafuta simu zote za mtumiaji', async () => {
    await call('POST', '/api/push/fcm', { token: phoneTok('driver2') }, 'driver');
    assert.equal((await call('POST', '/api/push/fcm/remove', { token: phoneTok('driver2') }, 'driver')).status, 200);
    assert.equal((await db.query('SELECT 1 FROM naya.fcm_tokens WHERE token = $1', [phoneTok('driver2')])).rowCount, 0);
    assert.equal((await db.query('SELECT 1 FROM naya.fcm_tokens WHERE user_id = $1', [ids.driver])).rowCount, 1);
    assert.equal((await call('POST', '/api/auth/logout', {}, 'driver')).status, 200);
    assert.equal((await db.query('SELECT 1 FROM naya.fcm_tokens WHERE user_id = $1', [ids.driver])).rowCount, 0);
  });
});
