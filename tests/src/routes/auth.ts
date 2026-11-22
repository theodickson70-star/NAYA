import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { checkPassword, endSession, needUser, setFlash, startSession } from '../auth.js';
import { db, one } from '../db.js';
import { html, raw } from '../html.js';
import { NETWORKS, NETWORK_LABEL } from '../format.js';
import { audit } from '../services/audit.js';
import { changeOwnPassword, registerBusiness } from '../services/business.js';
import { outside, page } from '../views/layout.js';
import { csrfField, field } from '../views/ui.js';
import { arr, body, query, send, str, tryForm } from './util.js';

// Hash ya kubahatisha: muda wa jibu unalingana username ikiwepo au isipokuwepo
const DUMMY_HASH = bcrypt.hashSync('paypoint-dummy', 10);

function safeNext(n: string | undefined) {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

function loginForm(req: FastifyRequest, error?: string, username = '', next = '/') {
  return outside(
    'Ingia',
    html`<form method="post" action="/ingia" class="card form-card" novalidate>
      <h1>Ingia</h1>
      <p class="muted">Mmiliki na wafanyakazi wanaingia hapa kwa username na password.</p>
      ${error ? html`<div class="flash flash-kosa" role="alert">${error}</div>` : ''}
      ${csrfField(req.csrf)}
      <input type="hidden" name="rudi" value="${next}">
      ${field('Username', 'username', { required: true, value: username, autocomplete: 'username', autofocus: !username })}
      ${field('Password', 'password', { required: true, type: 'password', autocomplete: 'current-password', autofocus: !!username })}
      <button class="btn btn-block" type="submit">Ingia</button>
      <p class="center">Mmiliki mpya? <a href="/sajili">Sajili duka lako</a></p>
    </form>`,
  );
}

function registerForm(req: FastifyRequest, error?: string, v: Record<string, string | string[]> = {}) {
  const chosen = new Set((v.mitandao as string[] | undefined) ?? ['mpesa', 'mixx', 'airtel']);
  const val = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : '');
  return outside(
    'Sajili duka',
    html`<form method="post" action="/sajili" class="card form-card" novalidate>
      <h1>Sajili duka jipya</h1>
      <p class="muted">Wewe ndiye mmiliki. Baadaye utaongeza wafanyakazi na maduka mengine.</p>
      ${error ? html`<div class="flash flash-kosa" role="alert">${error}</div>` : ''}
      ${csrfField(req.csrf)}
      <fieldset><legend>Duka</legend>
        ${field('Jina la duka', 'jina_duka', { required: true, value: val('jina_duka'), placeholder: 'mf. Juma Wakala Sokoni' })}
        <div class="row2">
          ${field('Namba ya leseni', 'namba_leseni', { value: val('namba_leseni') })}
          ${field('Mahali', 'mahali', { value: val('mahali'), placeholder: 'mf. Sokoni, Urambo' })}
        </div>
        <div class="field"><span class="label">Mitandao unayohudumia</span>
          <div class="checks">${NETWORKS.map((n) => html`<label class="check"><input type="checkbox" name="mitandao" value="${n}" ${chosen.has(n) ? raw('checked') : ''}> ${NETWORK_LABEL[n]}</label>`)}</div>
        </div>
      </fieldset>
      <fieldset><legend>Mmiliki</legend>
        ${field('Jina lako kamili', 'jina', { required: true, value: val('jina'), autocomplete: 'name' })}
        ${field('Namba ya simu', 'simu', { required: true, value: val('simu'), type: 'tel', placeholder: '07XXXXXXXX', autocomplete: 'tel' })}
        ${field('Username', 'username', { required: true, value: val('username'), autocomplete: 'username', hint: 'Herufi ndogo na namba, bila nafasi (mf. juma)' })}
        ${field('Password', 'password', { required: true, type: 'password', autocomplete: 'new-password', hint: 'Angalau herufi 6' })}
      </fieldset>
      <button class="btn btn-block" type="submit">Sajili duka</button>
      <p class="center">Una akaunti tayari? <a href="/ingia">Ingia</a></p>
    </form>`,
  );
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/ingia', async (req, reply) => {
    if (req.user) return reply.redirect('/');
    return send(reply, loginForm(req, undefined, '', safeNext(query(req).rudi)));
  });

  app.post('/ingia', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const b = body(req);
    const username = str(b, 'username').trim().toLowerCase();
    const password = str(b, 'password');
    const next = safeNext(str(b, 'rudi'));
    const u = await one<{ id: string; biashara_id: string; jina: string; password_hash: string; active: boolean }>(
      db,
      'SELECT id, biashara_id, jina, password_hash, active FROM paypoint.watumiaji WHERE lower(username) = $1',
      [username],
    );
    const ok = await checkPassword(password, u?.password_hash ?? DUMMY_HASH);
    if (!u || !ok) {
      if (u) await audit(db, { id: u.id, biashara_id: u.biashara_id, jina: u.jina }, 'login_failed', 'Jaribio la kuingia kwa password isiyo sahihi', req.ip);
      return send(reply, loginForm(req, 'Username au password si sahihi', username, next), 401);
    }
    if (!u.active) return send(reply, loginForm(req, 'Akaunti yako imezimwa. Wasiliana na mmiliki.', username, next), 403);
    await startSession(reply, u.id, req);
    await db.query('UPDATE paypoint.watumiaji SET ameingia_mwisho = now() WHERE id = $1', [u.id]);
    await audit(db, { id: u.id, biashara_id: u.biashara_id, jina: u.jina }, 'login', 'Ameingia kwenye mfumo', req.ip);
    return reply.redirect(next);
  });

  app.post('/toka', async (req, reply) => {
    if (req.user) await audit(db, { id: req.user.id, biashara_id: req.user.biashara_id, jina: req.user.jina }, 'logout', 'Ametoka kwenye mfumo', req.ip);
    await endSession(req, reply);
    return reply.redirect('/ingia');
  });

  app.get('/sajili', async (req, reply) => {
    if (req.user) return reply.redirect('/');
    return send(reply, registerForm(req));
  });

  app.post('/sajili', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const b = body(req);
    const r = await tryForm(() =>
      registerBusiness(
        {
          jina_duka: str(b, 'jina_duka'),
          namba_leseni: str(b, 'namba_leseni'),
          mahali: str(b, 'mahali'),
          mitandao: arr(b, 'mitandao'),
          jina: str(b, 'jina'),
          simu: str(b, 'simu'),
          username: str(b, 'username'),
          password: str(b, 'password'),
        },
        req.ip,
      ),
    );
    if (!r.ok) {
      const { password: _p, _csrf: _c, ...keep } = b;
      return send(reply, registerForm(req, r.error, { ...(keep as Record<string, string>), mitandao: arr(b, 'mitandao') }), 400);
    }
    await startSession(reply, r.value, req);
    return reply.redirect('/?karibu=1');
  });

  // Akaunti yangu: kubadilisha password (lazima kwa mfanyakazi mpya)
  const accountPage = (req: FastifyRequest, error?: string) => {
    const u = needUser(req);
    return page(req, {
      title: 'Akaunti yangu',
      body: html`<div class="grid2">
        <form method="post" action="/akaunti" class="card" novalidate>
          <h2>Badilisha password</h2>
          ${u.lazima_abadilishe_password ? html`<div class="flash flash-tahadhari">Kwa usalama, weka password yako mwenyewe kabla ya kuendelea.</div>` : ''}
          ${error ? html`<div class="flash flash-kosa" role="alert">${error}</div>` : ''}
          ${csrfField(req.csrf)}
          ${field('Password ya sasa', 'sasa', { required: true, type: 'password', autocomplete: 'current-password' })}
          ${field('Password mpya', 'mpya', { required: true, type: 'password', autocomplete: 'new-password', hint: 'Angalau herufi 6' })}
          ${field('Rudia password mpya', 'mpya2', { required: true, type: 'password', autocomplete: 'new-password' })}
          <button class="btn" type="submit">Hifadhi password</button>
        </form>
        <div class="card">
          <h2>Taarifa zangu</h2>
          <dl class="dl">
            <dt>Jina</dt><dd>${u.jina}</dd>
            <dt>Username</dt><dd>@${u.username}</dd>
            <dt>Nafasi</dt><dd>${u.role === 'owner' ? 'Mmiliki' : 'Mfanyakazi'}</dd>
            <dt>Biashara</dt><dd>${u.biashara_jina}</dd>
            ${u.duka_jina ? html`<dt>Duka</dt><dd>${u.duka_jina}</dd>` : ''}
          </dl>
        </div>
      </div>`,
    });
  };

  app.get('/akaunti', async (req, reply) => send(reply, accountPage(req)));
  app.post('/akaunti', async (req, reply) => {
    const u = needUser(req);
    const b = body(req);
    if (str(b, 'mpya') !== str(b, 'mpya2')) return send(reply, accountPage(req, 'Password mpya hazilingani'), 400);
    const r = await tryForm(() => changeOwnPassword({ id: u.id, biashara_id: u.biashara_id, jina: u.jina }, str(b, 'sasa'), str(b, 'mpya'), req.ip));
    if (!r.ok) return send(reply, accountPage(req, r.error), 400);
    await setFlash(req, 'sawa', 'Password imebadilishwa');
    return reply.redirect('/');
  });
}
