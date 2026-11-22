import type { FastifyInstance, FastifyRequest } from 'fastify';
import { needOwner, setFlash } from '../auth.js';
import { html } from '../html.js';
import { dateTime, phoneLocal } from '../format.js';
import { addStaff, listMaduka, listStaff, moveStaff, resetStaffPassword, toggleStaff } from '../services/business.js';
import { page } from '../views/layout.js';
import { csrfField, empty, field, select } from '../views/ui.js';
import { body, isUuid, send, str, tryForm } from './util.js';
import { AppError } from '../errors.js';

async function addForm(req: FastifyRequest, error?: string, v: Record<string, string> = {}) {
  const u = needOwner(req);
  const maduka = (await listMaduka(u.biashara_id)).filter((d) => d.active);
  return page(req, {
    title: 'Ongeza mfanyakazi',
    active: 'wafanyakazi',
    body: html`<form method="post" action="/wafanyakazi/ongeza" class="card narrow" novalidate>
      ${error ? html`<div class="flash flash-kosa" role="alert">${error}</div>` : ''}
      ${csrfField(req.csrf)}
      ${field('Jina kamili', 'jina', { required: true, value: v.jina, autofocus: true })}
      ${field('Namba ya simu', 'simu', { type: 'tel', value: v.simu, placeholder: '07XXXXXXXX' })}
      ${select('Duka atakalofanyia kazi', 'duka_id', maduka.map((d) => ({ value: d.id, label: d.jina })), v.duka_id, { required: true })}
      ${field('Username', 'username', { required: true, value: v.username, autocomplete: 'off', hint: 'Herufi ndogo na namba, bila nafasi (mf. asha.sokoni)' })}
      ${field('Password ya muda', 'password', { required: true, type: 'text', autocomplete: 'off', hint: 'Mpe mfanyakazi. Ataombwa kuweka password yake mwenyewe akiingia mara ya kwanza.' })}
      <div class="btn-row"><button class="btn" type="submit">Ongeza mfanyakazi</button><a class="btn btn-ghost" href="/wafanyakazi">Ghairi</a></div>
    </form>`,
  });
}

export async function staffRoutes(app: FastifyInstance) {
  app.get('/wafanyakazi', async (req, reply) => {
    const u = needOwner(req);
    const [list, maduka] = await Promise.all([listStaff(u.biashara_id), listMaduka(u.biashara_id)]);
    const opts = maduka.filter((d) => d.active).map((d) => ({ value: d.id, label: d.jina }));
    return send(
      reply,
      page(req, {
        title: 'Wafanyakazi',
        active: 'wafanyakazi',
        actions: html`<a class="btn" href="/wafanyakazi/ongeza">+ Ongeza mfanyakazi</a>`,
        body: list.length
          ? html`<div class="staff">${list.map(
              (s) => html`<article class="card staff-card ${s.active ? '' : 'off'}">
                <div class="staff-top">
                  <div class="avatar">${s.jina.trim()[0]?.toUpperCase() ?? '?'}</div>
                  <div><h2>${s.jina}</h2><p class="muted">@${s.username}${s.simu ? ` · ${phoneLocal(s.simu)}` : ''}</p></div>
                  <span class="pill ${s.active ? 'pill-on' : 'pill-void'}">${s.active ? 'Hai' : 'Amezimwa'}</span>
                </div>
                <p class="small muted">Duka: <b>${s.duka_jina ?? 'Hajapangiwa'}</b> · Aliingia mwisho: ${s.ameingia_mwisho ? dateTime(s.ameingia_mwisho) : 'bado'}</p>
                <div class="staff-actions">
                  <form method="post" action="/wafanyakazi/${s.id}/badilisha" data-confirm="${s.active ? `Zima akaunti ya ${s.jina}? Atatolewa kwenye mfumo papo hapo.` : `Washa akaunti ya ${s.jina}?`}">
                    ${csrfField(req.csrf)}<button class="btn ${s.active ? 'btn-danger-ghost' : 'btn-ghost'}" type="submit">${s.active ? 'Zima' : 'Washa'}</button></form>
                  <a class="btn btn-ghost" href="/ripoti?mfanyakazi=${s.id}">Ripoti yake</a>
                  <a class="btn btn-ghost" href="/kumbukumbu?mtumiaji=${s.id}">Kumbukumbu</a>
                </div>
                <details><summary>Hamisha duka / weka password mpya</summary>
                  <form method="post" action="/wafanyakazi/${s.id}/duka" class="inline-form">${csrfField(req.csrf)}
                    ${select('Duka', 'duka_id', opts, s.duka_id)}<button class="btn btn-ghost" type="submit">Hamisha</button></form>
                  <form method="post" action="/wafanyakazi/${s.id}/password" class="inline-form">${csrfField(req.csrf)}
                    ${field('Password mpya ya muda', 'password', { required: true, autocomplete: 'off' })}<button class="btn btn-ghost" type="submit">Weka</button></form>
                </details>
              </article>`,
            )}</div>`
          : empty('Bado huna mfanyakazi.', html`<a class="btn" href="/wafanyakazi/ongeza">Ongeza mfanyakazi wa kwanza</a>`),
      }),
    );
  });

  app.get('/wafanyakazi/ongeza', async (req, reply) => send(reply, await addForm(req)));
  app.post('/wafanyakazi/ongeza', async (req, reply) => {
    const u = needOwner(req);
    const b = body(req);
    const v = { jina: str(b, 'jina'), username: str(b, 'username'), simu: str(b, 'simu'), password: str(b, 'password'), duka_id: str(b, 'duka_id') };
    const r = await tryForm(() => addStaff({ id: u.id, biashara_id: u.biashara_id, jina: u.jina }, v, req.ip));
    if (!r.ok) return send(reply, await addForm(req, r.error, { ...v, password: '' }), 400);
    await setFlash(req, 'sawa', `${v.jina.trim()} ameongezwa. Mpe username @${v.username.trim().toLowerCase()} na password ya muda.`);
    return reply.redirect('/wafanyakazi');
  });

  const idOf = (req: FastifyRequest) => {
    const id = (req.params as { id: string }).id;
    if (!isUuid(id)) throw new AppError('Mfanyakazi hayupo', 404);
    return id;
  };
  // Kuzima / kuwasha (prompt: /mfanyakazi/badilisha/<id>)
  const toggle = async (req: FastifyRequest, id: string) => {
    const u = needOwner(req);
    const active = await toggleStaff({ id: u.id, biashara_id: u.biashara_id, jina: u.jina }, id, req.ip);
    await setFlash(req, 'sawa', active ? 'Mfanyakazi amewashwa' : 'Mfanyakazi amezimwa na ametolewa kwenye mfumo');
  };
  app.post('/wafanyakazi/:id/badilisha', async (req, reply) => {
    await toggle(req, idOf(req));
    return reply.redirect('/wafanyakazi');
  });
  app.post('/mfanyakazi/badilisha/:id', async (req, reply) => {
    await toggle(req, idOf(req));
    return reply.redirect('/wafanyakazi');
  });
  app.post('/wafanyakazi/:id/duka', async (req, reply) => {
    const u = needOwner(req);
    const r = await tryForm(() => moveStaff({ id: u.id, biashara_id: u.biashara_id, jina: u.jina }, idOf(req), str(body(req), 'duka_id'), req.ip));
    await setFlash(req, r.ok ? 'sawa' : 'kosa', r.ok ? 'Mfanyakazi amehamishwa' : r.error);
    return reply.redirect('/wafanyakazi');
  });
  app.post('/wafanyakazi/:id/password', async (req, reply) => {
    const u = needOwner(req);
    const r = await tryForm(() => resetStaffPassword({ id: u.id, biashara_id: u.biashara_id, jina: u.jina }, idOf(req), str(body(req), 'password'), req.ip));
    await setFlash(req, r.ok ? 'sawa' : 'kosa', r.ok ? 'Password ya muda imewekwa. Ataombwa kuibadilisha akiingia.' : r.error);
    return reply.redirect('/wafanyakazi');
  });
}


