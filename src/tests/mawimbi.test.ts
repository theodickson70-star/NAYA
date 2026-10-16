// Kosa #2: kumpata dereva haraka kwa MAWIMBI.
//   Wimbi 1: madereva 2 walio karibu zaidi (sekunde 15). Wimbi 2+: madereva 4 wanaofuata pamoja (sekunde 20) —
//   wa kwanza kukubali anapata safari, wengine wanaambiwa "mwingine amewahi".
// Database ya MAJARIBIO tu.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { candidatesForRide, dispatchPending, offlineUnseenDrivers } from '../src/services/rides.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6);
const PASSWORD = 'NayaTest#2026';
const userIds: string[] = [];
const locationIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let ip = 0;

async function call(method: 'GET' | 'POST', url: string, body?: unknown, who?: string, extra: Record<string, string> = {}) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.11.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...extra },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

// Eneo lake (mbali na tests nyingine)
const A = { lat: -5.4, lng: 32.6 };
const B = { lat: -5.415, lng: 32.61 };
// d1 karibu zaidi … d5 mbali zaidi (wote ndani ya km 10)
const SPOTS = [0.0004, 0.004, 0.008, 0.012, 0.016, 0.02, 0.024].map((d) => ({ lat: A.lat - d, lng: A.lng }));
const D = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'];
// x1: bajaji (chombo tofauti), x2: ada itaisha — wako online lakini hawapewi maombi ya bodaboda
const X = [{ key: 'x1', vehicle: 'BAJAJI', spot: { lat: A.lat - 0.001, lng: A.lng } }, { key: 'x2', vehicle: 'BODABODA', spot: { lat: A.lat - 0.002, lng: A.lng } }];

async function makeUser(key: string, phone: string, name: string, mode: string) {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode) VALUES ($1, $2, 'USER', $3, $4) RETURNING id`,
    [`255${phone.slice(1)}`, name, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: 'app' })).json.data.token;
}

const state = async (who: string) => (await call('GET', '/api/driver/state', undefined, who)).json.data;
const order = async () => {
  const res = await call('POST', '/api/rides', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] }, vehicleType: 'BODABODA' }, 'p1');
  assert.equal(res.status, 201, res.json.message);
  return res.json.data.id as string;
};
const offered = async () => {
  const out: string[] = [];
  for (const d of D) if ((await state(d)).offer) out.push(d);
  return out;
};
const expireOffers = (rideId: string) =>
  db.query(`UPDATE naya.ride_offers SET expires_at = now() - interval '1 second' WHERE ride_id = $1 AND status = 'PENDING'`, [rideId]);

before(async () => {
  await runMigrations(() => {});
  // Majaribio haya ni ya sheria za KAWAIDA (mfumo huru umezimwa); mfumo huru una majaribio yake (mfumo-huru.test.ts).
  await db.query(`INSERT INTO naya.settings (key, value) VALUES ('dispatch', '{"openMode": false}') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  app = await buildApp({ logger: false });
  for (const [name, p] of [[`Pickup W${s}`, A], [`Dest W${s}`, B]] as const) {
    const row = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(row.rows[0].id);
  }
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 1000, 500, 1500, 100, 1.3), ('BAJAJI', 1500, 700, 2500, 500, 1.3)`,
  );
  await makeUser('p1', `0750${s}`, 'Abiria Mawimbi', 'PASSENGER');
  for (const [i, d] of D.entries()) {
    await makeUser(d, `075${i + 1}${s}`, `Dereva Wimbi ${i + 1}`, 'DRIVER');
    await db.query(
      `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
       VALUES ($1, 'APPROVED', 'BODABODA', $2, 'Boxer', 'Nyekundu', 'DL123456', now() + interval '30 days')`,
      [ids[d], `MC ${s.slice(-3)} W${i + 1}`],
    );
    assert.equal((await call('POST', '/api/driver/online', { online: true, ...SPOTS[i] }, d)).status, 200);
  }
  for (const [i, x] of X.entries()) {
    await makeUser(x.key, `0759${i}${s.slice(1)}`, `Dereva Online ${x.key}`, 'DRIVER');
    await db.query(
      `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
       VALUES ($1, 'APPROVED', $2, $3, 'Boxer', 'Nyekundu', 'DL123456', now() + interval '30 days')`,
      [ids[x.key], x.vehicle, `MC ${s.slice(-3)} X${i + 1}`],
    );
    assert.equal((await call('POST', '/api/driver/online', { online: true, ...x.spot }, x.key)).status, 200);
  }
  // x2 yuko online, lakini ada yake imeisha zamani (zaidi ya siku za neema)
  await db.query(`UPDATE naya.drivers SET paid_until = now() - interval '90 days' WHERE user_id = $1`, [ids.x2]);
});

after(async () => {
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.ride_offers WHERE driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.query(`UPDATE naya.settings SET value = '{"openMode": true}' WHERE key = 'dispatch'`);
  await db.end();
});

describe('Kosa #2 — mawimbi ya maombi', () => {
  let rideId = '';

  it('wimbi la 1: madereva 2 walio karibu zaidi KWA PAMOJA, sekunde 15', async () => {
    rideId = await order();
    assert.deepEqual(await offered(), ['d1', 'd2']);
    const o = (await state('d1')).offer;
    assert.equal(o.totalSeconds, 15);
    assert.ok(o.secondsLeft > 10 && o.secondsLeft <= 15);
  });

  it('wote wawili wakikataa: madereva 4 wanaofuata wanapata ombi KWA PAMOJA, sekunde 20', async () => {
    const o1 = (await state('d1')).offer;
    await call('POST', `/api/driver/offers/${o1.id}/decline`, {}, 'd1');
    assert.deepEqual(await offered(), ['d2']); // d2 bado anaweza kukubali — wimbi jipya halianzi
    const o2 = (await state('d2')).offer;
    await call('POST', `/api/driver/offers/${o2.id}/decline`, {}, 'd2');
    assert.deepEqual(await offered(), ['d3', 'd4', 'd5', 'd6']);
    const o4 = (await state('d4')).offer;
    assert.equal(o4.totalSeconds, 20);
    assert.equal(o4.ride.id, rideId);
  });

  it('ofisi inaona madereva WOTE walio online na sababu za wasioweza kupewa safari', async () => {
    const list = (await candidatesForRide(rideId)) as any[];
    const by = (key: string) => list.find((c) => c.id === ids[key]);
    assert.ok(!list.some((c) => c.id === ids.p1)); // abiria mwenyewe haonekani
    // x1 (bajaji) na x2 (ada imeisha) wako karibu, lakini hawawezi kupewa
    assert.equal(by('x1').canOffer, false);
    assert.match(by('x1').reasons.join(' '), /Ana bajaji — abiria ameomba bodaboda/);
    assert.equal(by('x2').canOffer, false);
    assert.match(by('x2').reasons.join(' '), /Ada ya mwezi imeisha/);
    // d1 alikataa: bado anaweza kutumiwa na ofisi, na ofisi inaona alikataa
    assert.equal(by('d1').canOffer, true);
    assert.match(by('d1').notes.join(' '), /Alikataa safari hii/);
    // d3 ana ombi la safari hii linalomsubiri
    assert.equal(by('d3').canOffer, false);
    assert.match(by('d3').notes.join(' '), /linamsubiri sasa/);
    // walio tayari wanakuja kwanza
    const firstBlocked = list.findIndex((c) => !c.canOffer);
    assert.ok(list.slice(firstBlocked).every((c) => !c.canOffer));
  });

  it('mmoja akikataa ndani ya wimbi, wengine bado wanaweza kukubali (wimbi jipya halianzi)', async () => {
    const o3 = (await state('d3')).offer;
    await call('POST', `/api/driver/offers/${o3.id}/decline`, {}, 'd3');
    assert.deepEqual(await offered(), ['d4', 'd5', 'd6']);
  });

  it('wa kwanza kukubali anapata safari; mwingine anaambiwa "dereva mwingine amewahi"', async () => {
    const o5 = (await state('d5')).offer;
    const o4 = (await state('d4')).offer;
    const acc = await call('POST', `/api/driver/offers/${o4.id}/accept`, {}, 'd4');
    assert.equal(acc.status, 200, acc.json.message);
    const ride = (await call('GET', '/api/rides/current', undefined, 'p1')).json.data;
    assert.equal(ride.status, 'ACCEPTED');
    assert.equal(ride.driver.name, 'Dereva Wimbi 4');
    const s5 = await state('d5');
    assert.equal(s5.offer, null);
    assert.equal(s5.lastOffer?.id, o5.id);
    assert.equal(s5.lastOffer?.status, 'TAKEN');
    const late = await call('POST', `/api/driver/offers/${o5.id}/accept`, {}, 'd5');
    assert.equal(late.status, 409);
    assert.match(late.json.message, /Dereva mwingine amewahi/);
    // "mwingine amewahi" haihesabiwi kama kukosa kujibu
    assert.equal((await db.query('SELECT is_online FROM naya.drivers WHERE user_id = $1', [ids.d5])).rows[0].is_online, true);
    await call('POST', `/api/rides/${rideId}/cancel`, { reason: 'jaribio' }, 'p1');
    await call('POST', `/api/rides/${rideId}/close`, {}, 'p1');
  });

  it('wimbi likiisha muda bila jibu → wimbi linalofuata (madereva wapya tu)', async () => {
    // d4 ameachiwa (safari imeghairiwa) — yuko huru tena
    rideId = await order();
    assert.deepEqual(await offered(), ['d1', 'd2']);
    await expireOffers(rideId);
    await dispatchPending();
    assert.deepEqual(await offered(), ['d3', 'd4', 'd5', 'd6']);
    await expireOffers(rideId);
    await dispatchPending();
    assert.deepEqual(await offered(), ['d7']);
  });

  it('abiria akighairi wakati wa wimbi: ombi linaondoka ("abiria ameghairi"), dereva hawekwi offline', async () => {
    const o7 = (await state('d7')).offer;
    assert.equal((await call('POST', `/api/rides/${rideId}/cancel`, { reason: 'jaribio' }, 'p1')).status, 200);
    const s7 = await state('d7');
    assert.equal(s7.offer, null);
    assert.equal(s7.lastOffer?.id, o7.id);
    assert.equal(s7.lastOffer?.status, 'CANCELLED');
    await call('POST', `/api/rides/${rideId}/close`, {}, 'p1');
    // d7: ombi 1 limeghairiwa (si "hakujibu"). Ombi jingine likiisha muda bado ni 1 tu → anabaki online.
    rideId = await order();
    await db.query(`UPDATE naya.ride_offers SET status = 'DECLINED' WHERE ride_id = $1 AND status = 'PENDING'`, [rideId]);
    await dispatchPending(); // d3..d6
    await db.query(`UPDATE naya.ride_offers SET status = 'DECLINED' WHERE ride_id = $1 AND status = 'PENDING'`, [rideId]);
    await dispatchPending(); // d7
    assert.deepEqual(await offered(), ['d7']);
    await expireOffers(rideId);
    await dispatchPending();
    assert.equal((await db.query('SELECT is_online FROM naya.drivers WHERE user_id = $1', [ids.d7])).rows[0].is_online, true);
    await call('POST', `/api/rides/${rideId}/cancel`, { reason: 'jaribio' }, 'p1');
  });

  it('dereva "online" ambaye simu haijaonekana dakika 20+ anawekwa offline na kujulishwa', async () => {
    await db.query(`UPDATE naya.drivers SET last_seen_at = now() - interval '25 minutes' WHERE user_id = $1`, [ids.x1]);
    await db.query(`UPDATE naya.drivers SET last_seen_at = now() - interval '5 minutes' WHERE user_id = $1`, [ids.x2]);
    const off = await offlineUnseenDrivers(true);
    assert.ok(off.includes(ids.x1));
    assert.ok(!off.includes(ids.x2)); // dakika 5 tu — anabaki online
    const online = async (key: string) => (await db.query('SELECT is_online FROM naya.drivers WHERE user_id = $1', [ids[key]])).rows[0].is_online;
    assert.equal(await online('x1'), false);
    assert.equal(await online('x2'), true);
    assert.equal(await online('d1'), true);
    const n = await db.query(`SELECT title, body FROM naya.notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [ids.x1]);
    assert.equal(n.rows[0]?.title, 'Umewekwa offline');
    assert.match(n.rows[0].body, /haijaona simu yako kwa dakika 20/);
  });
});
