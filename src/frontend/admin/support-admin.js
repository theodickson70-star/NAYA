// Ofisi: Msaada — matatizo yaliyoripotiwa na wateja na madereva; kujibu (jibu linamfikia kwenye simu) na kutatua.
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh, SUPPORT_CATEGORIES, SUPPORT_STATUS } from '/shared/labels.js';
import { RIDE_STATUS } from './rides-admin.js';

const $ = (id) => document.getElementById(id);
let ctx = null;
const state = { status: 'ACTIVE', q: '', userId: '' };
let openTicket = null;

const FILTERS = [
  ['ACTIVE', 'Zinazoshughulikiwa'],
  ['OPEN', 'Zinasubiri ofisi'],
  ['ANSWERED', 'Zimejibiwa'],
  ['RESOLVED', 'Zimetatuliwa'],
  ['ALL', 'Zote'],
];

// Majibu ya haraka (msimamizi anaweza kuyabadilisha kabla ya kutuma).
const QUICK = [
  'Asante kwa kutujulisha. Tunalishughulikia sasa hivi na tutakujulisha.',
  'Tumezungumza na dereva. Tunaomba radhi kwa usumbufu.',
  'Kitu chako kimepatikana. Karibu ukichukue ofisini kwa NAYA.',
  'Tafadhali tupigie simu ofisini tukusaidie zaidi.',
];

const tag = (tone, text) => `<span class="badge badge-${tone}">${esc(text)}</span>`;
const statusTag = (s) => tag(SUPPORT_STATUS[s].tone, SUPPORT_STATUS[s].label);

function fail(err, boxId) {
  if (ctx.onAuthError(err)) return;
  $(boxId).textContent = err.message;
  $(boxId).hidden = false;
}

export function setup(context) {
  ctx = context;
  $('support-filters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-status]');
    if (!chip) return;
    location.hash = `#/msaada?hali=${chip.dataset.status}`;
  });
  $('support-search').addEventListener('submit', (event) => {
    event.preventDefault();
    const q = $('support-q').value.trim();
    location.hash = `#/msaada?hali=ALL${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  });
  $('ticket-detail').addEventListener('click', onClick);
  $('ticket-detail').addEventListener('submit', onSubmit);
}

export async function loadList(params) {
  state.status = FILTERS.some(([k]) => k === params.get('hali')) ? params.get('hali') : 'ACTIVE';
  state.q = params.get('q') ?? '';
  state.userId = params.get('mtumiaji') ?? '';
  $('support-q').value = state.q;
  $('support-error').hidden = true;
  if (!$('support-list').children.length) $('support-list').innerHTML = '<p class="empty">Inapakia…</p>';
  try {
    const query = new URLSearchParams({ status: state.userId ? 'ALL' : state.status });
    if (state.q) query.set('q', state.q);
    if (state.userId) query.set('userId', state.userId);
    const { tickets, counts } = await ctx.api.get(`/api/admin/support?${query}`);
    $('support-filters').innerHTML = FILTERS.map(([k, label]) => {
      const n = k === 'ACTIVE' ? counts.OPEN + counts.ANSWERED : k === 'ALL' ? counts.OPEN + counts.ANSWERED + counts.RESOLVED : counts[k];
      return `<button type="button" class="chip" data-status="${k}" aria-pressed="${!state.userId && k === state.status}">${label}<span>${n}</span></button>`;
    }).join('');
    $('support-list').innerHTML = tickets.length
      ? tickets
          .map(
            (t) => `<a class="ticket-row${t.status === 'OPEN' ? ' is-open' : ''}" href="#/msaada/${esc(t.id)}">
              <span class="t-dot" aria-hidden="true"></span>
              <span style="min-width:0"><span class="t-subject">${esc(t.subject)}</span>
                <span class="t-last">${t.lastFromStaff ? 'Ofisi: ' : ''}${esc(t.lastMessage ?? '')}</span></span>
              <span class="driver-sub col-hide">${esc(t.userName)} · ${t.role === 'DRIVER' ? 'Dereva' : 'Abiria'}<br>${esc(formatDate(t.updatedAt, true))}</span>
              <span>${statusTag(t.status)}</span>
            </a>`,
          )
          .join('')
      : `<p class="empty">${state.status === 'OPEN' || state.status === 'ACTIVE' ? 'Hakuna ombi linalosubiri. Kazi nzuri!' : 'Hakuna maombi hapa.'}</p>`;
  } catch (err) {
    $('support-list').innerHTML = '';
    fail(err, 'support-error');
  }
}

export async function loadTicket(id) {
  $('ticket-error').hidden = true;
  if (openTicket?.id !== id) $('ticket-detail').innerHTML = '<p class="muted">Inapakia…</p>';
  try {
    render(await ctx.api.get(`/api/admin/support/${encodeURIComponent(id)}`));
  } catch (err) {
    $('ticket-detail').innerHTML = '';
    fail(err, 'ticket-error');
  }
}

export const openTicketId = () => openTicket?.id ?? null;
/** Msimamizi anaandika jibu sasa hivi — usichore upya (atapoteza maneno). */
export const isTyping = () => !!$('reply-body')?.value.trim() || document.activeElement?.id === 'reply-body';

function render(t) {
  openTicket = t;
  const resolved = t.status === 'RESOLVED';
  $('ticket-detail').innerHTML = `
    <div class="detail-head">
      <div>
        <h1>${esc(t.subject)}</h1>
        <p class="muted">${esc(SUPPORT_CATEGORIES[t.category] ?? t.category)} · ${t.role === 'DRIVER' ? 'Dereva' : 'Abiria'}
          <a href="#/wateja/${esc(t.userId)}">${esc(t.userName)}</a> · <a href="tel:+${esc(t.userPhone)}">${esc(formatPhone(t.userPhone))}</a>
          · Ilifunguliwa ${esc(formatDate(t.createdAt, true))}</p>
      </div>
      ${statusTag(t.status)}
    </div>
    ${t.userStatus === 'SUSPENDED' ? '<p class="alert alert-warn">Akaunti ya mtumiaji huyu imesimamishwa — hataona jibu mpaka irudishwe.</p>' : ''}
    ${
      t.ride
        ? `<a class="ticket-ride" href="#/safari/${esc(t.ride.id)}"><strong>Safari: ${esc(t.ride.pickupName)} → ${esc(t.ride.destinationName)}</strong>
            <span class="badge badge-${RIDE_STATUS[t.ride.status]?.[0] ?? 'muted'}">${esc(RIDE_STATUS[t.ride.status]?.[1] ?? t.ride.status)}</span><br>
            <span class="muted small">${esc(formatDate(t.ride.requestedAt, true))} · ${formatTsh(t.ride.fare)} · Abiria ${esc(t.ride.passengerName)}${
              t.ride.driverName ? ` · Dereva ${esc(t.ride.driverName)} (${esc(t.ride.plateNumber ?? '')})` : ''
            }</span></a>`
        : ''
    }
    <div class="thread">
      ${t.messages
        .map(
          (m) => `<div class="msg ${m.fromStaff ? 'staff' : 'user'}"><p>${esc(m.body)}</p><span class="meta">${
            m.fromStaff ? esc(m.authorName ?? 'Ofisi') : esc(t.userName)
          } · ${esc(formatDate(m.createdAt, true))}</span></div>`,
        )
        .join('')}
    </div>
    <form class="reply-box" id="reply-form">
      <div class="quick-replies" aria-label="Majibu ya haraka">${QUICK.map((q, i) => `<button type="button" data-quick="${i}">${esc(q.slice(0, 34))}…</button>`).join('')}</div>
      <label class="sr-only" for="reply-body">Jibu</label>
      <textarea id="reply-body" maxlength="1000" placeholder="Andika jibu kwa ${esc(t.userName.split(' ')[0])}… (litamfikia kwenye simu)"></textarea>
      <p class="alert alert-danger" id="reply-error" role="alert" hidden></p>
      <div class="actions">
        ${resolved ? '<button class="btn btn-ghost" type="button" data-reopen>Fungua upya</button>' : '<button class="btn btn-ghost" type="button" data-resolve>Jibu na utatue</button>'}
        <button class="btn btn-primary" type="submit">Tuma jibu</button>
      </div>
    </form>`;
}

async function send(resolve, button) {
  $('reply-error').hidden = true;
  button.disabled = true;
  try {
    render(await ctx.api.post(`/api/admin/support/${openTicket.id}/reply`, { body: $('reply-body').value, resolve }));
  } catch (err) {
    fail(err, 'reply-error');
    button.disabled = false;
  }
}

function onSubmit(event) {
  if (event.target.id !== 'reply-form') return;
  event.preventDefault();
  send(false, event.submitter ?? event.target.querySelector('button[type="submit"]'));
}

async function onClick(event) {
  const quick = event.target.closest('[data-quick]');
  if (quick) {
    $('reply-body').value = QUICK[Number(quick.dataset.quick)];
    $('reply-body').focus();
    return;
  }
  const resolve = event.target.closest('[data-resolve]');
  if (resolve) return send(true, resolve);
  const reopen = event.target.closest('[data-reopen]');
  if (reopen) {
    reopen.disabled = true;
    try {
      render(await ctx.api.post(`/api/admin/support/${openTicket.id}/reopen`));
    } catch (err) {
      fail(err, 'reply-error');
    }
  }
}
