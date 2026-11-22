// Phase 13: ukurasa wa kupakua APK — "/" inaleta /pakua/, /pakua/apk inahesabu na kupeleka kwenye APK, QR, takwimu za ofisi.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { DEFAULT_APK_URL, downloadStats } from '../src/routes/pakua.js';

let app: FastifyInstance;
const ANDROID = 'Mozilla/5.0 (Linux; Android 13; TECNO) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
});
after(async () => {
  await app.close();
  await db.end();
});

describe('NAYA Phase 13 — Pakua app', () => {
  it('link kuu "/" inaleta ukurasa wa kupakua, na ukurasa unahudumiwa', async () => {
    const root = await app.inject({ method: 'GET', url: '/' });
    assert.equal(root.statusCode, 302);
    assert.equal(root.headers.location, '/pakua/');
    const page = await app.inject({ method: 'GET', url: '/pakua/' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Pakua app ya NAYA/);
    assert.equal((await app.inject({ method: 'GET', url: '/pakua' })).headers.location, '/pakua/');
  });

  it('/pakua/apk inahesabu upakuaji (Android) na kupeleka kwenye APK ya toleo jipya', async () => {
    const before = (await downloadStats()).total;
    const res = await app.inject({ method: 'GET', url: '/pakua/apk', headers: { 'user-agent': ANDROID }, remoteAddress: '10.13.0.1' });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, process.env.ANDROID_APK_URL || DEFAULT_APK_URL);
    const stats = await downloadStats();
    assert.equal(stats.total, before + 1);
    assert.ok(stats.today >= 1);
  });

  it('"Sasisha" ndani ya app: /api/app/latest inatoa toleo jipya na link ya https; upakuaji wa sasisho hauhesabiwi', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/app/latest' });
    assert.equal(res.statusCode, 200);
    const data = res.json().data;
    assert.equal(data.apk, process.env.ANDROID_APK_URL || DEFAULT_APK_URL);
    assert.match(data.apk, /^https:\/\//);
    assert.equal(data.page, '/pakua/apk?sasisha=1');
    assert.ok(data.versionCode === null || Number.isInteger(data.versionCode));
    const before = (await downloadStats()).total;
    const upd = await app.inject({ method: 'GET', url: '/pakua/apk?sasisha=1', headers: { 'user-agent': ANDROID }, remoteAddress: '10.13.0.2' });
    assert.equal(upd.statusCode, 302);
    assert.equal((await downloadStats()).total, before);
  });

  it('QR code ni SVG ya ukurasa wa kupakua', async () => {
    const res = await app.inject({ method: 'GET', url: '/pakua/qr.svg', headers: { host: 'naya.example' } });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type']), /image\/svg\+xml/);
    assert.match(res.body, /<svg/);
  });

  it('akaunti inaelekeza kwenye /pakua/ (si link ya nje moja kwa moja)', async () => {
    const { getAccount } = await import('../src/services/account.js');
    const row = await db.query(`SELECT * FROM naya.users WHERE role = 'USER' LIMIT 1`);
    if (row.rows[0]) assert.equal((await getAccount(row.rows[0])).androidApkUrl, '/pakua/');
  });
});
