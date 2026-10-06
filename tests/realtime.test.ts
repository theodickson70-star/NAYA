// Tests za Phase 7: taarifa za papo hapo (SSE + Postgres LISTEN/NOTIFY), arifa na Web Push.
// Database ya MAJARIBIO tu:  DATABASE_URL=... JWT_SECRET=... npm test
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { startListener, stopListener } from '../src/realtime/hub.js';
import { hashPassword } from '../src/services/auth.js';
import { saveSubscription, setPushSenderForTests } from '../src/services/push.js';

let app: FastifyInstance;
let base = '';
const s = String(Date.now()).slice(-6);
const PASSWORD = 'NayaTest#2026';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
const userIds: string[] = [];
const locationIds: string[] = [];
const streams: Stream[] = [];

interface SseEvent {
  type: string;
  data: any;
}
interface Stream {
  events: SseEvent[];
  waitFor: (type: string, timeoutMs?: number) => Promise<SseEvent>;
  close: () => void;
}

async function http(method: string, url: string, body?: unknown, who?: string) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

/** Fungua /api/stream kama app inavyofanya (tiketi → EventSource) na kusanya matukio. */
async function openStream(who: string): Promise<Stream> {
  const ticket = (await http('POST', '/api/stream/ticket', undefined, who)).json.data.ticket;
  const controller = new AbortController();
  const res = await fetch(`${base}/api/stream?ticket=${encodeURIComponent(ticket)}`, { signal: controller.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const events: SseEvent[] = [];
  const waiters: Array<() => void> = [];
  (async () => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const type = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (type && data) {
            events.push({ type, data: JSON.parse(data) });
            waiters.splice(0).forEach((w) => w());
          }
        }
      }
    } catch {
      // stream imefungwa
    }
  })();
  const stream: Stream = {
    events,
    waitFor: (type, timeoutMs = 3000) =>
      new Promise((resolve, reject) => {
        const seen = events.length;
        const check = () => {
          const hit = events.slice(seen).find((e) => e.type === type) ?? null;
          if (hit) {
            clearTimeout(timer);
            resolve(hit);
          } else waiters.push(check);
        };
        const timer = setTimeout(() => reject(new Error(`hakuna tukio "${type}" ndani ya ${timeoutMs}ms`)), timeoutMs);
        check();
      }),
    close: () => controller.abort(),
  };
  streams.push(stream);
  await stream.waitFor('ready').catch(() => {});
  return stream;
}

async function makeUser(key: string, phone: string, role = 'USER', mode: string | null = 'PASSENGER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`255${phone.slice(1)}`, `Mtumiaji ${key}`, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  tokens[key] = (await http('POST', '/api/auth/login', { phone, password: PASSWORD, portal: role === 'USER' ? 'app' : 'admin' })).json.data.token;
}

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  await startListener({ info: () => {}, warn: () => {} });

  for (const [name, lat, lng] of [[`RT Pickup ${s}`, -5.07, 32.05], [`RT Dest ${s}`, -5.085, 32.06]] as const) {
    const row = await db.query(`INSERT INTO naya.locations (name, lat, lng) VALUES ($1, $2, $3) RETURNING id`, [name, lat, lng]);
    locationIds.push(row.rows[0].id);
  }
  await db.query('DELETE FROM naya.fare_rules');
  await db.query(`INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare) VALUES ('BODABODA', 1000, 500, 1500)`);
  await makeUser('admin', `0691${s}`, 'ADMIN', null);
  await makeUser('passenger', `0730${s}`);
  await makeUser('driver', `0731${s}`, 'USER', 'DRIVER');
  await makeUser('applicant', `0732${s}`, 'USER', 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number)
     VALUES ($1, 'APPROVED', 'BODABODA', $2, 'Boxer', 'Bluu', 'DL1'), ($3, 'PENDING', 'BODABODA', $4, 'TVS', 'Nyeusi', 'DL2')`,
    [ids.driver, `MC ${s.slice(-3)} RTA`, ids.applicant, `MC ${s.slice(-3)} RTB`],
  );
});

after(async () => {
  for (const st of streams) st.close();
  setPushSenderForTests(null);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  await db.query('UPDATE naya.drivers SET reviewed_by = NULL WHERE reviewed_by = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await stopListener();
  await app.close();
  await db.end();
});

describe('NAYA Phase 7 — realtime na arifa', () => {
  it('tiketi ya stream inahitaji kuingia; tiketi mbaya inakataliwa', async () => {
    assert.equal((await http('POST', '/api/stream/ticket')).status, 401);
    assert.equal((await fetch(`${base}/api/stream?ticket=si-tiketi-halisi-kabisa`)).status, 401);
  });

  it('tiketi ya stream haiwezi kutumika kama token ya kawaida', async () => {
    const ticket = (await http('POST', '/api/stream/ticket', undefined, 'passenger')).json.data.ticket;
    const res = await fetch(`${base}/api/account`, { headers: { authorization: `Bearer ${ticket}` } });
    assert.equal(res.status, 401);
  });

  it('safari: dereva anapata "offer", abiria "ride", ofisi "admin" — papo hapo', async () => {
    const driverStream = await openStream('driver');
    const passengerStream = await openStream('passenger');
    const adminStream = await openStream('admin');
    await http('POST', '/api/driver/online', { online: true, lat: -5.0702, lng: 32.0501 }, 'driver');

    const offerWait = driverStream.waitFor('offer');
    const adminWait = adminStream.waitFor('admin');
    const ride = await http('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'passenger');
    assert.equal(ride.status, 201, ride.json?.message);
    const offerEvent = await offerWait;
    assert.equal(offerEvent.data.rideId, ride.json.data.id);
    assert.deepEqual(Object.keys(offerEvent.data).sort(), ['rideId', 'type']); // hakuna data binafsi kwenye tukio
    await adminWait;

    const offerId = (await http('GET', '/api/driver/state', undefined, 'driver')).json.data.offer.id;
    const rideWait = passengerStream.waitFor('ride');
    await http('POST', `/api/driver/offers/${offerId}/accept`, {}, 'driver');
    assert.equal((await rideWait).data.rideId, ride.json.data.id);

    // matukio hayavuki mipaka: abiria hapati "offer" ya dereva
    assert.equal(passengerStream.events.some((e) => e.type === 'offer'), false);

    const arrivedWait = passengerStream.waitFor('ride');
    await http('POST', `/api/driver/rides/${ride.json.data.id}/arrive`, {}, 'driver');
    await arrivedWait;
  });

  it('tukio kutoka server nyingine (Postgres NOTIFY) linafika kupitia LISTEN', async () => {
    const stream = await openStream('applicant');
    const wait = stream.waitFor('account');
    await db.query('SELECT pg_notify($1, $2)', ['naya_events', JSON.stringify({ type: 'account', userId: ids.applicant, origin: 'server-nyingine' })]);
    const event = await wait;
    assert.equal(event.type, 'account');
  });

  it('baada ya kutoka, tiketi ya zamani haifungui stream', async () => {
    const ticket = (await http('POST', '/api/stream/ticket', undefined, 'applicant')).json.data.ticket;
    await http('POST', '/api/auth/logout', {}, 'applicant');
    assert.equal((await fetch(`${base}/api/stream?ticket=${encodeURIComponent(ticket)}`)).status, 401);
    tokens.applicant = (await http('POST', '/api/auth/login', { phone: `0732${s}`, password: PASSWORD, portal: 'app' })).json.data.token;
  });

  it('server bila funguo za VAPID: public key ni null na kujisajili kunakataliwa kwa ujumbe wazi', async () => {
    assert.equal((await http('GET', '/api/push/public-key')).json.data.publicKey, null);
    const sub = await http('POST', '/api/push/subscribe', { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'x'.repeat(40), auth: 'y'.repeat(16) } }, 'applicant');
    assert.equal(sub.status, 400);
    assert.match(sub.json.message, /Arifa/);
  });

  it('dereva akithibitishwa: arifa inahifadhiwa, Web Push inatumwa, na usajili uliokufa (410) unafutwa', async () => {
    const sent: Array<{ endpoint: string; payload: any; urgency: string }> = [];
    setPushSenderForTests(async (subscription, payload, options) => {
      sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload), urgency: options.urgency });
      if (subscription.endpoint.endsWith('/dead')) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      return {};
    });
    await saveSubscription(ids.applicant, { endpoint: 'https://push.example.com/alive', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } }, 'test');
    await saveSubscription(ids.applicant, { endpoint: 'https://push.example.com/dead', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } }, 'test');

    const stream = await openStream('applicant');
    const wait = stream.waitFor('account');
    assert.equal((await http('POST', `/api/admin/drivers/${ids.applicant}/approve`, {}, 'admin')).status, 200);
    await wait;

    assert.equal(sent.length, 2);
    assert.equal(sent[0].payload.title, 'Umethibitishwa kuwa dereva wa NAYA!');
    const left = await db.query('SELECT endpoint FROM naya.push_subscriptions WHERE user_id = $1', [ids.applicant]);
    assert.deepEqual(left.rows.map((r) => r.endpoint), ['https://push.example.com/alive']);

    const list = await http('GET', '/api/notifications', undefined, 'applicant');
    assert.equal(list.json.data[0].title, 'Umethibitishwa kuwa dereva wa NAYA!');
    assert.equal(list.json.data[0].readAt, null);
    await http('POST', '/api/notifications/read', {}, 'applicant');
    assert.notEqual((await http('GET', '/api/notifications', undefined, 'applicant')).json.data[0].readAt, null);
  });

  it('ombi la safari ni arifa ya haraka (urgency high)', async () => {
    const sent: Array<{ payload: any; urgency: string }> = [];
    setPushSenderForTests(async (_s, payload, options) => {
      sent.push({ payload: JSON.parse(payload), urgency: options.urgency });
      return {};
    });
    await saveSubscription(ids.applicant, { endpoint: 'https://push.example.com/driver2', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(16) } }, 'test');
    await http('POST', '/api/driver/online', { online: true, lat: -5.0703, lng: 32.0502 }, 'applicant');
    const ride = await http('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'passenger');
    // abiria wa kwanza bado ana safari inayoendelea → 409; tumia safari mpya ya abiria huyo baada ya kuimaliza
    if (ride.status === 409) {
      const current = (await http('GET', '/api/rides/current', undefined, 'passenger')).json.data;
      await http('POST', `/api/driver/rides/${current.id}/start`, {}, 'driver');
      await http('POST', `/api/driver/rides/${current.id}/complete`, {}, 'driver');
      await http('POST', `/api/rides/${current.id}/close`, {}, 'passenger');
      await http('POST', '/api/driver/online', { online: false }, 'driver'); // ombi liende kwa dereva mwenye push
      await http('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'passenger');
    }
    const offer = sent.find((m) => m.payload.title === 'Ombi jipya la safari');
    assert.ok(offer, `hakuna push ya ombi: ${JSON.stringify(sent.map((m) => m.payload.title))}`);
    assert.equal(offer.urgency, 'high');
    assert.match(offer.payload.body, /TSh/);
  });
});
