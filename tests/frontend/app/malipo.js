// Ada ya mwezi kwa simu (0.16.0): dereva anachagua miezi + mtandao + namba → ombi la PIN linaenda kwenye simu yake →
// app inasubiri uthibitisho wa kampuni ya malipo (inauliza kila sekunde 3) → siku zinaongezwa zenyewe.
// HAKUNA kinachoandikwa "imelipwa" kwenye app mpaka server iseme SUCCESS.
// 0.20.0: au "Pata control number" — dereva analipa kutoka app / menyu ya pesa ya simu, wakala au benki (kiasi kamili);
// malipo yakifika, siku zinaongezwa zenyewe (webhook ya Abliner).
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, handleError, toast, phone(), onPaid() }
let pollTimer = null;
let waitingId = null;
let started = 0;
let controlTimer = null;

const PHONE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10.5 18.5h3"/></svg>';

export function init(c) {
  ctx = c;
  const root = $('app-content');
  root.addEventListener('submit', onSubmit);
  root.addEventListener('click', onClick);
  root.addEventListener('change', (e) => {
    if (e.target.name === 'pay-months') updateTotal();
  });
}

export function stop() {
  clearInterval(pollTimer);
  pollTimer = null;
  waitingId = null;
  clearInterval(controlTimer);
  controlTimer = null;
}

/** Sehemu ya "Lipa kwa simu" ndani ya ukurasa wa Ada ya mwezi. sub = GET /api/driver/subscription. */
export function sectionHtml(sub) {
  const o = sub.online;
  if (!o?.enabled) return walletLink();
  if (o.pending) return `${walletLink()}<div id="pay-box">${waitingHtml(o.pending)}</div>${controlHtml(sub)}`;
  const months = [1, 2, 3];
  const net = o.suggestedNetwork ?? o.networks[0]?.code;
  return `${walletLink()}<div id="pay-box"><form class="pay-form" id="pay-form" data-fee="${sub.monthlyFee}" novalidate>
      <h3>Lipa kwa simu sasa</h3>
      <p class="muted small">Utapokea ombi kwenye simu yako — ingiza PIN yako ya pesa ya simu kuthibitisha. Siku zinaongezwa papo hapo.</p>
      <fieldset class="pay-months"><legend>Miezi</legend>
        ${months
          .map(
            (m) => `<label><input type="radio" name="pay-months" value="${m}"${m === 1 ? ' checked' : ''}><span><strong>${m === 1 ? 'Mwezi 1' : `Miezi ${m}`}</strong><span class="muted">${formatTsh(sub.monthlyFee * m)}</span></span></label>`,
          )
          .join('')}
      </fieldset>
      <label for="pay-network">Mtandao</label>
      <select id="pay-network">${o.networks.map((n) => `<option value="${n.code}"${n.code === net ? ' selected' : ''}>${esc(n.label)}</option>`).join('')}</select>
      <label for="pay-phone">Namba ya kulipia</label>
      <input id="pay-phone" inputmode="tel" autocomplete="tel" value="${esc(formatPhone(ctx.phone()))}">
      <p class="alert alert-danger" id="pay-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block btn-big" type="submit" id="pay-submit">Lipa ${formatTsh(sub.monthlyFee)}</button>
    </form></div>${controlHtml(sub)}`;
}

/** 0.21.0: ada inaweza kulipwa kwa salio la Wallet ya dereva (PIN, bila M-Pesa). */
const walletLink = () =>
  `<a class="mw-paylink" href="#/akaunti/wallet/ada"><span><strong>Lipa kwa salio la Wallet</strong><span class="muted">Kwa PIN yako ya wallet — bila kusubiri M-Pesa</span></span><span aria-hidden="true">›</span></a>`;

// ------------------------------------------------------------------ control number (BillPay)

const COPY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>';
const spaced = (n) => String(n).replace(/(\d{4})(?=\d)/g, '$1 ');

function controlCard(p) {
  return `<li class="cn-card">
      <span class="cn-label">Control number · ${p.months === 1 ? 'mwezi 1' : `miezi ${p.months}`}</span>
      <span class="cn-number" translate="no">${esc(spaced(p.controlNumber))}</span>
      <span class="cn-amount">Lipa <strong>${formatTsh(p.amount)}</strong> kamili${p.expiresAt ? ` · hadi ${esc(formatDate(p.expiresAt))}` : ''}</span>
      <button class="btn btn-ghost btn-small cn-copy" type="button" data-pay="copy" data-number="${esc(p.controlNumber)}">${COPY_ICON} Nakili namba</button>
    </li>`;
}

function controlHtml(sub) {
  const o = sub.online;
  if (!o?.controlNumbers) return '';
  const open = (o.control ?? []).filter((p) => p.controlNumber);
  return `<section class="cn-box" id="cn-box" aria-labelledby="cn-title">
      <h3 id="cn-title">Au lipa kwa control number</h3>
      <p class="muted small">Ombi la PIN halikufiki, au unataka kulipa kwa wakala au benki? Pata namba ya kulipia bili, kisha lipa kutoka M-Pesa, Mixx by Yas, Airtel Money, HaloPesa au benki. Siku zinaongezwa zenyewe malipo yakifika.</p>
      ${open.length ? `<ul class="cn-list">${open.map(controlCard).join('')}</ul>
        <p class="cn-how small">Kwenye menyu au app ya pesa ya simu (au benki), chagua <strong>kulipa bili kwa control number</strong>, weka namba hapo juu na ulipe <strong>kiasi kamili</strong>.</p>` : ''}
      <p class="alert alert-danger" id="cn-error" role="alert" hidden></p>
      <button class="btn btn-ghost btn-block" type="button" data-pay="control">${open.length ? 'Pata control number nyingine' : 'Pata control number'}</button>
    </section>`;
}

function chosenMonths() {
  return Number($('pay-form')?.querySelector('input[name="pay-months"]:checked')?.value ?? 1);
}

/** Control number zilizo wazi: angalia kila sekunde 20 kama zimelipwa (ukurasa ukiwa wazi). */
function watchControl(list) {
  clearInterval(controlTimer);
  controlTimer = null;
  const ids = (list ?? []).filter((p) => p.controlNumber).map((p) => p.id);
  if (!ids.length) return;
  controlTimer = setInterval(async () => {
    if (!$('cn-box')) return clearInterval(controlTimer);
    try {
      for (const id of ids) {
        const p = await ctx.api.get(`/api/payments/${id}`);
        if (p.status === 'SUCCESS') {
          clearInterval(controlTimer);
          ctx.toast('Ada imepokelewa kwa control number — asante!');
          ctx.onPaid();
          return;
        }
      }
    } catch (err) {
      if (ctx.handleError(err)) clearInterval(controlTimer);
    }
  }, 20_000);
}

async function getControlNumber(button) {
  $('cn-error').hidden = true;
  button.disabled = true;
  button.textContent = 'Inatengeneza control number…';
  try {
    await ctx.api.post('/api/driver/subscription/control-number', { months: chosenMonths() });
    ctx.toast('Control number iko tayari');
    ctx.reload();
  } catch (err) {
    if (ctx.handleError(err, 'cn-error')) return;
    button.disabled = false;
    button.textContent = 'Pata control number';
  }
}

/** Baada ya kuchora ukurasa: kama kuna ombi linalosubiri, endelea kulisubiri. */
export function afterRender(sub) {
  if (sub.online?.pending) watch(sub.online.pending.id);
  watchControl(sub.online?.control);
}

function updateTotal() {
  const form = $('pay-form');
  if (!form) return;
  const m = Number(form.querySelector('input[name="pay-months"]:checked')?.value ?? 1);
  $('pay-submit').textContent = `Lipa ${formatTsh(Number(form.dataset.fee) * m)}`;
}

function waitingHtml(p) {
  return `<div class="pay-wait" role="status" aria-live="polite">
    <span class="pay-wait-phone" aria-hidden="true">${PHONE_ICON}<i></i></span>
    <h3>Angalia simu yako</h3>
    <p>Ingiza PIN yako ya <strong>${esc(p.networkLabel)}</strong> kwenye <strong>${esc(formatPhone(p.phone))}</strong> kuthibitisha kulipa <strong>${formatTsh(p.amount)}</strong> kwa NAYA.</p>
    <p class="muted small">Ombi halijafika? Hakikisha simu iko hewani. Linaweza kuchukua sekunde chache.</p>
  </div>`;
}

function resultHtml(p) {
  if (p.status === 'SUCCESS') {
    return `<div class="pay-done" role="status"><h3>Ada imepokelewa — asante!</h3>
      <p>${formatTsh(p.amount)} kutoka ${esc(p.networkLabel)} ${esc(formatPhone(p.phone))}.${p.providerRef ? ` Kumbukumbu: <strong>${esc(p.providerRef)}</strong>.` : ''}</p></div>`;
  }
  return `<div class="pay-fail" role="alert"><h3>Malipo hayakukamilika</h3>
    <p>${esc(p.failureReason ?? 'Malipo yameshindwa.')}</p>
    <button class="btn btn-primary btn-block" type="button" data-pay="again">Jaribu tena</button></div>`;
}

function watch(id) {
  clearInterval(pollTimer);
  waitingId = id;
  started = Date.now();
  pollTimer = setInterval(poll, 3000);
}

async function poll() {
  if (!waitingId || !$('pay-box')) return stop();
  try {
    const p = await ctx.api.get(`/api/payments/${waitingId}`);
    if (p.status === 'PENDING') {
      // Baada ya dakika 3 tunauliza mara chache zaidi (server inaendelea kuhakiki hadi dakika 15)
      if (Date.now() - started > 180_000) {
        clearInterval(pollTimer);
        pollTimer = setInterval(poll, 15000);
      }
      return;
    }
    stop();
    $('pay-box').innerHTML = resultHtml(p);
    if (p.status === 'SUCCESS') {
      ctx.toast('Ada imepokelewa');
      ctx.onPaid();
    }
  } catch (err) {
    if (ctx.handleError(err)) stop();
  }
}

async function onSubmit(event) {
  if (event.target.id !== 'pay-form') return;
  event.preventDefault();
  const form = event.target;
  const button = $('pay-submit');
  $('pay-error').hidden = true;
  button.disabled = true;
  button.textContent = 'Inatuma ombi…';
  try {
    const p = await ctx.api.post('/api/driver/subscription/pay', {
      months: Number(form.querySelector('input[name="pay-months"]:checked')?.value ?? 1),
      network: $('pay-network').value,
      phone: $('pay-phone').value,
    });
    if (p.status === 'PENDING') {
      $('pay-box').innerHTML = waitingHtml(p);
      watch(p.id);
    } else {
      $('pay-box').innerHTML = resultHtml(p);
      if (p.status === 'SUCCESS') ctx.onPaid();
    }
  } catch (err) {
    if (ctx.handleError(err, 'pay-error')) return;
    button.disabled = false;
    updateTotal();
  }
}

function onClick(event) {
  if (event.target.closest('[data-pay="again"]')) return ctx.reload();
  const control = event.target.closest('[data-pay="control"]');
  if (control) return getControlNumber(control);
  const copy = event.target.closest('[data-pay="copy"]');
  if (copy) {
    const n = copy.dataset.number;
    (navigator.clipboard?.writeText(n) ?? Promise.reject())
      .then(() => ctx.toast('Control number imenakiliwa'))
      .catch(() => ctx.toast(`Control number: ${n}`));
  }
}
