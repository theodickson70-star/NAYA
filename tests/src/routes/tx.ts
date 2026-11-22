import type { FastifyInstance, FastifyRequest } from 'fastify';
import { needAgent, needUser, setFlash } from '../auth.js';
import { db } from '../db.js';
import { html, raw } from '../html.js';
import { config } from '../config.js';
import { type Network, NETWORKS, dateTime, netLabel, num, phoneLocal, tzs } from '../format.js';
import { balances, dukaNetworks, recordTransaction, reverseTransaction } from '../services/ledger.js';
import { customerByPhone } from '../services/customers.js';
import { getTx } from '../services/reports.js';
import { page } from '../views/layout.js';
import { ainaChip, csrfField, field, netChip } from '../views/ui.js';
import { amount, body, send, str, tryForm } from './util.js';
import { AppError } from '../errors.js';

async function txForm(req: FastifyRequest, aina: 'tuma' | 'toa', error?: string, v: Record<string, string> = {}) {
  const u = needAgent(req);
  const [nets, b] = await Promise.all([dukaNetworks(db, u.duka_id), balances(db, u.duka_id)]);
  const chosen = v.mtandao ?? nets[0]?.mtandao;
  const tuma = aina === 'tuma';
  return page(req, {
    title: tuma ? 'Tuma pesa' : 'Toa pesa',
    active: aina,
    body: html`<div class="grid2 form-side">
      <form method="post" action="/${aina}" class="card tx-form tx-${aina}" novalidate data-txform>
        <p class="muted">${tuma ? 'Mteja analeta cash, wewe unatuma pesa kwenye simu ya mpokeaji.' : 'Mteja anakutumia pesa kwenye namba yako ya wakala, wewe unampa cash.'}</p>
        ${error ? html`<div class="flash flash-kosa" role="alert">${error}</div>` : ''}
        ${csrfField(req.csrf)}
        <div class="field"><span class="label">Mtandao</span>
          <div class="nets">${nets.map(
            (n) => html`<label class="net-opt"><input type="radio" name="mtandao" value="${n.mtandao}" ${n.mtandao === chosen ? raw('checked') : ''} required>
              ${netChip(n.mtandao)}<small>Float: ${tzs(b.floats[n.mtandao] ?? 0)}</small></label>`,
          )}</div>
        </div>
        ${field(tuma ? 'Simu ya mpokeaji' : 'Simu ya mteja', 'simu', { required: true, type: 'tel', value: v.simu, placeholder: '07XXXXXXXX', autocomplete: 'off', autofocus: true, hint: 'Mteja mpya anasajiliwa yenyewe kwenye daftari' })}
        <div class="lookup" data-lookup aria-live="polite"></div>
        ${field('Jina la mteja', 'jina', { value: v.jina, autocomplete: 'off' })}
        ${field('Kiasi (TSh)', 'kiasi', { required: true, money: true, value: v.kiasi, placeholder: '0' })}
        <div class="quick" data-quick>${[5000, 10000, 20000, 50000, 100000].map((n) => html`<button type="button" class="chip" data-amount="${n}">${num(n)}</button>`)}</div>
        ${field('Namba ya muamala (Ref ya SMS)', 'kumbukumbu_namba', { value: v.kumbukumbu_namba, autocomplete: 'off', maxlength: 40 })}
        ${field('Maelezo', 'maelezo', { value: v.maelezo, maxlength: 200 })}
        <button class="btn btn-block btn-${aina}" type="submit">${tuma ? 'Hifadhi — Tuma' : 'Hifadhi — Toa'}</button>
      </form>
      <aside class="card side-note">
        <h2>Salio la duka</h2>
        <dl class="dl">
          <dt>Cash</dt><dd>${tzs(b.cash)}</dd>
          ${nets.map((n) => html`<dt>${netLabel(n.mtandao)}</dt><dd>${tzs(b.floats[n.mtandao] ?? 0)}</dd>`)}
        </dl>
        <p class="muted small">${tuma ? 'Kutuma kunapunguza float ya mtandao na kuongeza cash.' : 'Kutoa kunapunguza cash na kuongeza float ya mtandao.'} Kamisheni inahesabiwa yenyewe.</p>
      </aside>
    </div>`,
  });
}

function receipt(req: FastifyRequest, t: NonNullable<Awaited<ReturnType<typeof getTx>>>) {
  const u = needUser(req);
  const canReverse = u.role === 'agent' && t.mtumiaji_id === u.id && !t.imebatilishwa;
  const text = [
    `${t.biashara} — RISITI #${t.id}`,
    `${t.aina === 'tuma' ? 'Kutuma' : 'Kutoa'} ${netLabel(t.mtandao)}: ${tzs(t.kiasi)}`,
    t.simu_mteja ? `Mteja: ${t.jina_mteja ?? ''} ${phoneLocal(t.simu_mteja)}` : '',
    t.kumbukumbu_namba ? `Ref: ${t.kumbukumbu_namba}` : '',
    `Tarehe: ${dateTime(t.tarehe)}`,
    `Asante kwa kutumia ${t.duka}.`,
  ].filter(Boolean).join('\n');
  const wa = `https://wa.me/${t.simu_mteja ?? ''}?text=${encodeURIComponent(text)}`;
  return page(req, {
    title: `Risiti #${t.id}`,
    body: html`<div class="grid2">
      <div class="receipt card" id="risiti">
        <div class="r-head">
          <strong>${t.biashara}</strong>
          ${t.duka !== t.biashara || t.mahali ? html`<span>${[t.duka !== t.biashara ? t.duka : '', t.mahali ?? ''].filter(Boolean).join(' · ')}</span>` : ''}
          ${t.namba_leseni ? html`<span>Leseni: ${t.namba_leseni}</span>` : ''}
        </div>
        <div class="r-title">RISITI #${t.id}</div>
        ${t.imebatilishwa ? html`<div class="r-void">IMEBATILISHWA<small>${t.sababu_kubatilisha ?? ''}</small></div>` : ''}
        <dl class="r-lines">
          <dt>Aina</dt><dd>${t.aina === 'tuma' ? 'Kutuma pesa' : 'Kutoa pesa'}</dd>
          <dt>Mtandao</dt><dd>${netLabel(t.mtandao)}</dd>
          <dt>Mteja</dt><dd>${t.jina_mteja ?? '-'}<br>${phoneLocal(t.simu_mteja)}</dd>
          ${t.kumbukumbu_namba ? html`<dt>Ref</dt><dd>${t.kumbukumbu_namba}</dd>` : ''}
          <dt>Tarehe</dt><dd>${dateTime(t.tarehe)}</dd>
          <dt>Mhudumu</dt><dd>${t.mfanyakazi}</dd>
        </dl>
        <div class="r-amount"><span>KIASI</span><b>${tzs(t.kiasi)}</b></div>
        <p class="r-foot">Asante kwa kutumia huduma zetu · ${config.appName}</p>
      </div>
      <div class="card no-print">
        <h2>Vitendo</h2>
        <p>${ainaChip(t.aina)} ${netChip(t.mtandao)} <span class="muted">Kamisheni: ${tzs(t.kamisheni)}</span></p>
        <div class="btn-row">
          <button class="btn" type="button" data-print>Chapisha risiti</button>
          ${t.simu_mteja ? html`<a class="btn btn-ghost" href="${wa}" target="_blank" rel="noopener">Tuma kwa WhatsApp</a>` : ''}
          ${u.role === 'agent' ? html`<a class="btn btn-ghost" href="/${t.aina}">Muamala mwingine</a>` : ''}
        </div>
        ${canReverse
          ? html`<details class="reverse"><summary>Umekosea? Batilisha muamala huu</summary>
              <form method="post" action="/miamala/${t.id}/batilisha" data-confirm="Batilisha muamala huu? Utabaki kwenye rekodi na mmiliki ataarifiwa.">
                ${csrfField(req.csrf)}
                ${field('Sababu', 'sababu', { required: true, maxlength: 200, placeholder: 'mf. kiasi kimekosewa' })}
                <button class="btn btn-danger" type="submit">Batilisha</button>
                <p class="muted small">Muamala haufutwi: unabaki kwenye rekodi ukiwa na alama "Imebatilishwa". Inawezekana siku hiyo hiyo tu.</p>
              </form></details>`
          : ''}
      </div>
    </div>`,
  });
}

export async function txRoutes(app: FastifyInstance) {
  for (const aina of ['tuma', 'toa'] as const) {
    app.get(`/${aina}`, async (req, reply) => send(reply, await txForm(req, aina)));
    app.post(`/${aina}`, async (req, reply) => {
      const u = needAgent(req);
      const b = body(req);
      const mtandao = str(b, 'mtandao') as Network;
      const r = await tryForm(async () => {
        if (!(NETWORKS as readonly string[]).includes(mtandao)) throw new AppError('Chagua mtandao');
        return recordTransaction(
          u,
          {
            aina,
            mtandao,
            simu: str(b, 'simu'),
            jina: str(b, 'jina'),
            kiasi: amount(b, 'kiasi'),
            kumbukumbu_namba: str(b, 'kumbukumbu_namba'),
            maelezo: str(b, 'maelezo'),
          },
          req.ip,
        );
      });
      if (!r.ok) {
        const v = Object.fromEntries(['mtandao', 'simu', 'jina', 'kiasi', 'kumbukumbu_namba', 'maelezo'].map((k) => [k, str(b, k)]));
        return send(reply, await txForm(req, aina, r.error, v), 400);
      }
      await setFlash(req, 'sawa', `Muamala #${r.value} umehifadhiwa`);
      return reply.redirect(`/risiti/${r.value}`);
    });
  }

  app.get('/risiti/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Risiti haipo', 404);
    const t = await getTx(needUser(req), id);
    if (!t) throw new AppError('Risiti haipo', 404);
    return send(reply, receipt(req, t));
  });

  app.post('/miamala/:id/batilisha', async (req, reply) => {
    const u = needUser(req);
    const id = Number((req.params as { id: string }).id);
    const r = await tryForm(() => reverseTransaction(u, id, str(body(req), 'sababu'), req.ip));
    await setFlash(req, r.ok ? 'sawa' : 'kosa', r.ok ? `Muamala #${id} umebatilishwa. Mmiliki amearifiwa.` : r.error);
    return reply.redirect(`/risiti/${id}`);
  });

  // Kutafuta mteja kwa simu wakati wa kuandika muamala
  app.get('/api/mteja', async (req) => {
    const u = needUser(req);
    const c = await customerByPhone(u, String((req.query as { simu?: string }).simu ?? ''));
    return { mteja: c ? { jina: c.jina, simu: phoneLocal(c.simu) } : null };
  });
}
