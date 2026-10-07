// Ofisi: wateja na madereva — kumtafuta mtu yeyote, kuona historia yake yote, na kutatua tatizo lake papo hapo.
import { escapeHtml as esc } from '/shared/api.js';
import { AUDIT_ACTIONS, DRIVER_STATUS, formatDate, formatPhone, formatTsh, SUPPORT_CATEGORIES, SUPPORT_STATUS, VEHICLE_TYPES } from '/shared/labels.js';
import { RIDE_STATUS } from './rides-admin.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, onAuthError }
const state = { filter: 'ALL', q: '' };
let current = null; // mtumiaji aliye wazi

const FILTERS = [
  ['ALL', 'Wote'],
  ['PASSENGERS', 'Abiria'],
  ['DRIVERS', 'Madereva'],
  ['NEW', 'Wapya (siku 7)'],
  ['UNVERIFIED', 'Namba haijathibitishwa'],
  ['SUSPENDED', 'Waliosimamishwa'],
];

const initials = (name) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
const tag = (tone, text) => `<span class="badge badge-${tone}">${esc(text)}</span>`;
const rideBadge = (s) => tag(RIDE_STATUS[s]?.[0] ?? 'muted', RIDE_STATUS[s]?.[1] ?? s);

function fail(err, boxId) {
  if (ctx.onAuthError(err)) return;
  $(boxId).textContent = err.message;
  $(boxId).hidden = false;
}

export function setup(context) {
  ctx = context;
  $('user-filters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-filter]');
    if (!chip) return;
    location.hash = `#/wateja?chuja=${chip.dataset.filter}${state.q ? `&q=${encodeURIComponent(state.q)}` : ''}`;
  });
  $('user-search').addEventListener('submit', (event) => {
    event.preventDefault();
    const q = $('user-q').value.trim();
    location.hash = `#/wateja?chuja=${q ? 'ALL' : state.filter}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  });
  $('user-detail').addEventListener('submit', onSubmit);
  $('user-detail').addEventListener('click', onClick);
}

// ------------------------------------------------------------------ orodha
export async function loadList(filter, q) {
  state.filter = FILTERS.some(([k]) => k === filter) ? filter : 'ALL';
  state.q = q ?? '';
  $('user-q').value = state.q;
  $('users-error').hidden = true;
  $('user-list').innerHTML = '<p class="empty">Inapakia…</p>';
  try {
    const params = new URLSearchParams({ filter: state.filter });
    if (state.q) params.set('q', state.q);
    const { users, counts } = await ctx.api.get(`/api/admin/users?${params}`);
    $('user-filters').innerHTML = FILTERS.map(
      ([k, label]) => `<button type="button" class="chip" data-filter="${k}" aria-pressed="${k === state.filter}">${label}<span>${counts[k] ?? 0}</span></button>`,
    ).join('');
    $('user-list').innerHTML = users.length
      ? users
          .map((u) => {
            const tags = [
              u.status === 'SUSPENDED' ? tag('bad', 'Amesimamishwa') : '',
              u.driverStatus ? `${tag(DRIVER_STATUS[u.driverStatus]?.tone ?? 'muted', `Dereva: ${DRIVER_STATUS[u.driverStatus]?.label ?? u.driverStatus}`)}` : '',
              u.online ? tag('ok', 'Online') : '',
              !u.phoneVerified ? tag('warn', 'Namba haijathibitishwa') : '',
              u.openTickets ? tag('warn', `Msaada ${u.openTickets}`) : '',
            ].join('');
            return `<a class="user-row" href="#/wateja/${esc(u.id)}">
              <span><span class="driver-name">${esc(u.fullName)}</span><br><span class="driver-sub">${esc(formatPhone(u.phone))}${u.plateNumber ? ` · ${esc(u.plateNumber)}` : ''}</span></span>
              <span class="driver-sub col-hide">Safari: abiria ${u.tripsAsPassenger}${u.tripsAsDriver ? ` · dereva ${u.tripsAsDriver}` : ''}</span>
              <span class="driver-sub col-hide">Alijiunga ${esc(formatDate(u.createdAt))}</span>
              <span class="tags">${tags || tag('muted', 'Abiria')}</span>
            </a>`;
          })
          .join('')
      : `<p class="empty">${state.q ? 'Hakuna mtumiaji anayelingana na utafutaji huu.' : 'Hakuna watumiaji kwenye kundi hili.'}</p>`;
  } catch (err) {
    $('user-list').innerHTML = '';
    fail(err, 'users-error');
  }
}

// ------------------------------------------------------------------ mtumiaji mmoja
export async function loadUser(id) {
  $('user-error').hidden = true;
  $('user-detail').innerHTML = '<p class="muted">Inapakia…</p>';
  try {
    render(await ctx.api.get(`/api/admin/users/${encodeURIComponent(id)}`));
  } catch (err) {
    $('user-detail').innerHTML = '';
    fail(err, 'user-error');
  }
}

export const currentUserId = () => current?.user.id ?? null;

function render(data) {
  current = data;
  const { user: u, driver: d, stats: st, rides, tickets, sos, notes, history, devices } = data;
  const suspended = u.status === 'SUSPENDED';
  const isDriver = d && ['APPROVED', 'SUSPENDED'].includes(d.status);
  $('user-detail').innerHTML = `
    <div class="profile-head">
      <span class="profile-avatar" aria-hidden="true">${esc(initials(u.fullName))}</span>
      <div>
        <h1>${esc(u.fullName)}</h1>
        <p class="muted"><a href="tel:+${esc(u.phone)}">${esc(formatPhone(u.phone))}</a> · Alijiunga ${esc(formatDate(u.createdAt))}${
          u.lastLoginAt ? ` · Aliingia mwisho ${esc(formatDate(u.lastLoginAt, true))}` : ''
        }</p>
        <div class="tags">
          ${suspended ? tag('bad', 'Akaunti imesimamishwa') : tag('ok', 'Akaunti iko hai')}
          ${u.phoneVerifiedAt ? tag('ok', 'Namba imethibitishwa') : tag('warn', 'Namba haijathibitishwa')}
          ${u.termsAcceptedAt ? tag('muted', `Masharti: alikubali ${formatDate(u.termsAcceptedAt)}`) : tag('warn', 'Bado hajakubali masharti')}
          ${d ? tag(DRIVER_STATUS[d.status]?.tone ?? 'muted', `Dereva: ${DRIVER_STATUS[d.status]?.label ?? d.status}`) : tag('muted', 'Abiria')}
          ${d?.online ? tag('ok', 'Online sasa') : ''}
          ${devices?.androidApp ? tag('ok', 'Ana app ya Android') : ''}
        </div>
      </div>
      <div class="profile-actions">
        <a class="btn btn-primary btn-small" href="tel:+${esc(u.phone)}">Piga simu</a>
        ${d ? `<a class="btn btn-ghost btn-small" href="#/madereva/${esc(u.id)}">Nyaraka za dereva</a>` : ''}
        <a class="btn btn-ghost btn-small" href="#/msaada?mtumiaji=${esc(u.id)}">Msaada wake</a>
      </div>
    </div>
    ${suspended && u.suspendedReason ? `<p class="alert alert-danger"><strong>Sababu ya kusimamishwa:</strong> ${esc(u.suspendedReason)}</p>` : ''}

    <div class="user-grid">
      <div>
        <section class="panel">
          <h2>Takwimu</h2>
          <div class="mini-stats">
            <div><strong>${st.passengerTrips}</strong><span>Safari kama abiria</span></div>
            <div><strong>${formatTsh(st.passengerSpent)}</strong><span>Amelipa (abiria)</span></div>
            <div><strong>${st.passengerCancels}</strong><span>Alizoghairi (abiria)</span></div>
            <div><strong>${st.passengerRating ?? '–'}</strong><span>Nyota kutoka kwa madereva</span></div>
            ${
              isDriver
                ? `<div><strong>${st.driverTrips}</strong><span>Safari kama dereva</span></div>
                   <div><strong>${formatTsh(st.driverEarned)}</strong><span>Mapato (dereva)</span></div>
                   <div><strong>${st.driverCancels}</strong><span>Alizoghairi (dereva)</span></div>
                   <div><strong>${st.driverRating ?? '–'}</strong><span>Nyota kutoka kwa abiria</span></div>`
                : ''
            }
          </div>
          ${
            isDriver
              ? `<p class="muted small" style="margin-top:10px">${esc(VEHICLE_TYPES[d.vehicleType] ?? '')} ${esc(d.plateNumber ?? '')} · ${esc(d.vehicleMake ?? '')} ${esc(
                  d.vehicleColor ?? '',
                )} · Ada mpaka ${esc(formatDate(d.paidUntil))}${d.lastSeenAt ? ` · Alionekana ${esc(formatDate(d.lastSeenAt, true))}` : ''}</p>`
              : ''
          }
        </section>

        <section class="panel">
          <h2>Safari za karibuni</h2>
          ${
            rides.length
              ? `<ul class="trip-list">${rides
                  .map(
                    (r) => `<li><a href="#/safari/${esc(r.id)}">
                      <strong>${esc(r.pickupName)} → ${esc(r.destinationName)}</strong>${rideBadge(r.status)}
                      <span class="muted">${esc(formatDate(r.requestedAt, true))} · ${r.as === 'DRIVER' ? 'Akiwa dereva' : 'Akiwa abiria'}${
                        r.otherName ? ` · na ${esc(r.otherName)}` : ''
                      }</span><span class="muted">${formatTsh(r.fare)}</span>
                    </a></li>`,
                  )
                  .join('')}</ul>`
              : '<p class="muted">Bado hana safari.</p>'
          }
        </section>

        <section class="panel">
          <h2>Msaada na dharura</h2>
          ${
            tickets.length || sos.length
              ? `<ul class="trip-list">${tickets
                  .map(
                    (t) => `<li><a href="#/msaada/${esc(t.id)}"><strong>${esc(t.subject)}</strong>${tag(SUPPORT_STATUS[t.status].tone, SUPPORT_STATUS[t.status].label)}
                      <span class="muted">${esc(SUPPORT_CATEGORIES[t.category] ?? t.category)} · ${esc(formatDate(t.updatedAt, true))}</span><span></span></a></li>`,
                  )
                  .join('')}${sos
                  .map(
                    (x) => `<li><a href="#/safari/${esc(x.rideId)}"><strong>Dharura (${x.role === 'DRIVER' ? 'dereva' : 'abiria'})</strong>${
                      x.status === 'OPEN' ? tag('bad', 'Wazi') : tag('muted', 'Imeshughulikiwa')
                    }<span class="muted">${esc(formatDate(x.createdAt, true))}</span><span></span></a></li>`,
                  )
                  .join('')}</ul>`
              : '<p class="muted">Hajaripoti tatizo lolote.</p>'
          }
        </section>

        <section class="panel">
          <h2>Historia ya hatua za ofisi</h2>
          ${
            history.length
              ? `<ul class="history">${history
                  .map(
                    (h) => `<li><span><strong>${esc(AUDIT_ACTIONS[h.action] ?? h.action)}</strong>${h.actorName ? ` — ${esc(h.actorName)}` : ''}</span><span class="muted">${esc(
                      formatDate(h.createdAt, true),
                    )}</span>${h.details?.reason || h.details?.body ? `<span class="note">${esc(h.details.reason ?? h.details.body)}</span>` : ''}</li>`,
                  )
                  .join('')}</ul>`
              : '<p class="muted">Hakuna hatua bado.</p>'
          }
        </section>
      </div>

      <div>
        <section class="panel">
          <h2>Mtumie ujumbe</h2>
          <form class="action-form" data-form="message">
            <label class="sr-only" for="um-body">Ujumbe</label>
            <textarea id="um-body" maxlength="300" placeholder="Mf. Habari, tumepokea malalamiko yako. Tutakupigia leo."></textarea>
            <label class="check"><input type="checkbox" id="um-sms" ${data.smsEnabled ? '' : 'disabled'}> Tuma pia kwa SMS${data.smsEnabled ? '' : ' (SMS hazijawashwa)'}</label>
            <p class="alert alert-ok" id="um-ok" role="status" hidden></p>
            <p class="alert alert-danger" id="um-error" role="alert" hidden></p>
            <div class="actions"><button class="btn btn-primary" type="submit">Tuma ujumbe</button></div>
          </form>
        </section>

        <section class="panel">
          <h2>Maelezo ya ndani</h2>
          <p class="muted small">Mtumiaji hayaoni. Andika mambo muhimu (mf. "alipiga simu kuhusu…").</p>
          <form class="action-form" data-form="note">
            <label class="sr-only" for="un-body">Maelezo</label>
            <textarea id="un-body" maxlength="1000"></textarea>
            <p class="alert alert-danger" id="un-error" role="alert" hidden></p>
            <div class="actions"><button class="btn btn-ghost" type="submit">Hifadhi maelezo</button></div>
          </form>
          ${
            notes.length
              ? `<ul class="note-list">${notes
                  .map((n) => `<li>${esc(n.body)}<br><span class="muted">${esc(n.authorName ?? 'Ofisi')} · ${esc(formatDate(n.createdAt, true))}</span></li>`)
                  .join('')}</ul>`
              : ''
          }
        </section>

        <section class="panel">
          <h2>Msaidie</h2>
          <div class="actions" style="margin-top:6px">
            ${u.phoneVerifiedAt ? '' : '<button class="btn btn-ghost btn-small" type="button" data-act="verify">Thibitisha namba yake</button>'}
            <button class="btn btn-ghost btn-small" type="button" data-act="temp">Mpe password ya muda</button>
            ${d?.online ? '<button class="btn btn-ghost btn-small" type="button" data-act="offline">Mtoe online</button>' : ''}
          </div>
          <div id="temp-box"></div>
          <p class="alert alert-danger" id="act-error" role="alert" hidden></p>
        </section>

        <section class="panel">
          ${
            suspended
              ? `<h2>Rudisha akaunti</h2><p class="muted small">Ataweza kuingia na kutumia NAYA tena.</p>
                 <div class="actions"><button class="btn btn-primary" type="button" data-act="reactivate">Rudisha akaunti</button></div>`
              : `<h2>Simamisha akaunti</h2><p class="muted small">Anatolewa kwenye app papo hapo na hawezi kuingia mpaka urudishe akaunti. Kwa dereva tu, tumia "Nyaraka za dereva → Simamisha".</p>
                 <form class="action-form" data-form="suspend">
                   <label for="us-reason">Sababu</label>
                   <textarea id="us-reason" maxlength="300"></textarea>
                   <div class="actions"><button class="btn btn-danger" type="submit">Simamisha akaunti</button></div>
                 </form>`
          }
          <p class="alert alert-danger" id="us-error" role="alert" hidden></p>
        </section>
      </div>
    </div>`;
}

async function run(button, errorId, work) {
  $(errorId).hidden = true;
  if (button) button.disabled = true;
  try {
    return await work();
  } catch (err) {
    fail(err, errorId);
    return null;
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

async function onSubmit(event) {
  const form = event.target.closest('[data-form]');
  if (!form || !current) return;
  event.preventDefault();
  const id = current.user.id;
  const button = form.querySelector('button[type="submit"]');
  if (form.dataset.form === 'message') {
    const res = await run(button, 'um-error', () => ctx.api.post(`/api/admin/users/${id}/message`, { body: $('um-body').value, sms: $('um-sms').checked }));
    if (res) {
      $('um-body').value = '';
      $('um-ok').textContent = res.smsSent ? 'Ujumbe umetumwa kwenye app na kwa SMS.' : 'Ujumbe umetumwa kwenye app.';
      $('um-ok').hidden = false;
    }
  }
  if (form.dataset.form === 'note') {
    const res = await run(button, 'un-error', () => ctx.api.post(`/api/admin/users/${id}/notes`, { body: $('un-body').value }));
    if (res) render(res);
  }
  if (form.dataset.form === 'suspend') {
    if (!confirm(`Simamisha akaunti ya ${current.user.fullName}?`)) return;
    const res = await run(button, 'us-error', () => ctx.api.post(`/api/admin/users/${id}/suspend`, { reason: $('us-reason').value }));
    if (res) render(res);
  }
}

async function onClick(event) {
  const button = event.target.closest('[data-act]');
  if (!button || !current) return;
  const id = current.user.id;
  const act = button.dataset.act;
  if (act === 'verify') {
    const res = await run(button, 'act-error', () => ctx.api.post(`/api/admin/users/${id}/verify-phone`));
    if (res) render(res);
  }
  if (act === 'offline') {
    const res = await run(button, 'act-error', () => ctx.api.post(`/api/admin/users/${id}/offline`));
    if (res) render(res);
  }
  if (act === 'reactivate') {
    const res = await run(button, 'us-error', () => ctx.api.post(`/api/admin/users/${id}/reactivate`));
    if (res) render(res);
  }
  if (act === 'temp') {
    if (!confirm('Password yake ya sasa itaacha kufanya kazi na atatolewa kwenye simu zote. Endelea?')) return;
    const res = await run(button, 'act-error', () => ctx.api.post(`/api/admin/users/${id}/temp-password`));
    if (!res) return;
    $('temp-box').innerHTML = res.smsSent
      ? '<p class="alert alert-ok">Password ya muda imetumwa kwake kwa SMS.</p>'
      : `<div class="secret-box"><strong>Password ya muda</strong><code>${esc(res.temporaryPassword)}</code>
          <span class="muted small">Mpigie umpe password hii. Inaonyeshwa mara hii moja tu — ikifungwa haionekani tena. Aibadilishe baada ya kuingia.</span></div>`;
  }
}
