// Msaada kwenye app: abiria au dereva anaripoti tatizo, anaona majibu ya ofisi na kuendelea na mazungumzo.
// Njia: #/akaunti/msaada (ombi jipya) na #/akaunti/msaada/<id> (mazungumzo).
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatTsh, SUPPORT_CATEGORIES, SUPPORT_STATUS } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, handleError, toast, isDriver }
let openId = null;

// Aina zinazoonyeshwa (kwa mpangilio), kulingana na mode.
const PASSENGER_CATS = ['RIDE', 'FARE', 'DRIVER', 'LOST_ITEM', 'SAFETY', 'APP', 'ACCOUNT', 'OTHER'];
const DRIVER_CATS = ['RIDE', 'PASSENGER', 'FARE', 'LOST_ITEM', 'SAFETY', 'APP', 'ACCOUNT', 'OTHER'];
const tag = (s) => `<span class="badge badge-${SUPPORT_STATUS[s].tone}">${esc(SUPPORT_STATUS[s].label)}</span>`;

export function init(context) {
  ctx = context;
  $('app-content').addEventListener('submit', onSubmit);
}

/** Ndani ya ukurasa wa Akaunti: kadi ya Msaada (orodha inapakiwa baadaye). */
export function cardHtml(unread) {
  return `<section class="card support-card" aria-labelledby="support-title">
    <div class="support-head">
      <h2 id="support-title">Msaada${unread ? ` <span class="pill-dot">${unread} jipya</span>` : ''}</h2>
      <a class="btn btn-primary btn-small" href="#/akaunti/msaada">Ripoti tatizo</a>
    </div>
    <p class="muted">Tatizo la safari, nauli, umesahau kitu, au lolote — ofisi ya NAYA inakujibu hapa na kwenye simu yako.</p>
    <ul class="support-list" id="support-list"><li class="muted">Inapakia…</li></ul>
  </section>`;
}

export async function loadCardList() {
  try {
    const tickets = await ctx.api.get('/api/support');
    if (!$('support-list')) return;
    $('support-list').innerHTML = tickets.length
      ? tickets
          .slice(0, 6)
          .map(
            (t) => `<li><a href="#/akaunti/msaada/${esc(t.id)}" class="${t.userUnread ? 'unread' : ''}">
              <span><strong>${esc(t.subject)}</strong><br><span class="muted">${esc(formatDate(t.updatedAt, true))}</span></span>${tag(t.status)}
            </a></li>`,
          )
          .join('')
      : '<li class="muted">Hujaripoti tatizo lolote.</li>';
  } catch (err) {
    ctx.handleError(err);
  }
}

// ------------------------------------------------------------------ ombi jipya
export async function renderNew() {
  openId = null;
  const cats = ctx.isDriver() ? DRIVER_CATS : PASSENGER_CATS;
  $('app-content').innerHTML = `
    <a class="back" href="#/akaunti">‹ Akaunti</a>
    <h1>Ripoti tatizo</h1>
    <p class="muted">Eleza kilichotokea. Ofisi ya NAYA itakujibu haraka iwezekanavyo.</p>
    <form class="card support-form" id="support-form" novalidate>
      <fieldset class="cat-grid">
        <legend>Tatizo linahusu nini?</legend>
        ${cats
          .map((c, i) => `<label><input type="radio" name="category" value="${c}" ${i === 0 ? 'checked' : ''}><span>${esc(SUPPORT_CATEGORIES[c])}</span></label>`)
          .join('')}
      </fieldset>
      <label for="support-ride">Safari husika <span class="muted">(si lazima)</span></label>
      <select id="support-ride"><option value="">Inapakia safari zako…</option></select>
      <label for="support-message">Eleza tatizo</label>
      <textarea id="support-message" maxlength="1000" rows="5" placeholder="Mf. Nilisahau begi kwenye bodaboda MC 123 ABC jana saa 2 usiku."></textarea>
      <p class="alert alert-danger" id="support-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Tuma kwa ofisi</button>
    </form>
    <p class="muted small" style="margin-top:14px">Hatari au dharura ukiwa safarini? Tumia kitufe cha <strong>Dharura</strong> kwenye safari, au piga 112.</p>`;
  try {
    const rides = await ctx.api.get(ctx.isDriver() ? '/api/driver/rides' : '/api/rides/history');
    if (!$('support-ride')) return;
    $('support-ride').innerHTML =
      '<option value="">Hakuna safari maalum</option>' +
      rides
        .slice(0, 15)
        .map((r) => `<option value="${esc(r.id)}">${esc(formatDate(r.requestedAt, true))} · ${esc(r.pickup?.name ?? '')} → ${esc(r.destination?.name ?? '')} · ${formatTsh(r.fare)}</option>`)
        .join('');
  } catch {
    if ($('support-ride')) $('support-ride').innerHTML = '<option value="">Hakuna safari maalum</option>';
  }
}

// ------------------------------------------------------------------ mazungumzo
export async function renderTicket(id) {
  openId = id;
  if (!$('ticket-thread')) $('app-content').innerHTML = '<p class="muted" style="padding:24px">Inapakia…</p>';
  try {
    const t = await ctx.api.get(`/api/support/${encodeURIComponent(id)}`);
    if (openId !== id) return;
    const typing = $('support-reply')?.value ?? '';
    $('app-content').innerHTML = `
      <a class="back" href="#/akaunti">‹ Akaunti</a>
      <div class="ticket-top"><h1>${esc(SUPPORT_CATEGORIES[t.category] ?? 'Msaada')}</h1>${tag(t.status)}</div>
      <p class="muted">Ombi la ${esc(formatDate(t.createdAt, true))}</p>
      <div class="thread" id="ticket-thread">
        ${t.messages
          .map(
            (m) => `<div class="bubble ${m.fromStaff ? 'staff' : 'me'}"><p>${esc(m.body)}</p><span>${m.fromStaff ? 'Ofisi ya NAYA' : 'Wewe'} · ${esc(
              formatDate(m.createdAt, true),
            )}</span></div>`,
          )
          .join('')}
        ${t.status === 'OPEN' && !t.messages.some((m) => m.fromStaff) ? '<p class="muted small waiting">Ofisi imepokea ombi lako. Utapata jibu hapa na kwenye simu yako.</p>' : ''}
      </div>
      <form class="reply" id="support-reply-form" novalidate>
        <label class="sr-only" for="support-reply">Andika ujumbe</label>
        <textarea id="support-reply" maxlength="1000" rows="2" placeholder="${t.status === 'RESOLVED' ? 'Bado lina tatizo? Andika hapa…' : 'Andika ujumbe…'}"></textarea>
        <button class="btn btn-primary" type="submit">Tuma</button>
      </form>
      <p class="alert alert-danger" id="support-error" role="alert" hidden></p>`;
    $('support-reply').value = typing;
    window.scrollTo(0, document.body.scrollHeight);
  } catch (err) {
    ctx.handleError(err);
  }
}

export const openTicketId = () => (location.hash.startsWith('#/akaunti/msaada/') ? openId : null);

async function onSubmit(event) {
  if (event.target.id === 'support-form') {
    event.preventDefault();
    const button = event.target.querySelector('button[type="submit"]');
    $('support-error').hidden = true;
    button.disabled = true;
    try {
      const t = await ctx.api.post('/api/support', {
        category: event.target.querySelector('input[name="category"]:checked')?.value,
        message: $('support-message').value,
        rideId: $('support-ride').value || null,
      });
      ctx.toast('Tumepokea. Ofisi itakujibu hapa.');
      location.hash = `#/akaunti/msaada/${t.id}`;
    } catch (err) {
      ctx.handleError(err, 'support-error');
      button.disabled = false;
    }
  }
  if (event.target.id === 'support-reply-form') {
    event.preventDefault();
    const button = event.target.querySelector('button');
    const body = $('support-reply').value.trim();
    if (!body) return;
    button.disabled = true;
    try {
      await ctx.api.post(`/api/support/${openId}/reply`, { body });
      $('support-reply').value = '';
      await renderTicket(openId);
    } catch (err) {
      ctx.handleError(err, 'support-error');
      button.disabled = false;
    }
  }
}
