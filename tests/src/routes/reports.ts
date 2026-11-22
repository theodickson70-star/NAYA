import type { FastifyInstance, FastifyRequest } from 'fastify';
import { needAgent, needOwner, needUser, setFlash } from '../auth.js';
import { db, many } from '../db.js';
import { html, raw } from '../html.js';
import { addDays, dateTime, netLabel, niceDate, num, phoneLocal, todayTz, tzs } from '../format.js';
import { KITENDO_LABEL } from '../services/audit.js';
import { listMaduka, listStaff } from '../services/business.js';
import { balances, dukaNetworks } from '../services/ledger.js';
import { listCounts, submitCount } from '../services/reconcile.js';
import { type Filter, exportRows, report } from '../services/reports.js';
import { page } from '../views/layout.js';
import { csrfField, empty, field, netChip, select, stat, variance } from '../views/ui.js';
import { txTable } from './home.js';
import { amount, body, isUuid, query, send, str, tryForm, ymd } from './util.js';

function periodOf(req: FastifyRequest): { from: string; to: string; kipindi: string } {
  const q = query(req);
  const today = todayTz();
  const k = q.kipindi ?? (q.from || q.to ? 'chagua' : 'leo');
  switch (k) {
    case 'jana':
      return { from: addDays(today, -1), to: addDays(today, -1), kipindi: k };
    case 'wiki':
      return { from: addDays(today, -6), to: today, kipindi: k };
    case 'mwezi':
      return { from: `${today.slice(0, 8)}01`, to: today, kipindi: k };
    case 'chagua': {
      const from = ymd(q.from) ?? today;
      const to = ymd(q.to) ?? today;
      return from <= to ? { from, to, kipindi: k } : { from: to, to: from, kipindi: k };
    }
    default:
      return { from: today, to: today, kipindi: 'leo' };
  }
}

const PERIODS = [
  { value: 'leo', label: 'Leo' },
  { value: 'jana', label: 'Jana' },
  { value: 'wiki', label: 'Siku 7' },
  { value: 'mwezi', label: 'Mwezi huu' },
  { value: 'chagua', label: 'Chagua tarehe' },
];

function periodFilters(p: { from: string; to: string; kipindi: string }, extra: unknown = '') {
  return html`<form method="get" class="filters" data-filters>
    <div class="seg" role="group" aria-label="Kipindi">${PERIODS.map((x) => html`<button type="submit" name="kipindi" value="${x.value}" class="${p.kipindi === x.value ? 'on' : ''}">${x.label}</button>`)}</div>
    <div class="filter-row">
      <div class="field"><label for="f-from">Kuanzia</label><input id="f-from" type="date" name="from" value="${p.from}"></div>
      <div class="field"><label for="f-to">Hadi</label><input id="f-to" type="date" name="to" value="${p.to}"></div>
      ${extra}
      <button class="btn btn-ghost" type="submit" name="kipindi" value="chagua">Onyesha</button>
    </div>
  </form>`;
}

function csvCell(v: unknown) {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : s;
}

export async function reportRoutes(app: FastifyInstance) {
  app.get('/ripoti', async (req, reply) => {
    const u = needUser(req);
    const p = periodOf(req);
    const q = query(req);
    const f: Filter = { ...p, duka: isUuid(q.duka) ? q.duka : null, mfanyakazi: isUuid(q.mfanyakazi) ? q.mfanyakazi : null };
    const [r, maduka, staff] = await Promise.all([
      report(u, f),
      u.role === 'owner' ? listMaduka(u.biashara_id) : Promise.resolve([]),
      u.role === 'owner' ? listStaff(u.biashara_id) : Promise.resolve([]),
    ]);
    const extra =
      u.role === 'owner'
        ? html`${select('Duka', 'duka', [{ value: '', label: 'Yote' }, ...maduka.map((d) => ({ value: d.id, label: d.jina }))], f.duka)}
            ${select('Mfanyakazi', 'mfanyakazi', [{ value: '', label: 'Wote' }, ...staff.map((s) => ({ value: s.id, label: `${s.jina}${s.active ? '' : ' (amezimwa)'}` }))], f.mfanyakazi)}`
        : '';
    const qs = new URLSearchParams({ from: f.from, to: f.to, kipindi: 'chagua', ...(f.duka ? { duka: f.duka } : {}), ...(f.mfanyakazi ? { mfanyakazi: f.mfanyakazi } : {}) });
    const t = r.totals;
    return send(
      reply,
      page(req, {
        title: u.role === 'owner' ? 'Ripoti' : 'Ripoti yangu',
        active: 'ripoti',
        actions: html`<a class="btn btn-ghost" href="/ripoti.csv?${qs.toString()}">Pakua Excel (CSV)</a>`,
        body: html`${periodFilters(p, extra)}
          <p class="muted small">${niceDate(f.from)}${f.from !== f.to ? ` hadi ${niceDate(f.to)}` : ''}</p>
          <div class="stats4">${stat('Kamisheni', tzs(t.kamisheni), 'green')}${stat('Miamala', num(t.idadi))}${stat('Tuma', tzs(t.tuma))}${stat('Toa', tzs(t.toa))}</div>
          ${t.zilizobatilishwa ? html`<p class="small muted">Zilizobatilishwa: ${t.zilizobatilishwa} (hazihesabiwi kwenye jumla)</p>` : ''}
          <div class="grid2">
            <section class="card"><h2>Kwa mtandao</h2>
              ${r.byNetwork.length ? html`<table class="tbl"><thead><tr><th>Mtandao</th><th class="num">Miamala</th><th class="num">Tuma</th><th class="num">Toa</th><th class="num">Kamisheni</th></tr></thead>
                <tbody>${r.byNetwork.map((x) => html`<tr><td>${netChip(x.mtandao)}</td><td class="num">${num(x.idadi)}</td><td class="num">${num(x.tuma)}</td><td class="num">${num(x.toa)}</td><td class="num strong">${tzs(x.kamisheni)}</td></tr>`)}</tbody></table>` : empty('Hakuna data')}
            </section>
            ${u.role === 'owner'
              ? html`<section class="card"><h2>Kwa mfanyakazi</h2>
                  ${r.byAgent.length ? html`<table class="tbl"><thead><tr><th>Mfanyakazi</th><th class="num">Miamala</th><th class="num">Tuma</th><th class="num">Toa</th><th class="num">Kamisheni</th></tr></thead>
                    <tbody>${r.byAgent.map((x) => html`<tr><td><a href="/ripoti?${new URLSearchParams({ ...Object.fromEntries(qs), mfanyakazi: x.id }).toString()}">${x.jina}</a>${x.zilizobatilishwa ? html` <small class="sub">bat. ${x.zilizobatilishwa}</small>` : ''}</td><td class="num">${num(x.idadi)}</td><td class="num">${num(x.tuma)}</td><td class="num">${num(x.toa)}</td><td class="num strong">${tzs(x.kamisheni)}</td></tr>`)}</tbody></table>` : empty('Hakuna data')}
                </section>`
              : html`<section class="card"><h2>Kwa siku</h2>
                  ${r.byDay.length ? html`<table class="tbl"><thead><tr><th>Siku</th><th class="num">Miamala</th><th class="num">Kamisheni</th></tr></thead>
                    <tbody>${r.byDay.map((x) => html`<tr><td>${niceDate(x.siku)}</td><td class="num">${num(x.idadi)}</td><td class="num strong">${tzs(x.kamisheni)}</td></tr>`)}</tbody></table>` : empty('Hakuna data')}
                </section>`}
          </div>
          ${u.role === 'owner' && r.byDuka.length > 1
            ? html`<section class="card"><h2>Kwa duka</h2><table class="tbl"><thead><tr><th>Duka</th><th class="num">Miamala</th><th class="num">Tuma</th><th class="num">Toa</th><th class="num">Kamisheni</th></tr></thead>
                <tbody>${r.byDuka.map((x) => html`<tr><td>${x.jina}</td><td class="num">${num(x.idadi)}</td><td class="num">${num(x.tuma)}</td><td class="num">${num(x.toa)}</td><td class="num strong">${tzs(x.kamisheni)}</td></tr>`)}</tbody></table></section>`
            : ''}
          ${u.role === 'owner' && r.byDay.length > 1
            ? html`<section class="card"><h2>Kwa siku</h2><table class="tbl"><thead><tr><th>Siku</th><th class="num">Miamala</th><th class="num">Tuma</th><th class="num">Toa</th><th class="num">Kamisheni</th></tr></thead>
                <tbody>${r.byDay.map((x) => html`<tr><td>${niceDate(x.siku)}</td><td class="num">${num(x.idadi)}</td><td class="num">${num(x.tuma)}</td><td class="num">${num(x.toa)}</td><td class="num strong">${tzs(x.kamisheni)}</td></tr>`)}</tbody></table></section>`
            : ''}
          <section class="card"><h2>Miamala (${num(r.txs.length)}${r.txs.length >= 1000 ? '+' : ''})</h2>${txTable(r.txs, { showAgent: u.role === 'owner', showDuka: u.role === 'owner' && maduka.length > 1 })}</section>`,
      }),
    );
  });

  app.get('/ripoti.csv', async (req, reply) => {
    const u = needUser(req);
    const p = periodOf(req);
    const q = query(req);
    const rows = await exportRows(u, { ...p, duka: isUuid(q.duka) ? q.duka : null, mfanyakazi: isUuid(q.mfanyakazi) ? q.mfanyakazi : null });
    const head = ['Risiti', 'Tarehe', 'Aina', 'Mtandao', 'Mteja', 'Simu', 'Kiasi', 'Kamisheni', 'Ref', 'Mfanyakazi', 'Duka', 'Hali'];
    const lines = rows.map((t) =>
      [t.id, dateTime(t.tarehe), t.aina === 'tuma' ? 'Tuma' : 'Toa', netLabel(t.mtandao), t.jina_mteja ?? '', phoneLocal(t.simu_mteja), t.kiasi, t.kamisheni,
       t.kumbukumbu_namba ?? '', t.mfanyakazi, t.duka, t.imebatilishwa ? `Imebatilishwa: ${t.sababu_kubatilisha ?? ''}` : 'Sawa'].map(csvCell).join(','),
    );
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="paypoint-ripoti-${p.from}_${p.to}.csv"`)
      .send(`﻿${[head.join(','), ...lines].join('\r\n')}`);
  });

  // ---------------------------------------------------------------- hesabu ya siku
  const countPage = async (req: FastifyRequest, error?: string) => {
    const u = needUser(req);
    const p = periodOf(req);
    const list = await listCounts(u, p.from, p.to);
    let formPart = html``;
    if (u.role === 'agent') {
      const a = needAgent(req);
      const [nets, b] = await Promise.all([dukaNetworks(db, a.duka_id), balances(db, a.duka_id)]);
      formPart = html`<form method="post" action="/hesabu" class="card" novalidate>
        <h2>Hesabu ya sasa — ${a.duka_jina ?? ''}</h2>
        <p class="muted small">Hesabu cash iliyopo mkononi na angalia salio la float kwenye kila laini, kisha andika hapa. Mfumo utalinganisha na hesabu yake na kumjulisha mmiliki kama kuna tofauti.</p>
        ${error ? html`<div class="flash flash-kosa" role="alert">${error}</div>` : ''}
        ${csrfField(req.csrf)}
        ${field('Cash halisi mkononi (TSh)', 'cash', { required: true, money: true })}
        ${nets.map((n) => field(`Float halisi — ${netLabel(n.mtandao)} (TSh)`, `float_${n.mtandao}`, { required: true, money: true }))}
        ${field('Maelezo', 'maelezo', { maxlength: 300 })}
        <button class="btn" type="submit" data-confirm="Hifadhi hesabu hii? Haiwezi kubadilishwa baadaye.">Hifadhi hesabu</button>
        <p class="muted small">Mfumo unatarajia sasa: cash ${tzs(b.cash)}${nets.map((n) => `, ${netLabel(n.mtandao)} ${tzs(b.floats[n.mtandao] ?? 0)}`).join('')}.</p>
      </form>`;
    }
    return page(req, {
      title: 'Hesabu ya siku',
      active: 'hesabu',
      body: html`${formPart}
        ${periodFilters(p)}
        <section class="card"><h2>Hesabu zilizohifadhiwa</h2>
          ${list.length
            ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Tarehe</th><th>Duka</th><th>Mfanyakazi</th><th class="num">Cash (mfumo / halisi)</th><th>Float</th><th>Matokeo</th></tr></thead>
                <tbody>${list.map((h) => html`<tr><td>${dateTime(h.tarehe)}</td><td>${h.duka}</td><td>${h.mfanyakazi}</td>
                  <td class="num">${num(h.cash_mfumo)} / ${num(h.cash_halisi)}</td>
                  <td>${h.floats.map((x) => html`<div class="small">${netLabel(x.mtandao)}: ${num(x.mfumo)} / ${num(x.halisi)}</div>`)}</td>
                  <td>${variance(Number(h.tofauti))}${h.maelezo ? html`<div class="small muted">${h.maelezo}</div>` : ''}</td></tr>`)}</tbody></table></div>`
            : empty('Hakuna hesabu kwa kipindi hiki.')}
        </section>`,
    });
  };
  app.get('/hesabu', async (req, reply) => send(reply, await countPage(req)));
  app.post('/hesabu', async (req, reply) => {
    const a = needAgent(req);
    const b = body(req);
    const nets = await dukaNetworks(db, a.duka_id);
    const missing = [str(b, 'cash'), ...nets.map((n) => str(b, `float_${n.mtandao}`))].some((v) => v.trim() === '');
    if (missing) return send(reply, await countPage(req, 'Jaza cash na float ya kila mtandao'), 400);
    const r = await tryForm(() =>
      submitCount(a, {
        cash: amount(b, 'cash'),
        floats: Object.fromEntries(nets.map((n) => [n.mtandao, amount(b, `float_${n.mtandao}`)])),
        maelezo: str(b, 'maelezo'),
      }, req.ip),
    );
    if (!r.ok) return send(reply, await countPage(req, r.error), 400);
    await setFlash(req, 'sawa', 'Hesabu imehifadhiwa');
    return reply.redirect('/hesabu');
  });

  // ---------------------------------------------------------------- kumbukumbu (audit log)
  app.get('/kumbukumbu', async (req, reply) => {
    const u = needOwner(req);
    const p = periodOf(req);
    const q = query(req);
    const kitendo = q.kitendo && q.kitendo in KITENDO_LABEL ? q.kitendo : '';
    const mtumiaji = isUuid(q.mtumiaji) ? q.mtumiaji! : '';
    const people = await many<{ id: string; jina: string; role: string }>(
      db, 'SELECT id, jina, role FROM paypoint.watumiaji WHERE biashara_id = $1 ORDER BY role DESC, jina', [u.biashara_id],
    );
    const rows = await many<{ id: number; jina: string | null; kitendo: string; maelezo: string; ip: string | null; tarehe: string }>(
      db,
      `SELECT id, jina, kitendo, maelezo, ip, tarehe FROM paypoint.kumbukumbu
        WHERE biashara_id = $1 AND (tarehe AT TIME ZONE 'Africa/Dar_es_Salaam')::date BETWEEN $2::date AND $3::date
          AND ($4 = '' OR kitendo = $4) AND ($5 = '' OR mtumiaji_id::text = $5)
        ORDER BY tarehe DESC, id DESC LIMIT 500`,
      [u.biashara_id, p.from, p.to, kitendo, mtumiaji],
    );
    const extra = html`${select('Kitendo', 'kitendo', [{ value: '', label: 'Vyote' }, ...Object.entries(KITENDO_LABEL).map(([value, label]) => ({ value, label }))], kitendo)}
      ${select('Mtumiaji', 'mtumiaji', [{ value: '', label: 'Wote' }, ...people.map((x) => ({ value: x.id, label: `${x.jina}${x.role === 'owner' ? ' (mmiliki)' : ''}` }))], mtumiaji)}`;
    return send(
      reply,
      page(req, {
        title: 'Kumbukumbu',
        active: 'kumbukumbu',
        body: html`${periodFilters(p, extra)}
          <p class="muted small">Kila kitendo kwenye mfumo kinarekodiwa hapa. Kumbukumbu haziwezi kubadilishwa wala kufutwa na mtu yeyote.</p>
          <section class="card">${rows.length
            ? html`<ul class="audit">${rows.map((a) => html`<li class="k-${a.kitendo}"><span class="k-tag">${KITENDO_LABEL[a.kitendo] ?? a.kitendo}</span>
                <div><p>${a.maelezo}</p><small>${a.jina ?? 'Mfumo'} · ${dateTime(a.tarehe)}${a.ip ? ` · ${a.ip}` : ''}</small></div></li>`)}</ul>`
            : empty('Hakuna kumbukumbu kwa kipindi hiki.')}</section>${raw('')}`,
      }),
    );
  });
}
