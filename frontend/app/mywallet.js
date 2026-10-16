// Wallet yangu (0.21.0) — app ya dereva:
//   #/akaunti/wallet        salio, mapato ya leo, vitendo, historia
//   #/akaunti/wallet/toa    kutoa pesa: kiasi → ada na atakachopokea (kutoka Abliner) → PIN → imetumwa
//   #/akaunti/wallet/ada    kulipa ada ya mwezi kwa salio (PIN)
//   #/akaunti/wallet/pin    kutengeneza / kubadilisha PIN, "Nimesahau PIN"
// Hakuna kinachoandikwa "imetumwa" mpaka server iseme hivyo (jibu la kampuni ya malipo).
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, handleError, toast }
let w = null; // GET /api/driver/wallet
let previewTimer = null;
let previewSeq = 0;
let lastPreview = null;

const ICON = {
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/><path d="M6 11l6-6 6 6"/></svg>',
  in: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg>',
  card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};
const KIND_ICON = { PROMO_EARNING: 'in', RIDE_EARNING: 'in', WITHDRAWAL: 'out', WITHDRAWAL_REVERSAL: 'undo', SUBSCRIPTION: 'card', ADJUSTMENT: 'pen' };

export function init(context) {
  ctx = context;
  const root = $('app-content');
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('input', onInput);
}

const back = (href, label) => `<a class="back" href="${href}">‹ ${esc(label)}</a>`;
const fail = (err, box) => ctx.handleError(err, box);

async function load() {
  w = await ctx.api.get('/api/driver/wallet');
  return w;
}

/** #/akaunti/wallet[/sehemu] */
export async function render(section) {
  clearTimeout(previewTimer);
  lastPreview = null;
  $('app-content').innerHTML = `${back(section ? '#/akaunti/wallet' : '#/akaunti', section ? 'Wallet yangu' : 'Akaunti')}<div id="mw"><p class="muted">Inapakia…</p></div>`;
  try {
    await load();
  } catch (err) {
    if (!fail(err)) $('mw').innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
    return;
  }
  if (!$('mw')) return;
  if (section === 'toa') return renderWithdraw();
  if (section === 'ada') return renderFee();
  if (section === 'pin') return renderPin();
  renderHome();
}

// ------------------------------------------------------------------ mwanzo

function notices() {
  const out = [];
  if (w.status !== 'ACTIVE') out.push(['bad', `Wallet imesimamishwa na ofisi${w.suspendedReason ? `: ${esc(w.suspendedReason)}` : ''}. Salio lako liko salama.`]);
  if (w.pin.blocked) out.push(['bad', 'PIN imekosewa mara nyingi — wallet imefungwa. Wasiliana na ofisi ya NAYA.']);
  else if (w.pin.resetAllowed) out.push(['warn', 'Ofisi imeruhusu PIN mpya. <a href="#/akaunti/wallet/pin">Weka PIN yako mpya</a>.']);
  else if (!w.pin.set) out.push(['warn', 'Tengeneza PIN ya wallet ili uweze kutoa pesa. <a href="#/akaunti/wallet/pin">Tengeneza PIN</a>.']);
  else if (w.pin.resetRequested) out.push(['muted', 'Ombi lako la PIN mpya limetumwa ofisi. Watakupigia kuthibitisha ni wewe.']);
  if (!w.account) out.push(['warn', 'Weka namba yako ya kupokea pesa. <a href="#/akaunti/malipo-ya-ofa">Weka namba</a>.']);
  else if (!w.account.verified || w.account.nameChanged) out.push(['warn', 'Thibitisha namba yako ya malipo (jina la mwenye namba). <a href="#/akaunti/malipo-ya-ofa">Thibitisha</a>.']);
  if (w.holdUntil) out.push(['muted', `Kwa usalama (${esc(w.holdReason ?? 'mabadiliko ya karibuni')}), kutoa kutawezekana baada ya ${esc(formatDate(w.holdUntil, true))}.`]);
  if (w.pendingWithdrawal) out.push(['muted', `Unatoa ${formatTsh(w.pendingWithdrawal.amount)} — inasubiri uthibitisho wa mtandao.`]);
  return out.map(([tone, html]) => `<p class="mw-note is-${tone}" role="status">${html}</p>`).join('');
}

function dayLabel(d) {
  const day = new Date(d);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  const same = (a, b) => a.toDateString() === b.toDateString();
  if (same(day, today)) return 'Leo';
  if (same(day, y)) return 'Jana';
  return formatDate(d);
}

function historyHtml() {
  if (!w.entries.length) return '<p class="muted mw-empty">Bado hakuna miamala. Ukibeba mteja wa ofa, NAYA inaweka malipo yako hapa.</p>';
  let last = '';
  const parts = [];
  for (const e of w.entries) {
    const label = dayLabel(e.createdAt);
    if (label !== last) {
      parts.push(`<li class="mw-day">${esc(label)}</li>`);
      last = label;
    }
    const plus = e.amount > 0;
    const pending = e.kind === 'WITHDRAWAL' && e.paymentStatus === 'PENDING';
    const time = new Intl.DateTimeFormat('sw-TZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Dar_es_Salaam' }).format(new Date(e.createdAt));
    parts.push(`<li class="mw-tx">
        <span class="mw-tx-ico is-${KIND_ICON[e.kind] ?? 'pen'}">${ICON[KIND_ICON[e.kind] ?? 'pen']}</span>
        <span class="mw-tx-txt"><strong>${esc(e.label)}</strong><span class="muted">${esc(time)}${e.note ? ` · ${esc(e.note)}` : ''}${pending ? ' · <em>inasubiri uthibitisho</em>' : ''}</span></span>
        <span class="mw-tx-amt ${plus ? 'is-in' : 'is-out'}">${plus ? '+' : '−'}${formatTsh(Math.abs(e.amount))}<small>${formatTsh(e.balanceAfter)}</small></span>
      </li>`);
  }
  return `<ul class="mw-list">${parts.join('')}</ul>`;
}

function renderHome() {
  const canFee = w.status === 'ACTIVE' && w.pin.set && !w.pin.blocked && !w.pin.resetAllowed && w.monthlyFee > 0;
  $('mw').innerHTML = `
    <section class="mw-hero" aria-labelledby="mw-title">
      <p class="mw-hero-top"><span id="mw-title">Wallet yangu</span><span class="mw-chip">Leo +${formatTsh(w.earnedToday)}</span></p>
      <p class="mw-balance" aria-live="polite"><small>TSh</small>${Number(w.balance).toLocaleString('en-US')}</p>
      <p class="mw-hero-sub">${
        w.account ? `Inatumwa kwenda ${esc(w.account.networkLabel)} ${esc(formatPhone(w.account.phone))}${w.account.verified ? ` · ${esc(w.account.name)}` : ''}` : 'Weka namba ya kupokea pesa'
      }</p>
      <div class="mw-actions">
        <a class="mw-btn mw-btn-gold${w.canWithdraw ? '' : ' is-off'}" href="#/akaunti/wallet/toa" ${w.canWithdraw ? '' : 'aria-disabled="true"'}>${ICON.out}<span>Toa pesa</span></a>
        <a class="mw-btn${canFee ? '' : ' is-off'}" href="#/akaunti/wallet/ada" ${canFee ? '' : 'aria-disabled="true"'}>${ICON.card}<span>Lipa ada</span></a>
        <a class="mw-btn" href="#/akaunti/wallet/pin">${ICON.lock}<span>${w.pin.set && !w.pin.resetAllowed ? 'PIN' : 'Tengeneza PIN'}</span></a>
      </div>
    </section>
    ${notices()}
    ${!w.canWithdraw && w.withdrawBlock && w.pin.set && w.account?.verified && !w.holdUntil && w.status === 'ACTIVE' ? `<p class="mw-note is-muted">${esc(w.withdrawBlock)}</p>` : ''}
    <section class="card mw-history" aria-labelledby="mw-h">
      <h2 id="mw-h">Historia</h2>
      ${historyHtml()}
    </section>
    <p class="small muted mw-foot">Kutoa: kuanzia ${formatTsh(w.limits.min)} hadi ${formatTsh(w.limits.dailyMax)} kwa siku. Ada ya mtandao ya kutuma inaonyeshwa kabla hujathibitisha.</p>`;
}

// ------------------------------------------------------------------ PIN input (tarakimu 4, nukta)

const pinField = (id, label) => `<label for="${id}">${esc(label)}</label>
  <input class="mw-pin" id="${id}" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="••••" required>`;

// ------------------------------------------------------------------ kutoa pesa

function renderWithdraw() {
  if (!w.canWithdraw) {
    $('mw').innerHTML = `<h1 class="acct-title">Toa pesa</h1>${notices()}<p class="mw-note is-warn">${esc(w.withdrawBlock ?? 'Kutoa hakuwezekani kwa sasa.')}</p>`;
    return;
  }
  const max = Math.min(w.balance, w.limits.leftToday);
  const chips = [5000, 10000, 20000].filter((v) => v <= max && v >= w.limits.min);
  $('mw').innerHTML = `
    <h1 class="acct-title">Toa pesa</h1>
    <p class="muted">Salio: <strong>${formatTsh(w.balance)}</strong> · leo unaweza kutoa hadi ${formatTsh(max)}</p>
    <form class="card mw-form" id="mw-withdraw" novalidate>
      <label for="mw-amount">Kiasi cha kutoa (TSh)</label>
      <input class="mw-amount" id="mw-amount" inputmode="numeric" autocomplete="off" placeholder="0" required>
      <div class="mw-chips">${chips.map((v) => `<button type="button" class="mw-chipbtn" data-mw="amt" data-v="${v}">${formatTsh(v)}</button>`).join('')}<button type="button" class="mw-chipbtn" data-mw="amt" data-v="${max}">Yote · ${formatTsh(max)}</button></div>
      <div class="mw-dest">
        <span class="mw-dest-ico">${ICON.check}</span>
        <span><small>Inatumwa kwenda</small><strong>${esc(w.account.name)}</strong><span class="muted">${esc(w.account.networkLabel)} · ${esc(formatPhone(w.account.phone))}</span></span>
      </div>
      <div class="mw-quote" id="mw-quote" aria-live="polite" hidden></div>
      ${pinField('mw-pin', 'PIN ya wallet')}
      <p class="alert alert-danger" id="mw-withdraw-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block btn-big" type="submit" id="mw-withdraw-btn" disabled>Andika kiasi</button>
    </form>`;
}

const amountValue = () => Number(String($('mw-amount')?.value ?? '').replace(/[^\d]/g, '')) || 0;

function schedulePreview() {
  clearTimeout(previewTimer);
  lastPreview = null;
  const btn = $('mw-withdraw-btn');
  const box = $('mw-quote');
  const amount = amountValue();
  if (!btn) return;
  btn.disabled = true;
  if (!amount) {
    btn.textContent = 'Andika kiasi';
    box.hidden = true;
    return;
  }
  btn.textContent = 'Inahesabu ada…';
  previewTimer = setTimeout(async () => {
    const my = ++previewSeq;
    try {
      const q = await ctx.api.get(`/api/driver/wallet/withdraw/preview?amount=${amount}`);
      if (my !== previewSeq || !$('mw-quote')) return;
      lastPreview = q;
      box.hidden = false;
      box.className = 'mw-quote';
      box.innerHTML = `<span><small>Unatoa</small><strong>${formatTsh(q.amount)}</strong></span>
        <span><small>Ada ya mtandao${q.source === 'estimate' ? ' (makadirio)' : ''}</small><strong>−${formatTsh(q.fee)}</strong></span>
        <span class="is-total"><small>Utapokea</small><strong>${formatTsh(q.receive)}</strong></span>`;
      btn.disabled = false;
      btn.textContent = `Toa ${formatTsh(q.amount)}`;
    } catch (err) {
      if (my !== previewSeq || !$('mw-quote')) return;
      if (ctx.handleError(err, null)) return;
      box.hidden = false;
      box.className = 'mw-quote is-bad';
      box.textContent = err.message;
      btn.textContent = 'Badilisha kiasi';
    }
  }, 380);
}

function resultHtml(kind, title, body) {
  return `<section class="mw-result is-${kind}" role="status">
      <span class="mw-result-ico">${kind === 'ok' ? ICON.check : kind === 'bad' ? ICON.undo : ICON.out}</span>
      <h2>${esc(title)}</h2><p>${body}</p>
      <a class="btn btn-primary btn-block" href="#/akaunti/wallet">Rudi kwenye wallet</a>
    </section>`;
}

// ------------------------------------------------------------------ ada kwa salio

function renderFee() {
  const fee = w.monthlyFee;
  const months = [1, 2, 3].filter((m) => fee * m <= w.balance);
  if (!w.pin.set || w.pin.resetAllowed) {
    $('mw').innerHTML = `<h1 class="acct-title">Lipa ada kwa salio</h1><p class="mw-note is-warn">Tengeneza PIN ya wallet kwanza. <a href="#/akaunti/wallet/pin">Tengeneza PIN</a></p>`;
    return;
  }
  $('mw').innerHTML = `
    <h1 class="acct-title">Lipa ada kwa salio</h1>
    <p class="muted">Salio: <strong>${formatTsh(w.balance)}</strong> · ada ni ${formatTsh(fee)} kwa siku 30</p>
    ${
      months.length
        ? `<form class="card mw-form" id="mw-fee" novalidate>
            <fieldset class="pay-months"><legend>Miezi</legend>${months
              .map((m) => `<label><input type="radio" name="mw-months" value="${m}"${m === 1 ? ' checked' : ''}><span><strong>${m === 1 ? 'Mwezi 1' : `Miezi ${m}`}</strong><span class="muted">${formatTsh(fee * m)}</span></span></label>`)
              .join('')}</fieldset>
            ${pinField('mw-fee-pin', 'PIN ya wallet')}
            <p class="alert alert-danger" id="mw-fee-error" role="alert" hidden></p>
            <button class="btn btn-primary btn-block btn-big" type="submit">Lipa ${formatTsh(fee)} kwa salio</button>
          </form>`
        : `<p class="mw-note is-warn">Salio halitoshi kulipa ada ya mwezi 1 (${formatTsh(fee)}). <a href="#/akaunti/ada">Lipa kwa simu</a></p>`
    }`;
}

// ------------------------------------------------------------------ PIN

function renderPin() {
  const create = !w.pin.set || w.pin.resetAllowed;
  $('mw').innerHTML = create
    ? `<h1 class="acct-title">${w.pin.resetAllowed ? 'Weka PIN mpya' : 'Tengeneza PIN ya wallet'}</h1>
      <p class="muted">PIN ya tarakimu 4 inalinda pesa zako: inahitajika kila unapotoa pesa, kulipa ada kwa salio au kubadilisha namba ya malipo. Usimwambie mtu yeyote — hata ofisi ya NAYA haiioni.</p>
      <form class="card mw-form" id="mw-pin-new" novalidate>
        ${pinField('mw-pin1', 'PIN mpya')}
        ${pinField('mw-pin2', 'Rudia PIN')}
        <label for="mw-pw">Password ya akaunti yako</label>
        <input id="mw-pw" type="password" autocomplete="current-password" required>
        <p class="small muted">Epuka PIN rahisi kama 1234, 0000 au tarakimu 4 za mwisho za simu yako.${w.pin.resetAllowed ? ' Kwa usalama, kutoa kutawezekana baada ya saa 24.' : ''}</p>
        <p class="alert alert-danger" id="mw-pin-new-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">Hifadhi PIN</button>
      </form>`
    : `<h1 class="acct-title">PIN ya wallet</h1>
      <form class="card mw-form" id="mw-pin-change" novalidate>
        <h2>Badilisha PIN</h2>
        ${pinField('mw-old', 'PIN ya sasa')}
        ${pinField('mw-new1', 'PIN mpya')}
        ${pinField('mw-new2', 'Rudia PIN mpya')}
        <p class="alert alert-danger" id="mw-pin-change-error" role="alert" hidden></p>
        <button class="btn btn-primary btn-block" type="submit">Badilisha PIN</button>
      </form>
      <section class="card mw-forgot">
        <h2>Umesahau PIN?</h2>
        ${
          w.pin.resetRequested
            ? '<p class="muted">Ombi lako limetumwa ofisi ya NAYA. Watakupigia kuthibitisha ni wewe, kisha utaweka PIN mpya hapa.</p>'
            : `<p class="muted">Ombi linaenda ofisi ya NAYA. Wakithibitisha ni wewe, utaweka PIN mpya mwenyewe.</p>
               <p class="alert alert-danger" id="mw-forgot-error" role="alert" hidden></p>
               <button class="btn btn-ghost btn-block" type="button" data-mw="forgot">Omba PIN mpya</button>`
        }
      </section>`;
}

// ------------------------------------------------------------------ matukio

function onInput(event) {
  if (event.target.id === 'mw-amount') {
    const digits = event.target.value.replace(/[^\d]/g, '');
    event.target.value = digits ? Number(digits).toLocaleString('en-US') : '';
    schedulePreview();
  } else if (event.target.classList?.contains('mw-pin')) {
    event.target.value = event.target.value.replace(/[^\d]/g, '').slice(0, 4);
  }
}

async function onClick(event) {
  const b = event.target.closest('[data-mw]');
  const off = event.target.closest('.mw-btn.is-off');
  if (off) {
    event.preventDefault();
    if (w?.withdrawBlock && off.classList.contains('mw-btn-gold')) ctx.toast(w.withdrawBlock);
    return;
  }
  if (!b) return;
  if (b.dataset.mw === 'amt') {
    $('mw-amount').value = Number(b.dataset.v).toLocaleString('en-US');
    schedulePreview();
    $('mw-pin')?.focus();
    return;
  }
  if (b.dataset.mw === 'forgot') {
    if (!confirm('Tuma ombi la PIN mpya kwa ofisi ya NAYA?')) return;
    b.disabled = true;
    try {
      w = await ctx.api.post('/api/driver/wallet/pin/forgot', {});
      ctx.toast('Ombi limetumwa ofisi ya NAYA');
      renderPin();
    } catch (err) {
      b.disabled = false;
      fail(err, 'mw-forgot-error');
    }
  }
}

function formError(id, message) {
  const box = $(id);
  box.textContent = message;
  box.hidden = false;
}

async function onSubmit(event) {
  const form = event.target;
  if (!['mw-withdraw', 'mw-fee', 'mw-pin-new', 'mw-pin-change'].includes(form.id)) return;
  event.preventDefault();
  const err = `${form.id}-error`;
  $(err).hidden = true;
  const button = form.querySelector('button[type="submit"]');
  try {
    if (form.id === 'mw-withdraw') {
      const amount = amountValue();
      const pin = $('mw-pin').value;
      if (!lastPreview || lastPreview.amount !== amount) return formError(err, 'Subiri ada ihesabiwe kwanza.');
      if (!/^\d{4}$/.test(pin)) return formError(err, 'Weka PIN yako ya wallet (tarakimu 4).');
      button.disabled = true;
      button.textContent = 'Inatuma…';
      const before = w.entries[0]?.id;
      w = await ctx.api.post('/api/driver/wallet/withdraw', { amount, pin });
      const mine = w.entries.find((e) => e.kind === 'WITHDRAWAL' && e.id !== before && Math.abs(e.amount) === amount) ?? w.entries.find((e) => e.kind === 'WITHDRAWAL');
      const reversed = w.entries[0]?.kind === 'WITHDRAWAL_REVERSAL' && w.entries[0]?.id !== before;
      const pending = w.pendingWithdrawal && w.pendingWithdrawal.amount === amount;
      const dest = `${esc(w.account?.networkLabel ?? '')} ${esc(formatPhone(w.account?.phone ?? ''))}`;
      $('mw').innerHTML = reversed
        ? resultHtml('bad', 'Kutoa hakukufanikiwa', `${esc(w.entries[0].note ?? 'Mtandao umekataa.')} Pesa yote (${formatTsh(amount)}) imerudi kwenye wallet yako.`)
        : pending
          ? resultHtml('wait', 'Inatumwa…', `${formatTsh(lastPreview.receive)} inatumwa kwenda ${dest}. Utapata ujumbe ikikamilika.`)
          : resultHtml('ok', 'Pesa imetumwa!', `${formatTsh(lastPreview.receive)} imetumwa kwenda ${dest}.${mine ? '' : ''} Salio jipya: <strong>${formatTsh(w.balance)}</strong>.`);
      ctx.toast(reversed ? 'Kutoa kumeshindwa — pesa imerudi' : pending ? 'Inatumwa' : 'Pesa imetumwa');
      return;
    }
    if (form.id === 'mw-fee') {
      const months = Number(form.querySelector('input[name="mw-months"]:checked')?.value ?? 1);
      const pin = $('mw-fee-pin').value;
      if (!/^\d{4}$/.test(pin)) return formError(err, 'Weka PIN yako ya wallet (tarakimu 4).');
      button.disabled = true;
      w = await ctx.api.post('/api/driver/wallet/subscription', { months, pin });
      $('mw').innerHTML = resultHtml('ok', 'Ada imelipwa!', `${formatTsh(w.monthlyFee * months)} imelipwa kwa salio — siku ${30 * months} zimeongezwa. Salio jipya: <strong>${formatTsh(w.balance)}</strong>.`);
      ctx.toast('Ada imelipwa kwa salio');
      return;
    }
    if (form.id === 'mw-pin-new') {
      const p1 = $('mw-pin1').value;
      if (!/^\d{4}$/.test(p1)) return formError(err, 'PIN iwe tarakimu 4.');
      if (p1 !== $('mw-pin2').value) return formError(err, 'PIN hazifanani. Ziandike tena.');
      if (!$('mw-pw').value) return formError(err, 'Weka password ya akaunti yako.');
      button.disabled = true;
      w = await ctx.api.post('/api/driver/wallet/pin', { pin: p1, password: $('mw-pw').value });
      ctx.toast('PIN ya wallet imewekwa');
      location.hash = '#/akaunti/wallet';
      return;
    }
    if (form.id === 'mw-pin-change') {
      const n1 = $('mw-new1').value;
      if (!/^\d{4}$/.test(n1) || !/^\d{4}$/.test($('mw-old').value)) return formError(err, 'PIN ziwe tarakimu 4.');
      if (n1 !== $('mw-new2').value) return formError(err, 'PIN mpya hazifanani.');
      button.disabled = true;
      w = await ctx.api.post('/api/driver/wallet/pin/change', { oldPin: $('mw-old').value, newPin: n1 });
      ctx.toast('PIN imebadilishwa');
      location.hash = '#/akaunti/wallet';
    }
  } catch (e) {
    button.disabled = false;
    if (form.id === 'mw-withdraw') {
      button.textContent = lastPreview ? `Toa ${formatTsh(lastPreview.amount)}` : 'Toa pesa';
      const pin = $('mw-pin');
      if (pin) pin.value = '';
    }
    fail(e, err);
  }
}
