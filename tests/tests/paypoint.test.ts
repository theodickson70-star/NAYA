// Majaribio ya PayPoint dhidi ya PostgreSQL halisi (database ya majaribio)
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db, runMigrations } from '../src/db.js';
import { balances } from '../src/services/ledger.js';
import { Client } from './helpers.js';

let app: FastifyInstance;
const s = String(Date.now()).slice(-6);
const owner = { username: `juma${s}`, password: 'Siri#2026' };
let bizId = '';
let dukaId = '';
let agentA = '';
let lastTx = 0;

const one = async <T>(sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows[0] as T;

before(async () => {
  await runMigrations(() => {});
  app = await buildApp();
});
after(async () => {
  await app.close();
  await db.end();
});

describe('PayPoint', () => {
  const o = () => new Client(app, '10.1.0.1');
  let O: Client;
  let A: Client;
  let B: Client;

  it('mmiliki anasajili duka na anaona hatua za kuanza', async () => {
    O = o();
    await O.get('/sajili');
    const r = await O.post('/sajili', {
      jina_duka: `Juma Wakala ${s}`, namba_leseni: 'LS-77', mahali: 'Sokoni, Urambo', mitandao: ['mpesa', 'airtel'],
      jina: 'Juma Hamisi', simu: '0754 111 222', username: owner.username, password: owner.password,
    });
    assert.equal(r.statusCode, 302, r.body.slice(0, 300));
    const home = await O.get('/');
    assert.equal(home.statusCode, 200);
    assert.match(home.body, /Anza hapa/);
    const u = await one<{ biashara_id: string; role: string; simu: string }>('SELECT biashara_id, role, simu FROM paypoint.watumiaji WHERE username = $1', [owner.username]);
    assert.equal(u.role, 'owner');
    assert.equal(u.simu, '255754111222');
    bizId = u.biashara_id;
    dukaId = (await one<{ id: string }>('SELECT id FROM paypoint.maduka WHERE biashara_id = $1', [bizId])).id;
    const rates = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM paypoint.kamisheni_asilimia WHERE biashara_id = $1', [bizId]);
    assert.equal(rates.n, 10);
  });

  it('username inayojirudia na password fupi zinakataliwa', async () => {
    const c = o();
    await c.get('/sajili');
    let r = await c.post('/sajili', { jina_duka: 'X Duka', jina: 'X Y', simu: '0754000000', username: owner.username.toUpperCase(), password: 'abcdef', mitandao: 'mpesa' });
    assert.equal(r.statusCode, 400);
    assert.match(r.body, /imeshachukuliwa/);
    assert.match(r.body, /value="X Duka"/); // fomu inabaki na taarifa
    r = await c.post('/sajili', { jina_duka: 'X Duka', jina: 'X Y', simu: '0754000000', username: `x${s}`, password: '123', mitandao: 'mpesa' });
    assert.match(r.body, /angalau herufi 6/);
  });

  it('fomu bila CSRF inakataliwa', async () => {
    const r = await O.post('/float', { duka_id: dukaId, aina: 'cash_ingia', kiasi: '1000' }, { csrf: 'bandia' });
    assert.equal(r.statusCode, 403);
    assert.match(r.body, /Fomu imeisha muda/);
  });

  it('kuingia kwa password isiyo sahihi kunakataliwa na kunarekodiwa', async () => {
    const c = o();
    await c.get('/ingia');
    const r = await c.post('/ingia', { username: owner.username, password: 'kosa-kosa' });
    assert.equal(r.statusCode, 401);
    assert.match(r.body, /si sahihi/);
    const a = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM paypoint.kumbukumbu WHERE biashara_id = $1 AND kitendo = 'login_failed'`, [bizId]);
    assert.equal(a.n, 1);
  });

  it('mmiliki anaweka float na cash; mtandao usiohudumiwa unakataliwa', async () => {
    await O.get('/float');
    let r = await O.post('/float', { duka_id: dukaId, aina: 'float_ingia', mtandao: 'mpesa', kiasi: '500,000', maelezo: 'benki' });
    assert.equal(r.statusCode, 302);
    r = await O.post('/float', { duka_id: dukaId, aina: 'cash_ingia', mtandao: 'mpesa', kiasi: '1,000,000' });
    assert.equal(r.statusCode, 302);
    r = await O.post('/float', { duka_id: dukaId, aina: 'float_ingia', mtandao: 'mixx', kiasi: '1000' });
    assert.equal(r.statusCode, 400);
    r = await O.post('/float', { duka_id: dukaId, aina: 'float_toka', mtandao: 'airtel', kiasi: '1000' });
    assert.match(r.body, /haitoshi/);
    const b = await balances(db, dukaId);
    assert.deepEqual(b, { cash: 1_000_000, floats: { mpesa: 500_000 } });
  });

  it('mmiliki anaongeza wafanyakazi; wanalazimika kubadilisha password', async () => {
    await O.get('/wafanyakazi/ongeza');
    for (const [jina, user] of [['Asha Juma', `asha${s}`], ['Bakari Ali', `bakari${s}`]]) {
      const r = await O.post('/wafanyakazi/ongeza', { jina, username: user, simu: '0713000111', password: 'muda123', duka_id: dukaId });
      assert.equal(r.statusCode, 302, r.body.slice(0, 200));
    }
    agentA = (await one<{ id: string }>('SELECT id FROM paypoint.watumiaji WHERE username = $1', [`asha${s}`])).id;
    A = new Client(app, '10.2.0.1');
    await A.get('/ingia');
    let r = await A.post('/ingia', { username: `asha${s}`, password: 'muda123' });
    assert.equal(r.headers.location, '/');
    r = await A.get('/');
    assert.equal(r.headers.location, '/akaunti');
    await A.get('/akaunti');
    r = await A.post('/akaunti', { sasa: 'muda123', mpya: 'AshaSiri1', mpya2: 'AshaSiri1' });
    assert.equal(r.statusCode, 302);
    r = await A.get('/');
    assert.equal(r.statusCode, 200);
    assert.match(r.body, /TUMA/);

    B = new Client(app, '10.3.0.1');
    await B.get('/ingia');
    await B.post('/ingia', { username: `bakari${s}`, password: 'muda123' });
    await B.get('/akaunti');
    await B.post('/akaunti', { sasa: 'muda123', mpya: 'BakariSiri1', mpya2: 'BakariSiri1' });
  });

  it('wakala anatuma pesa: float inapungua, cash inaongezeka, kamisheni 1%, mteja anasajiliwa', async () => {
    await A.get('/tuma');
    const r = await A.post('/tuma', { mtandao: 'mpesa', simu: '0767 555 444', jina: 'Neema Said', kiasi: '50,000', kumbukumbu_namba: 'QK7H2' });
    assert.equal(r.statusCode, 302, r.body.slice(0, 400));
    lastTx = Number(r.headers.location!.split('/').pop());
    const t = await one<{ kamisheni: number; simu_mteja: string; mteja_id: string }>('SELECT kamisheni, simu_mteja, mteja_id FROM paypoint.miamala WHERE id = $1', [lastTx]);
    assert.equal(t.kamisheni, 500);
    assert.equal(t.simu_mteja, '255767555444');
    assert.ok(t.mteja_id);
    assert.deepEqual(await balances(db, dukaId), { cash: 1_050_000, floats: { mpesa: 450_000 } });
    const receipt = await A.get(`/risiti/${lastTx}`);
    assert.match(receipt.body, /RISITI #/);
    assert.match(receipt.body, /Neema Said/);
    assert.match(receipt.body, /wa\.me\/255767555444/);
  });

  it('muamala usiowezekana unakataliwa bila kurekodiwa', async () => {
    const before = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM paypoint.miamala WHERE biashara_id = $1', [bizId]);
    let r = await A.post('/tuma', { mtandao: 'mpesa', simu: '0767555444', kiasi: '900000' });
    assert.equal(r.statusCode, 400);
    assert.match(r.body, /Float ya M-Pesa haitoshi/);
    r = await A.post('/toa', { mtandao: 'airtel', simu: '0767555444', kiasi: '2,000,000' });
    assert.match(r.body, /Cash haitoshi/);
    r = await A.post('/tuma', { mtandao: 'mixx', simu: '0767555444', kiasi: '1000' });
    assert.match(r.body, /halihudumii Mixx/);
    r = await A.post('/tuma', { mtandao: 'mpesa', simu: '12345', kiasi: '1000' });
    assert.match(r.body, /namba sahihi ya simu/);
    r = await A.post('/tuma', { mtandao: 'mpesa', simu: '0767555444', kiasi: '50' });
    assert.match(r.body, /TSh 100/);
    const after = await one<{ n: number }>('SELECT COUNT(*)::int AS n FROM paypoint.miamala WHERE biashara_id = $1', [bizId]);
    assert.equal(after.n, before.n);
  });

  it('toa: jina la mteja linajazwa kutoka daftarini; kamisheni ya chini TSh 100', async () => {
    const look = await A.get('/api/mteja?simu=0767555444');
    assert.deepEqual(JSON.parse(look.body), { mteja: { jina: 'Neema Said', simu: '0767 555 444' } });
    const r = await A.post('/toa', { mtandao: 'airtel', simu: '+255 767 555 444', kiasi: '5000' });
    assert.equal(r.statusCode, 302);
    const id = Number(r.headers.location!.split('/').pop());
    const t = await one<{ kamisheni: number; jina_mteja: string }>('SELECT kamisheni, jina_mteja FROM paypoint.miamala WHERE id = $1', [id]);
    assert.equal(t.kamisheni, 100); // 1.5% ya 5,000 = 75 → angalau 100
    assert.equal(t.jina_mteja, 'Neema Said');
    assert.deepEqual(await balances(db, dukaId), { cash: 1_045_000, floats: { mpesa: 450_000, airtel: 5_000 } });
    const list = await A.get('/wateja');
    assert.match(list.body, /Neema Said/);
  });

  it('mfanyakazi haoni miamala ya mwenzake wala kurasa za mmiliki', async () => {
    assert.equal((await B.get(`/risiti/${lastTx}`)).statusCode, 404);
    const rep = await B.get('/ripoti');
    assert.doesNotMatch(rep.body, /Neema Said/);
    for (const url of ['/float', '/wafanyakazi', '/kumbukumbu', '/maduka', '/kamisheni', '/arifa']) {
      assert.equal((await B.get(url)).statusCode, 403, url);
    }
    // Mmiliki anaona yote
    const repO = await O.get('/ripoti');
    assert.match(repO.body, /Neema Said/);
    assert.match(repO.body, /Asha Juma/);
  });

  it('kubatilisha: mmiliki hawezi; mfanyakazi mwingine hawezi; aliyerekodi anaweza, salio linarudi', async () => {
    await O.get(`/risiti/${lastTx}`);
    await O.post(`/miamala/${lastTx}/batilisha`, { sababu: 'kosa' });
    let t = await one<{ imebatilishwa: boolean }>('SELECT imebatilishwa FROM paypoint.miamala WHERE id = $1', [lastTx]);
    assert.equal(t.imebatilishwa, false);
    await B.post(`/miamala/${lastTx}/batilisha`, { sababu: 'kosa' });
    t = await one('SELECT imebatilishwa FROM paypoint.miamala WHERE id = $1', [lastTx]);
    assert.equal(t.imebatilishwa, false);
    await A.get(`/risiti/${lastTx}`);
    const r = await A.post(`/miamala/${lastTx}/batilisha`, { sababu: 'Kiasi kimekosewa' });
    assert.equal(r.statusCode, 302);
    t = await one('SELECT imebatilishwa FROM paypoint.miamala WHERE id = $1', [lastTx]);
    assert.equal(t.imebatilishwa, true);
    assert.deepEqual(await balances(db, dukaId), { cash: 995_000, floats: { mpesa: 500_000, airtel: 5_000 } });
    const arifa = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM paypoint.arifa WHERE biashara_id = $1 AND aina = 'batilisha'`, [bizId]);
    assert.equal(arifa.n, 1);
    const again = await A.post(`/miamala/${lastTx}/batilisha`, { sababu: 'tena' });
    assert.equal(again.statusCode, 302);
    const page = await A.get(`/risiti/${lastTx}`);
    assert.match(page.body, /IMEBATILISHWA/);
    assert.match(page.body, /umeshabatilishwa/);
  });

  it('rekodi za kudumu: database inakataa kufuta miamala na kubadilisha kumbukumbu', async () => {
    await assert.rejects(db.query('DELETE FROM paypoint.miamala WHERE id = $1', [lastTx]), /haiwezi kufutwa/);
    await assert.rejects(db.query(`UPDATE paypoint.kumbukumbu SET maelezo = 'x' WHERE biashara_id = $1`, [bizId]), /haiwezi kufutwa/);
  });

  it('ngazi ya kamisheni inatumika badala ya asilimia', async () => {
    await O.get('/kamisheni');
    let r = await O.post('/kamisheni/ngazi', { mtandao: 'mpesa', aina: 'tuma', kuanzia: '10,001', hadi: '50,000', kamisheni: '350' });
    assert.equal(r.statusCode, 302);
    r = await O.post('/kamisheni/ngazi', { mtandao: 'mpesa', aina: 'tuma', kuanzia: '40,000', hadi: '60,000', kamisheni: '1' });
    assert.match(r.body, /inaingiliana/);
    r = await A.post('/tuma', { mtandao: 'mpesa', simu: '0715000999', kiasi: '20000' });
    const id = Number(r.headers.location!.split('/').pop());
    assert.equal((await one<{ kamisheni: number }>('SELECT kamisheni FROM paypoint.miamala WHERE id = $1', [id])).kamisheni, 350);
  });

  it('tahadhari ya float ndogo inamfikia mmiliki mara moja', async () => {
    // float ya mpesa sasa 480,000; kiwango ni 100,000
    await A.post('/tuma', { mtandao: 'mpesa', simu: '0715000999', kiasi: '400000' });
    await A.post('/tuma', { mtandao: 'mpesa', simu: '0715000999', kiasi: '1000' });
    const n = await one<{ n: number }>(`SELECT COUNT(*)::int AS n FROM paypoint.arifa WHERE biashara_id = $1 AND aina = 'float_chini'`, [bizId]);
    assert.equal(n.n, 1);
    const home = await O.get('/');
    assert.match(home.body, /float ya M-Pesa imeshuka/);
  });

  it('hesabu ya siku: upungufu unarekodiwa na mmiliki anaarifiwa', async () => {
    const b = await balances(db, dukaId);
    await A.get('/hesabu');
    const r = await A.post('/hesabu', { cash: String(b.cash - 2000), float_mpesa: String(b.floats.mpesa), float_airtel: String(b.floats.airtel), maelezo: 'chenji' });
    assert.equal(r.statusCode, 302, r.body.slice(0, 300));
    const h = await one<{ tofauti: number }>('SELECT tofauti FROM paypoint.hesabu WHERE biashara_id = $1 ORDER BY id DESC LIMIT 1', [bizId]);
    assert.equal(h.tofauti, -2000);
    const page = await O.get('/hesabu');
    assert.match(page.body, /Upungufu TSh 2,000/);
  });

  it('ripoti: kuchuja kwa mfanyakazi na kupakua CSV', async () => {
    const r = await O.get(`/ripoti?kipindi=leo&mfanyakazi=${agentA}`);
    assert.match(r.body, /Asha Juma/);
    const csv = await O.get(`/ripoti.csv?kipindi=leo`);
    assert.equal(csv.headers['content-type'], 'text/csv; charset=utf-8');
    assert.ok(csv.body.startsWith('﻿Risiti,Tarehe'));
    assert.match(csv.body, /Imebatilishwa: Kiasi kimekosewa/);
  });

  it('kumbukumbu zinaonyesha kila kitendo', async () => {
    const r = await O.get('/kumbukumbu?kipindi=leo');
    for (const word of ['Biashara', 'Ameongeza mfanyakazi', 'Float imeingia', 'Ameingia kwenye mfumo', 'amebatilisha', 'Hesabu ya', 'Ameongeza ngazi']) {
      assert.match(r.body, new RegExp(word), word);
    }
    const f = await O.get(`/kumbukumbu?kipindi=leo&kitendo=tuma&mtumiaji=${agentA}`);
    assert.match(f.body, /Tuma M-Pesa/);
    assert.doesNotMatch(f.body, /Float imeingia/);
  });

  it('maandishi ya watumiaji yanasafishwa (hakuna XSS)', async () => {
    await A.get('/wateja/ongeza');
    const r = await A.post('/wateja/ongeza', { jina: '<script>alert(1)</script>', simu: '0699000111' });
    assert.equal(r.statusCode, 302);
    const page = await O.get('/wateja');
    assert.doesNotMatch(page.body, /<script>alert/);
    assert.match(page.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  it('biashara nyingine haioni data ya biashara hii', async () => {
    const X = new Client(app, '10.9.0.1');
    await X.get('/sajili');
    await X.post('/sajili', { jina_duka: 'Duka Lingine', jina: 'Mwingine', simu: '0788000000', username: `x2${s}`, password: 'Siri#2026', mitandao: 'mpesa' });
    assert.equal((await X.get(`/risiti/${lastTx}`)).statusCode, 404);
    const w = await X.get('/wateja');
    assert.doesNotMatch(w.body, /Neema/);
    assert.equal((await X.get(`/float?duka=${dukaId}`)).statusCode, 200);
    const fp = await X.post('/float', { duka_id: dukaId, aina: 'cash_ingia', kiasi: '1000' });
    assert.match(fp.body, /Duka halipo/);
  });

  it('mfanyakazi akizimwa anatolewa kwenye mfumo papo hapo', async () => {
    await O.get('/wafanyakazi');
    const r = await O.post(`/wafanyakazi/${agentA}/badilisha`, {});
    assert.equal(r.statusCode, 302);
    const h = await A.get('/');
    assert.equal(h.statusCode, 302);
    assert.match(h.headers.location as string, /\/ingia/);
    await A.get('/ingia');
    const l = await A.post('/ingia', { username: `asha${s}`, password: 'AshaSiri1' });
    assert.equal(l.statusCode, 403);
    assert.match(l.body, /imezimwa/);
  });

  it('kutoka kunafuta kikao', async () => {
    await O.get('/');
    const r = await O.post('/toka', {});
    assert.equal(r.headers.location, '/ingia');
    assert.equal((await O.get('/')).statusCode, 302);
  });
});
