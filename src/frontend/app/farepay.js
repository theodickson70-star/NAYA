// Nauli kwa simu (0.22.0) — sehemu za skrini ya safari iliyokamilika (abiria na dereva) na ukurasa wa "Deni langu".
//   Abiria:  "Lipa kwa simu" (namba yoyote, hadi 3) au taslimu. Ada ya simu inaonyeshwa kabla ya kulipa.
//   Dereva:  hali ya malipo; "Nimepokea cash" au "Hajalipa" (deni).
//   #/akaunti/deni  deni la abiria: safari, jumla, kulipa kwa simu.
// Hakuna kinachoandikwa "umelipa" mpaka server (kampuni ya malipo) ithibitishe.
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, toast, handleError, myPhone }
let debtPoll = null;

export function init(context) {
  ctx = context;
  $('app-content').addEventListener('click', onDebtClick);
}

const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/></svg>',
  cash: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/></svg>',
};

/** Muhtasari wa kiasi: nauli + ada = jumla */
const sumHtml = (f) => `<dl class="fp-sum">
    <div><dt>Nauli</dt><dd>${formatTsh(f.due)}</dd></div>
    <div><dt>Ada ya simu</dt><dd>${f.fee ? `+${formatTsh(f.fee)}` : 'Bure'}</dd></div>
    <div class="is-total"><dt>Jumla</dt><dd>${formatTsh(f.total)}</dd></div>
  </dl>`;

const phoneForm = (id, value, label) => `<label for="${id}">Namba ya kulipia</label>
  <input id="${id}" class="fp-phone" type="tel" inputmode="tel" autocomplete="tel" value="${esc(value)}" placeholder="0754 123 456">
  <p class="small muted">Inaweza kuwa namba yoyote ya M-Pesa, Mixx, Airtel au HaloPesa. ${esc(label)}</p>`;

const waitingHtml = (phone, total) => `<div class="fp-wait" role="status">
    <span class="fp-spin" aria-hidden="true"></span>
    <p><strong>Angalia simu ${esc(formatPhone(phone))}</strong><br>Weka PIN kukubali kulipa ${formatTsh(total)}. Tunasubiri uthibitisho wa mtandao…</p>
  </div>`;

/** Abiria — kadi ya malipo kwenye skrini ya "Umefika". `ui` = { busy, error } */
export function passengerCardHtml(ride, ui = {}) {
  const f = ride.farePay;
  if (!f) return '';
  if (f.settlement === 'MOBILE') {
    return `<section class="card fp-card is-ok" id="fare-pay" role="status"><span class="fp-ico">${ICON.check}</span>
      <div><h2>Umelipa kwa simu</h2><p class="muted">${formatTsh(f.due)} imemfikia dereva kupitia NAYA. Asante!</p></div></section>`;
  }
  if (f.settlement === 'CASH') {
    return `<section class="card fp-card is-muted" id="fare-pay"><span class="fp-ico">${ICON.cash}</span>
      <div><h2>Umelipa taslimu</h2><p class="muted">Dereva amethibitisha amepokea ${formatTsh(f.due)}.</p></div></section>`;
  }
  if (f.settlement === 'DEBT') {
    return f.debtCleared
      ? ''
      : `<section class="card fp-card is-bad" id="fare-pay" role="alert"><div><h2>Una deni la ${formatTsh(f.due)}</h2>
          <p>Dereva ameandika kwamba hukulipa nauli. Lipa deni ili uweze kuagiza safari tena.</p>
          <a class="btn btn-primary btn-block" href="#/akaunti/deni">Lipa deni kwa simu</a></div></section>`;
  }
  if (!f.enabled) return '';
  if (f.pending) return `<section class="card fp-card" id="fare-pay">${waitingHtml(f.pending.phone, f.total)}</section>`;
  if (!f.canPay) {
    return f.numbersLeft === 0
      ? `<section class="card fp-card is-muted" id="fare-pay"><div><h2>Lipa taslimu</h2><p class="muted">Umejaribu namba ${f.numbersUsed.length} bila mafanikio. Mpe dereva ${formatTsh(f.due)} taslimu.</p></div></section>`
      : '';
  }
  const failed = f.last?.status === 'FAILED';
  return `<section class="card fp-card" id="fare-pay" aria-labelledby="fp-title">
      <h2 id="fp-title">Lipa nauli</h2>
      ${sumHtml(f)}
      ${
        failed
          ? `<p class="alert alert-danger" role="alert">Malipo kwa ${esc(formatPhone(f.last.phone))} hayakufanikiwa${f.last.failureReason ? `: ${esc(f.last.failureReason)}` : '.'} ${
              f.numbersLeft ? `Jaribu tena au tumia namba nyingine (zimebaki ${f.numbersLeft}).` : ''
            }</p>`
          : ''
      }
      ${phoneForm('fp-phone', failed ? '' : ctx.myPhone() ? formatPhone(ctx.myPhone()) : '', `Namba ${f.numbersLeft} kati ya 3 zinaweza kujaribiwa.`)}
      <p class="alert alert-danger" id="fp-error" role="alert"${ui.error ? '' : ' hidden'}>${esc(ui.error ?? '')}</p>
      <button class="btn btn-primary btn-block btn-big" type="button" data-ride="fare-pay"${ui.busy ? ' disabled' : ''}>${ICON.phone}<span>${
        ui.busy ? 'Inatuma ombi…' : `Lipa ${formatTsh(f.total)} kwa simu`
      }</span></button>
      <p class="fp-or">au mpe dereva <strong>${formatTsh(f.due)}</strong> taslimu</p>
    </section>`;
}

/** Abiria — mstari wa juu wa skrini ya "Umefika" */
export function passengerHeadline(ride) {
  const f = ride.farePay;
  const pays = ride.passengerPays ?? ride.fare;
  const promo = ride.promo ? ` Ofa ya NAYA imelipa ${formatTsh(ride.promo.discount)}.` : '';
  if (!f || !f.enabled || f.settlement === 'CASH') return `Lipa dereva ${formatTsh(pays)} taslimu.${promo}`;
  if (f.settlement === 'MOBILE') return `Umelipa ${formatTsh(pays)} kwa simu.${promo}`;
  if (f.settlement === 'DEBT') return `Hukulipa ${formatTsh(pays)} — limekuwa deni.`;
  return `Lipa ${formatTsh(pays)} kwa simu hapa chini, au taslimu kwa dereva.${promo}`;
}

/** Dereva — sehemu ya malipo kwenye skrini ya "Pokea …". `ui` = { debtConfirm, busy, error } */
export function driverSectionHtml(ride, ui = {}) {
  const f = ride.farePay;
  if (!f) return '';
  if (f.settlement === 'MOBILE') {
    return `<section class="card fp-card is-ok" role="status"><span class="fp-ico">${ICON.check}</span>
      <div><h2>Abiria amelipa kwa simu</h2><p class="muted">${formatTsh(f.due)} imeingia kwenye wallet yako. <a href="#/akaunti/wallet">Fungua wallet</a></p></div></section>`;
  }
  if (f.settlement === 'CASH') return `<p class="fp-note">${ICON.check} Umeandika: umepokea ${formatTsh(f.due)} taslimu.</p>`;
  if (f.settlement === 'DEBT') {
    return `<section class="card fp-card is-muted"><div><h2>Deni la abiria</h2><p class="muted">${
      f.debtCleared ? 'Deni limeondolewa.' : `Abiria akilipa deni lake la ${formatTsh(f.due)}, pesa itaingia kwenye wallet yako.`
    }</p></div></section>`;
  }
  if (f.pending) return `<section class="card fp-card"><div class="fp-wait" role="status"><span class="fp-spin" aria-hidden="true"></span><p><strong>Abiria analipa kwa simu…</strong><br>Subiri uthibitisho — pesa itaingia kwenye wallet yako.</p></div></section>`;
  if (!f.canSettle) return '';
  if (ui.debtConfirm) {
    return `<section class="card confirm fp-card">
      <p><strong>Abiria hajalipa ${formatTsh(f.due)}?</strong></p>
      <p class="muted">Litakuwa deni lake. Hataweza kuagiza safari mpya mpaka alipe kwa simu — pesa itaingia kwenye wallet yako.</p>
      <p class="alert alert-danger" id="fp-error" role="alert"${ui.error ? '' : ' hidden'}>${esc(ui.error ?? '')}</p>
      <div class="actions"><button class="btn btn-danger" type="button" data-ride="settle-debt-confirm" data-id="${esc(ride.id)}"${ui.busy ? ' disabled' : ''}>Ndiyo, hajalipa</button>
      <button class="btn btn-ghost" type="button" data-ride="settle-debt-keep">Rudi</button></div>
    </section>`;
  }
  return `<section class="card fp-card">
      <h2>Malipo ya nauli</h2>
      <p class="muted">${f.enabled ? 'Abiria anaweza kulipa kwa simu kwenye app yake — pesa inaingia kwenye wallet yako.' : 'Abiria analipa taslimu.'} Akikupa taslimu, bonyeza hapa:</p>
      <p class="alert alert-danger" id="fp-error" role="alert"${ui.error ? '' : ' hidden'}>${esc(ui.error ?? '')}</p>
      <button class="btn btn-primary btn-block" type="button" data-ride="settle-cash" data-id="${esc(ride.id)}"${ui.busy ? ' disabled' : ''}>${ICON.cash}<span>Nimepokea ${formatTsh(f.due)} taslimu</span></button>
      ${f.canDebt ? `<button class="btn btn-ghost btn-block btn-plain" type="button" data-ride="settle-debt">Abiria hajalipa</button>` : ''}
    </section>`;
}

export const fareKey = (f) => (f ? [f.settlement, f.debtCleared, f.pending?.id, f.last?.id, f.numbersLeft, f.canPay, f.canSettle].join(',') : '');

/** Namba iliyoandikwa → 2557XXXXXXXX (server inakagua pia). */
export function phoneValue(id) {
  const raw = String($(id)?.value ?? '').replace(/[^\d+]/g, '');
  return raw;
}

// ------------------------------------------------------------------ #/akaunti/deni

export async function renderDebtPage() {
  clearInterval(debtPoll);
  $('app-content').innerHTML = `<a class="back" href="#/akaunti">‹ Akaunti</a><div id="debt"><p class="muted">Inapakia…</p></div>`;
  await loadDebt();
}

async function loadDebt(error = '') {
  let d;
  try {
    d = await ctx.api.get('/api/passenger/debt');
  } catch (err) {
    if (!ctx.handleError(err)) $('debt').innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
    return;
  }
  const box = $('debt');
  if (!box) return;
  clearInterval(debtPoll);
  if (!d.due) {
    box.innerHTML = `<h1 class="acct-title">Deni langu</h1>
      <section class="card fp-card is-ok"><span class="fp-ico">${ICON.check}</span><div><h2>Huna deni</h2><p class="muted">Unaweza kuagiza safari.</p></div></section>
      <a class="btn btn-primary btn-block" href="#/">Agiza safari</a>`;
    return;
  }
  box.innerHTML = `<h1 class="acct-title">Deni langu</h1>
    <p class="muted">Safari ${d.rides.length === 1 ? 'hii hukuilipa' : 'hizi hukuzilipa'}. Ukilipa, pesa inaenda kwa dereva na utaweza kuagiza safari tena.</p>
    <ul class="card fp-debts">${d.rides
      .map(
        (r) => `<li><span><strong>${esc(r.from)} → ${esc(r.to)}</strong><span class="muted">${esc(formatDate(r.completedAt, true))}${r.driverName ? ` · ${esc(r.driverName)}` : ''}</span></span><strong>${formatTsh(r.amount)}</strong></li>`,
      )
      .join('')}</ul>
    ${
      !d.enabled
        ? '<p class="alert alert-warn">Malipo kwa simu yamezimwa kwa sasa. Wasiliana na ofisi ya NAYA.</p>'
        : d.pending
          ? `<section class="card fp-card">${waitingHtml(d.pending.phone, d.total)}</section>`
          : `<section class="card fp-card">
              ${sumHtml(d)}
              ${phoneForm('debt-phone', ctx.myPhone() ? formatPhone(ctx.myPhone()) : '', '')}
              <p class="alert alert-danger" id="debt-error" role="alert"${error ? '' : ' hidden'}>${esc(error)}</p>
              <button class="btn btn-primary btn-block btn-big" type="button" data-debt="pay">${ICON.phone}<span>Lipa ${formatTsh(d.total)} kwa simu</span></button>
            </section>`
    }`;
  if (d.pending) debtPoll = setInterval(() => watchDebt(d.pending.id), 4000);
}

async function watchDebt(paymentId) {
  if (!$('debt')) return clearInterval(debtPoll);
  try {
    const p = await ctx.api.get(`/api/payments/${paymentId}`);
    if (p.status === 'PENDING') return;
    clearInterval(debtPoll);
    if (p.status === 'SUCCESS') ctx.toast('Deni limelipwa — asante!');
    loadDebt(p.status === 'FAILED' ? `Malipo hayakufanikiwa${p.failureReason ? `: ${p.failureReason}` : '.'} Jaribu tena au tumia namba nyingine.` : '');
  } catch {
    // jaribu tena baadaye
  }
}

async function onDebtClick(event) {
  const b = event.target.closest('[data-debt="pay"]');
  if (!b || !$('debt')) return;
  const phone = phoneValue('debt-phone');
  if (phone.replace(/\D/g, '').length < 9) {
    $('debt-error').textContent = 'Weka namba ya simu ya kulipia.';
    $('debt-error').hidden = false;
    return;
  }
  b.disabled = true;
  try {
    const p = await ctx.api.post('/api/passenger/debt/pay', { phone });
    if (p.status === 'FAILED') return loadDebt(`Malipo hayakufanikiwa${p.failureReason ? `: ${p.failureReason}` : '.'} Jaribu namba nyingine.`);
    loadDebt();
  } catch (err) {
    b.disabled = false;
    ctx.handleError(err, 'debt-error');
  }
}
