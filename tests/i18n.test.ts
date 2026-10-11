// Phase 12: lugha mbili — makosa ya server kwa English, lugha ya mtumiaji inahifadhiwa, arifa zinatafsiriwa.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/pool.js';
import { runMigrations } from '../src/db/migrate.js';
import { tr } from '../src/services/i18n.js';
import { notify } from '../src/services/notify.js';

let app: FastifyInstance;
const phone = `0713${String(Date.now()).slice(-6)}`;
const PASSWORD = 'NayaTest#2026';

async function call(method: 'GET' | 'POST', url: string, body: unknown, lang: 'sw' | 'en', token?: string) {
  const res = await app.inject({
    method,
    url,
    remoteAddress: '10.9.0.1',
    headers: { 'x-naya-lang': lang, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { payload: body as object } : {}),
  });
  return { status: res.statusCode, json: res.json() as any };
}

before(async () => {
  await runMigrations(() => {});
  app = await buildApp({ logger: false });
});

after(async () => {
  const u = `255${phone.slice(1)}`;
  await db.query('DELETE FROM naya.notifications WHERE user_id IN (SELECT id FROM naya.users WHERE phone = $1)', [u]);
  await db.query('DELETE FROM naya.users WHERE phone = $1', [u]);
  await app.close();
  await db.end();
});

describe('NAYA Phase 12 — Kiswahili na English', () => {
  it('kamusi: ujumbe wa kawaida na wenye nafasi ({}) unatafsiriwa', () => {
    assert.equal(tr('Safari haikupatikana', 'en'), 'Trip not found');
    assert.equal(tr('Safari haikupatikana', 'sw'), 'Safari haikupatikana');
    assert.equal(tr('PIN si sahihi. Umebakiza majaribio 2.', 'en'), 'Wrong PIN. You have 2 attempts left.');
    assert.equal(tr('Neno lisilojulikana kabisa', 'en'), 'Neno lisilojulikana kabisa');
  });

  it('makosa ya fomu yanarudi kwa lugha ya kichwa x-naya-lang', async () => {
    const sw = await call('POST', '/api/auth/register', { fullName: 'Ab', phone: '123', password: 'short', acceptTerms: true }, 'sw');
    assert.match(sw.json.message, /Namba ya simu si sahihi/);
    const en = await call('POST', '/api/auth/register', { fullName: 'Ab', phone: '123', password: 'short', acceptTerms: true }, 'en');
    assert.equal(en.status, 400);
    assert.match(en.json.message, /Invalid phone number/);
    assert.match(en.json.message, /at least 8 characters/);
  });

  it('lugha inahifadhiwa kwa mtumiaji; arifa zinamfikia kwa English', async () => {
    const reg = await call('POST', '/api/auth/register', { fullName: 'Grace English', phone, password: PASSWORD, acceptTerms: true }, 'en');
    assert.equal(reg.status, 201);
    const token = reg.json.data.token;
    await call('GET', '/api/account', undefined, 'en', token);
    const row = await db.query('SELECT id, language FROM naya.users WHERE phone = $1', [`255${phone.slice(1)}`]);
    assert.equal(row.rows[0].language, 'en');
    await notify({ userId: row.rows[0].id, event: 'support', title: 'Ofisi ya NAYA imekujibu', body: 'Safari bado inaendelea.' });
    const n = await db.query('SELECT title, body FROM naya.notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [row.rows[0].id]);
    assert.equal(n.rows[0].title, 'The NAYA office has replied to you');
    assert.equal(n.rows[0].body, 'The trip is still in progress.');
    // Akibadili kurudi Kiswahili
    await call('GET', '/api/account', undefined, 'sw', token);
    assert.equal((await db.query('SELECT language FROM naya.users WHERE phone = $1', [`255${phone.slice(1)}`])).rows[0].language, 'sw');
  });
});
