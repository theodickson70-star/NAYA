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
  $('staff-link').addEventListener('click', onLinkClick);
  $('staff-secret').addEventListener('click', (e) => {
    if (e.target.closest('[data-secret-close]')) $('staff-secret').hidden = true;
  });
  $('loc-pending').addEventListener('click', onPendingClick);
}

// ------------------------------------------------------------------ akaunti za staff

export async function loadPage() {
  $('staff-error').hidden = true;
  $('staff-secret').hidden = true;
  $('staff-link').hidden = true;
  try {
    render(await ctx.api.get('/api/admin/staff'));
  } catch (err) {
    fail(err, 'staff-error');
  }
}

const initials = (name) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

const DRIVER_KIND = {
  APPROVED: 'Dereva (amethibitishwa)',
  PENDING: 'Dereva (anasubiri uthibitisho)',
  INCOMPLETE: 'Dereva (usajili haujakamilika)',
  REJECTED: 'Dereva (ombi limekataliwa)',
  SUSPENDED: 'Dereva (amesimamishwa)',
};
const accountKind = (driverStatus) => (driverStatus ? DRIVER_KIND[driverStatus] ?? 'Dereva' : 'Abiria');

function render(rows) {
  $('staff-count').textContent = rows.length ? `${rows.length}` : '';
  $('staff-list').innerHTML = rows.length
    ? rows
        .map(
          (s) => `<article class="staff-card${s.status === 'SUSPENDED' ? ' is-off' : ''}">
            <header>
              <span class="staff-avatar" aria-hidden="true">${esc(initials(s.fullName))}</span>
              <span><strong>${esc(s.fullName)}</strong><small>${esc(formatPhone(s.phone))}</small>${
                s.kind === 'LINKED' ? `<span class="staff-also">Pia ni ${esc(accountKind(s.driverStatus).toLowerCase())}</span>` : ''
              }</span>
              ${
                s.status === 'SUSPENDED'
                  ? `<span class="badge badge-bad">${s.kind === 'LINKED' && !s.accountSuspended ? 'Ruhusa imesimamishwa' : 'Amesimamishwa'}</span>`
                  : s.mustChangePassword && s.kind === 'STAFF'
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
            ${
              s.kind === 'LINKED'
                ? `<p class="muted small">Anatumia akaunti yake ya NAYA na password yake mwenyewe. ${
                    s.accountSuspended ? '<strong>Akaunti yake yote imesimamishwa (Watumiaji/Madereva).</strong>' : 'Kusimamisha kunaondoa ruhusa ya staff tu.'
                  }</p>`
                : ''
            }
            <p class="muted small">Staff tangu ${esc(formatDate(s.staffSince ?? s.createdAt))}${s.lastLoginAt ? ` · aliingia mara ya mwisho ${esc(formatDate(s.lastLoginAt, true))}` : ''}</p>
            <div class="staff-actions">
              ${s.driversPending ? `<a class="btn btn-primary btn-small" href="#/madereva?hali=PENDING">Kagua madereva</a>` : ''}
              ${s.kind === 'STAFF' ? `<button class="btn btn-ghost btn-small" type="button" data-staff="reset" data-id="${esc(s.id)}">Password mpya</button>` : ''}
              ${
                s.status === 'SUSPENDED'
                  ? s.accountSuspended && s.kind === 'LINKED'
                    ? ''
                    : `<button class="btn btn-ghost btn-small" type="button" data-staff="activate" data-id="${esc(s.id)}">${s.kind === 'LINKED' ? 'Rudisha ruhusa' : 'Mrudishe'}</button>`
                  : `<button class="btn btn-ghost btn-small btn-danger-text" type="button" data-staff="suspend" data-kind="${esc(s.kind)}" data-id="${esc(s.id)}">${
                      s.kind === 'LINKED' ? 'Simamisha ruhusa' : 'Simamisha'
                    }</button>`
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

let linkCandidate = null; // { fullName, phone, found }

function hideLink() {
  linkCandidate = null;
  $('staff-link').hidden = true;
  $('staff-link').innerHTML = '';
}

/** Namba tayari ina akaunti (abiria/dereva): uliza kabla ya kumpa ruhusa ya staff kwenye akaunti hiyo hiyo. */
function showLinkQuestion(input, found) {
  linkCandidate = { ...input, found };
  const box = $('staff-link');
  box.innerHTML = `<h3>Namba hii tayari ina akaunti ya NAYA</h3>
    <div class="staff-link-who">
      <span class="staff-avatar" aria-hidden="true">${esc(initials(found.fullName))}</span>
      <span><strong>${esc(found.fullName)}</strong><small>${esc(formatPhone(input.phone))} · ${esc(accountKind(found.driverStatus))}</small></span>
    </div>
    <p><strong>Mpe ruhusa ya NAYA Staff kwenye akaunti hii?</strong></p>
    <ul class="small">
      <li>Hakuna akaunti mpya wala password mpya — ataingia kwa password yake ile ile.</li>
      <li>Kwenye app ataona chaguo la <strong>NAYA Staff</strong> pembeni ya Abiria / Dereva.</li>
      ${found.driverStatus ? '<li>Udereva wake, safari, salio na malipo yake vinaendelea kama kawaida.</li>' : ''}
      <li>Ukimsimamisha baadaye, ruhusa ya staff tu ndiyo inaondoka.</li>
    </ul>
    ${found.fullName.trim().toLowerCase() !== input.fullName.trim().toLowerCase() ? `<p class="small muted">Jina uliloandika (“${esc(input.fullName)}”) ni tofauti. Jina la akaunti (“${esc(found.fullName)}”) ndilo litatumika.</p>` : ''}
    <p class="alert alert-danger" id="staff-link-error" role="alert" hidden></p>
    <div class="actions">
      <button class="btn btn-primary" type="button" data-link="confirm">Ndiyo, mpe ruhusa ya staff</button>
      <button class="btn btn-ghost" type="button" data-link="cancel">Ghairi</button>
    </div>`;
  box.hidden = false;
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function showLinked(r) {
  const box = $('staff-secret');
  box.innerHTML = `<div>
      <h3>${esc(r.fullName)} sasa ni NAYA Staff</h3>
      <p>Mwambie afungue <strong>app yake ya NAYA</strong> kama kawaida → <strong>Akaunti → Badili mode → NAYA Staff</strong>. Ataingia kwa password yake ile ile.</p>
    </div>
    <button class="btn btn-ghost btn-small" type="button" data-secret-close>Sawa</button>`;
  box.hidden = false;
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

async function createStaff(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  $('staff-form-error').hidden = true;
  $('staff-secret').hidden = true;
  hideLink();
  button.disabled = true;
  const input = { fullName: $('staff-name').value, phone: $('staff-phone').value };
  try {
    const found = await ctx.api.post('/api/admin/staff/lookup', { phone: input.phone });
    if (found.exists) {
      if (found.blocked) throw new Error(found.blocked);
      if (!input.fullName.trim()) throw new Error('Weka jina kamili');
      showLinkQuestion(input, found);
      return;
    }
    const r = await ctx.api.post('/api/admin/staff', input);
    form.reset();
    await loadPage();
    showSecret(r, 'NAYA Staff ameongezwa');
  } catch (err) {
    fail(err, 'staff-form-error');
  } finally {
    button.disabled = false;
  }
}

async function onLinkClick(event) {
  const b = event.target.closest('[data-link]');
  if (!b || !linkCandidate) return;
  if (b.dataset.link === 'cancel') return hideLink();
  b.disabled = true;
  try {
    const r = await ctx.api.post('/api/admin/staff', { fullName: linkCandidate.fullName, phone: linkCandidate.phone, linkExisting: true });
    $('staff-form').reset();
    await loadPage();
    toast('Ruhusa ya NAYA Staff imeongezwa');
    showLinked(r);
  } catch (err) {
    b.disabled = false;
    fail(err, 'staff-link-error');
  }
}

async function onListClick(event) {
  const b = event.target.closest('[data-staff]');
  if (!b) return;
  const { id } = b.dataset;
  const action = b.dataset.staff;
  if (
    action === 'suspend' &&
    !confirm(
      b.dataset.kind === 'LINKED'
        ? 'Ondoa ruhusa ya NAYA Staff kwa mtu huyu? Akaunti yake (abiria/dereva) inaendelea kama kawaida.'
        : 'Simamisha staff huyu? Atatolewa kwenye app papo hapo.',
    )
  )
    return;
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
    toast(action === 'suspend' ? (b.dataset.kind === 'LINKED' ? 'Ruhusa ya staff imesimamishwa' : 'Staff amesimamishwa') : 'Staff amerudishwa');
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
