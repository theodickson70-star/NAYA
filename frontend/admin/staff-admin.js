// Ofisi → Mipangilio → NAYA Staff (#/staff): akaunti za wasaidizi wanaosajili bodaboda na kupendekeza maeneo kwenye app.
// Pia: maeneo yanayosubiri kuidhinishwa (kwenye ukurasa wa Maeneo).
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, LOCATION_CATEGORIES } from '/shared/labels.js';
import { toast } from './ui.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, onAuthError, onPendingChange(n) }

function fail(err, boxId) {
  if (ctx.onAuthError(err)) return;
  const box = $(boxId);
  if (!box) return;
  box.textContent = err.message;
  box.hidden = false;
}

export function setup(context) {
  ctx = context;
  $('staff-form').addEventListener('submit', createStaff);
  $('staff-list').addEventListener('click', onListClick);
  $('staff-secret').addEventListener('click', (e) => {
    if (e.target.closest('[data-secret-close]')) $('staff-secret').hidden = true;
  });
  $('loc-pending').addEventListener('click', onPendingClick);
}

// ------------------------------------------------------------------ akaunti za staff

export async function loadPage() {
  $('staff-error').hidden = true;
  $('staff-secret').hidden = true;
  try {
    render(await ctx.api.get('/api/admin/staff'));
  } catch (err) {
    fail(err, 'staff-error');
  }
}

function render(rows) {
  $('staff-count').textContent = rows.length ? `${rows.length}` : '';
  $('staff-list').innerHTML = rows.length
    ? rows
        .map(
          (s) => `<article class="staff-card${s.status === 'SUSPENDED' ? ' is-off' : ''}">
            <header>
              <span class="staff-avatar" aria-hidden="true">${esc(
                s.fullName
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0].toUpperCase())
                  .join(''),
              )}</span>
              <span><strong>${esc(s.fullName)}</strong><small>${esc(formatPhone(s.phone))}</small></span>
              ${
                s.status === 'SUSPENDED'
                  ? '<span class="badge badge-bad">Amesimamishwa</span>'
                  : s.mustChangePassword
                    ? '<span class="badge badge-warn">Bado hajaingia</span>'
                    : '<span class="badge badge-ok">Hai</span>'
              }
            </header>
            <dl class="staff-stats">
              <div><dt>Madereva aliowasajili</dt><dd>${s.driversRegistered}</dd></div>
              <div><dt>Wamethibitishwa</dt><dd>${s.driversApproved}</dd></div>
              <div><dt>Wanasubiri wewe</dt><dd>${s.driversPending}</dd></div>
              <div><dt>Maeneo (yanasubiri)</dt><dd>${s.locationsAdded} <small>(${s.locationsPending})</small></dd></div>
            </dl>
            <p class="muted small">Ameongezwa ${esc(formatDate(s.createdAt))}${s.lastLoginAt ? ` · aliingia mara ya mwisho ${esc(formatDate(s.lastLoginAt, true))}` : ''}</p>
            <div class="staff-actions">
              ${s.driversPending ? `<a class="btn btn-primary btn-small" href="#/madereva?hali=PENDING">Kagua madereva</a>` : ''}
              <button class="btn btn-ghost btn-small" type="button" data-staff="reset" data-id="${esc(s.id)}">Password mpya</button>
              ${
                s.status === 'SUSPENDED'
                  ? `<button class="btn btn-ghost btn-small" type="button" data-staff="activate" data-id="${esc(s.id)}">Mrudishe</button>`
                  : `<button class="btn btn-ghost btn-small btn-danger-text" type="button" data-staff="suspend" data-id="${esc(s.id)}">Simamisha</button>`
              }
            </div>
          </article>`,
        )
        .join('')
    : '<p class="empty">Bado hakuna NAYA Staff. Ongeza wa kwanza hapo juu.</p>';
}

function showSecret(r, title) {
  const box = $('staff-secret');
  box.innerHTML = `<div>
      <h3>${esc(title)}</h3>
      <p>Mpe <strong>${esc(r.fullName)}</strong> taarifa hizi. Ataingia kwenye <strong>app ya NAYA</strong> (si ofisi) kwa namba <strong>${esc(formatPhone(r.phone))}</strong>, kisha atabadilisha password.</p>
      <p class="staff-password">${esc(r.tempPassword)}</p>
      <p class="small muted">Password hii inaonyeshwa <strong>mara moja tu</strong>. Iandike sasa.</p>
    </div>
    <button class="btn btn-ghost btn-small" type="button" data-secret-close>Nimeiandika</button>`;
  box.hidden = false;
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function createStaff(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  $('staff-form-error').hidden = true;
  button.disabled = true;
  try {
    const r = await ctx.api.post('/api/admin/staff', { fullName: $('staff-name').value, phone: $('staff-phone').value });
    form.reset();
    await loadPage();
    showSecret(r, 'NAYA Staff ameongezwa');
  } catch (err) {
    fail(err, 'staff-form-error');
  } finally {
    button.disabled = false;
  }
}

async function onListClick(event) {
  const b = event.target.closest('[data-staff]');
  if (!b) return;
  const { id } = b.dataset;
  const action = b.dataset.staff;
  if (action === 'suspend' && !confirm('Simamisha staff huyu? Atatolewa kwenye app papo hapo.')) return;
  if (action === 'reset' && !confirm('Mpe password mpya ya muda? Ya zamani itaacha kufanya kazi.')) return;
  b.disabled = true;
  try {
    if (action === 'reset') {
      const r = await ctx.api.post(`/api/admin/staff/${id}/reset-password`, {});
      await loadPage();
      showSecret(r, 'Password mpya ya muda');
      return;
    }
    render(await ctx.api.post(`/api/admin/staff/${id}/${action}`, {}));
    toast(action === 'suspend' ? 'Staff amesimamishwa' : 'Staff amerudishwa');
  } catch (err) {
    b.disabled = false;
    fail(err, 'staff-error');
  }
}

// ------------------------------------------------------------------ maeneo yanayosubiri (ukurasa wa Maeneo)

export async function loadPendingLocations() {
  const box = $('loc-pending');
  try {
    const rows = await ctx.api.get('/api/admin/locations/pending');
    ctx.onPendingChange?.(rows.length);
    box.hidden = !rows.length;
    box.innerHTML = rows.length
      ? `<h2>Maeneo yanayosubiri uidhinishe <span class="badge badge-warn">${rows.length}</span></h2>
        <p class="muted small">Yamependekezwa na NAYA Staff kwa GPS ya simu zao. Wateja hawayaoni mpaka uyaidhinishe.</p>
        <ul class="pending-locs">${rows
          .map(
            (l) => `<li>
              <span><strong>${esc(l.name)}</strong><small>${esc(LOCATION_CATEGORIES[l.category] ?? l.category)}${l.area ? ` · ${esc(l.area)}` : ''} · na ${esc(l.proposedBy ?? '–')} · ${esc(formatDate(l.createdAt, true))}</small></span>
              <a class="btn btn-ghost btn-small" href="https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=18/${l.lat}/${l.lng}" target="_blank" rel="noopener">Ramani</a>
              <button class="btn btn-primary btn-small" type="button" data-loc="approve" data-id="${esc(l.id)}">Idhinisha</button>
              <button class="btn btn-ghost btn-small" type="button" data-loc="reject" data-id="${esc(l.id)}">Kataa</button>
            </li>`,
          )
          .join('')}</ul>
        <p class="alert alert-danger" id="loc-pending-error" role="alert" hidden></p>`
      : '';
  } catch (err) {
    if (!ctx.onAuthError(err)) box.hidden = true;
  }
}

async function onPendingClick(event) {
  const b = event.target.closest('[data-loc]');
  if (!b) return;
  const approve = b.dataset.loc === 'approve';
  let note = null;
  if (!approve) {
    note = prompt('Kwa nini unakataa eneo hili? (staff ataona sababu)');
    if (note === null) return;
  }
  b.disabled = true;
  try {
    await ctx.api.post(`/api/admin/locations/${b.dataset.id}/review`, { approve, note: note ?? undefined });
    toast(approve ? 'Eneo limeidhinishwa — wateja wanaliona sasa' : 'Eneo limekataliwa');
    await loadPendingLocations();
    if (approve) ctx.onApproved?.();
  } catch (err) {
    b.disabled = false;
    fail(err, 'loc-pending-error');
  }
}
