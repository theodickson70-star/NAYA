// Ofisi: Maoni — maoni ya app (nyota + maelezo) kutoka kwa wateja na madereva, na maoni ya safari (nyota za abiria).
import { escapeHtml as esc } from '/shared/api.js';
import { FEEDBACK_STATUS, FEEDBACK_TOPICS, formatDate, formatPhone } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null;
const state = { tab: 'app', status: 'NEW', role: '', lowOnly: true };

const STATUS_FILTERS = [
  ['NEW', 'Mapya'],
  ['REVIEWED', 'Yamesomwa'],
  ['ACTED', 'Yamefanyiwa kazi'],
  ['ALL', 'Yote'],
];
const stars = (n) => `<span class="stars" aria-label="Nyota ${n} kati ya 5">${'★'.repeat(n)}<span class="stars-off">${'★'.repeat(5 - n)}</span></span>`;
const tag = (tone, text) => `<span class="badge badge-${tone}">${esc(text)}</span>`;

export function setup(context) {
  ctx = context;
  $('fb-tabs').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-tab]');
    if (!chip) return;
    state.tab = chip.dataset.tab;
    for (const c of $('fb-tabs').querySelectorAll('[data-tab]')) c.setAttribute('aria-pressed', String(c === chip));
    load();
  });
  $('fb-filters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-status], [data-role], [data-low]');
    if (!chip) return;
    if (chip.dataset.status) state.status = chip.dataset.status;
    if (chip.dataset.role !== undefined) state.role = chip.dataset.role;
    if (chip.dataset.low !== undefined) state.lowOnly = chip.dataset.low === '1';
    load();
  });
  $('fb-list').addEventListener('click', onAction);
}

/** Msimamizi anaandika maelezo sasa hivi — usichore upya. */
export const isTyping = () => [...document.querySelectorAll('#fb-list textarea')].some((t) => t.value.trim() || document.activeElement === t);

export async function load() {
  $('fb-error').hidden = true;
  try {
    if (state.tab === 'rides') return await loadRides();
    const params = new URLSearchParams({ status: state.status });
    if (state.role) params.set('role', state.role);
    const { items, summary } = await ctx.api.get(`/api/admin/feedback?${params}`);
    $('fb-summary').hidden = false;
    $('fb-summary').innerHTML = [
      ['Wastani (siku 30)', summary.avg30 ?? '–', 'nyota kati ya 5'],
      ['Wateja', summary.avgPassengers ?? '–', 'wastani wa nyota'],
      ['Madereva', summary.avgDrivers ?? '–', 'wastani wa nyota'],
      ['Mapya', summary.NEW ?? 0, 'hayajasomwa'],
      ['Yamefanyiwa kazi', summary.ACTED ?? 0, `kati ya ${summary.ALL ?? 0}`],
    ]
      .map(([l, v, s]) => `<div class="kpi"><span class="kpi-label">${l}</span><span class="kpi-value">${v}</span><span class="kpi-sub">${s}</span></div>`)
      .join('');
    $('fb-filters').innerHTML =
      STATUS_FILTERS.map(([k, l]) => `<button type="button" class="chip" data-status="${k}" aria-pressed="${k === state.status}">${l}<span>${summary[k] ?? 0}</span></button>`).join('') +
      '<span class="filter-gap"></span>' +
      [
        ['', 'Wote'],
        ['PASSENGER', 'Wateja'],
        ['DRIVER', 'Madereva'],
      ]
        .map(([k, l]) => `<button type="button" class="chip" data-role="${k}" aria-pressed="${k === state.role}">${l}</button>`)
        .join('');
    $('fb-list').innerHTML = items.length
      ? items
          .map(
            (f) => `<article class="fb-card${f.status === 'NEW' ? ' is-new' : ''}" data-id="${esc(f.id)}">
              <header>
                ${stars(f.rating)}
                <span class="muted small">${esc(FEEDBACK_TOPICS[f.topic] ?? f.topic)}</span>
                ${tag(FEEDBACK_STATUS[f.status].tone, FEEDBACK_STATUS[f.status].label)}
              </header>
              <p class="fb-body">${esc(f.body)}</p>
              <p class="muted small"><a href="#/wateja/${esc(f.userId)}">${esc(f.userName)}</a> · ${f.role === 'DRIVER' ? 'Dereva' : 'Mteja'} ·
                <a href="tel:+${esc(f.userPhone)}">${esc(formatPhone(f.userPhone))}</a> · ${esc(formatDate(f.createdAt, true))}</p>
              ${
                f.officeNote
                  ? `<p class="fb-note"><strong>Hatua ya ofisi:</strong> ${esc(f.officeNote)}<br><span class="muted small">${esc(f.handledBy ?? '')} · ${esc(formatDate(f.handledAt, true))}</span></p>`
                  : ''
              }
              ${
                f.status === 'ACTED'
                  ? ''
                  : `<div class="fb-actions">
                      <label class="sr-only" for="note-${esc(f.id)}">Hatua iliyochukuliwa</label>
                      <textarea id="note-${esc(f.id)}" maxlength="500" rows="2" placeholder="Mmefanya nini? (si lazima — mtoaji atajulishwa kwenye simu)"></textarea>
                      <div class="actions">
                        ${f.status === 'NEW' ? '<button class="btn btn-ghost btn-small" type="button" data-act="REVIEWED">Nimesoma</button>' : ''}
                        <button class="btn btn-primary btn-small" type="button" data-act="ACTED">Imefanyiwa kazi</button>
                      </div>
                    </div>`
              }
            </article>`,
          )
          .join('')
      : `<p class="empty">${state.status === 'NEW' ? 'Hakuna maoni mapya. Umeshayasoma yote.' : 'Hakuna maoni hapa.'}</p>`;
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    $('fb-error').textContent = err.message;
    $('fb-error').hidden = false;
  }
}

async function loadRides() {
  $('fb-summary').hidden = true;
  $('fb-filters').innerHTML = [
    ['1', 'Nyota 1–3 au yenye maneno'],
    ['0', 'Yote (siku 30)'],
  ]
    .map(([k, l]) => `<button type="button" class="chip" data-low="${k}" aria-pressed="${(k === '1') === state.lowOnly}">${l}</button>`)
    .join('');
  const rows = await ctx.api.get(`/api/admin/ride-comments?all=${state.lowOnly ? 0 : 1}`);
  $('fb-list').innerHTML = rows.length
    ? rows
        .map(
          (r) => `<article class="fb-card${r.rating <= 2 ? ' is-low' : ''}">
            <header>${stars(r.rating)}<span class="muted small">${esc(formatDate(r.completedAt, true))}</span></header>
            ${r.comment ? `<p class="fb-body">${esc(r.comment)}</p>` : '<p class="muted">Bila maneno.</p>'}
            <p class="muted small">Abiria <a href="#/wateja/${esc(r.passengerId)}">${esc(r.passengerName)}</a> kuhusu dereva
              ${r.driverId ? `<a href="#/wateja/${esc(r.driverId)}">${esc(r.driverName)}</a> (${esc(r.plateNumber ?? '')})` : '—'} ·
              <a href="#/safari/${esc(r.rideId)}">${esc(r.pickupName)} → ${esc(r.destinationName)}</a></p>
          </article>`,
        )
        .join('')
    : '<p class="empty">Hakuna maoni ya safari kwa kipindi hiki.</p>';
}

async function onAction(event) {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const card = button.closest('[data-id]');
  const id = card.dataset.id;
  button.disabled = true;
  try {
    await ctx.api.post(`/api/admin/feedback/${id}`, { status: button.dataset.act, note: card.querySelector('textarea')?.value ?? '' });
    load();
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    $('fb-error').textContent = err.message;
    $('fb-error').hidden = false;
    button.disabled = false;
  }
}
