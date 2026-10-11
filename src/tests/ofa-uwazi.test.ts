// Uwazi wa ofa (0.14.3): ofisi inaweza kuchunguza kwa nini mteja anaona / haoni ofa, inaona wateja wangapi wanaipata
// na maonyo kabla ya kuwasha, na mteja asiyestahili anaambiwa kwa upole (si kimya).
// Database ya MAJARIBIO tu.
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
const promoIds: string[] = [];
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const phones: Record<string, string> = {};
let ip = 0;

async function call(method: 'GET' | 'POST', url: string, body?: unknown, who?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.33.${Math.floor(ip / 250)}.${(ip++ % 250) + 1}`,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

const A = { lat: -6.6, lng: 33.7 };
const B = { lat: -6.615, lng: 33.71 };

async function makeUser(key: string, phone: string, name: string, mode: string | null, role = 'USER') {
  const row = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode, phone_verified_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [`255${phone.slice(1)}`, name, role, await hashPassword(PASSWORD), mode],
  );
  ids[key] = row.rows[0].id;
  phones[key] = phone;
  userIds.push(row.rows[0].id);
  tokens[key] = (await call('POST', '/api/auth/login', { phone, password: PASSWORD, portal: role === 'USER' ? 'app' : 'admin' })).json.data.token;
}
async function promo(body: Record<string, unknown>, activate = true) {
  const res = await call('POST', '/api/admin/promotions', { name: `Ofa U${s} ${promoIds.length}`, title: 'Nusu bei!', audience: 'ALL', discountPercent: 50, ...body }, 'admin');
  assert.equal(res.status, 201, res.json.message);
  promoIds.push(res.json.data.id);
  if (activate) assert.equal((await call('POST', `/api/admin/promotions/${res.json.data.id}/status`, { status: 'ACTIVE' }, 'admin')).status, 200);
  return res.json.data.id as string;
}
const pause = (id: string) => call('POST', `/api/admin/promotions/${id}/status`, { status: 'PAUSED' }, 'admin');
const check = (who: string, fare = 3000, vehicle = 'BODABODA') =>
  call('GET', `/api/admin/promotions/check?phone=${phones[who]}&fare=${fare}&vehicle=${vehicle}`, undefined, 'admin');
/** Safari iliyokamilika (bila ofa) — moja kwa moja kwenye DB. */
async function completedRide(passenger: string, fare: number) {
  await db.query(
    `INSERT INTO naya.rides (passenger_id, vehicle_type, pickup_location_id, pickup_name, pickup_lat, pickup_lng, dest_location_id, dest_name, dest_lat, dest_lng,
                             distance_km, fare, status, completed_at)
     VALUES ($1, 'BODABODA', $2, 'Pickup', $3, $4, $5, 'Dest', $6, $7, 2, $8, 'COMPLETED', now())`,
    [ids[passenger], locationIds[0], A.lat, A.lng, locationIds[1], B.lat, B.lng, fare],
  );
}

let pausedBefore: string[] = [];
before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  pausedBefore = (await db.query(`UPDATE naya.promotions SET status = 'PAUSED' WHERE status = 'ACTIVE' RETURNING id`)).rows.map((r) => r.id);
  for (const [name, p] of [[`Pickup U${s}`, A], [`Dest U${s}`, B]] as const) {
    const r = await db.query(`INSERT INTO naya.locations (name, category, lat, lng) VALUES ($1, 'OTHER', $2, $3) RETURNING id`, [name, p.lat, p.lng]);
    locationIds.push(r.rows[0].id);
  }
  // Nauli ya kila safari ya majaribio: TSh 3,000
  await db.query(`DELETE FROM naya.fare_rules`);
  await db.query(
    `INSERT INTO naya.fare_rules (vehicle_type, base_fare, per_km, minimum_fare, rounding_step, road_factor) VALUES
       ('BODABODA', 3000, 0, 3000, 100, 1.3), ('BAJAJI', 4000, 0, 4000, 100, 1.3)`,
  );
  await makeUser('admin', `0750${s}`, 'Ofisi Uwazi', null, 'ADMIN');
  await makeUser('p1', `0751${s}`, `Mteja Mpya ${s}`, 'PASSENGER');
  await makeUser('p2', `0752${s}`, `Mteja Mzoefu ${s}`, 'PASSENGER');
  await makeUser('d1', `0753${s}`, `Boda Uwazi ${s}`, 'PASSENGER');
  await db.query(
    `INSERT INTO naya.drivers (user_id, status, vehicle_type, plate_number, vehicle_make, vehicle_color, license_number, paid_until)
     VALUES ($1, 'APPROVED', 'BODABODA', $2, 'Boxer', 'Nyekundu', 'DL123456', now() + interval '30 days')`,
    [ids.d1, `MC ${s.slice(-3)} UW1`],
  );
  for (let i = 0; i < 6; i++) await completedRide('p2', 3000);
});

after(async () => {
  await db.query('DELETE FROM naya.notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.rides WHERE passenger_id = ANY($1::uuid[]) OR driver_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.promotions WHERE id = ANY($1::uuid[])', [promoIds]);
  await db.query(`UPDATE naya.promotions SET status = 'ACTIVE' WHERE id = ANY($1::uuid[])`, [pausedBefore]);
  await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [userIds]);
  await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[])', [locationIds]);
  await db.query('DELETE FROM naya.fare_rules');
  await app.close();
  await db.end();
});

describe('Uwazi wa ofa', () => {
  let allId = '';

  it('chunguza mteja: hakuna ofa inayoendelea → jibu wazi', async () => {
    const r = await check('p1');
    assert.equal(r.status, 200, r.json.message);
    assert.equal(r.json.data.verdict.ok, false);
    assert.match(r.json.data.verdict.text, /Hakuna ofa/);
  });

  it('chunguza mteja: anayestahili → "Anaona ofa" na kiasi sahihi', async () => {
    allId = await promo({ minFare: 2000, vehicleTypes: ['BODABODA'] });
    const r = (await check('p1')).json.data;
    assert.equal(r.verdict.ok, true);
    assert.match(r.verdict.text, /analipa TSh 1,500/);
    assert.equal(r.offers.find((o: any) => o.id === allId).discount, 1500);
    assert.equal(r.user.completedRides, 0);
  });

  it('chunguza mteja: dereva, nauli ndogo, chombo kingine — kila moja na sababu yake', async () => {
    const drv = (await check('d1')).json.data;
    assert.equal(drv.verdict.ok, false);
    assert.equal(drv.offers.find((o: any) => o.id === allId).code, 'driver');
    assert.match(drv.verdict.text, /Ni dereva/);
    assert.equal((await check('p1', 1500)).json.data.offers.find((o: any) => o.id === allId).code, 'fare_low');
    assert.equal((await check('p1', 3000, 'BAJAJI')).json.data.offers.find((o: any) => o.id === allId).code, 'vehicle');
  });

  it('chunguza mteja: ofa ya wateja wapya — mzoefu hapati; iliyosimamishwa inaonyeshwa hivyo', async () => {
    await pause(allId);
    const newId = await promo({ audience: 'NEW_CUSTOMERS', maxDiscount: 1500, perCustomerLimit: 2 });
    const old = (await check('p2')).json.data;
    assert.equal(old.verdict.ok, false);
    assert.equal(old.offers.find((o: any) => o.id === newId).code, 'not_new');
    assert.equal(old.offers.find((o: any) => o.id === allId).code, 'paused');
    assert.equal(old.rides.length, 5);
    const fresh = (await check('p1')).json.data;
    assert.equal(fresh.verdict.ok, true);
    assert.match(fresh.verdict.text, /Safari 2 za ofa zimebaki/);
    await pause(newId);
  });

  it('chunguza mteja: namba isiyojulikana 404, namba mbovu 400, asiye ofisi 403', async () => {
    assert.equal((await call('GET', '/api/admin/promotions/check?phone=0799000111', undefined, 'admin')).status, 404);
    assert.equal((await call('GET', '/api/admin/promotions/check?phone=123', undefined, 'admin')).status, 400);
    assert.equal((await call('GET', `/api/admin/promotions/check?phone=${phones.p1}`, undefined, 'p1')).status, 403);
  });

  it('app: dereva anaambiwa kwa nini haoni ofa; mteja anaiona; app za zamani bado zinapata orodha', async () => {
    await call('POST', `/api/admin/promotions/${allId}/status`, { status: 'ACTIVE' }, 'admin');
    const drv = (await call('GET', '/api/offers?full=1', undefined, 'd1')).json.data;
    assert.deepEqual(drv.offers, []);
    assert.match(drv.notice, /kwa wateja tu/);
    const cust = (await call('GET', '/api/offers?full=1', undefined, 'p1')).json.data;
    assert.equal(cust.offers.length, 1);
    assert.equal(cust.notice, null);
    const legacy = (await call('GET', '/api/offers', undefined, 'p1')).json.data;
    assert.ok(Array.isArray(legacy));
    assert.equal(legacy.length, 1);
  });

  it('bei: safari isiyopata ofa kwa sababu ya nauli inaonyesha sababu (promoNote)', async () => {
    const body = { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] } };
    let est = (await call('POST', '/api/fares/estimate', body, 'p1')).json.data;
    const boda = est.options.find((o: any) => o.vehicleType === 'BODABODA');
    assert.equal(boda.promo.discount, 1500);
    const bajaji = est.options.find((o: any) => o.vehicleType === 'BAJAJI');
    assert.equal(bajaji.promo, null);
    assert.match(bajaji.promoNote, /ni kwa Bodaboda tu/);
    // dereva hapati maelezo ya bei (tayari anaambiwa kwenye bango)
    est = (await call('POST', '/api/fares/estimate', body, 'd1')).json.data;
    assert.equal(est.options.find((o: any) => o.vehicleType === 'BAJAJI').promoNote, null);
  });

  it('hakiki ya ofa: wateja wangapi + maonyo (nauli ya chini sana juu, tarehe ya baadaye, bajeti ndogo)', async () => {
    const base = { audience: 'ALL', discountPercent: 50, maxDiscount: null, minFare: null, maxFare: null, vehicleTypes: null, perCustomerLimit: null, perDriverLimit: 3, perDriverPeriod: 'WEEK', budget: null, priority: 0, startsAt: null, endsAt: null };
    const ok = await call('POST', '/api/admin/promotions/preview', base, 'admin');
    assert.equal(ok.status, 200, ok.json.message);
    assert.ok(ok.json.data.eligible >= 2);
    assert.ok(ok.json.data.eligible <= ok.json.data.customers);
    assert.ok(ok.json.data.warnings.some((w: any) => /waliothibitishwa/.test(w.text)));
    assert.ok(ok.json.data.warnings.some((w: any) => /tayari inaendelea/.test(w.text)));

    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const bad = (await call('POST', '/api/admin/promotions/preview', { ...base, minFare: 500000, startsAt: tomorrow, budget: 3000 }, 'admin')).json.data;
    const texts = bad.warnings.map((w: any) => w.text).join(' | ');
    assert.match(texts, /Hakuna hata safari moja/);
    assert.match(texts, /Kabla ya hapo wateja hawataiona/);

    const newOnly = (await call('POST', '/api/admin/promotions/preview', { ...base, audience: 'NEW_CUSTOMERS' }, 'admin')).json.data;
    assert.ok(newOnly.eligible < ok.json.data.eligible, 'mteja mzoefu (p2) hahesabiwi kwenye ofa ya wateja wapya');

    const saved = await call('GET', `/api/admin/promotions/${allId}/preview`, undefined, 'admin');
    assert.equal(saved.status, 200);
    assert.ok(saved.json.data.eligible >= 1);
    assert.equal((await call('POST', '/api/admin/promotions/preview', base, 'p1')).status, 403);
  });
});
