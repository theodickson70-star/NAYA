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

function loadUserPhoto(u) {
  if (!u.hasPhoto) return;
  ctx.api
    .blob(`/api/admin/users/${u.id}/photo?v=${encodeURIComponent(u.photoUpdatedAt ?? '')}`)
    .then((blob) => {
      const el = $('user-photo');
      if (el) el.innerHTML = `<img src="${URL.createObjectURL(blob)}" alt="">`;
    })
    .catch(() => {});
}

function render(data) {
  setTimeout(() => loadUserPhoto(data.user), 0);
  setTimeout(() => loadMoney(data.user.id), 0);
  current = data;
  const { user: u, driver: d, stats: st, rides, tickets, sos, notes, history, devices } = data;
  const suspended = u.status === 'SUSPENDED';
  const isDriver = d && ['APPROVED', 'SUSPENDED'].includes(d.status);
  $('user-detail').innerHTML = `
    <div class="profile-head">
      <span class="profile-avatar" id="user-photo" aria-hidden="true">${esc(initials(u.fullName))}</span>
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
        ${u.emergencyPhone ? `<p class="small">Mtu wa dharura: <strong>${esc(u.emergencyName || '–')}</strong> · <a href="tel:+${esc(u.emergencyPhone)}">${esc(formatPhone(u.emergencyPhone))}</a></p>` : ''}
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
        <section class="panel um-money" id="um-money" aria-labelledby="um-money-h">
          <h2 id="um-money-h">Pesa za mteja</h2>
          <p class="muted">Inapakia…</p>
        </section>

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
  if (event.target.id === 'rf-form') return onRefundSubmit(event);
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

// ------------------------------------------------------------------ Pesa za mteja: salio + kumrudishia pesa (0.24.0)

let money = null;
const SETTLE = { MOBILE: 'alilipa kwa simu', WALLET: 'alilipa kwa salio', CASH: 'taslimu', DEBT: 'deni' };
const REF_STATUS = { PENDING: ['warn', 'Inatumwa'], SUCCESS: ['ok', 'Imefika'], FAILED: ['bad', 'Imeshindwa'] };

async function loadMoney(userId) {
  const box = $('um-money');
  if (!box) return;
  try {
    money = await ctx.api.get(`/api/admin/users/${userId}/money`);
    if (current?.user.id !== userId || !$('um-money')) return;
    drawMoney();
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    box.innerHTML = `<h2>Pesa za mteja</h2><p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
  }
}

function rideOption(r) {
  const paid = r.paidByPhone ? `${formatTsh(r.paidByPhone)} kwa simu` : r.settlement ? `${formatTsh(r.due)} ${SETTLE[r.settlement] ?? ''}` : formatTsh(r.due);
  const when = formatDate(r.completedAt ?? r.requestedAt, true);
  return `<option value="${esc(r.id)}" data-amount="${esc(r.paidByPhone ?? r.due)}" data-needed="${r.fareRefund === 'NEEDED' ? 1 : ''}">${
    r.fareRefund === 'NEEDED' ? 'INAHITAJI KURUDISHWA · ' : ''
  }${esc(r.from)} → ${esc(r.to)} · ${esc(when)} · ${esc(paid)}</option>`;
}

function drawMoney(result = null) {
  const m = money;
  const needed = m.rides.filter((r) => r.fareRefund === 'NEEDED');
  const want = new URLSearchParams(location.hash.split('?')[1] ?? '').get('rudisha');
  const history = [
    ...m.refunds.map((r) => ({
      at: r.createdAt,
      html: `<li><span><strong>${formatTsh(r.amount)} kwa simu</strong> ${tag(REF_STATUS[r.status][0], REF_STATUS[r.status][1])}</span><span class="muted">${esc(formatDate(r.createdAt, true))} · ${esc(
        formatPhone(r.phone),
      )}${r.createdBy ? ` · ${esc(r.createdBy)}` : ''}</span><span class="note">${esc(r.note ?? '')}${r.failureReason ? ` — ${esc(r.failureReason)}` : ''}${r.providerRef ? ` · ${esc(r.providerRef)}` : ''}</span></li>`,
    })),
    ...m.entries
      .filter((e) => e.kind === 'REFUND' || e.kind === 'ADJUSTMENT')
      .map((e) => ({
        at: e.createdAt,
        html: `<li><span><strong>${e.amount > 0 ? '+' : '−'}${formatTsh(Math.abs(e.amount))} kwenye salio</strong> ${tag('ok', 'Papo hapo')}</span><span class="muted">${esc(formatDate(e.createdAt, true))}${
          e.createdBy ? ` · ${esc(e.createdBy)}` : ''
        }</span>${e.note ? `<span class="note">${esc(e.note)}</span>` : ''}</li>`,
      })),
  ]
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 10);
  $('um-money').innerHTML = `
    <h2 id="um-money-h">Pesa za mteja</h2>
    <div class="mini-stats um-money-stats">
      <div><strong>${formatTsh(m.balance)}</strong><span>Salio la NAYA${m.cashoutRequested ? ' · ameomba kurudishiwa' : ''}</span></div>
      <div><strong>${formatTsh(m.limits.phoneLeftToday)}</strong><span>Marejesho kwa simu yaliyobaki leo (NAYA nzima)</span></div>
    </div>
    ${needed.length ? `<p class="alert alert-danger" role="alert"><strong>Safari ${needed.length} ${needed.length === 1 ? 'inasubiri' : 'zinasubiri'} kurudishiwa pesa.</strong> Ichague hapa chini.</p>` : ''}
    ${
      result
        ? result.status === 'FAILED'
          ? `<p class="alert alert-danger" role="alert">Kutuma kwenda ${esc(result.to)} kumeshindwa${result.failureReason ? `: ${esc(result.failureReason)}` : '.'} Hakuna pesa iliyotoka — jaribu namba nyingine au rudisha kwenye salio.</p>`
          : result.salio
            ? '<p class="alert alert-ok" role="status">Pesa imeingia kwenye Salio la NAYA la mteja papo hapo. Mteja amejulishwa.</p>'
            : `<p class="alert alert-ok" role="status">${result.status === 'SUCCESS' ? 'Pesa imefika' : 'Pesa inatumwa'}${result.to ? ` kwenda ${esc(result.to)}` : ''}. Mteja amejulishwa.</p>`
        : ''
    }
    <details class="um-refund"${needed.length || want ? ' open' : ''}>
      <summary><strong>Mrudishie pesa</strong></summary>
      <form class="action-form" id="rf-form" novalidate>
        <label for="rf-ride">Safari husika <span class="muted">(si lazima)</span></label>
        <select id="rf-ride"><option value="">— Bila safari (fidia / malalamiko ya jumla) —</option>${m.rides.map(rideOption).join('')}</select>
        <div class="settings-grid">
          <div><label for="rf-amount">Kiasi (TSh)</label><input id="rf-amount" inputmode="numeric" autocomplete="off" placeholder="0"></div>
          <div><label for="rf-reason">Sababu</label><select id="rf-reason">${m.reasons.map((r) => `<option value="${r.code}">${esc(r.label)}</option>`).join('')}</select></div>
        </div>
        <fieldset class="rf-to"><legend>Rudisha wapi</legend>
          <label class="check"><input type="radio" name="rf-to" value="SALIO" checked> Salio la NAYA <span class="muted small">— papo hapo, bila ada; anatumia kwa safari au anaomba kurudishiwa</span></label>
          <label class="check"><input type="radio" name="rf-to" value="PHONE"${m.canPhone ? '' : ' disabled'}> Namba ya simu <span class="muted small">— Abliner inatuma; NAYA inabeba ada${m.canPhone ? '' : ' (haipatikani sasa)'}</span></label>
        </fieldset>
        <div id="rf-phone-box" hidden><label for="rf-phone">Namba ya kupokea</label><input id="rf-phone" type="tel" inputmode="tel" value="${esc(formatPhone(m.phone))}"></div>
        <label for="rf-note">Maelezo (yanaonekana kwenye historia)</label>
        <textarea id="rf-note" maxlength="250" placeholder="Mf. Alikatwa mara mbili tarehe 20/10 — kumbukumbu ya Abliner ABC123"></textarea>
        <p class="small muted">Kikomo kwa marejesho moja: ${formatTsh(m.limits.maxPerRefund)}. Kwa safari, kiasi hakizidi alicholipa.</p>
        <p class="alert alert-danger" id="rf-error" role="alert" hidden></p>
        <div class="actions"><button class="btn btn-primary" type="submit">Rudisha pesa</button></div>
      </form>
    </details>
    ${history.length ? `<h3 class="um-money-h3">Marejesho ya karibuni</h3><ul class="history">${history.map((h) => h.html).join('')}</ul>` : ''}`;
  if (want && m.rides.some((r) => r.id === want)) {
    $('rf-ride').value = want;
    pickRide();
  }
  $('rf-ride').addEventListener('change', pickRide);
  for (const r of document.querySelectorAll('input[name="rf-to"]')) r.addEventListener('change', () => ($('rf-phone-box').hidden = r.value !== 'PHONE' || !r.checked));
}

function pickRide() {
  const opt = $('rf-ride').selectedOptions[0];
  if (!opt?.value) return;
  $('rf-amount').value = Number(opt.dataset.amount).toLocaleString('en-US');
  if (opt.dataset.needed) {
    $('rf-reason').value = 'RIDE_NOT_DONE';
    if (money.canPhone) {
      document.querySelector('input[name="rf-to"][value="PHONE"]').checked = true;
      $('rf-phone-box').hidden = false;
    }
  }
}

async function onRefundSubmit(event) {
  event.preventDefault();
  if (!current || !money) return;
  const err = $('rf-error');
  err.hidden = true;
  const amount = Number(String($('rf-amount').value).replace(/[^\d]/g, ''));
  const to = document.querySelector('input[name="rf-to"]:checked')?.value ?? 'SALIO';
  const note = $('rf-note').value.trim();
  if (!amount) return fail(new Error('Weka kiasi cha kurudisha.'), 'rf-error');
  if (note.length < 5) return fail(new Error('Andika maelezo ya kwa nini unarudisha pesa.'), 'rf-error');
  const phone = to === 'PHONE' ? $('rf-phone').value.replace(/[^\d+]/g, '') : null;
  const where = to === 'PHONE' ? `namba ${$('rf-phone').value}` : 'Salio la NAYA';
  if (!confirm(`Mrudishie ${current.user.fullName} ${formatTsh(amount)} kwenye ${where}?${to === 'PHONE' ? ' Pesa halisi itatumwa sasa hivi.' : ''}`)) return;
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const res = await ctx.api.post(`/api/admin/users/${current.user.id}/refund`, {
      amount,
      to,
      phone,
      reason: $('rf-reason').value,
      note,
      rideId: $('rf-ride').value || null,
    });
    money = res;
    // Safari iliyochaguliwa kutoka Marejesho imeshughulikiwa — usiichague tena ukurasa ukichorwa upya
    if (location.hash.includes('?rudisha=')) history.replaceState(null, '', location.hash.split('?')[0]);
    drawMoney(res.last ?? { status: 'SUCCESS', salio: true });
  } catch (e) {
    button.disabled = false;
    fail(e, 'rf-error');
  }
}
