import type { FastifyInstance, FastifyRequest } from 'fastify';
import { needUser, setFlash } from '../auth.js';
import { html } from '../html.js';
import { dateTime, num, phoneLocal, tzs } from '../format.js';
import { type Customer, getCustomer, listCustomers, saveCustomer } from '../services/customers.js';
import { page } from '../views/layout.js';
import { ainaChip, csrfField, empty, field, netChip } from '../views/ui.js';
import { body, isUuid, query, send, str, tryForm } from './util.js';
import { AppError } from '../errors.js';

function form(req: FastifyRequest, c: Partial<Customer> | null, error?: string) {
  const editing = !!c?.id;
  return page(req, {
    title: editing ? 'Badilisha mteja' : 'Mteja mpya',
    active: 'wateja',
    body: html`<form method="post" action="${editing ? `/wateja/${c!.id}` : '/wateja/ongeza'}" class="card narrow" novalidate>
      ${error ? html`<div class="flash flash-kosa" role="alert">${error}</div>` : ''}
      ${csrfField(req.csrf)}
      ${editing
        ? html`<div class="field"><span class="label">Namba ya simu</span><div class="static">${phoneLocal(c!.simu)}</div></div>`
        : field('Namba ya simu', 'simu', { required: true, type: 'tel', value: c?.simu, placeholder: '07XXXXXXXX', autofocus: true })}
      ${field('Jina la mteja', 'jina', { required: true, value: c?.jina, autofocus: editing })}
      ${field('Maelezo', 'maelezo', { value: c?.maelezo, maxlength: 300 })}
      <div class="btn-row"><button class="btn" type="submit">Hifadhi</button><a class="btn btn-ghost" href="${editing ? `/wateja/${c!.id}` : '/wateja'}">Ghairi</a></div>
    </form>`,
  });
}

export async function customerRoutes(app: FastifyInstance) {
  app.get('/wateja', async (req, reply) => {
    const u = needUser(req);
    const q = (query(req).q ?? '').slice(0, 60);
    const list = await listCustomers(u, q);
    return send(
      reply,
      page(req, {
        title: 'Wateja',
        active: 'wateja',
        actions: html`<a class="btn" href="/wateja/ongeza">+ Sajili mteja</a>`,
        body: html`<form method="get" class="search" role="search"><input type="search" name="q" value="${q}" placeholder="Tafuta kwa jina au namba ya simu" aria-label="Tafuta mteja"><button class="btn btn-ghost" type="submit">Tafuta</button></form>
          <p class="muted small">Mteja anasajiliwa yenyewe ukiweka namba yake kwenye muamala. Salio la mteja liko kwenye mtandao wake, si hapa.${u.role === 'agent' ? ' Idadi ya miamala ni ya kwako tu.' : ''}</p>
          ${list.length
            ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Jina</th><th>Simu</th><th class="num">Miamala</th><th class="num">Thamani</th><th>Mara ya mwisho</th></tr></thead>
                <tbody>${list.map((c) => html`<tr><td><a href="/wateja/${c.id}">${c.jina || 'Bila jina'}</a></td><td>${phoneLocal(c.simu)}</td><td class="num">${num(c.miamala)}</td><td class="num">${tzs(c.thamani)}</td><td>${c.mwisho ? dateTime(c.mwisho) : '-'}</td></tr>`)}</tbody></table></div>`
            : empty(q ? 'Hakuna mteja anayelingana na utafutaji.' : 'Bado hakuna mteja. Wanaongezwa wenyewe kwenye miamala, au sajili mmoja sasa.')}`,
      }),
    );
  });

  app.get('/wateja/ongeza', async (req, reply) => send(reply, form(req, null)));
  app.post('/wateja/ongeza', async (req, reply) => {
    const u = needUser(req);
    const b = body(req);
    const v = { jina: str(b, 'jina'), simu: str(b, 'simu'), maelezo: str(b, 'maelezo') };
    const r = await tryForm(() => saveCustomer(u, null, v, req.ip));
    if (!r.ok) return send(reply, form(req, v, r.error), 400);
    await setFlash(req, 'sawa', 'Mteja amesajiliwa');
    return reply.redirect(`/wateja/${r.value}`);
  });

  app.get('/wateja/:id', async (req, reply) => {
    const u = needUser(req);
    const id = (req.params as { id: string }).id;
    if (!isUuid(id)) throw new AppError('Mteja hayupo', 404);
    const { customer: c, txs } = await getCustomer(u, id);
    const live = txs.filter((t) => !t.imebatilishwa);
    const sum = (a: string) => live.filter((t) => t.aina === a).reduce((s, t) => s + Number(t.kiasi), 0);
    return send(
      reply,
      page(req, {
        title: c.jina || 'Mteja',
        active: 'wateja',
        actions: html`<a class="btn btn-ghost" href="/wateja/${c.id}/badilisha">Badilisha</a>`,
        body: html`<div class="hero hero-person">
            <div class="hero-big">${phoneLocal(c.simu)}</div>
            ${c.maelezo ? html`<p class="hero-note">${c.maelezo}</p>` : ''}
            <div class="today-row on-dark">
              <div class="stat"><span>Miamala</span><strong>${num(live.length)}</strong></div>
              <div class="stat"><span>Ametuma</span><strong>${tzs(sum('tuma'))}</strong></div>
              <div class="stat"><span>Ametoa</span><strong>${tzs(sum('toa'))}</strong></div>
            </div>
          </div>
          <section class="card"><h2>Miamala ${u.role === 'agent' ? 'yako na mteja huyu' : ''}</h2>
            ${txs.length
              ? html`<div class="table-wrap"><table class="tbl"><thead><tr><th>Risiti</th><th>Tarehe</th><th>Aina</th><th>Mtandao</th><th class="num">Kiasi</th><th>Mfanyakazi</th><th>Duka</th></tr></thead>
                  <tbody>${txs.map((t) => html`<tr class="${t.imebatilishwa ? 'voided' : ''}"><td><a href="/risiti/${t.id}">#${t.id}</a></td><td>${dateTime(t.tarehe)}</td><td>${ainaChip(t.aina)}</td><td>${netChip(t.mtandao)}</td><td class="num strong">${tzs(t.kiasi)}</td><td>${t.mfanyakazi}</td><td>${t.duka}</td></tr>`)}</tbody></table></div>`
              : empty('Hakuna muamala bado.')}
          </section>`,
      }),
    );
  });

  app.get('/wateja/:id/badilisha', async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!isUuid(id)) throw new AppError('Mteja hayupo', 404);
    const { customer } = await getCustomer(needUser(req), id);
    return send(reply, form(req, customer));
  });
  app.post('/wateja/:id', async (req, reply) => {
    const u = needUser(req);
    const id = (req.params as { id: string }).id;
    if (!isUuid(id)) throw new AppError('Mteja hayupo', 404);
    const b = body(req);
    const r = await tryForm(() => saveCustomer(u, id, { jina: str(b, 'jina'), simu: '', maelezo: str(b, 'maelezo') }, req.ip));
    if (!r.ok) {
      const { customer } = await getCustomer(u, id);
      return send(reply, form(req, { ...customer, jina: str(b, 'jina'), maelezo: str(b, 'maelezo') }, r.error), 400);
    }
    await setFlash(req, 'sawa', 'Taarifa za mteja zimehifadhiwa');
    return reply.redirect(`/wateja/${id}`);
  });
}
