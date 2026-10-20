// Ofisi → Fedha → Malipo → Wallet za madereva (0.21.0)
//   #/malipo/wallet          muhtasari: deni la wallet zote dhidi ya salio la Abliner, maombi ya PIN, mipangilio, orodha
//   #/malipo/wallet/<id>     wallet moja: salio, PIN, kusimamisha, marekebisho, historia kamili (ledger)
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh } from '/shared/labels.js';
import { toast } from './ui.js';

let ctx = null; // { api, onAuthError, tabs(name) }
let host = null;
let q = '';
let searchTimer = null;
let view = 0;
const n = (v) => Number(v ?? 0).toLocaleString('en-US');
const KIND = {
  PROMO_EARNING: ['in', 'Malipo ya ofa'],
  RIDE_EARNING: ['in', 'Safari (kwa simu)'],
  WITHDRAWAL: ['out', 'Kutoa pesa'],
  WITHDRAWAL_REVERSAL: ['in', 'Kutoa kumeshindwa — imerudi'],
  SUBSCRIPTION: ['out', 'Ada ya mwezi'],
  ADJUSTMENT: ['adj', 'Marekebisho ya ofisi'],
};
const PAY = { PENDING: ['warn', 'Inasubiri'], SUCCESS: ['ok', 'Imetumwa'], FAILED: ['bad', 'Imeshindwa'] };

export function setup(context, hostEl) {
  ctx = context;
  host = hostEl;
  host.addEventListener('click', onClick);
  host.addEventListener('submit', onSubmit);
  host.addEventListener('input', onInput);
}

const active = () => host.querySelector('[data-wallets]');
const fail = (err, boxId) => {
  if (ctx.onAuthError(err)) return;
  const box = boxId && document.getElementById(boxId);
  if (box) {
    box.textContent = err.message;
    box.hidden = false;
  } else host.insertAdjacentHTML('afterbegin', `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`);
};

export function open(id) {
  view += 1;
  clearTimeout(searchTimer);
  host.innerHTML = `${ctx.tabs()}<p class="muted rp-loading">Inapakia…</p>`;
  return id ? loadOne(id) : loadList();
}

// ------------------------------------------------------------------ orodha

async function loadList() {
  const v = view;
  try {
    const [s, rows] = await Promise.all([ctx.api.get('/api/admin/wallets/summary'), ctx.api.get(`/api/admin/wallets${q ? `?q=${encodeURIComponent(q)}` : ''}`)]);
    if (v !== view) return;
    const typing = document.activeElement?.id === 'wl-q';
    const st = s.settings;
    host.innerHTML = `${ctx.tabs()}<div data-wallets>
      <p class="rp-lead">Kila dereva ana wallet yake: malipo ya ofa yanaingia hapa, naye anatoa kwenda namba yake ya malipo iliyothibitishwa kwa PIN yake mwenyewe (ofisi haiioni). Pesa halisi iko kwenye akaunti ya NAYA kwa Abliner.</p>
      ${s.short ? `<p class="alert alert-danger" role="alert"><strong>Salio la Abliner (${formatTsh(s.ablinerBalance)}) halitoshi kulipa wallet zote za madereva (${formatTsh(s.owed)})${s.customerOwed ? ` na salio za abiria (${formatTsh(s.customerOwed)})` : ''}.</strong> Jaza salio la Abliner ili madereva wasikwame wakitoa pesa.</p>` : ''}
      ${s.stuck ? `<p class="alert alert-danger" role="alert"><strong>Kutoa ${n(s.stuck)} kumekwama zaidi ya dakika 30.</strong> Fungua wallet ya dereva, kagua muamala kwenye dashibodi ya Abliner, kisha thibitisha kama pesa ilifika au la.</p>` : ''}
      ${s.lateSuccess ? `<p class="alert alert-danger" role="alert"><strong>Kutoa ${n(s.lateSuccess)} kumefika BAADA ya pesa kurudishwa kwenye wallet</strong> — dereva amepata mara mbili. Kagua na ufanye marekebisho.</p>` : ''}
      <section class="rp-stats">
        <div class="rp-stat rp-stat-hero"><span>Deni la wallet zote</span><strong>${formatTsh(s.owed)}</strong><small>Madereva ${n(s.withBalance)} wana salio${s.customerOwed ? ` · + abiria ${formatTsh(s.customerOwed)}` : ''}</small></div>
        <div class="rp-stat${s.short ? ' rp-stat-bad' : ''}"><span>Salio la Abliner</span><strong>${s.ablinerBalance === null ? '–' : formatTsh(s.ablinerBalance)}</strong><small>${
          s.ablinerBalance === null ? 'Halisomeki sasa' : s.short ? 'Halitoshi deni' : 'Linatosha deni la wallet'
        }</small></div>
        <div class="rp-stat${s.pinResets ? ' rp-stat-bad' : ''}"><span>Maombi ya PIN mpya</span><strong>${n(s.pinResets)}</strong><small>Thibitisha ni yeye kabla ya kuruhusu</small></div>
        <div class="rp-stat"><span>Wanatoa sasa</span><strong>${n(s.pendingWithdrawals)}</strong><small>${formatTsh(s.pendingAmount)} zinasubiri uthibitisho</small></div>
      </section>
      <form class="settings-card wl-settings" id="wl-settings" novalidate>
        <h3>Mipangilio ya wallet</h3>
        <label class="check"><input type="checkbox" id="wl-to-wallet"${st.promoToWallet ? ' checked' : ''}> Malipo ya ofa yaingie kwenye wallet ya dereva <span class="muted small">(ukiondoa alama: yanatumwa moja kwa moja kwenye namba yake kama zamani)</span></label>
        <div class="settings-grid">
          <div><label for="wl-min">Kiwango cha chini cha kutoa (TSh)</label><input id="wl-min" inputmode="numeric" value="${esc(st.minWithdraw)}"></div>
          <div><label for="wl-day">Kikomo cha kutoa kwa siku (TSh)</label><input id="wl-day" inputmode="numeric" value="${esc(st.dailyWithdrawLimit)}"></div>
        </div>
        <p class="small muted">Ada ya mtandao ya kutuma (2–4%) inabebwa na dereva na inaonyeshwa kwake kabla ya kuthibitisha.</p>
        <p class="alert alert-danger" id="wl-settings-error" role="alert" hidden></p>
        <div class="actions"><button class="btn btn-primary btn-small" type="submit">Hifadhi mipangilio</button></div>
      </form>
      <div class="rp-toolbar"><input type="search" id="wl-q" class="search" placeholder="Tafuta jina, simu au plate" value="${esc(q)}" aria-label="Tafuta"></div>
      ${
        rows.length
          ? `<div class="rp-scroll"><table class="rp-table"><thead><tr><th>Dereva</th><th class="num">Salio</th><th>PIN</th><th>Hali</th><th>Mara ya mwisho</th><th></th></tr></thead><tbody>${rows
              .map(
                (w) => `<tr>
                  <td><a class="rp-person" href="#/malipo/wallet/${esc(w.id)}"><strong>${esc(w.name)}</strong><span>${esc(formatPhone(w.phone))} · ${esc(w.plate ?? '')}</span></a></td>
                  <td class="num"><strong>${formatTsh(w.balance)}</strong></td>
                  <td>${
                    w.pinResetRequested
                      ? '<span class="badge badge-bad">Ameomba PIN mpya</span>'
                      : w.pinBlocked
                        ? '<span class="badge badge-bad">Imefungwa</span>'
                        : w.pinSet
                          ? '<span class="badge badge-ok">Imewekwa</span>'
                          : '<span class="badge badge-muted">Bado</span>'
                  }</td>
                  <td>${w.status === 'SUSPENDED' ? '<span class="badge badge-bad">Imesimamishwa</span>' : w.onHold ? '<span class="badge badge-warn">Saa 24 za usalama</span>' : '<span class="badge badge-ok">Hai</span>'}</td>
                  <td class="rp-nowrap">${w.lastActivity ? esc(formatDate(w.lastActivity, true)) : '–'}</td>
                  <td><a class="btn btn-${w.pinResetRequested ? 'primary' : 'ghost'} btn-small" href="#/malipo/wallet/${esc(w.id)}">${w.pinResetRequested ? 'Shughulikia' : 'Fungua'}</a></td>
                </tr>`,
              )
              .join('')}</tbody></table></div>`
          : `<div class="rp-scroll"><p class="empty">${q ? 'Hakuna wallet inayolingana na utafutaji.' : 'Bado hakuna dereva aliyethibitishwa.'}</p></div>`
      }</div>`;
    if (typing) {
      const input = document.getElementById('wl-q');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  } catch (err) {
    if (v === view) fail(err);
  }
}

// ------------------------------------------------------------------ wallet moja

async function loadOne(id) {
  const v = view;
  try {
    const w = await ctx.api.get(`/api/admin/wallets/${id}`);
    if (v === view) renderOne(w);
  } catch (err) {
    if (v === view) fail(err);
  }
}

function renderOne(w) {
  const pin = w.pin;
  const pinState = pin.resetRequestedAt
    ? `<span class="badge badge-bad">Ameomba PIN mpya · ${esc(formatDate(pin.resetRequestedAt, true))}</span>`
    : pin.resetAllowedAt
      ? '<span class="badge badge-warn">Ameruhusiwa PIN mpya — bado hajaiweka</span>'
      : pin.blocked
        ? '<span class="badge badge-bad">Imefungwa (makosa mengi)</span>'
        : pin.lockedUntil
          ? `<span class="badge badge-warn">Imefungwa mpaka ${esc(formatDate(pin.lockedUntil, true))}</span>`
          : pin.set
            ? `<span class="badge badge-ok">Imewekwa</span>${pin.failed ? ` <span class="small muted">makosa ${n(pin.failed)}</span>` : ''}`
            : '<span class="badge badge-muted">Bado hajaweka</span>';
  host.innerHTML = `${ctx.tabs()}<div data-wallets data-id="${esc(w.id)}">
    <a class="back-link" href="#/malipo/wallet">Rudi kwa wallet</a>
    <section class="wl-head">
      <div><h2>${esc(w.name)}</h2><p class="muted">${esc(formatPhone(w.phone))} · ${esc(w.plate ?? '')} · <a href="#/madereva/${esc(w.id)}">Wasifu wa dereva</a></p></div>
      <div class="wl-head-bal"><span>Salio</span><strong>${formatTsh(w.balance)}</strong></div>
    </section>
    <section class="rp-stats wl-facts">
      <div class="rp-stat"><span>Hali</span><strong class="wl-small">${w.status === 'SUSPENDED' ? 'Imesimamishwa' : 'Hai'}</strong><small>${esc(w.suspendedReason ?? (w.holdUntil ? `Kutoa kunasubiri mpaka ${formatDate(w.holdUntil, true)} (${w.holdReason ?? ''})` : 'Anaweza kutoa'))}</small></div>
      <div class="rp-stat"><span>PIN</span><strong class="wl-small">${pinState}</strong></div>
      <div class="rp-stat"><span>Namba ya kupokea</span><strong class="wl-small">${w.account ? esc(w.account.networkLabel) : '–'}</strong><small>${w.account ? `${esc(formatPhone(w.account.phone))} · ${esc(w.account.name)}${w.account.verified ? ' ✓' : ' (haijathibitishwa)'}` : 'Hajaweka namba'}</small></div>
    </section>
    <div class="wl-actions">
      ${pin.resetRequestedAt ? '<button class="btn btn-primary btn-small" type="button" data-wa="allow-pin-reset">Ruhusu PIN mpya</button>' : ''}
      ${pin.blocked || pin.lockedUntil ? '<button class="btn btn-ghost btn-small" type="button" data-wa="unlock-pin">Fungua PIN</button>' : ''}
      ${w.status === 'SUSPENDED' ? '<button class="btn btn-ghost btn-small" type="button" data-wa="activate">Fungua wallet</button>' : '<button class="btn btn-ghost btn-small btn-danger-text" type="button" data-wa="suspend">Simamisha wallet</button>'}
    </div>
    ${pin.resetRequestedAt ? '<p class="small muted">Kabla ya kuruhusu: mpigie dereva kwenye namba yake ya NAYA na uthibitishe ni yeye. Ataweka PIN mpya mwenyewe kwa password yake, na kutoa kutasubiri saa 24.</p>' : ''}
    <p class="alert alert-danger" id="wl-one-error" role="alert" hidden></p>
    <form class="settings-card wl-adjust" id="wl-adjust" novalidate>
      <h3>Marekebisho ya salio</h3>
      <p class="small muted">Kwa makosa tu (mf. malipo yaliyolipwa kwa mkono). Kila marekebisho yanaonekana kwa dereva na kwenye historia hii, pamoja na jina lako.</p>
      <div class="settings-grid">
        <div><label for="wl-adj-amount">Kiasi (TSh) — mf. 2000 au −2000</label><input id="wl-adj-amount" inputmode="numeric" placeholder="2000"></div>
        <div><label for="wl-adj-reason">Sababu</label><input id="wl-adj-reason" maxlength="250" placeholder="Mf. ofa ya safari ya tarehe …"></div>
      </div>
      <p class="alert alert-danger" id="wl-adjust-error" role="alert" hidden></p>
      <div class="actions"><button class="btn btn-ghost btn-small" type="submit">Weka marekebisho</button></div>
    </form>
    <h3>Historia (ledger)</h3>
    ${
      w.entries.length
        ? `<div class="rp-scroll"><table class="rp-table"><thead><tr><th>Muda</th><th>Aina</th><th>Maelezo</th><th class="num">Kiasi</th><th class="num">Salio baada</th><th>Muamala</th></tr></thead><tbody>${w.entries
            .map((e) => {
              const k = KIND[e.kind] ?? ['adj', e.kind];
              const p = e.paymentStatus ? PAY[e.paymentStatus] : null;
              return `<tr>
                <td class="rp-nowrap">${esc(formatDate(e.createdAt, true))}</td>
                <td><span class="wl-kind is-${k[0]}">${esc(k[1])}</span></td>
                <td>${esc(e.note ?? '')}${e.createdBy ? `<span class="rp-sub">na ${esc(e.createdBy)}</span>` : ''}${e.rideId ? `<span class="rp-sub"><a href="#/safari/${esc(e.rideId)}">Safari</a></span>` : ''}</td>
                <td class="num"><strong class="${e.amount > 0 ? 'wl-in' : 'wl-out'}">${e.amount > 0 ? '+' : '−'}${formatTsh(Math.abs(e.amount))}</strong></td>
                <td class="num">${formatTsh(e.balanceAfter)}</td>
                <td>${e.lateSuccess ? '<span class="badge badge-bad">Imefika baadaye — kagua</span>' : e.stuck ? '<span class="badge badge-bad">Imekwama</span>' : p ? `<span class="badge badge-${p[0]}">${p[1]}</span>` : ''}${e.providerRef ? `<span class="rp-sub">${esc(e.providerRef)}</span>` : e.reference ? `<span class="rp-sub">${esc(e.reference)}</span>` : ''}${
                  e.stuck && e.kind === 'WITHDRAWAL'
                    ? `<span class="wl-resolve"><button class="link-btn" type="button" data-resolve="SUCCESS" data-pid="${esc(e.paymentId)}">Pesa ilifika</button><button class="link-btn link-danger" type="button" data-resolve="FAILED" data-pid="${esc(e.paymentId)}">Haikufika — rudisha</button></span>`
                    : e.lateSuccess && e.kind === 'WITHDRAWAL'
                      ? `<span class="wl-resolve"><button class="link-btn" type="button" data-late="${esc(e.paymentId)}">Nimekagua na kurekebisha</button></span>`
                      : ''
                }</td>
              </tr>`;
            })
            .join('')}</tbody></table></div>`
        : '<div class="rp-scroll"><p class="empty">Bado hakuna miamala kwenye wallet hii.</p></div>'
    }</div>`;
}

// ------------------------------------------------------------------ matukio

function onInput(event) {
  if (event.target.id !== 'wl-q' || !active()) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    q = event.target.value.trim();
    view += 1;
    loadList();
  }, 300);
}

async function onClick(event) {
  const root = active();
  const r = event.target.closest('[data-resolve], [data-late]');
  if (r && root) return onResolve(r, root);
  const b = event.target.closest('[data-wa]');
  if (!b || !root) return;
  const id = root.dataset.id;
  const action = b.dataset.wa;
  let body = {};
  if (action === 'suspend') {
    const reason = prompt('Kwa nini unasimamisha wallet hii? (dereva ataona sababu)');
    if (!reason || reason.trim().length < 3) return;
    body = { reason: reason.trim() };
  }
  if (action === 'allow-pin-reset' && !confirm('Umethibitisha (kwa simu au ana kwa ana) kwamba ni dereva mwenyewe aliyeomba PIN mpya?')) return;
  if (action === 'unlock-pin' && !confirm('Fungua PIN ya dereva huyu? PIN yake inabaki ileile.')) return;
  b.disabled = true;
  try {
    renderOne(await ctx.api.post(`/api/admin/wallets/${id}/${action}`, body));
    toast({ suspend: 'Wallet imesimamishwa', activate: 'Wallet imefunguliwa', 'unlock-pin': 'PIN imefunguliwa', 'allow-pin-reset': 'Dereva ameruhusiwa PIN mpya' }[action]);
  } catch (err) {
    b.disabled = false;
    fail(err, 'wl-one-error');
  }
}

async function onResolve(b, root) {
  let url;
  let body = {};
  if (b.dataset.late) {
    if (!confirm('Umeshafanya marekebisho (mf. kupunguza kiasi kilichorudishwa) au umeamua kuacha? Alama hii itaondoka.')) return;
    url = `/api/admin/wallets/withdrawals/${b.dataset.late}/late-reviewed`;
  } else {
    const okay = b.dataset.resolve === 'SUCCESS';
    const note = prompt(
      okay
        ? 'Umeona kwenye dashibodi ya Abliner kwamba pesa IMEFIKA? Andika kumbukumbu ya muamala au ulichoona:'
        : 'Umeona kwenye dashibodi ya Abliner kwamba pesa HAIKUTOKA? Kiasi chote kitarudi kwenye wallet ya dereva. Andika ulichoona:',
    );
    if (!note || note.trim().length < 5) return;
    url = `/api/admin/wallets/withdrawals/${b.dataset.pid}/resolve`;
    body = { outcome: b.dataset.resolve, note: note.trim() };
  }
  b.disabled = true;
  try {
    renderOne(await ctx.api.post(url, body));
    toast('Imehifadhiwa');
  } catch (err) {
    b.disabled = false;
    fail(err, 'wl-one-error');
  }
  return root;
}

async function onSubmit(event) {
  const form = event.target;
  if (!active() || !['wl-settings', 'wl-adjust'].includes(form.id)) return;
  event.preventDefault();
  const err = `${form.id}-error`;
  document.getElementById(err).hidden = true;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  const num = (id) => Number(String(document.getElementById(id).value).replace(/[^\d-]/g, ''));
  try {
    if (form.id === 'wl-settings') {
      await ctx.api.put('/api/admin/settings/driver-wallet', {
        promoToWallet: document.getElementById('wl-to-wallet').checked,
        minWithdraw: num('wl-min'),
        dailyWithdrawLimit: num('wl-day'),
      });
      toast('Mipangilio ya wallet imehifadhiwa');
      button.disabled = false;
      return;
    }
    const amount = num('wl-adj-amount');
    const reason = document.getElementById('wl-adj-reason').value.trim();
    if (!amount) throw new Error('Weka kiasi (si 0).');
    if (!confirm(`${amount > 0 ? 'Ongeza' : 'Punguza'} ${formatTsh(Math.abs(amount))} kwenye wallet ya dereva huyu?`)) {
      button.disabled = false;
      return;
    }
    renderOne(await ctx.api.post(`/api/admin/wallets/${active().dataset.id}/adjust`, { amount, reason }));
    toast('Marekebisho yamewekwa');
  } catch (e) {
    button.disabled = false;
    fail(e, err);
  }
}
