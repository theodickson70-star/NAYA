// Tests za Phase 11: Ofisi kuu — msaada, watumiaji, matangazo, ramani, kuingilia safari, ripoti, utafutaji.
// Database ya MAJARIBIO tu:  DATABASE_URL=... JWT_SECRET=... npm test
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6);
const PASSWORD = 'NayaTest#2026';
const userIds: string[] = [];
const locationIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const phones: Record<string, string> = {};
let ip = 0;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.11.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  let json: any = null;
  try {
    json = res.json();
  } catch {
    json = res.body;
  }
  return { status: res.statusCode, json, headers: res.headers, body: res.body };
}

const A = { lat: -5.07, lng: 32.05 };
const B = { lat: -5.085, lng: 32.06 };

async function login(key: string, password = PASSWORD) {
  const portal = key === 'admin' ? 'admin' : 'app';
  return call('POST', '/api/auth/login', { phone: phones[key], password, portal });
}

async function makeUser(key: string, phone: string, name: string, role = 'USER', mode: string | null = 'PASSENGER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [`255${phone.slice(1)}`, name, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  phones[key] = phone;
  userIds.push(row.rows[0].id);
  tokens[key] = (await login(key)).json.data.token;
}

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  for (const [name, p] of [[`Ofisi Pickup ${s}`, A], [`Ofisi Dest ${s}`, B]] as const) {
    const row = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(row.rows[0].id);
  }
  await db.query('DELETE FROM naya.fare_rules');
  await db.query(`INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES ('BODABODA', 1000, 500, 1500, 100, 1.3)`);
  await db.query('UPDATE naya.drivers SET is_online = false'); // database ya majaribio: madereva wa tests nyingine wasiingilie
  await makeUser('admin', `0693${s}`, 'Msimamizi Kuu', 'ADMIN', null);
  await makeUser('p1', `0750${s}`, `Mteja Ofisi ${s}`);
  await makeUser('d1', `0751${s}`, `Dereva Ofisi ${s}`, 'USER', 'DRIVER');
  await makeUser('d2', `0752${s}`, `Dereva Pili ${s}`, 'USER', 'DRIVER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
     VALUES ($1, 'APPROVED', 'BODABODA', $3, 'Boxer', 'Nyekundu', 'DL1', now() + interval '30 days'),
            ($2, 'APPROVED', 'BODABODA', $4, 'TVS', 'Bluu', 'DL2', now() + interval '30 days')`,
    [ids.d1, ids.d2, `MC ${s.slice(-3)} OFA`, `MC ${s.slice(-3)} OFB`],
  );
});

after(async () => {
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.broadcasts WHERE created_by = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

describe('NAYA Phase 11 — Msaada (malalamiko)', () => {
  let ticketId = '';

  it('mteja anaripoti tatizo; uhakiki wa aina na ujumbe', async () => {
    assert.equal((await call('POST', '/api/support', { category: 'HAPANA', message: 'Tatizo' }, 'p1')).status, 400);
    assert.equal((await call('POST', '/api/support', { category: 'APP', message: 'abc' }, 'p1')).status, 400);
    const res = await call('POST', '/api/support', { category: 'LOST_ITEM', message: 'Nimesahau simu kwenye bodaboda ya jana jioni.' }, 'p1');
    assert.equal(res.status, 201, res.json.message);
    ticketId = res.json.data.id;
    assert.equal(res.json.data.status, 'OPEN');
    assert.equal(res.json.data.messages.length, 1);
    assert.match(res.json.data.subject, /Nimesahau kitu/);
    // mtu mwingine haoni tiketi hii
    assert.equal((await call('GET', `/api/support/${ticketId}`, undefined, 'd1')).status, 404);
  });

  it('ofisi inaona, inajibu; mteja anaona jibu (bila jina la mfanyakazi) na alama ya "haijasomwa"', async () => {
    assert.equal((await call('GET', '/api/admin/support', undefined, 'p1')).status, 403);
    const list = await call('GET', '/api/admin/support?status=OPEN', undefined, 'admin');
    assert.ok(list.json.data.tickets.some((t: any) => t.id === ticketId));
    assert.ok(list.json.data.counts.OPEN >= 1);
    const dash = await call('GET', '/api/admin/dashboard', undefined, 'admin');
    assert.ok(dash.json.data.supportOpen >= 1);

    const reply = await call('POST', `/api/admin/support/${ticketId}/reply`, { body: 'Tumempata dereva, simu yako iko ofisini Stendi Kuu.' }, 'admin');
    assert.equal(reply.status, 200);
    assert.equal(reply.json.data.status, 'ANSWERED');
    assert.equal(reply.json.data.messages.at(-1).authorName, 'Msimamizi Kuu');

    assert.equal((await call('GET', '/api/account', undefined, 'p1')).json.data.supportUnread, 1);
    const mine = await call('GET', `/api/support/${ticketId}`, undefined, 'p1');
    assert.equal(mine.json.data.messages.at(-1).fromStaff, true);
    assert.equal(mine.json.data.messages.at(-1).authorName, undefined);
    assert.equal((await call('GET', '/api/account', undefined, 'p1')).json.data.supportUnread, 0, 'kufungua kunaondoa alama');
    const note = await db.query(`SELECT title FROM naya.notifications WHERE user_id = $1 AND kind = 'support_reply'`, [ids.p1]);
    assert.equal(note.rows[0].title, 'Ofisi ya NAYA imekujibu');
  });

  it('mteja akiandika tena tiketi inarudi OPEN; ofisi inaitatua', async () => {
    const r = await call('POST', `/api/support/${ticketId}/reply`, { body: 'Asante, nitakuja kesho asubuhi.' }, 'p1');
    assert.equal(r.json.data.status, 'OPEN');
    const done = await call('POST', `/api/admin/support/${ticketId}/reply`, { body: '', resolve: true }, 'admin');
    assert.equal(done.json.data.status, 'RESOLVED');
    assert.ok(done.json.data.resolvedAt);
  });
});

describe('NAYA Phase 11 — Watumiaji', () => {
  it('kutafuta kwa jina, simu na plate; vichujio', async () => {
    const byName = await call('GET', `/api/admin/users?q=${encodeURIComponent(`Mteja Ofisi ${s}`)}`, undefined, 'admin');
    assert.equal(byName.json.data.users.length, 1);
    const byPhone = await call('GET', `/api/admin/users?q=${phones.p1}`, undefined, 'admin');
    assert.equal(byPhone.json.data.users[0].id, ids.p1);
    const byPlate = await call('GET', `/api/admin/users?q=${encodeURIComponent(`${s.slice(-3)} OFA`)}`, undefined, 'admin');
    assert.equal(byPlate.json.data.users[0].id, ids.d1);
    const drivers = await call('GET', `/api/admin/users?filter=DRIVERS&q=${encodeURIComponent(`Ofisi ${s}`)}`, undefined, 'admin');
    assert.deepEqual(drivers.json.data.users.map((u: any) => u.id), [ids.d1]);
    assert.ok(drivers.json.data.counts.ALL >= 3);
    assert.equal((await call('GET', '/api/admin/users', undefined, 'p1')).status, 403);
  });

  it('maelezo kamili ya mtumiaji: safari, tiketi, maelezo ya ndani', async () => {
    await call('POST', `/api/admin/users/${ids.p1}/notes`, { body: 'Alipiga simu ofisini kuhusu simu iliyosahaulika.' }, 'admin');
    const d = await call('GET', `/api/admin/users/${ids.p1}`, undefined, 'admin');
    assert.equal(d.status, 200);
    assert.equal(d.json.data.user.fullName, `Mteja Ofisi ${s}`);
    assert.equal(d.json.data.tickets.length, 1);
    assert.equal(d.json.data.notes[0].authorName, 'Msimamizi Kuu');
    assert.equal(d.json.data.user.password_hash, undefined);
    assert.equal((await call('GET', `/api/admin/users/${ids.admin}`, undefined, 'admin')).status, 404, 'akaunti za ofisi hazipo hapa');
  });

  it('kuthibitisha namba kwa mkono, na kumtumia ujumbe', async () => {
    await db.query('UPDATE naya.users SET phone_verified_at = NULL WHERE id = $1', [ids.p1]);
    const v = await call('POST', `/api/admin/users/${ids.p1}/verify-phone`, {}, 'admin');
    assert.ok(v.json.data.user.phoneVerifiedAt);
    const m = await call('POST', `/api/admin/users/${ids.p1}/message`, { body: 'Karibu NAYA!', sms: true }, 'admin');
    assert.equal(m.status, 200);
    assert.equal(m.json.data.smsSent, false, 'SMS zimezimwa kwenye majaribio');
    const n = await db.query(`SELECT body FROM naya.notifications WHERE user_id = $1 AND kind = 'office_message'`, [ids.p1]);
    assert.equal(n.rows[0].body, 'Karibu NAYA!');
  });

  it('password ya muda: bila SMS inaonyeshwa kwa msimamizi mara moja; ya zamani haifanyi kazi', async () => {
    const r = await call('POST', `/api/admin/users/${ids.p1}/temp-password`, {}, 'admin');
    assert.equal(r.status, 200);
    const temp = r.json.data.temporaryPassword;
    assert.match(temp, /^[a-z2-9]{8}$/);
    assert.equal((await login('p1')).status, 401);
    const ok = await login('p1', temp);
    assert.equal(ok.status, 200);
    tokens.p1 = ok.json.data.token;
    // rudisha password ya majaribio
    await db.query('UPDATE naya.users SET password_hash = $2 WHERE id = $1', [ids.p1, await hashPassword(PASSWORD)]);
    tokens.p1 = (await login('p1')).json.data.token;
  });

  it('kumsimamisha: anatolewa papo hapo, hawezi kuingia; kumrudisha', async () => {
    assert.equal((await call('POST', `/api/admin/users/${ids.d2}/suspend`, { reason: '' }, 'admin')).status, 400);
    await call('POST', '/api/driver/online', { online: true, ...A }, 'd2');
    const sus = await call('POST', `/api/admin/users/${ids.d2}/suspend`, { reason: 'Malalamiko ya wateja' }, 'admin');
    assert.equal(sus.status, 200, sus.json.message);
    assert.equal(sus.json.data.user.status, 'SUSPENDED');
    assert.equal(sus.json.data.driver.online, false);
    assert.equal((await call('GET', '/api/account', undefined, 'd2')).status, 401, 'token ya zamani imekufa');
    assert.equal((await login('d2')).status, 403);
    const back = await call('POST', `/api/admin/users/${ids.d2}/reactivate`, {}, 'admin');
    assert.equal(back.json.data.user.status, 'ACTIVE');
    const again = await login('d2');
    assert.equal(again.status, 200);
    tokens.d2 = again.json.data.token;
  });
});

describe('NAYA Phase 11 — ramani, kuingilia safari, matangazo, ripoti, utafutaji', () => {
  let rideId = '';

  it('ramani: dereva online na safari inayotafuta zinaonekana', async () => {
    await call('POST', '/api/driver/online', { online: true, ...A }, 'd1');
    // d2 yuko online lakini mbali (km ~15) — dispatch ya kawaida haitampa
    await call('POST', '/api/driver/online', { online: true, lat: -5.2, lng: 32.05 }, 'd2');
    await call('POST', '/api/driver/online', { online: false }, 'd1');
    const ride = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
    assert.equal(ride.status, 201, ride.json.message);
    rideId = ride.json.data.id;
    const live = await call('GET', '/api/admin/live', undefined, 'admin');
    assert.ok(live.json.data.drivers.some((d: any) => d.id === ids.d2 && typeof d.lat === 'number'));
    const r = live.json.data.rides.find((x: any) => x.id === rideId);
    assert.equal(r.status, 'SEARCHING');
  });

  it('ofisi inampa dereva maalum ombi (hata akiwa mbali); kengele inapigwa kama kawaida', async () => {
    const cands = await call('GET', `/api/admin/rides/${rideId}/candidates`, undefined, 'admin');
    const d2 = cands.json.data.find((c: any) => c.id === ids.d2);
    assert.ok(d2, JSON.stringify(cands.json.data));
    assert.ok(d2.km > 10);
    const offered = await call('POST', `/api/admin/rides/${rideId}/offer`, { driverId: ids.d2 }, 'admin');
    assert.equal(offered.status, 200, offered.json.message);
    const st = (await call('GET', '/api/driver/state', undefined, 'd2')).json.data;
    assert.equal(st.offer.ride.id, rideId);
    const accept = await call('POST', `/api/driver/offers/${st.offer.id}/accept`, {}, 'd2');
    assert.equal(accept.status, 200, accept.json.message);
    // dereva aliyeshughulika hawezi kupewa tena
    assert.equal((await call('POST', `/api/admin/rides/${rideId}/offer`, { driverId: ids.d2 }, 'admin')).status, 409);
  });

  it('safari iliyokwama: ofisi inaimaliza ikiwa imeanza tu', async () => {
    assert.equal((await call('POST', `/api/admin/rides/${rideId}/complete`, {}, 'admin')).status, 409);
    const pin = (await db.query('SELECT start_pin FROM naya.rides WHERE id = $1', [rideId])).rows[0].start_pin;
    await call('POST', `/api/driver/rides/${rideId}/arrive`, {}, 'd2');
    const started = await call('POST', `/api/driver/rides/${rideId}/start`, { pin }, 'd2');
    assert.equal(started.status, 200, started.json.message);
    const done = await call('POST', `/api/admin/rides/${rideId}/complete`, { note: 'Dereva alisahau kubonyeza Maliza' }, 'admin');
    assert.equal(done.status, 200, done.json.message);
    assert.equal(done.json.data.status, 'COMPLETED');
  });

  it('tangazo kwa madereva walio online: wanapokea arifa', async () => {
    const info = await call('GET', '/api/admin/broadcasts', undefined, 'admin');
    assert.ok(info.json.data.sizes.ONLINE_DRIVERS >= 1);
    const sent = await call('POST', '/api/admin/broadcasts', { audience: 'ONLINE_DRIVERS', title: 'Mvua leo', body: 'Endesheni kwa uangalifu.' }, 'admin');
    assert.equal(sent.status, 201, sent.json.message);
    assert.ok(sent.json.data.recipients >= 1);
    let got = 0;
    for (let i = 0; i < 50 && !got; i++) {
      got = (await db.query(`SELECT 1 FROM naya.notifications WHERE user_id = $1 AND kind = 'broadcast' AND title = 'Mvua leo'`, [ids.d2])).rowCount ?? 0;
      if (!got) await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(got, 1);
    const history = await call('GET', '/api/admin/broadcasts', undefined, 'admin');
    assert.equal(history.json.data.history[0].title, 'Mvua leo');
  });

  it('ripoti ya siku 7 na CSV ya safari', async () => {
    const r = await call('GET', '/api/admin/reports?days=7', undefined, 'admin');
    assert.equal(r.json.data.days.length, 7);
    assert.ok(r.json.data.totals.completed >= 1);
    assert.ok(Array.isArray(r.json.data.topDrivers) && Array.isArray(r.json.data.hours));
    const csv = await call('GET', '/api/admin/reports/rides.csv?days=7', undefined, 'admin');
    assert.equal(csv.status, 200);
    assert.match(String(csv.headers['content-type']), /text\/csv/);
    assert.match(csv.body, /Nauli \(TSh\)/);
    assert.ok(csv.body.includes(rideId));
    assert.equal((await call('GET', '/api/admin/reports/rides.csv', undefined, 'p1')).status, 403);
  });

  it('utafutaji mmoja: simu, plate na namba ya safari', async () => {
    const byPhone = await call('GET', `/api/admin/search?q=${phones.d2}`, undefined, 'admin');
    assert.equal(byPhone.json.data.users[0].id, ids.d2);
    const byRide = await call('GET', `/api/admin/search?q=${rideId.slice(0, 8)}`, undefined, 'admin');
    assert.equal(byRide.json.data.rides[0].id, rideId);
  });

  it('ofisi inamtoa dereva online', async () => {
    const r = await call('POST', `/api/admin/users/${ids.d2}/offline`, {}, 'admin');
    assert.equal(r.status, 200);
    assert.equal(r.json.data.driver.online, false);
    assert.equal((await call('POST', `/api/admin/users/${ids.d2}/offline`, {}, 'admin')).status, 409);
  });
});

describe('NAYA Phase 11.1 — Maoni', () => {
  let fid = '';
  it('abiria na dereva wanatoa maoni; uhakiki wa nyota', async () => {
    assert.equal((await call('POST', '/api/feedback', { rating: 0, body: 'Nzuri sana' }, 'p1')).status, 400);
    const p = await call('POST', '/api/feedback', { rating: 4, topic: 'PRICES', body: 'Bei ni nzuri, ila ongezeni bajaji usiku.' }, 'p1');
    assert.equal(p.status, 201, p.json.message);
    assert.equal(p.json.data.status, 'NEW');
    fid = p.json.data.id;
    const d = await call('POST', '/api/feedback', { rating: 5, body: 'Kengele ya maombi inasaidia sana.' }, 'd1');
    assert.equal(d.json.data.role, 'DRIVER');
    assert.equal((await call('GET', '/api/feedback', undefined, 'p1')).json.data.length, 1);
  });

  it('ofisi inaona maoni mapya, wastani wa nyota, na kuyafanyia kazi; mtoaji anajulishwa', async () => {
    const list = await call('GET', '/api/admin/feedback?status=NEW', undefined, 'admin');
    assert.ok(list.json.data.items.some((f: any) => f.id === fid));
    assert.ok(list.json.data.summary.NEW >= 2);
    assert.equal(typeof list.json.data.summary.avg30, 'number');
    assert.ok((await call('GET', '/api/admin/dashboard', undefined, 'admin')).json.data.feedbackNew >= 2);
    assert.equal((await call('GET', '/api/admin/feedback', undefined, 'p1')).status, 403);
    const acted = await call('POST', `/api/admin/feedback/${fid}`, { status: 'ACTED', note: 'Tumeongeza bajaji 2 za usiku kuanzia wiki hii.' }, 'admin');
    assert.equal(acted.status, 200, acted.json.message);
    assert.equal(acted.json.data.status, 'ACTED');
    assert.equal(acted.json.data.handledBy, 'Msimamizi Kuu');
    const mine = (await call('GET', '/api/feedback', undefined, 'p1')).json.data[0];
    assert.equal(mine.officeNote, 'Tumeongeza bajaji 2 za usiku kuanzia wiki hii.');
    const n = await db.query(`SELECT title FROM naya.notifications WHERE user_id = $1 AND kind = 'feedback_reply'`, [ids.p1]);
    assert.equal(n.rows[0].title, 'Tumefanyia kazi maoni yako');
  });

  it('maoni ya safari (nyota za abiria) yanaonekana ofisini', async () => {
    const r = await call('GET', '/api/admin/ride-comments?all=1', undefined, 'admin');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json.data));
  });
});
