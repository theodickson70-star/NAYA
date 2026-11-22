import type { FastifyInstance, FastifyRequest } from 'fastify';
import { needOwner, setFlash } from '../auth.js';
import { html, raw } from '../html.js';
import { NETWORKS, NETWORK_LABEL, tzs } from '../format.js';
import { type Duka, type DukaInput, getDuka, listMaduka, saveDuka } from '../services/business.js';
import { page } from '../views/layout.js';
import { csrfField, field, netChip } from '../views/ui.js';
import { amount, body, isUuid, send, str, tryForm } from './util.js';
import { AppError } from '../errors.js';

function form(req: FastifyRequest, d: Partial<Duka> | null, error?: string) {
  const editing = !!d?.id;
  const nets = new Map((d?.mitandao ?? [{ mtandao: 'mpesa', namba_wakala: null }]).map((m) => [m.mtandao, m.namba_wakala]));
  return page(req, {
    title: editing ? `Badilisha ${d!.jina}` : 'Ongeza duka',
    active: 'maduka',
    body: html`<form method="post" action="${editing ? `/maduka/${d!.id}` : '/maduka/ongeza'}" class="card narrow" novalidate>
      ${error ? html`<div class="flash flash-kosa" role="alert">${error}</div>` : ''}
      ${csrfField(req.csrf)}
      ${field('Jina la duka', 'jina', { required: true, value: d?.jina })}
      <div class="row2">${field('Namba ya leseni', 'namba_leseni', { value: d?.namba_leseni })}${field('Mahali', 'mahali', { value: d?.mahali })}</div>
      <div class="field"><span class="label">Mitandao na namba za wakala</span>
        <div class="net-rows">${NETWORKS.map(
          (n) => html`<div class="net-row"><label class="check"><input type="checkbox" name="net_${n}" value="1" ${nets.has(n) ? raw('checked') : ''}> ${NETWORK_LABEL[n]}</label>
            <input name="namba_${n}" value="${nets.get(n) ?? ''}" placeholder="Namba ya wakala / till" aria-label="Namba ya wakala ${NETWORK_LABEL[n]}"></div>`,
        )}</div></div>
      <div class="row2">
        ${field('Tahadhari float ikishuka chini ya (TSh)', 'float_chini', { money: true, value: d?.float_chini ?? 100000, required: true })}
        ${field('Tahadhari cash ikishuka chini ya (TSh)', 'cash_chini', { money: true, value: d?.cash_chini ?? 100000, required: true })}
      </div>
      ${editing ? html`<label class="check"><input type="checkbox" name="active" value="1" ${d!.active ? raw('checked') : ''}> Duka liko hai (likizimwa, wafanyakazi wake hawawezi kurekodi miamala)</label>` : ''}
      <div class="btn-row"><button class="btn" type="submit">Hifadhi</button><a class="btn btn-ghost" href="/maduka">Ghairi</a></div>
    </form>`,
  });
}

function input(b: ReturnType<typeof body>, editing: boolean): DukaInput {
  return {
    jina: str(b, 'jina'),
    namba_leseni: str(b, 'namba_leseni'),
    mahali: str(b, 'mahali'),
    active: editing ? str(b, 'active') === '1' : true,
    float_chini: amount(b, 'float_chini'),
    cash_chini: amount(b, 'cash_chini'),
    mitandao: Object.fromEntries(NETWORKS.map((n) => [n, { on: str(b, `net_${n}`) === '1', namba: str(b, `namba_${n}`) }])),
  };
}
function asDuka(i: DukaInput, id?: string): Partial<Duka> {
  return {
    id, jina: i.jina, namba_leseni: i.namba_leseni ?? null, mahali: i.mahali ?? null, active: i.active ?? true,
    float_chini: i.float_chini, cash_chini: i.cash_chini,
    mitandao: NETWORKS.filter((n) => i.mitandao[n]?.on).map((n) => ({ mtandao: n, namba_wakala: i.mitandao[n]?.namba ?? null })),
  };
}

export async function dukaRoutes(app: FastifyInstance) {
  app.get('/maduka', async (req, reply) => {
    const u = needOwner(req);
    const list = await listMaduka(u.biashara_id);
    return send(
      reply,
      page(req, {
        title: 'Maduka',
        active: 'maduka',
        actions: html`<a class="btn" href="/maduka/ongeza">+ Ongeza duka</a>`,
        body: html`<div class="cards3">${list.map(
          (d) => html`<article class="card ${d.active ? '' : 'off'}">
            <div class="card-head"><h2>${d.jina}</h2><span class="pill ${d.active ? 'pill-on' : 'pill-void'}">${d.active ? 'Hai' : 'Limezimwa'}</span></div>
            <p class="muted small">${d.mahali ?? ''}${d.namba_leseni ? ` · Leseni ${d.namba_leseni}` : ''}</p>
            <ul class="list">${d.mitandao.map((m) => html`<li>${netChip(m.mtandao)}<span class="muted">${m.namba_wakala ?? '—'}</span></li>`)}</ul>
            <p class="small muted">Tahadhari: float &lt; ${tzs(d.float_chini)} · cash &lt; ${tzs(d.cash_chini)}</p>
            <div class="btn-row"><a class="btn btn-ghost" href="/maduka/${d.id}">Badilisha</a><a class="btn btn-ghost" href="/float?duka=${d.id}">Float</a></div>
          </article>`,
        )}</div>`,
      }),
    );
  });
  app.get('/maduka/ongeza', async (req, reply) => {
    needOwner(req);
    return send(reply, form(req, null));
  });
  app.post('/maduka/ongeza', async (req, reply) => {
    const u = needOwner(req);
    const i = input(body(req), false);
    const r = await tryForm(() => saveDuka({ id: u.id, biashara_id: u.biashara_id, jina: u.jina }, null, i, req.ip));
    if (!r.ok) return send(reply, form(req, asDuka(i), r.error), 400);
    await setFlash(req, 'sawa', 'Duka limeongezwa. Weka float na cash ya kuanzia.');
    return reply.redirect(`/float?duka=${r.value}`);
  });
  app.get('/maduka/:id', async (req, reply) => {
    const u = needOwner(req);
    const id = (req.params as { id: string }).id;
    if (!isUuid(id)) throw new AppError('Duka halipo', 404);
    return send(reply, form(req, await getDuka(u.biashara_id, id)));
  });
  app.post('/maduka/:id', async (req, reply) => {
    const u = needOwner(req);
    const id = (req.params as { id: string }).id;
    if (!isUuid(id)) throw new AppError('Duka halipo', 404);
    const i = input(body(req), true);
    const r = await tryForm(() => saveDuka({ id: u.id, biashara_id: u.biashara_id, jina: u.jina }, id, i, req.ip));
    if (!r.ok) return send(reply, form(req, asDuka(i, id), r.error), 400);
    await setFlash(req, 'sawa', 'Duka limehifadhiwa');
    return reply.redirect('/maduka');
  });
}
