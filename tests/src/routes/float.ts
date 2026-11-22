import type { FastifyInstance, FastifyRequest } from 'fastify';
import { needOwner, setFlash } from '../auth.js';
import { db, many } from '../db.js';
import { html, raw } from '../html.js';
import { dateTime, netLabel, tzs } from '../format.js';
import { listMaduka } from '../services/business.js';
import { HARAKATI_LABEL, balances, recordMovement } from '../services/ledger.js';
import { page } from '../views/layout.js';
import { csrfField, empty, field, select } from '../views/ui.js';
import { balancePanel } from './home.js';
import { amount, body, query, send, str, tryForm } from './util.js';

async function floatPage(req: FastifyRequest, dukaId?: string, error?: string, v: Record<string, string> = {}) {
  const u = needOwner(req);
  const maduka = await listMaduka(u.biashara_id);
  if (!maduka.length) return page(req, { title: 'Float', active: 'float', body: empty('Ongeza duka kwanza.', html`<a class="btn" href="/maduka/ongeza">Ongeza duka</a>`) });
  const duka = maduka.find((d) => d.id === dukaId) ?? maduka[0];
  const salio = await balances(db, duka.id);
  const history = await many<{ aina: string; mtandao: string | null; kiasi: number; maelezo: string | null; tarehe: string; jina: string }>(
    db,
    `SELECT h.aina, h.mtandao, h.kiasi, h.maelezo, h.tarehe, u.jina FROM paypoint.harakati h JOIN paypoint.watumiaji u ON u.id = h.mtumiaji_id
      WHERE h.duka_id = $1 ORDER BY h.tarehe DESC LIMIT 100`,
    [duka.id],
  );
  const aina = v.aina ?? 'float_ingia';
  return page(req, {
    title: 'Float na cash',
    active: 'float',
    body: html`
      ${maduka.length > 1
        ? html`<form method="get" class="filters">${select('Duka', 'duka', maduka.map((d) => ({ value: d.id, label: d.jina })), duka.id, { submitOnChange: true })}<noscript><button class="btn btn-ghost">Onyesha</button></noscript></form>`
        : ''}
      <div class="grid2">
        <div>${balancePanel({ ...duka, salio })}</div>
        <form method="post" action="/float" class="card" novalidate data-movement>
          <h2>Ongeza au toa float / cash</h2>
          <p class="muted small">Ni wewe (mmiliki) pekee unayeweza kubadilisha float na cash. Kila kitendo kinaingia kwenye kumbukumbu.</p>
          ${error ? html`<div class="flash flash-kosa" role="alert">${error}</div>` : ''}
          ${csrfField(req.csrf)}
          <input type="hidden" name="duka_id" value="${duka.id}">
          ${select('Kitendo', 'aina', Object.entries(HARAKATI_LABEL).map(([value, label]) => ({ value, label })), aina)}
          <div data-net-field>${select('Mtandao', 'mtandao', duka.mitandao.map((m) => ({ value: m.mtandao, label: netLabel(m.mtandao) })), v.mtandao)}</div>
          ${field('Kiasi (TSh)', 'kiasi', { required: true, money: true, value: v.kiasi })}
          ${field('Maelezo', 'maelezo', { value: v.maelezo, maxlength: 200, placeholder: 'mf. float kutoka benki' })}
          <button class="btn btn-block" type="submit">Hifadhi</button>
        </form>
      </div>
      <section class="card"><h2>Historia ya float na cash — ${duka.jina}</h2>
        ${history.length
          ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Tarehe</th><th>Kitendo</th><th>Mtandao</th><th class="num">Kiasi</th><th>Maelezo</th><th>Na</th></tr></thead>
              <tbody>${history.map((h) => html`<tr><td>${dateTime(h.tarehe)}</td><td>${HARAKATI_LABEL[h.aina] ?? h.aina}</td><td>${h.mtandao ? netLabel(h.mtandao) : '-'}</td><td class="num strong">${tzs(h.kiasi)}</td><td>${h.maelezo ?? ''}</td><td>${h.jina}</td></tr>`)}</tbody></table></div>`
          : empty('Bado hakuna float wala cash iliyowekwa kwenye duka hili.')}
      </section>${raw('')}`,
  });
}

export async function floatRoutes(app: FastifyInstance) {
  app.get('/float', async (req, reply) => send(reply, await floatPage(req, query(req).duka)));
  app.post('/float', async (req, reply) => {
    const u = needOwner(req);
    const b = body(req);
    const v = { duka_id: str(b, 'duka_id'), aina: str(b, 'aina'), mtandao: str(b, 'mtandao'), kiasi: str(b, 'kiasi'), maelezo: str(b, 'maelezo') };
    const r = await tryForm(() =>
      recordMovement({ id: u.id, biashara_id: u.biashara_id, jina: u.jina }, { ...v, kiasi: amount(b, 'kiasi') }, req.ip),
    );
    if (!r.ok) return send(reply, await floatPage(req, v.duka_id, r.error, v), 400);
    await setFlash(req, 'sawa', `${HARAKATI_LABEL[v.aina]}: ${tzs(amount(b, 'kiasi'))} imehifadhiwa`);
    return reply.redirect(`/float?duka=${encodeURIComponent(v.duka_id)}`);
  });
}
