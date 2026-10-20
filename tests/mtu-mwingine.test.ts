// 0.25.0 Safari ya mtu mwingine: abiria anamwagizia mtu mwingine safari (jina + namba ya anayesafiri).
// Inakagua: uhakiki, dereva anaona/anampigia anayesafiri (si picha wala namba ya aliyeagiza), SMS kwa anayesafiri
// dereva akikubali (na link inayofanya kazi), link ya anayesafiri (/api/share mode RIDER), dharura kupitia link,
// SMS ya kughairi, na safari za kawaida hazibadiliki. SMS halisi hazitumwi (setSmsSenderForTests). DB ya majaribio tu.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { setSmsSenderForTests } from '../src/services/sms.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6).replace(/^0/, '1');
const PASSWORD = 'NayaTest#2026';
const userIds: string[] = [];
const locationIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const sent: Array<{ phone: string; message: string }> = [];
let ip = 0;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.78.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}
const intl = (local: string) => `255${local.slice(1)}`;
const A = { lat: -8.2, lng: 35.4 };
const B = { lat: -8.215, lng: 35.41 };
const RIDER_LOCAL = `0764${s}`;
const RIDER = intl(RIDER_LOCAL);

async function makeUser(key: string, phone: string, name: string, mode: string | null, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode, phone_verified_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [intl(phone), name, role, await hashPassword(PASSWORD), mode],
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
const book = (rider: unknown, who = 'p1') =>
  call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA', rider }, who);
const tokenOf = (link: string) => link.split('#')[1];

let pausedBefore: string[] = [];
let feeBefore: unknown = null;
before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  setSmsSenderForTests(async (phone, message) => {
    sent.push({ phone, message });
    return { ok: true, requestId: 'test' };
  });
  pausedBefore = (await db.query(`UPDATE naya.promotions SET status = 'PAUSED' WHERE status = 'ACTIVE' RETURNING id`)).rows.map((r) => r.id);
  feeBefore = (await db.query(`SELECT value FROM naya.settings WHERE key = 'subscription'`)).rows[0]?.value ?? null;
  await db.query(
    `INSERT INTO naya.settings (key, value) VALUES ('subscription', '{"monthlyFee": 5000, "trialDays": 30, "graceDays": 3, "paymentInstructions": "Lipa ofisini."}')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
  );
  for (const [name, p] of [[`Stendi M${s}`, A], [`Soko M${s}`, B]] as const) {
    const r = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(r.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 3000, 0, 3000, 100, 1.3), ('BAJAJI', 4000, 0, 4000, 100, 1.3)`,
  );
  await makeUser('admin', `0760${s}`, 'Ofisi Mwingine', null, 'ADMIN');
  await makeUser('p1', `0761${s}`, `Baraka Mwagizaji ${s}`, 'PASSENGER');
  await makeDriver('d1', `0763${s}`, `Juma Dereva ${s}`, `MC ${s.slice(-3)} MW1`);
  await db.query('UPDATE naya.users SET photo_file_id = NULL WHERE id = $1', [ids.p1]);
});

after(async () => {
  setSmsSenderForTests(null);
  await db.query('DELETE FROM naya.sos_alerts WHERE ride_id IN (SELECT id FROM naya.rides WHERE passenger_id = ANY($1::uuid[]))', [userIds]);
  await db.query('DELETE FROM naya.ride_offers WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[]) OR target_id = ANY($1::uuid[])', [userIds]);
  await db.query(`DELETE FROM naya.audit_logs WHERE action = 'sos.raised' AND actor_id IS NULL AND details->>'role' = 'RIDER' AND created_at > now() - interval '1 hour'`);
  await db.query('DELETE FROM naya.sms_log WHERE phone = ANY($1)', [[RIDER]]);
  await db.query(`DELETE FROM naya.sms_log WHERE phone IN (SELECT phone FROM naya.users WHERE id = ANY($1::uuid[]))`, [userIds]);
  await db.query(`UPDATE naya.promotions SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])`, [pausedBefore]);
  if (feeBefore) await db.query(`UPDATE naya.settings SET value = $1 WHERE key = 'subscription'`, [JSON.stringify(feeBefore)]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

describe('NAYA 0.25.0 — safari ya mtu mwingine', () => {
  it('uhakiki: jina na namba sahihi zinahitajika; namba yako mwenyewe inakataliwa', async () => {
    assert.equal((await book({ name: 'Neema', phone: '12345' })).status, 400);
    assert.equal((await book({ name: 'N', phone: RIDER_LOCAL })).status, 400);
    const own = await book({ name: 'Mimi Mwenyewe', phone: `0761${s}` });
    assert.equal(own.status, 400);
    assert.match(own.json.message, /namba yako/);
  });

  let rideId = '';
  let riderToken = '';
  it('kuagiza: aliyeagiza anaona anayesafiri + link; link inafanya kazi hata kabla ya dereva', async () => {
    const res = await book({ name: 'Mama Neema Juma', phone: RIDER_LOCAL });
    assert.equal(res.status, 201, res.json.message);
    rideId = res.json.data.id;
    const r = res.json.data;
    assert.equal(r.forOther, true);
    assert.equal(r.rider.name, 'Mama Neema Juma');
    assert.equal(r.rider.phone, RIDER);
    assert.equal(r.rider.smsSent, false);
    assert.match(r.rider.link, /^\/safari\/#[A-Za-z0-9_-]{32}$/);
    riderToken = tokenOf(r.rider.link);
    const row = (await db.query('SELECT rider_name, rider_phone, rider_token_hash FROM naya.rides WHERE id = $1', [rideId])).rows[0];
    assert.equal(row.rider_phone, RIDER);
    assert.ok(row.rider_token_hash, 'hash ya link imehifadhiwa');
    const view = await call('POST', '/api/share', { token: riderToken });
    assert.equal(view.status, 200, view.json.message);
    assert.equal(view.json.data.mode, 'RIDER');
    assert.equal(view.json.data.status, 'SEARCHING');
    assert.equal(view.json.data.passengerFirstName, 'Mama');
    assert.equal(view.json.data.bookedBy, 'Baraka');
    assert.equal(view.json.data.fare.paid, false);
  });

  it('dereva: ombi lina jina la anayesafiri na aliyeagiza; picha ya aliyeagiza haionyeshwi', async () => {
    // Dereva online karibu na mahali pa kuchukua; ombi linamfikia kupitia dispatch
    assert.equal((await call('POST', '/api/driver/online', { online: true, lat: A.lat - 0.0005, lng: A.lng }, 'd1')).status, 200);
    await call('GET', '/api/rides/current', undefined, 'p1'); // dispatch
    const st = (await call('GET', '/api/driver/state', undefined, 'd1')).json.data;
    assert.equal(st.offer?.ride.id, rideId, 'dereva hakupata ombi');
    assert.equal(st.offer.passenger.firstName, 'Mama');
    assert.equal(st.offer.passenger.bookedBy, 'Baraka');
    assert.equal(st.offer.passenger.hasPhoto, false);
    assert.equal(st.offer.ride.forOther, true);
    assert.equal((await call('GET', `/api/driver/rides/${rideId}/passenger-photo`, undefined, 'd1')).status, 404);

    const before = sent.length;
    const acc = await call('POST', `/api/driver/offers/${st.offer.id}/accept`, {}, 'd1');
    assert.equal(acc.status, 200, acc.json.message);
    const p = acc.json.data.ride.passenger;
    assert.equal(p.name, 'Mama Neema Juma');
    assert.equal(p.phone, RIDER, 'dereva anampigia anayesafiri');
    assert.equal(p.bookedBy, 'Baraka');

    const sms = sent.slice(before).filter((m) => m.phone === RIDER);
    assert.equal(sms.length, 1, 'anayesafiri amepata SMS moja');
    assert.match(sms[0].message, /Baraka amekuagizia bodaboda/);
    assert.match(sms[0].message, new RegExp(`MC ${s.slice(-3)} MW1`));
    assert.match(sms[0].message, new RegExp(`simu 0763${s}`));
    assert.ok(sms[0].message.includes(`/safari/#${riderToken}`), 'SMS ina link ile ile ya anayesafiri');
    const mine = (await call('GET', '/api/rides/current', undefined, 'p1')).json.data;
    assert.equal(mine.rider.smsSent, true);
  });

  it('link ya anayesafiri: dereva + simu yake; link ya "Shiriki safari" haina namba wala dharura', async () => {
    const view = (await call('POST', '/api/share', { token: riderToken })).json.data;
    assert.equal(view.status, 'ACCEPTED');
    assert.equal(view.driver.phone, intl(`0763${s}`));
    assert.equal(view.sosOpen, false);

    const shared = await call('POST', `/api/rides/${rideId}/share`, {}, 'p1');
    assert.equal(shared.status, 200);
    const shareToken = tokenOf(shared.json.data.path);
    const sv = (await call('POST', '/api/share', { token: shareToken })).json.data;
    assert.equal(sv.mode, 'SHARE');
    assert.equal(sv.driver.phone, undefined);
    assert.equal(sv.passengerFirstName, 'Mama', 'anayefuatiliwa ni anayesafiri');
    assert.equal((await call('POST', '/api/share/sos', { token: shareToken })).status, 404);
  });

  it('dharura kupitia link ya anayesafiri → ofisi inaona jina na namba yake, na aliyeagiza', async () => {
    const sos = await call('POST', '/api/share/sos', { token: riderToken, lat: -8.2001, lng: 35.4001 });
    assert.equal(sos.status, 201, sos.json.message);
    assert.equal((await call('POST', '/api/share/sos', { token: riderToken })).status, 200, 'kubonyeza tena hakuleti nakala');
    const row = (await db.query('SELECT user_id, role FROM naya.sos_alerts WHERE ride_id = $1', [rideId])).rows;
    assert.equal(row.length, 1);
    assert.equal(row[0].role, 'RIDER');
    assert.equal(row[0].user_id, ids.p1);
    const list = (await call('GET', '/api/admin/sos', undefined, 'admin')).json.data;
    const a = list.find((x: any) => x.rideId === rideId);
    assert.equal(a.name, 'Mama Neema Juma');
    assert.equal(a.phone, RIDER);
    assert.equal(a.emergencyPhone, intl(`0761${s}`));
    assert.match(a.emergencyName, /Baraka/);
    assert.equal(a.otherPhone, intl(`0763${s}`), 'dereva');
    assert.equal((await call('POST', '/api/share', { token: riderToken })).json.data.sosOpen, true);
    await db.query(`UPDATE naya.sos_alerts SET status = 'RESOLVED', resolved_at = now() WHERE ride_id = $1`, [rideId]);
  });

  it('ofisi: safari inaonyesha aliyeagiza na anayesafiri', async () => {
    const r = (await call('GET', `/api/admin/rides/${rideId}`, undefined, 'admin')).json.data;
    assert.equal(r.passenger.id, ids.p1);
    assert.equal(r.rider.name, 'Mama Neema Juma');
    assert.ok(r.rider.smsAt);
    const list = (await call('GET', '/api/admin/rides?scope=active', undefined, 'admin')).json.data;
    assert.equal(list.find((x: any) => x.id === rideId)?.riderName, 'Mama Neema Juma');
  });

  it('aliyeagiza akighairi → anayesafiri anapata SMS "imeghairiwa"; link inaonyesha imeghairiwa', async () => {
    const before = sent.length;
    const res = await call('POST', `/api/rides/${rideId}/cancel`, { reason: 'Amepata usafiri mwingine' }, 'p1');
    assert.equal(res.status, 200, res.json.message);
    const sms = sent.slice(before).filter((m) => m.phone === RIDER);
    assert.equal(sms.length, 1);
    assert.match(sms[0].message, /imeghairiwa/);
    const view = (await call('POST', '/api/share', { token: riderToken })).json.data;
    assert.equal(view.status, 'CANCELLED');
    assert.equal(view.driver?.phone, undefined, 'simu ya dereva haionyeshwi safari ikiisha');
    assert.equal((await call('POST', '/api/share/sos', { token: riderToken })).status, 409);
    await call('POST', `/api/rides/${rideId}/close`, {}, 'p1');
    const hist = (await call('GET', '/api/rides/history', undefined, 'p1')).json.data;
    assert.equal(hist.find((h: any) => h.id === rideId)?.riderName, 'Mama Neema Juma');
  });

  it('safari ya kawaida haibadiliki: hakuna rider, dereva anaona aliyeagiza, hakuna SMS ya anayesafiri', async () => {
    await call('POST', '/api/driver/rides/' + rideId + '/close', {}, 'd1');
    const res = await book(null);
    assert.equal(res.status, 201, res.json.message);
    assert.equal(res.json.data.rider, null);
    assert.equal(res.json.data.forOther, false);
    const id = res.json.data.id;
    const st = (await call('GET', '/api/driver/state', undefined, 'd1')).json.data;
    assert.equal(st.offer?.ride.id, id);
    assert.equal(st.offer.passenger.bookedBy, null);
    const before = sent.length;
    const acc = await call('POST', `/api/driver/offers/${st.offer.id}/accept`, {}, 'd1');
    assert.equal(acc.status, 200);
    assert.equal(acc.json.data.ride.passenger.phone, intl(`0761${s}`));
    assert.equal(sent.slice(before).filter((m) => m.phone === RIDER).length, 0);
    assert.equal((await call('POST', `/api/rides/${id}/cancel`, {}, 'p1')).status, 200);
    await call('POST', '/api/driver/online', { online: false }, 'd1');
  });
});
