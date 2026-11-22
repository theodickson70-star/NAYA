import type { FastifyInstance, FastifyRequest } from 'fastify';
import { needOwner, setFlash } from '../auth.js';
import { html } from '../html.js';
import { NETWORKS, NETWORK_LABEL, tzs } from '../format.js';
import { addTier, commissionSettings, deleteTier, saveRates } from '../services/business.js';
import { page } from '../views/layout.js';
import { csrfField, field, netChip, select } from '../views/ui.js';
import { amount, body, isUuid, send, str, tryForm } from './util.js';

async function settingsPage(req: FastifyRequest, error?: string) {
  const u = needOwner(req);
  const { rates, tiers } = await commissionSettings(u.biashara_id);
  const rate = (n: string, a: string) => rates.find((r) => r.mtandao === n && r.aina === a);
  return page(req, {
    title: 'Kamisheni',
    active: 'kamisheni',
    body: html`
      ${error ? html`<div class="flash flash-kosa" role="alert">${error}</div>` : ''}
      <form method="post" action="/kamisheni" class="card" novalidate>
        <h2>Asilimia kwa kila mtandao</h2>
        <p class="muted small">Kamisheni = asilimia × kiasi, lakini isiwe chini ya kiwango cha chini. Ngazi (hapo chini) zikiwekwa kwa kiasi fulani, zinatumika badala ya asilimia.</p>
        ${csrfField(req.csrf)}
        <div class="table-wrap"><table class="tbl rates"><thead><tr><th>Mtandao</th><th>Tuma %</th><th>Tuma chini (TSh)</th><th>Toa %</th><th>Toa chini (TSh)</th></tr></thead>
          <tbody>${NETWORKS.map((n) => {
            const t = rate(n, 'tuma');
            const o = rate(n, 'toa');
            return html`<tr><td>${netChip(n)}</td>
              <td><input name="${n}_tuma_pct" value="${t?.asilimia ?? 1}" inputmode="decimal" aria-label="${NETWORK_LABEL[n]} tuma asilimia"></td>
              <td><input name="${n}_tuma_min" value="${t?.kiwango_chini ?? 100}" inputmode="numeric" aria-label="${NETWORK_LABEL[n]} tuma kiwango cha chini"></td>
              <td><input name="${n}_toa_pct" value="${o?.asilimia ?? 1.5}" inputmode="decimal" aria-label="${NETWORK_LABEL[n]} toa asilimia"></td>
              <td><input name="${n}_toa_min" value="${o?.kiwango_chini ?? 100}" inputmode="numeric" aria-label="${NETWORK_LABEL[n]} toa kiwango cha chini"></td></tr>`;
          })}</tbody></table></div>
        <button class="btn" type="submit">Hifadhi asilimia</button>
      </form>
      <section class="card">
        <h2>Ngazi za kamisheni (hiari)</h2>
        <p class="muted small">Weka kama mtandao unavyolipa kwa ngazi, mf. M-Pesa Toa TSh 1,001 – 3,000 = TSh 160.</p>
        ${tiers.length
          ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Mtandao</th><th>Aina</th><th class="num">Kuanzia</th><th class="num">Hadi</th><th class="num">Kamisheni</th><th></th></tr></thead>
              <tbody>${tiers.map((t) => html`<tr><td>${netChip(t.mtandao)}</td><td>${t.aina === 'tuma' ? 'Tuma' : 'Toa'}</td><td class="num">${tzs(t.kuanzia)}</td><td class="num">${tzs(t.hadi)}</td><td class="num strong">${tzs(t.kamisheni)}</td>
                <td><form method="post" action="/kamisheni/ngazi/${t.id}/futa">${csrfField(req.csrf)}<button class="link-btn" type="submit">Ondoa</button></form></td></tr>`)}</tbody></table></div>`
          : html`<p class="muted">Hakuna ngazi bado — asilimia ndizo zinazotumika.</p>`}
        <form method="post" action="/kamisheni/ngazi" class="tier-form" novalidate>
          ${csrfField(req.csrf)}
          ${select('Mtandao', 'mtandao', NETWORKS.map((n) => ({ value: n, label: NETWORK_LABEL[n] })))}
          ${select('Aina', 'aina', [{ value: 'toa', label: 'Toa' }, { value: 'tuma', label: 'Tuma' }])}
          ${field('Kuanzia (TSh)', 'kuanzia', { money: true, required: true })}
          ${field('Hadi (TSh)', 'hadi', { money: true, required: true })}
          ${field('Kamisheni (TSh)', 'kamisheni', { money: true, required: true })}
          <button class="btn btn-ghost" type="submit">Ongeza ngazi</button>
        </form>
      </section>`,
  });
}

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/kamisheni', async (req, reply) => send(reply, await settingsPage(req)));
  app.post('/kamisheni', async (req, reply) => {
    const u = needOwner(req);
    const b = body(req);
    const num = (k: string) => Number(str(b, k).replace(',', '.'));
    const rates = NETWORKS.flatMap((n) =>
      (['tuma', 'toa'] as const).map((a) => ({ mtandao: n, aina: a, asilimia: num(`${n}_${a}_pct`), kiwango_chini: amount(b, `${n}_${a}_min`) })),
    );
    const r = await tryForm(() => saveRates({ id: u.id, biashara_id: u.biashara_id, jina: u.jina }, rates, req.ip));
    if (!r.ok) return send(reply, await settingsPage(req, r.error), 400);
    await setFlash(req, 'sawa', 'Asilimia za kamisheni zimehifadhiwa');
    return reply.redirect('/kamisheni');
  });
  app.post('/kamisheni/ngazi', async (req, reply) => {
    const u = needOwner(req);
    const b = body(req);
    const r = await tryForm(() =>
      addTier({ id: u.id, biashara_id: u.biashara_id, jina: u.jina }, {
        mtandao: str(b, 'mtandao'), aina: str(b, 'aina'), kuanzia: amount(b, 'kuanzia'), hadi: amount(b, 'hadi'), kamisheni: amount(b, 'kamisheni'),
      }, req.ip),
    );
    if (!r.ok) return send(reply, await settingsPage(req, r.error), 400);
    await setFlash(req, 'sawa', 'Ngazi imeongezwa');
    return reply.redirect('/kamisheni');
  });
  app.post('/kamisheni/ngazi/:id/futa', async (req, reply) => {
    const u = needOwner(req);
    const id = (req.params as { id: string }).id;
    if (isUuid(id)) await deleteTier({ id: u.id, biashara_id: u.biashara_id, jina: u.jina }, id, req.ip);
    await setFlash(req, 'sawa', 'Ngazi imeondolewa');
    return reply.redirect('/kamisheni');
  });
}
