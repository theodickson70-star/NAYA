import type { FastifyInstance } from 'fastify';
import { needAgent, needOwner, needUser, setFlash } from '../auth.js';
import { db, many } from '../db.js';
import { html } from '../html.js';
import { dateTime, niceDate, num, phoneLocal, tzs } from '../format.js';
import { agentDashboard, ownerDashboard, type TxRow } from '../services/reports.js';
import { page } from '../views/layout.js';
import { ainaChip, barChart, csrfField, empty, netChip, stat, variance } from '../views/ui.js';
import { query, send } from './util.js';

export function txTable(txs: TxRow[], opts: { showAgent?: boolean; showDuka?: boolean } = {}) {
  if (!txs.length) return empty('Hakuna muamala bado.');
  return html`<div class="table-wrap"><table class="tbl tx">
    <thead><tr><th>Risiti</th><th>Saa</th><th>Aina</th><th>Mteja</th><th class="num">Kiasi</th><th class="num">Kamisheni</th>${opts.showAgent ? html`<th>Mfanyakazi</th>` : ''}${opts.showDuka ? html`<th>Duka</th>` : ''}</tr></thead>
    <tbody>${txs.map(
      (t) => html`<tr class="${t.imebatilishwa ? 'voided' : ''}">
        <td class="c-id"><a href="/risiti/${t.id}">#${t.id}</a></td>
        <td class="c-time">${dateTime(t.tarehe)}</td>
        <td class="c-chips">${ainaChip(t.aina)} ${netChip(t.mtandao)}${t.imebatilishwa ? html` <span class="pill pill-void" title="${t.sababu_kubatilisha ?? ''}">Imebatilishwa</span>` : ''}</td>
        <td class="c-mteja">${t.mteja_id ? html`<a href="/wateja/${t.mteja_id}">${t.jina_mteja || 'Bila jina'}</a>` : t.jina_mteja || '-'}<small class="sub">${phoneLocal(t.simu_mteja)}</small></td>
        <td class="num strong c-kiasi">${tzs(t.kiasi)}</td>
        <td class="num c-kam"><span class="m-only">Kamisheni </span>${num(t.kamisheni)}</td>
        ${opts.showAgent ? html`<td class="c-agent">${t.mfanyakazi}</td>` : ''}${opts.showDuka ? html`<td class="c-duka">${t.duka}</td>` : ''}
      </tr>`,
    )}</tbody></table></div>`;
}

function balancePanel(d: { jina: string; active: boolean; float_chini: number; cash_chini: number; mitandao: { mtandao: string }[]; salio: { cash: number; floats: Record<string, number> } }, heading = true) {
  const nets = d.mitandao.map((m) => m.mtandao);
  for (const k of Object.keys(d.salio.floats)) if (!nets.includes(k) && d.salio.floats[k] !== 0) nets.push(k);
  return html`<div class="hero">
    ${heading ? html`<div class="hero-top"><strong>${d.jina}</strong>${d.active ? '' : html`<span class="pill pill-void">Limezimwa</span>`}</div>` : ''}
    <span class="hero-label">Cash mkononi</span>
    <div class="hero-big ${d.salio.cash < d.cash_chini ? 'low' : ''}">${tzs(d.salio.cash)}</div>
    <ul class="floats">${nets.map((n) => {
      const v = d.salio.floats[n] ?? 0;
      return html`<li><span>${netChip(n)}</span><b class="${v < d.float_chini ? 'low' : ''}">${tzs(v)}</b></li>`;
    })}</ul>
  </div>`;
}

export async function homeRoutes(app: FastifyInstance) {
  app.get('/', async (req, reply) => {
    const u = needUser(req);
    const welcome = query(req).karibu === '1';
    if (u.role === 'owner') {
      const d = await ownerDashboard(u);
      const firstRun = d.maduka.every((m) => m.salio.cash === 0 && Object.values(m.salio.floats).every((v) => v === 0));
      return send(
        reply,
        page(req, {
          title: 'Dashibodi',
          active: 'home',
          body: html`
            ${welcome || firstRun
              ? html`<div class="card steps"><h2>Anza hapa</h2><ol>
                  <li><a href="/float">Weka float na cash ya kuanzia</a> kwenye duka lako.</li>
                  <li><a href="/wafanyakazi/ongeza">Ongeza wafanyakazi</a> na uwapangie duka.</li>
                  <li><a href="/kamisheni">Kagua viwango vya kamisheni</a> (chaguo-msingi: Tuma 1%, Toa 1.5%, angalau TSh 100).</li>
                  <li>Wafanyakazi wanaingia na kuanza kurekodi miamala.</li></ol></div>`
              : ''}
            <section class="today">
              <div class="today-main">
                <span class="hero-label">Kamisheni ya leo</span>
                <div class="hero-big gold">${tzs(d.today.kamisheni)}</div>
                <div class="today-row">${stat('Miamala', num(d.today.idadi))}${stat('Tuma', tzs(d.today.tuma))}${stat('Toa', tzs(d.today.toa))}</div>
              </div>
              <div class="today-chart"><span class="hero-label">Kamisheni — siku 7</span>
                ${barChart(d.series.map((s) => ({ label: niceDate(s.siku).split(' ').slice(0, 2).join(' '), value: s.kamisheni })), (n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)))}
              </div>
            </section>
            ${d.arifa.length
              ? html`<section class="card"><div class="card-head"><h2>Arifa mpya</h2><a href="/arifa">Zote (${d.unread})</a></div>
                  <ul class="alerts">${d.arifa.map((a) => html`<li class="alert-${a.aina}"><span>${a.ujumbe}</span><small>${dateTime(a.tarehe)}</small></li>`)}</ul></section>`
              : ''}
            <h2 class="section-title">Maduka</h2>
            <div class="cards3">${d.maduka.map((m) => html`<div>${balancePanel(m)}<p class="under"><a href="/float?duka=${m.id}">Weka / toa float</a> · <a href="/ripoti?duka=${m.id}">Ripoti</a></p></div>`)}</div>
            <section class="card"><div class="card-head"><h2>Miamala ya karibuni</h2><a href="/ripoti">Ripoti kamili</a></div>
              ${txTable(d.latest, { showAgent: true, showDuka: d.maduka.length > 1 })}</section>
            ${d.hesabu.length
              ? html`<section class="card"><div class="card-head"><h2>Hesabu za karibuni</h2><a href="/hesabu">Zote</a></div>
                  <ul class="list">${d.hesabu.map((h) => html`<li><span><b>${h.duka}</b> · ${h.mfanyakazi} · ${dateTime(h.tarehe)}</span>${variance(Number(h.tofauti))}</li>`)}</ul></section>`
              : ''}`,
        }),
      );
    }
    const a = needAgent(req);
    const d = await agentDashboard(a);
    return send(
      reply,
      page(req, {
        title: d.duka.jina,
        active: 'home',
        body: html`
          ${balancePanel({ ...d.duka, mitandao: d.mitandao, salio: d.salio }, false)}
          <div class="actions-big">
            <a class="big big-tuma" href="/tuma"><span class="big-ic">↙</span><b>TUMA</b><small>Mteja analeta cash, unatuma pesa</small></a>
            <a class="big big-toa" href="/toa"><span class="big-ic">↗</span><b>TOA</b><small>Mteja anatoa pesa, unampa cash</small></a>
          </div>
          <div class="today-row">${stat('Miamala yangu leo', num(d.totals.idadi))}${stat('Kamisheni yangu leo', tzs(d.totals.kamisheni), 'green')}${stat('Tuma / Toa', `${tzs(d.totals.tuma)} / ${tzs(d.totals.toa)}`)}</div>
          <section class="card"><div class="card-head"><h2>Miamala yangu leo</h2><a href="/ripoti">Ripoti</a></div>
            <p class="muted small">Umekosea muamala? Fungua risiti yake ubatilishe (siku hiyo hiyo tu, kwa sababu).</p>
            ${d.txs.length ? txTable(d.txs) : empty('Bado hujafanya muamala leo.')}</section>`,
      }),
    );
  });

  app.get('/arifa', async (req, reply) => {
    const u = needOwner(req);
    const rows = await many<{ id: number; aina: string; ujumbe: string; imesomwa: boolean; tarehe: string }>(
      db, 'SELECT id, aina, ujumbe, imesomwa, tarehe FROM paypoint.arifa WHERE biashara_id = $1 ORDER BY tarehe DESC LIMIT 300', [u.biashara_id],
    );
    return send(
      reply,
      page(req, {
        title: 'Arifa',
        actions: rows.some((r) => !r.imesomwa)
          ? html`<form method="post" action="/arifa/soma">${csrfField(req.csrf)}<button class="btn btn-ghost" type="submit">Weka zote zimesomwa</button></form>`
          : undefined,
        body: rows.length
          ? html`<section class="card"><ul class="alerts">${rows.map((a) => html`<li class="alert-${a.aina} ${a.imesomwa ? 'read' : ''}"><span>${a.ujumbe}</span><small>${dateTime(a.tarehe)}</small></li>`)}</ul></section>`
          : empty('Hakuna arifa. Utaarifiwa float au cash ikishuka, muamala ukibatilishwa, au hesabu ikiwa na tofauti.'),
      }),
    );
  });

  app.post('/arifa/soma', async (req, reply) => {
    const u = needOwner(req);
    await db.query('UPDATE paypoint.arifa SET imesomwa = true WHERE biashara_id = $1 AND NOT imesomwa', [u.biashara_id]);
    await setFlash(req, 'sawa', 'Arifa zote zimewekwa kuwa zimesomwa');
    return reply.redirect('/arifa');
  });
}

export { balancePanel };
