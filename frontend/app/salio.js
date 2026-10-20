// Salio la NAYA — wallet ya abiria (0.23.0)
//   #/akaunti/salio   salio, "Weka pesa" (kiasi → ada → namba → PIN kwenye simu), historia, "Rudisha salio langu"
// Salio linaongezeka tu baada ya mtandao kuthibitisha (server). Linatumika ndani ya NAYA: nauli na deni.
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, toast, handleError, myPhone }
let w = null;
let quoteTimer = null;
let quoteSeq = 0;
let lastQuote = null;
let pollTimer = null;
let showCashout = false;

const ICON = {
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  in: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  bike: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="16.5" r="3"/><circle cx="18.5" cy="16.5" r="3"/><path d="M5.5 16.5l4-7h5l4 7M9.5 9.5L8 6H5.5M14.5 9.5L16 6h2"/></svg>',
};
const KIND_ICON = { TOPUP: 'in', RIDE_PAYMENT: 'bike', RIDE_REFUND: 'undo', DEBT_PAYMENT: 'bike', CASHOUT: 'out', ADJUSTMENT: 'pen', REFUND: 'undo' };

export function init(context) {
  ctx = context;
  const root = $('app-content');
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
}

export async function render() {
  clearInterval(pollTimer);
  clearTimeout(quoteTimer);
  lastQuote = null;
  showCashout = false;
  $('app-content').innerHTML = `<a class="back" href="#/akaunti">‹ Akaunti</a><div id="salio"><p class="muted">Inapakia…</p></div>`;
  await load();
}

async function load(error = '') {
  try {
    w = await ctx.api.get('/api/passenger/wallet');
  } catch (err) {
    if (!ctx.handleError(err) && $('salio')) $('salio').innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
    return;
  }
  if (!$('salio')) return;
  draw(error);
}

function historyHtml() {
  if (!w.entries.length) return '<p class="muted sl-empty">Bado hakuna miamala. Weka pesa ulipie safari zako kwa bonyezo moja.</p>';
  return `<ul class="mw-list">${w.entries
    .map((e) => {
      const plus = e.amount > 0;
      const ico = KIND_ICON[e.kind] ?? 'pen';
      return `<li class="mw-tx">
        <span class="mw-tx-ico is-${plus ? 'in' : 'out'}">${ICON[ico]}</span>
        <span class="mw-tx-txt"><strong>${esc(e.label)}</strong><span class="muted">${esc(formatDate(e.createdAt, true))}</span></span>
        <span class="mw-tx-amt ${plus ? 'is-in' : 'is-out'}">${plus ? '+' : '−'}${formatTsh(Math.abs(e.amount))}<small>${formatTsh(e.balanceAfter)}</small></span>
      </li>`;
    })
    .join('')}</ul>`;
}

function topupHtml(error) {
  if (!w.enabled) return '<p class="mw-note is-muted">Kuweka pesa kumezimwa kwa sasa na ofisi ya NAYA.</p>';
  if (w.status !== 'ACTIVE') return '<p class="mw-note is-bad">Salio lako limesimamishwa na ofisi ya NAYA. Wasiliana na ofisi.</p>';
  if (w.cashout) return '<p class="mw-note is-muted">Una ombi la kurudishiwa salio. Ghairi ombi hilo (chini) kama unataka kuweka pesa au kulipa kwa salio.</p>';
  if (w.pending) {
    return `<section class="card fp-card"><div class="fp-wait" role="status"><span class="fp-spin" aria-hidden="true"></span>
      <p><strong>Angalia simu ${esc(formatPhone(w.pending.phone))}</strong><br>Weka PIN kukubali kulipa ${formatTsh(w.pending.amount)}. Salio litaongezeka mtandao ukithibitisha…</p></div></section>`;
  }
  if (w.room < w.minTopup) return `<p class="mw-note is-muted">Salio lako limefika kikomo cha ${formatTsh(w.maxBalance)}. Litumie kwanza kabla ya kuweka zaidi.</p>`;
  const chips = [2000, 5000, 10000].filter((v) => v <= w.room && v >= w.minTopup);
  return `<form class="card mw-form" id="sl-topup" novalidate>
      <h2>Weka pesa</h2>
      <label for="sl-amount">Kiasi (TSh)</label>
      <input class="mw-amount" id="sl-amount" inputmode="numeric" autocomplete="off" placeholder="0">
      <div class="mw-chips">${chips.map((v) => `<button type="button" class="mw-chipbtn" data-sl="amt" data-v="${v}">${formatTsh(v)}</button>`).join('')}${
        chips.includes(w.room) ? '' : `<button type="button" class="mw-chipbtn" data-sl="amt" data-v="${w.room}">Hadi kikomo · ${formatTsh(w.room)}</button>`
      }</div>
      <div class="mw-quote" id="sl-quote" aria-live="polite" hidden></div>
      <label for="sl-phone">Namba ya kulipia</label>
      <input id="sl-phone" class="fp-phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(ctx.myPhone() ? formatPhone(ctx.myPhone()) : '')}" placeholder="0754 123 456">
      <p class="small muted">M-Pesa, Mixx, Airtel au HaloPesa. Salio lisizidi ${formatTsh(w.maxBalance)}.</p>
      <p class="alert alert-danger" id="sl-error" role="alert"${error ? '' : ' hidden'}>${esc(error)}</p>
      <button class="btn btn-primary btn-block btn-big" type="submit" id="sl-btn" disabled>Andika kiasi</button>
    </form>`;
}

function cashoutHtml() {
  if (w.cashout) {
    return `<section class="card sl-cash"><h2>Ombi la kurudishiwa salio</h2>
      <p class="muted">Umeomba ofisi ya NAYA ikurudishie salio lako kwenye ${esc(formatPhone(w.cashout.phone))} (${esc(formatDate(w.cashout.requestedAt, true))}). Watakutumia hivi karibuni.</p>
      <button class="btn btn-ghost btn-block btn-plain" type="button" data-sl="cash-cancel">Ghairi ombi</button></section>`;
  }
  if (w.balance <= 0) return '';
  if (!showCashout) return '<button class="btn btn-ghost btn-block btn-plain sl-cash-link" type="button" data-sl="cash-open">Rudishiwa salio langu</button>';
  return `<section class="card sl-cash"><h2>Rudishiwa salio</h2>
      <p class="muted">Ofisi ya NAYA itakutumia salio lako lote (${formatTsh(w.balance)}) kwenye namba hii.</p>
      <label for="sl-cash-phone">Namba ya kupokea</label>
      <input id="sl-cash-phone" class="fp-phone" type="tel" inputmode="tel" value="${esc(ctx.myPhone() ? formatPhone(ctx.myPhone()) : '')}">
      <p class="alert alert-danger" id="sl-cash-error" role="alert" hidden></p>
      <div class="actions"><button class="btn btn-primary" type="button" data-sl="cash-send">Tuma ombi</button><button class="btn btn-ghost" type="button" data-sl="cash-close">Rudi</button></div>
    </section>`;
}

function draw(error = '') {
  clearInterval(pollTimer);
  $('salio').innerHTML = `
    <section class="mw-hero sl-hero" aria-labelledby="sl-title">
      <p class="mw-hero-top"><span id="sl-title">Salio la NAYA</span><span class="mw-chip">Kikomo ${formatTsh(w.maxBalance)}</span></p>
      <p class="mw-balance" aria-live="polite"><small>TSh</small>${Number(w.balance).toLocaleString('en-US')}</p>
      <p class="mw-hero-sub">Lipia safari na deni kwa bonyezo moja — bila PIN ya simu kila safari. Safari ikighairiwa, pesa inarudi hapa papo hapo.</p>
    </section>
    ${topupHtml(error)}
    <section class="card mw-history" aria-labelledby="sl-h"><h2 id="sl-h">Historia</h2>${historyHtml()}</section>
    ${cashoutHtml()}`;
  if (w.pending) pollTimer = setInterval(() => watch(w.pending.id), 4000);
}

async function watch(id) {
  if (!$('salio')) return clearInterval(pollTimer);
  try {
    const p = await ctx.api.get(`/api/payments/${id}`);
    if (p.status === 'PENDING') return;
    clearInterval(pollTimer);
    if (p.status === 'SUCCESS') ctx.toast('Pesa imeingia kwenye salio lako');
    load(p.status === 'FAILED' ? `Kuweka pesa hakukufanikiwa${p.failureReason ? `: ${p.failureReason}` : '.'} Jaribu tena au tumia namba nyingine.` : '');
  } catch {
    // jaribu tena baadaye
  }
}

const amountValue = () => Number(String($('sl-amount')?.value ?? '').replace(/[^\d]/g, '')) || 0;

function scheduleQuote() {
  clearTimeout(quoteTimer);
  lastQuote = null;
  const btn = $('sl-btn');
  const box = $('sl-quote');
  if (!btn) return;
  const amount = amountValue();
  btn.disabled = true;
  if (!amount) {
    btn.textContent = 'Andika kiasi';
    box.hidden = true;
    return;
  }
  btn.textContent = 'Inahesabu…';
  quoteTimer = setTimeout(async () => {
    const my = ++quoteSeq;
    try {
      const q = await ctx.api.get(`/api/passenger/wallet/quote?amount=${amount}`);
      if (my !== quoteSeq || !$('sl-quote')) return;
      lastQuote = q;
      box.hidden = false;
      box.className = 'mw-quote';
      box.innerHTML = `<span><small>Salio litaongezeka</small><strong>${formatTsh(q.amount)}</strong></span>
        <span><small>Ada ya simu</small><strong>${q.fee ? `+${formatTsh(q.fee)}` : 'Bure'}</strong></span>
        <span class="is-total"><small>Utalipa</small><strong>${formatTsh(q.total)}</strong></span>`;
      btn.disabled = false;
      btn.textContent = `Lipa ${formatTsh(q.total)} kwa simu`;
    } catch (err) {
      if (my !== quoteSeq || !$('sl-quote')) return;
      if (ctx.handleError(err)) return;
      box.hidden = false;
      box.className = 'mw-quote is-bad';
      box.textContent = err.message;
      btn.textContent = 'Badilisha kiasi';
    }
  }, 350);
}

function onInput(event) {
  if (event.target.id !== 'sl-amount') return;
  const digits = event.target.value.replace(/[^\d]/g, '');
  event.target.value = digits ? Number(digits).toLocaleString('en-US') : '';
  scheduleQuote();
}

async function onClick(event) {
  if (!$('salio')) return;
  const b = event.target.closest('[data-sl], #sl-btn');
  if (!b) return;
  const act = b.id === 'sl-btn' ? 'topup' : b.dataset.sl;
  if (act === 'amt') {
    $('sl-amount').value = Number(b.dataset.v).toLocaleString('en-US');
    return scheduleQuote();
  }
  if (act === 'topup') {
    event.preventDefault();
    const amount = amountValue();
    const phone = String($('sl-phone').value).replace(/[^\d+]/g, '');
    const err = $('sl-error');
    err.hidden = true;
    if (!lastQuote || lastQuote.amount !== amount) return;
    if (phone.replace(/\D/g, '').length < 9) {
      err.textContent = 'Weka namba ya simu ya kulipia.';
      err.hidden = false;
      return;
    }
    b.disabled = true;
    b.textContent = 'Inatuma ombi…';
    try {
      const p = await ctx.api.post('/api/passenger/wallet/topup', { amount, phone });
      if (p.status === 'FAILED') return load(`Kuweka pesa hakukufanikiwa${p.failureReason ? `: ${p.failureReason}` : '.'} Jaribu namba nyingine.`);
      load();
    } catch (e) {
      b.disabled = false;
      b.textContent = `Lipa ${formatTsh(lastQuote.total)} kwa simu`;
      ctx.handleError(e, 'sl-error');
    }
    return;
  }
  if (act === 'cash-open' || act === 'cash-close') {
    showCashout = act === 'cash-open';
    return draw();
  }
  if (act === 'cash-send') {
    const phone = String($('sl-cash-phone').value).replace(/[^\d+]/g, '');
    b.disabled = true;
    try {
      await ctx.api.post('/api/passenger/wallet/cashout', { phone });
      ctx.toast('Ombi limetumwa kwa ofisi ya NAYA');
      showCashout = false;
      load();
    } catch (e) {
      b.disabled = false;
      ctx.handleError(e, 'sl-cash-error');
    }
    return;
  }
  if (act === 'cash-cancel') {
    b.disabled = true;
    await ctx.api.post('/api/passenger/wallet/cashout/cancel', {}).catch(() => {});
    load();
  }
}
