// Tests za Phase 4: hesabu ya nauli, maeneo, kanuni za bei na makadirio ya safari.
// Database ya MAJARIBIO tu:  DATABASE_URL=... JWT_SECRET=... npm test
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';
import { fareForDistance, quoteFare, straightLineKm } from '../src/services/fare-engine.js';

let app: FastifyInstance;
const suffix = String(Date.now()).slice(-6);
const adminPhone = `0688${suffix}`;
const userPhone = `0718${suffix}`;
const PASSWORD = 'NayaTest#2026';
const ids: string[] = [];
const locationIds: string[] = [];
let adminToken = '';
let userToken = '';
let ip = 0;

async function call(method: 'GET' | 'POST' | 'PUT', url: string, body?: unknown, token?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: `10.4.0.${(ip++ % 250) + 1}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

// Pointi mbili za majaribio karibu na mji wa Urambo, takriban km 1 kaskazini–kusini.
const A = { lat: -5.07, lng: 32.05 };
const B = { lat: -5.079, lng: 32.05 };

describe('Hesabu ya nauli (fare engine)', () => {
  const rule = { vehicleType: 'BODABODA' as const, baseFare: 1000, perKm: 500, minimumFare: 1500, roundingStep: 100, roadFactor: 1.3 };

  it('umbali wa moja kwa moja ni sahihi (digrii 0.009 ≈ km 1.0)', () => {
    assert.ok(Math.abs(straightLineKm(A, B) - 1.0) < 0.01);
  });

  it('nauli = kuanzia + km × bei, umbali × kizidisho cha barabara, kuzungushwa juu', () => {
    const q = quoteFare(rule, A, B); // km 1.0 × 1.3 = 1.3 → 1000 + 650 = 1650 → 1700
    assert.equal(q.distanceKm, 1.3);
    assert.equal(q.fare, 1700);
    assert.equal(q.currency, 'TZS');
    assert.equal(q.breakdown.minimumApplied, false);
  });

  it('safari fupi inapata nauli ya chini kabisa', () => {
    const q = quoteFare({ ...rule, minimumFare: 2000 }, A, { lat: -5.0705, lng: 32.05 });
    assert.equal(q.fare, 2000);
    assert.equal(q.breakdown.minimumApplied, true);
  });

  it('kuzungusha kwa 500 na mfano wa bei kwa umbali', () => {
    assert.equal(fareForDistance({ baseFare: 1000, perKm: 500, minimumFare: 0, roundingStep: 500 }, 3), 2500);
    assert.equal(fareForDistance({ baseFare: 1000, perKm: 450, minimumFare: 0, roundingStep: 500 }, 3), 2500);
    assert.equal(fareForDistance({ baseFare: 1000, perKm: 600, minimumFare: 0, roundingStep: 500 }, 3), 3000);
  });
});

describe('NAYA Phase 4 — maeneo na nauli', () => {
  before(async () => {
    await runMigrations(() => {});
    app = await buildApp({ logger: false });
    await db.query('DELETE FROM naya.fare_rules'); // database ya majaribio: anza bila bei
    const hash = await hashPassword(PASSWORD);
    const admin = await db.query(
      `INSERT INTO naya.users (phone, full_name, role, password_hash) VALUES ($1, 'Admin Bei', 'ADMIN', $2) RETURNING id`,
      [`255${adminPhone.slice(1)}`, hash],
    );
    const user = await db.query(
      `INSERT INTO naya.users (phone, full_name, role, password_hash, active_mode) VALUES ($1, 'Abiria Bei', 'USER', $2, 'PASSENGER') RETURNING id`,
      [`255${userPhone.slice(1)}`, hash],
    );
    ids.push(admin.rows[0].id, user.rows[0].id);
    adminToken = (await call('POST', '/api/auth/login', { phone: adminPhone, password: PASSWORD, portal: 'admin' })).json.data.token;
    userToken = (await call('POST', '/api/auth/login', { phone: userPhone, password: PASSWORD, portal: 'app' })).json.data.token;
  });

  after(async () => {
    await db.query('DELETE FROM naya.locations WHERE id = ANY($1::uuid[]) OR created_by = ANY($2::uuid[])', [locationIds, ids]);
    await db.query('DELETE FROM naya.fare_rules');
    await db.query('DELETE FROM naya.audit_logs WHERE actor_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM naya.users WHERE id = ANY($1::uuid[])', [ids]);
    await app.close();
    await db.end();
  });

  it('ofisi inaongeza maeneo; mtumiaji hawezi', async () => {
    const stand = await call('POST', '/api/admin/locations', { name: `Stendi T${suffix}`, category: 'STAND', area: 'Mjini', ...A }, adminToken);
    assert.equal(stand.status, 201, stand.json.message);
    assert.equal(typeof stand.json.data.lat, 'number');
    const market = await call('POST', '/api/admin/locations', { name: `Soko T${suffix}`, category: 'MARKET', ...B }, adminToken);
    assert.equal(market.status, 201);
    locationIds.push(stand.json.data.id, market.json.data.id);
    assert.equal((await call('POST', '/api/admin/locations', { name: 'Haramu', ...A }, userToken)).status, 403);
  });

  it('uhakiki: koordinati nje ya Tanzania na jina linalorudiwa vinakataliwa', async () => {
    const outside = await call('POST', '/api/admin/locations', { name: `Lusaka T${suffix}`, lat: -15.42, lng: 28.28 }, adminToken);
    assert.equal(outside.status, 400);
    const swapped = await call('POST', '/api/admin/locations', { name: `Kosa T${suffix}`, lat: 32.05, lng: -5.07 }, adminToken);
    assert.equal(swapped.status, 400);
    const dup = await call('POST', '/api/admin/locations', { name: `stendi t${suffix}`, ...A }, adminToken);
    assert.equal(dup.status, 409);
  });

  it('mtumiaji anaona maeneo yanayotumika tu, na anaweza kutafuta', async () => {
    const list = await call('GET', `/api/locations?q=${encodeURIComponent(`T${suffix}`)}`, undefined, userToken);
    assert.equal(list.status, 200);
    assert.equal(list.json.data.length, 2);
    assert.equal(list.json.data[0].isActive, undefined);
  });

  it('kabla ya kuweka bei: makadirio yanarudi bila chaguo', async () => {
    const est = await call('POST', '/api/fares/estimate', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] } }, userToken);
    assert.equal(est.status, 200);
    assert.deepEqual(est.json.data.options, []);
  });

  it('ofisi inaweka bei; uhakiki wa bei; mtumiaji hawezi kubadilisha bei', async () => {
    const bad = await call('PUT', '/api/admin/fares/BODABODA', { baseFare: -5, perKm: 500, minimumFare: 1500, roundingStep: 100, roadFactor: 1.3 }, adminToken);
    assert.equal(bad.status, 400);
    const badStep = await call('PUT', '/api/admin/fares/BODABODA', { baseFare: 1000, perKm: 500, minimumFare: 1500, roundingStep: 300, roadFactor: 1.3 }, adminToken);
    assert.equal(badStep.status, 400);
    assert.equal(
      (await call('PUT', '/api/admin/fares/BODABODA', { baseFare: 1, perKm: 1, minimumFare: 1, roundingStep: 50, roadFactor: 1.3 }, userToken)).status,
      403,
    );
    const boda = await call('PUT', '/api/admin/fares/BODABODA', { baseFare: 1000, perKm: 500, minimumFare: 1500, roundingStep: 100, roadFactor: 1.3 }, adminToken);
    assert.equal(boda.status, 200);
    const bajaji = await call('PUT', '/api/admin/fares/BAJAJI', { baseFare: 1500, perKm: 700, minimumFare: 2500, roundingStep: 500, roadFactor: 1.3 }, adminToken);
    assert.equal(bajaji.json.data.length, 2);
  });

  it('mfano wa bei kwa ofisi', async () => {
    const preview = await call('POST', '/api/admin/fares/preview', { baseFare: 1000, perKm: 500, minimumFare: 1500, roundingStep: 100, roadFactor: 1.3 }, adminToken);
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.json.data[0], { distanceKm: 1, fare: 1500 });
    assert.deepEqual(preview.json.data[2], { distanceKm: 3, fare: 2500 });
  });

  it('makadirio kati ya maeneo mawili: bodaboda na bajaji', async () => {
    const est = await call('POST', '/api/fares/estimate', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] } }, userToken);
    assert.equal(est.status, 200);
    const byType = Object.fromEntries(est.json.data.options.map((o: any) => [o.vehicleType, o]));
    assert.equal(byType.BODABODA.fare, 1700);
    assert.equal(byType.BODABODA.distanceKm, 1.3);
    assert.equal(byType.BAJAJI.fare, 2500); // 1500 + 910 = 2410 → 2500
    assert.equal(est.json.data.destination.name, `Soko T${suffix}`);
  });

  it('GPS ndani ya eneo la huduma inakubaliwa; nje (Dar es Salaam) inakataliwa kwa ujumbe wazi', async () => {
    const near = await call('POST', '/api/fares/estimate', { pickup: { lat: -5.072, lng: 32.051 }, destination: { locationId: locationIds[1] } }, userToken);
    assert.equal(near.status, 200);
    assert.equal(near.json.data.pickup.source, 'gps');
    const far = await call('POST', '/api/fares/estimate', { pickup: { lat: -6.8, lng: 39.28 }, destination: { locationId: locationIds[1] } }, userToken);
    assert.equal(far.status, 400);
    assert.match(far.json.message, /nje ya eneo la huduma/);
  });

  it('kuanzia na kwenda mahali pamoja kunakataliwa', async () => {
    const same = await call('POST', '/api/fares/estimate', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[0] } }, userToken);
    assert.equal(same.status, 400);
  });

  it('eneo lililozimwa halionekani wala halitumiki; ofisi inaweza kulirudisha', async () => {
    assert.equal((await call('POST', `/api/admin/locations/${locationIds[1]}/deactivate`, {}, adminToken)).json.data.isActive, false);
    const list = await call('GET', `/api/locations?q=${encodeURIComponent(`T${suffix}`)}`, undefined, userToken);
    assert.equal(list.json.data.length, 1);
    const est = await call('POST', '/api/fares/estimate', { pickup: { locationId: locationIds[0] }, destination: { locationId: locationIds[1] } }, userToken);
    assert.equal(est.status, 404);
    assert.equal((await call('POST', `/api/admin/locations/${locationIds[1]}/activate`, {}, adminToken)).json.data.isActive, true);
  });

  it('dashboard ya ofisi inaonyesha maandalizi', async () => {
    const dash = await call('GET', '/api/admin/dashboard', undefined, adminToken);
    assert.ok(dash.json.data.setup.activeLocations >= 2);
    assert.deepEqual([...dash.json.data.setup.pricedVehicleTypes].sort(), ['BAJAJI', 'BODABODA']);
  });
});
