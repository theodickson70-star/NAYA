// Tests za Phase 2: health, usajili, login, roles, logout, kusimamishwa, rate limit.
// Zinaendeshwa dhidi ya database ya MAJARIBIO (DATABASE_URL ya test) — kamwe ya production.
//   DATABASE_URL=... JWT_SECRET=... npm test
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { hashPassword } from '../src/services/auth.js';

let app: FastifyInstance;
const suffix = String(Date.now()).slice(-7);
const customerPhone = `0712${suffix.slice(-6)}`;
const adminPhone = `0688${suffix.slice(-6)}`;
const PASSWORD = 'NayaTest#2026';

async function call(method: 'GET' | 'POST', url: string, body?: unknown, token?: string, ip = '10.0.0.1') {
  const res = await app.inject({
    method,
    url,
    remoteAddress: ip,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
  await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash) VALUES ($1, 'Admin Majaribio', 'SUPER_ADMIN', $2)
     ON CONFLICT (phone) DO NOTHING`,
    [`255${adminPhone.slice(1)}`, await hashPassword(PASSWORD)],
  );
});

after(async () => {
  await db.query('DELETE FROM naya.users WHERE phone = ANY($1)', [[`255${customerPhone.slice(1)}`, `255${adminPhone.slice(1)}`]]);
  await app.close();
  await db.end();
});

describe('NAYA Phase 2', () => {
  let customerToken = '';
  let adminToken = '';

  it('GET /health inarudisha 200 na database ok', async () => {
    const { status, json } = await call('GET', '/health');
    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.status, 'ok');
    assert.equal(json.database, 'ok');
  });

  it('mteja anajisajili; password haionekani kwenye jibu', async () => {
    const { status, json } = await call('POST', '/api/auth/register', {
      fullName: 'Mteja Majaribio', phone: customerPhone, password: PASSWORD,
    });
    assert.equal(status, 201);
    assert.equal(json.success, true);
    assert.equal(json.data.user.role, 'USER');
    assert.equal(json.data.user.activeMode, null);
    assert.equal(json.data.user.phone, `255${customerPhone.slice(1)}`);
    assert.ok(json.data.token);
    assert.equal(JSON.stringify(json).includes('password'), false);
    assert.equal(JSON.stringify(json).includes('token_version'), false);
    customerToken = json.data.token;
  });

  it('namba ile ile haiwezi kusajiliwa mara mbili (409)', async () => {
    const { status, json } = await call('POST', '/api/auth/register', {
      fullName: 'Mtu Mwingine', phone: `+255${customerPhone.slice(1)}`, password: PASSWORD,
    }, undefined, '10.0.0.2');
    assert.equal(status, 409);
    assert.equal(json.success, false);
  });

  it('uhakiki: namba mbaya na password fupi zinakataliwa (400)', async () => {
    const { status, json } = await call('POST', '/api/auth/register', { fullName: 'Ab', phone: '12345', password: 'short' }, undefined, '10.0.0.3');
    assert.equal(status, 400);
    assert.match(json.message, /Namba ya simu si sahihi/);
    assert.match(json.message, /herufi 8/);
  });

  it('login: password mbaya na namba isiyopo zinapata ujumbe ule ule (401)', async () => {
    const wrong = await call('POST', '/api/auth/login', { phone: customerPhone, password: 'kosa-kosa-kosa' }, undefined, '10.0.0.4');
    const missing = await call('POST', '/api/auth/login', { phone: '0799000000', password: 'kosa-kosa-kosa' }, undefined, '10.0.0.4');
    assert.equal(wrong.status, 401);
    assert.equal(missing.status, 401);
    assert.equal(wrong.json.message, missing.json.message);
  });

  it('GET /api/auth/me: bila token 401, na token inarudisha mtumiaji', async () => {
    assert.equal((await call('GET', '/api/auth/me')).status, 401);
    const { status, json } = await call('GET', '/api/auth/me', undefined, customerToken);
    assert.equal(status, 200);
    assert.equal(json.data.fullName, 'Mteja Majaribio');
  });

  it('mteja HAWEZI kufika kwenye endpoints za admin (403) wala kuingia kupitia portal ya admin', async () => {
    assert.equal((await call('GET', '/api/admin/dashboard', undefined, customerToken)).status, 403);
    const viaAdmin = await call('POST', '/api/auth/login', { phone: customerPhone, password: PASSWORD, portal: 'admin' }, undefined, '10.0.0.5');
    assert.equal(viaAdmin.status, 403);
  });

  it('admin anaingia kupitia portal ya admin na kuona takwimu halisi', async () => {
    const login = await call('POST', '/api/auth/login', { phone: adminPhone, password: PASSWORD, portal: 'admin' }, undefined, '10.0.0.6');
    assert.equal(login.status, 200);
    adminToken = login.json.data.token;
    const { status, json } = await call('GET', '/api/admin/dashboard', undefined, adminToken);
    assert.equal(status, 200);
    assert.ok(json.data.users.members >= 1);
    assert.ok(json.data.users.admins >= 1);
    assert.equal(json.data.system.database, 'ok');
  });

  it('logout inaua token: baada ya kutoka, token ile ile inakataliwa', async () => {
    const out = await call('POST', '/api/auth/logout', undefined, customerToken);
    assert.equal(out.status, 200);
    assert.equal((await call('GET', '/api/auth/me', undefined, customerToken)).status, 401);
  });

  it('akaunti iliyosimamishwa: haiwezi kuingia, na token yake ya zamani inakataliwa papo hapo', async () => {
    const login = await call('POST', '/api/auth/login', { phone: customerPhone, password: PASSWORD }, undefined, '10.0.0.7');
    const token = login.json.data.token;
    await db.query(`UPDATE naya.users SET status = 'SUSPENDED' WHERE phone = $1`, [`255${customerPhone.slice(1)}`]);
    assert.equal((await call('GET', '/api/auth/me', undefined, token)).status, 403);
    assert.equal((await call('POST', '/api/auth/login', { phone: customerPhone, password: PASSWORD }, undefined, '10.0.0.8')).status, 403);
  });

  it('token ya kughushi inakataliwa', async () => {
    const fake = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4Iiwicm9sZSI6IlNVUEVSX0FETUlOIiwidHYiOjB9.bandia';
    assert.equal((await call('GET', '/api/admin/dashboard', undefined, fake)).status, 401);
  });

  it('rate limit: majaribio mengi ya login kutoka IP moja yanazuiwa (429)', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await call('POST', '/api/auth/login', { phone: '0799000001', password: 'x' }, undefined, '10.9.9.9')).status);
    }
    assert.ok(statuses.includes(429), `hakuna 429: ${statuses.join(',')}`);
  });

  it('njia isiyokuwepo inarudisha JSON ya NAYA (404)', async () => {
    const { status, json } = await call('GET', '/api/haipo');
    assert.equal(status, 404);
    assert.equal(json.success, false);
  });

  it('dashboard ya admin inahudumiwa kwenye /admin/', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /NAYA/);
    assert.equal(res.body.includes('Urambo Ride'), false);
  });
});
