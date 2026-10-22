// Ofisi: Taarifa kamili za dereva (0.27.0) — vichupo kwenye ukurasa wa dereva:
// Muhtasari · Bonus za ofa · Wallet · Safari · Malipo · Malalamiko · Usajili (nyaraka na uamuzi — ukurasa wa zamani).
// Dereva akidai "sijapata bonus", kichupo cha Bonus kinaonyesha kila safari ya ofa na pesa yake ilikwenda wapi.
import { escapeHtml as esc } from '/shared/api.js';
import { AUDIT_ACTIONS, formatDate, formatPhone, formatTsh, VEHICLE_TYPES } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, onAuthError }
let current = null; // { id, data, tab }

const TABS = [
  ['muhtasari', 'Muhtasari'],
  ['bonus', 'Bonus za ofa'],
  ['wallet', 'Wallet'],
  ['safari', 'Safari'],
  ['malipo', 'Malipo yote'],
  ['malalamiko', 'Malalamiko na historia'],
  ['usajili', 'Usajili na nyaraka'],
];
const STATE_TONE = { PAID: 'ok', PENDING: 'warn', WAITING: 'warn', HELD: 'warn', FAILED: 'bad', REJECTED: 'muted', NONE: 'bad' };
const STATE_SHORT = { PAID: 'Imelipwa', PENDING: 'Inatumwa', WAITING: 'Inakusanywa', HELD: 'Imeshikiliwa', FAILED: 'Imeshindwa', REJECTED: 'Imekataliwa', NONE: 'Haijalipwa' };
const PAY_KIND = {
  SUBSCRIPTION: 'Ada ya mwezi',
  PROMO_PAYOUT: 'Bonus ya ofa',
  WALLET_WITHDRAWAL: 'Kutoa wallet',
  RIDE_FARE: 'Nauli (kama abiria)',
  CUSTOMER_TOPUP: 'Kuweka salio (kama abiria)',
  CUSTOMER_REFUND: 'Kurudishiwa (kama abiria)',
};
const PAY_STATUS = { SUCCESS: ['ok', 'Imefanikiwa'], PENDING: ['warn', 'Inasubiri'], FAILED: ['bad', 'Imeshindwa'] };
const ENTRY = {
  PROMO_EARNING: 'Bonus ya ofa',
  RIDE_EARNING: 'Nauli ya simu',
  WITHDRAWAL: 'Kutoa',
  WITHDRAWAL_REVERSAL: 'Kutoa kumerudishwa',
  SUBSCRIPTION: 'Ada ya mwezi',
  ADJUSTMENT: 'Marekebisho ya ofisi',
};
const HOW = { WALLET: 'Wallet ya NAYA', AUTO: 'Simu (moja kwa moja)', MANUAL: 'Simu (ofisi kwa mkono)' };

const badge = (tone, text) => `<span class="badge badge-${tone}">${esc(text)}</span>`;
const money = (v) => formatTsh(v ?? 0);
const when = (d) => (d ? esc(formatDate(d, true)) : '–');
const tile = (value, label, tone = '') => `<div class="dv-tile ${tone}"><strong>${value}</strong><span>${esc(label)}</span></div>`;
const phone = (p) => (p ? esc(formatPhone(p)) : '–');

export function setup(context) {
  ctx = context;
}

/** Inaitwa baada ya ukurasa wa dereva kuchorwa. */
export async function mount(driverId, driverStatus) {
  const active = ['APPROVED', 'SUSPENDED'].includes(driverStatus);
  const fromHash = new URLSearchParams(location.hash.split('?')[1] ?? '').get('tab');
  const tab = TABS.some(([k]) => k === fromHash) ? fromHash : active ? 'muhtasari' : 'usajili';
  current = { id: driverId, data: null, tab };
  drawTabs();
  show(tab);
  $('dv-full').innerHTML = '<p class="muted dv-loading">Inapakia taarifa kamili…</p>';
  try {
    const data = await ctx.api.get(`/api/admin/drivers/${encodeURIComponent(driverId)}/full`);
    if (current?.id !== driverId) return;
    current.data = data;
    draw();
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    $('dv-full').innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
  }
}

function drawTabs() {
  const nav = $('dv-tabs');
  nav.innerHTML = TABS.map(([k, label]) => `<button type="button" role="tab" data-dv-tab="${k}" aria-selected="${k === current.tab}">${esc(label)}</button>`).join('') +
    '<button type="button" class="dv-print" data-dv-print>Chapisha taarifa</button>';
  nav.onclick = (e) => {
    if (e.target.closest('[data-dv-print]')) return printAll();
    const b = e.target.closest('[data-dv-tab]');
    if (!b) return;
    current.tab = b.dataset.dvTab;
    for (const x of nav.querySelectorAll('[data-dv-tab]')) x.setAttribute('aria-selected', String(x === b));
    const [base, q] = location.hash.split('?');
    const params = new URLSearchParams(q ?? '');
    params.set('tab', current.tab);
    history.replaceState(null, '', `${base}?${params}`);
    show(current.tab);
  };
}

function show(tab) {
  for (const p of document.querySelectorAll('#driver-detail [data-panel]')) p.hidden = p.dataset.panel !== tab;
}

function draw() {
  const d = current.data;
  $('dv-full').innerHTML = `
    <div data-panel="muhtasari">${overview(d)}</div>
    <div data-panel="bonus">${bonus(d)}</div>
    <div data-panel="wallet">${wallet(d)}</div>
    <div data-panel="safari">${trips(d)}</div>
    <div data-panel="malipo">${payments(d)}</div>
    <div data-panel="malalamiko">${complaints(d)}</div>`;
  show(current.tab);
  $('dv-full').onclick = onAction;
}

// ------------------------------------------------------------------ Muhtasari

function overview(d) {
  const p = d.profile;
  const fee = p.paidUntil ? (new Date(p.paidUntil) > new Date() ? `hadi ${formatDate(p.paidUntil)}` : `iliisha ${formatDate(p.paidUntil)}`) : 'haijalipwa';
  const online = p.online ? `Online sasa${p.onlineSince ? ` (tangu ${formatDate(p.onlineSince, true)})` : ''}` : `Offline · alionekana ${p.lastSeenAt ? formatDate(p.lastSeenAt, true) : '–'}`;
  return `
    <section class="dv-tiles">
      ${tile(d.rides.completed ?? 0, 'Safari zilizokamilika')}
      ${tile(money(d.rides.monthFare), 'Nauli za mwezi huu')}
      ${tile(p.rating ? `★ ${p.rating.average}` : '–', p.rating ? `Nyota (${p.rating.count})` : 'Nyota')}
      ${tile(d.offers.acceptRate == null ? '–' : `${d.offers.acceptRate}%`, 'Anakubali maombi')}
      ${tile(money(d.bonus.balance), 'NAYA inadaiwa bonus', d.bonus.balance > 0 ? 'is-warn' : '')}
      ${tile(d.wallet ? money(d.wallet.balance) : '–', 'Salio la wallet')}
    </section>
    <section class="panel dv-explain">
      <div class="panel-head"><h2>Kumweleza dereva (bonus na pesa)</h2><button class="btn btn-ghost btn-small" type="button" data-dv="copy-explain">Nakili</button></div>
      <ul id="dv-explain-list">${d.explanation.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
      <p class="muted small">Maelezo haya yanatokana na kumbukumbu za mfumo tu. Kwa undani, fungua kichupo cha "Bonus za ofa" na "Wallet".</p>
    </section>
    <section class="panel">
      <h2>Hali sasa</h2>
      <dl class="facts">
        <div><dt>Akaunti</dt><dd>${p.accountStatus === 'ACTIVE' ? 'Hai' : `Imesimamishwa${p.accountSuspendedReason ? ` — ${esc(p.accountSuspendedReason)}` : ''}`}</dd></div>
        <div><dt>Kazini</dt><dd>${esc(online)}</dd></div>
        <div><dt>Ada ya mwezi</dt><dd>${esc(fee)}</dd></div>
        <div><dt>App</dt><dd>${p.appClient === 'apk' ? 'App ya Android (APK)' : p.appClient ? 'Kivinjari' : '–'}${p.appSeenAt ? ` · ${when(p.appSeenAt)}` : ''}</dd></div>
        <div><dt>Aliingia mara ya mwisho</dt><dd>${when(p.lastLoginAt)}</dd></div>
        <div><dt>Simu imethibitishwa</dt><dd>${p.phoneVerifiedAt ? 'Ndiyo' : 'Hapana'}</dd></div>
        <div><dt>Dereva tangu</dt><dd>${p.reviewedAt ? esc(formatDate(p.reviewedAt)) : '–'}${p.reviewedBy ? ` · na ${esc(p.reviewedBy)}` : ''}</dd></div>
        <div><dt>Amesajiliwa na</dt><dd>${p.registeredBy ? esc(p.registeredBy) : 'Alijisajili mwenyewe'}</dd></div>
        <div><dt>Chombo</dt><dd>${esc([VEHICLE_TYPES[p.vehicleType], p.plate, p.make, p.color].filter(Boolean).join(' · '))}</dd></div>
        <div><dt>Mtu wa dharura</dt><dd>${p.emergencyPhone ? `${esc(p.emergencyName ?? '')} ${phone(p.emergencyPhone)}` : '–'}</dd></div>
      </dl>
    </section>
    <section class="panel">
      <h2>Namba za kupokea pesa</h2>
      ${
        d.accounts.length
          ? `<ul class="history">${d.accounts
              .map(
                (a) => `<li><span><strong>${esc(a.networkLabel ?? a.network)}</strong> · ${phone(a.phone)}${a.primary ? ' · <strong>kuu</strong>' : ''}</span>
                  <span class="muted">${esc(a.accountName ?? '')}${a.verified ? ' · jina limethibitishwa' : ''}${a.nameChanged ? ' · ⚠ jina limebadilika — malipo yamesimama' : ''}</span></li>`,
              )
              .join('')}</ul>`
          : '<p class="alert alert-warn">Hajaweka namba ya kupokea pesa — bonus haziwezi kutumwa kwa simu.</p>'
      }
    </section>`;
}

// ------------------------------------------------------------------ Bonus

function bonus(d) {
  const b = d.bonus;
  const states = Object.entries(b.byState)
    .map(([k, v]) => `<span class="dv-chip">${badge(STATE_TONE[k] ?? 'muted', STATE_SHORT[k] ?? k)} ${v.count} · ${money(v.amount)}</span>`)
    .join('');
  return `
    <section class="dv-tiles">
      ${tile(b.rides, 'Safari za ofa')}
      ${tile(money(b.earned), 'Bonus yote')}
      ${tile(money(b.paid), 'Imelipwa')}
      ${tile(money(b.balance), 'Bado inadaiwa', b.balance > 0 ? 'is-warn' : '')}
    </section>
    <p class="dv-split">Imelipwa kupitia: <strong>${money(b.paidToWallet)}</strong> wallet · <strong>${money(b.paidAuto)}</strong> simu (moja kwa moja) · <strong>${money(b.paidManual)}</strong> simu (ofisi kwa mkono)</p>
    ${states ? `<div class="dv-chips">${states}</div>` : ''}
    <section class="panel">
      <div class="panel-head"><h2>Kila safari ya ofa</h2><a href="#/malipo/madereva/${esc(d.profile.id)}">Fungua malipo ya ofa ya dereva</a></div>
      ${
        b.trips.length
          ? `<div class="table-wrap"><table class="dv-table">
              <thead><tr><th>Tarehe</th><th>Safari</th><th>Bonus</th><th>Hali</th><th>Pesa ilikwenda wapi</th><th></th></tr></thead>
              <tbody>${b.trips.map(bonusRow).join('')}</tbody></table></div>`
          : '<p class="muted">Hana safari ya ofa iliyokamilika.</p>'
      }
    </section>
    <section class="panel">
      <h2>Malipo ya bonus yaliyotumwa</h2>
      ${
        b.payouts.length
          ? `<div class="table-wrap"><table class="dv-table">
              <thead><tr><th>Tarehe</th><th>Kiasi</th><th>Njia</th><th>Namba</th><th>Kumbukumbu</th><th>Na nani</th></tr></thead>
              <tbody>${b.payouts
                .map(
                  (p) => `<tr class="${p.voidedAt ? 'is-void' : ''}">
                    <td>${when(p.paidAt)}</td><td class="num">${money(p.amount)}</td>
                    <td>${esc(HOW[p.how] ?? p.how)}${p.payStatus && p.payStatus !== 'SUCCESS' ? ` ${badge(PAY_STATUS[p.payStatus]?.[0] ?? 'muted', PAY_STATUS[p.payStatus]?.[1] ?? p.payStatus)}` : ''}</td>
                    <td>${p.how === 'WALLET' ? '—' : `${esc(p.networkLabel ?? '')} ${phone(p.phone)}`}</td>
                    <td class="mono">${esc(p.reference)}${p.providerRef && p.providerRef !== p.reference ? `<br><span class="muted small">${esc(p.providerRef)}</span>` : ''}</td>
                    <td>${esc(p.paidBy)}${p.voidedAt ? `<br><span class="smsc-bad small">Imefutwa: ${esc(p.voidReason ?? '')}</span>` : ''}</td>
                  </tr>`,
                )
                .join('')}</tbody></table></div>`
          : '<p class="muted">Bado hakuna malipo ya bonus.</p>'
      }
    </section>`;
}

function bonusRow(r) {
  const dest = r.destination;
  let where = '<span class="muted">—</span>';
  if (dest?.how === 'WALLET') where = `Wallet ya NAYA · ${when(dest.at)}`;
  else if (dest?.how === 'PHONE') {
    const [tone, label] = PAY_STATUS[dest.status] ?? ['muted', dest.status];
    where = `${esc(dest.networkLabel ?? '')} ${phone(dest.phone)} ${badge(tone, label)}<br><span class="muted small mono">${esc(dest.reference)}${dest.providerRef ? ` · ${esc(dest.providerRef)}` : ''}</span>${
      dest.failure ? `<br><span class="smsc-bad small">${esc(dest.failure)}</span>` : ''
    }`;
  } else if (dest?.how === 'BATCH') where = '<span class="muted">Pamoja na safari nyingine (angalia malipo hapa chini)</span>';
  const actions = ['HELD', 'FAILED'].includes(r.state)
    ? `<button class="btn btn-primary btn-small" type="button" data-dv="approve" data-id="${r.id}">Lipa</button>
       <button class="btn btn-ghost btn-small" type="button" data-dv="reject" data-id="${r.id}">Kataa</button>`
    : '';
  return `<tr>
    <td>${when(r.completedAt)}</td>
    <td><a href="#/safari/${esc(r.id)}">${esc(r.from)} → ${esc(r.to)}</a><br><span class="muted small">${esc(r.promoTitle ?? 'Ofa')} · nauli ${money(r.fare)}</span></td>
    <td class="num">${money(r.amount)}</td>
    <td>${badge(STATE_TONE[r.state] ?? 'muted', STATE_SHORT[r.state] ?? r.state)}${r.note ? `<br><span class="muted small">${esc(r.note)}</span>` : ''}</td>
    <td>${where}</td>
    <td class="dv-actions">${actions}</td>
  </tr>`;
}

// ------------------------------------------------------------------ Wallet

function wallet(d) {
  const w = d.wallet;
  if (!w) return '<p class="muted">Dereva huyu bado hana wallet (hajapokea pesa yoyote kupitia NAYA).</p>';
  const alerts = [
    w.status === 'SUSPENDED' ? `<p class="alert alert-danger">Wallet imesimamishwa${w.suspendedReason ? `: ${esc(w.suspendedReason)}` : ''}. Hawezi kutoa pesa.</p>` : '',
    w.holdUntil && new Date(w.holdUntil) > new Date() ? `<p class="alert alert-warn">Kutoa kumesimamishwa mpaka ${when(w.holdUntil)}${w.holdReason ? ` — ${esc(w.holdReason)}` : ''}.</p>` : '',
    w.pinBlocked ? '<p class="alert alert-warn">PIN ya wallet imefungwa.</p>' : '',
    !w.pinSet ? '<p class="alert alert-warn">Hajaweka PIN ya wallet — hawezi kutoa pesa mpaka aiweke.</p>' : '',
  ].join('');
  return `
    <section class="dv-tiles">
      ${tile(money(w.balance), 'Salio sasa', w.balance > 0 ? 'is-good' : '')}
      ${tile(money(w.promoIn), 'Bonus zilizoingia')}
      ${tile(money(w.ridesIn), 'Nauli za simu zilizoingia')}
      ${tile(money(w.withdrawn), 'Ametoa kwenda simu')}
      ${tile(money(w.withdrawPending), 'Njiani (inasubiri)', w.withdrawPending ? 'is-warn' : '')}
      ${tile(w.withdrawFailed ?? 0, 'Kutoa kulishindwa', w.withdrawFailed ? 'is-warn' : '')}
    </section>
    ${alerts}
    <section class="panel">
      <div class="panel-head"><h2>Kila muamala wa wallet</h2><a href="#/malipo/wallet/${esc(d.profile.id)}">Fungua wallet (vitendo)</a></div>
      ${
        w.entries.length
          ? `<div class="table-wrap"><table class="dv-table">
              <thead><tr><th>Tarehe</th><th>Aina</th><th>Kiasi</th><th>Salio baada</th><th>Maelezo</th></tr></thead>
              <tbody>${w.entries
                .map(
                  (e) => `<tr>
                    <td>${when(e.createdAt)}</td>
                    <td>${esc(ENTRY[e.kind] ?? e.kind)}</td>
                    <td class="num ${e.amount < 0 ? 'neg' : 'pos'}">${e.amount > 0 ? '+' : '−'}${money(Math.abs(e.amount))}</td>
                    <td class="num">${money(e.balanceAfter)}</td>
                    <td>${esc(e.note ?? '')}${e.payPhone ? ` · ${phone(e.payPhone)}` : ''}${
                      e.payStatus ? ` ${badge(PAY_STATUS[e.payStatus]?.[0] ?? 'muted', PAY_STATUS[e.payStatus]?.[1] ?? e.payStatus)}` : ''
                    }${e.reference ? `<br><span class="muted small mono">${esc(e.reference)}${e.providerRef ? ` · ${esc(e.providerRef)}` : ''}</span>` : ''}${
                      e.payFailure ? `<br><span class="smsc-bad small">${esc(e.payFailure)}</span>` : ''
                    }${e.createdBy ? `<br><span class="muted small">na ${esc(e.createdBy)}</span>` : ''}</td>
                  </tr>`,
                )
                .join('')}</tbody></table></div>`
          : '<p class="muted">Bado hakuna muamala kwenye wallet.</p>'
      }
    </section>`;
}

// ------------------------------------------------------------------ Safari

function trips(d) {
  const r = d.rides;
  const o = d.offers;
  return `
    <section class="dv-tiles">
      ${tile(`${r.todayTrips ?? 0} · ${money(r.todayFare)}`, 'Leo')}
      ${tile(`${r.weekTrips ?? 0} · ${money(r.weekFare)}`, 'Wiki hii')}
      ${tile(`${r.monthTrips ?? 0} · ${money(r.monthFare)}`, 'Mwezi huu')}
      ${tile(`${r.completed ?? 0} · ${money(r.fareTotal)}`, 'Tangu aanze')}
    </section>
    <dl class="facts dv-facts">
      <div><dt>Maombi aliyopewa</dt><dd>${o.total ?? 0}</dd></div>
      <div><dt>Alikubali</dt><dd>${o.accepted ?? 0}${o.acceptRate != null ? ` (${o.acceptRate}%)` : ''}</dd></div>
      <div><dt>Alikataa</dt><dd>${o.declined ?? 0}</dd></div>
      <div><dt>Hakujibu</dt><dd>${o.missed ?? 0}</dd></div>
      <div><dt>Aliyoghairi baada ya kukubali</dt><dd>${o.driverCancels ?? 0}</dd></div>
      <div><dt>Abiria walilipa kwa simu / salio</dt><dd>${r.paidMobile ?? 0} / ${r.paidWallet ?? 0}</dd></div>
      <div><dt>Abiria hawakulipa (deni)</dt><dd>${r.unpaid ?? 0}</dd></div>
      <div><dt>Safari ya mwisho</dt><dd>${when(r.lastTripAt)}</dd></div>
    </dl>
    <section class="panel">
      <h2>Safari 40 za karibuni</h2>
      ${
        d.recentRides.length
          ? `<div class="table-wrap"><table class="dv-table">
              <thead><tr><th>Tarehe</th><th>Safari</th><th>Abiria</th><th>Nauli</th><th>Hali</th></tr></thead>
              <tbody>${d.recentRides
                .map(
                  (x) => `<tr>
                    <td>${when(x.completedAt ?? x.requestedAt)}</td>
                    <td><a href="#/safari/${esc(x.id)}">${esc(x.from)} → ${esc(x.to)}</a>${x.comment ? `<br><span class="muted small">“${esc(x.comment)}”</span>` : ''}</td>
                    <td>${esc(x.riderName ?? x.passenger)}${x.riderName ? `<br><span class="muted small">ameagizwa na ${esc(x.passenger)}</span>` : ''}</td>
                    <td class="num">${money(x.fare)}${x.promo ? `<br><span class="muted small">bonus ${money(x.promo)}</span>` : ''}</td>
                    <td>${esc(x.status === 'COMPLETED' ? 'Imekamilika' : x.status === 'CANCELLED' ? 'Imeghairiwa' : x.status)}${x.rating ? ` · ${'★'.repeat(x.rating)}` : ''}${
                      x.settlement === 'DEBT' ? ` ${badge('bad', 'Deni')}` : x.settlement === 'MOBILE' ? ` ${badge('ok', 'Simu')}` : x.settlement === 'WALLET' ? ` ${badge('ok', 'Salio')}` : ''
                    }</td>
                  </tr>`,
                )
                .join('')}</tbody></table></div>`
          : '<p class="muted">Bado hana safari.</p>'
      }
    </section>
    ${
      d.debts.length
        ? `<section class="panel"><h2>Abiria waliomdai (hawakulipa)</h2><ul class="history">${d.debts
            .map(
              (x) => `<li><span><strong>${money(x.amount)}</strong> · ${esc(x.passenger)} ${phone(x.phone)}</span><span class="muted">${when(x.completedAt)}${
                x.clearedAt ? ` · imelipwa ${when(x.clearedAt)}` : ' · bado'
              }</span></li>`,
            )
            .join('')}</ul></section>`
        : ''
    }`;
}

// ------------------------------------------------------------------ Malipo yote

function payments(d) {
  return `
    <section class="panel">
      <h2>Miamala yote ya simu</h2>
      ${
        d.payments.length
          ? `<div class="table-wrap"><table class="dv-table">
              <thead><tr><th>Tarehe</th><th>Aina</th><th>Kiasi</th><th>Namba</th><th>Kumbukumbu</th><th>Hali</th></tr></thead>
              <tbody>${d.payments
                .map((p) => {
                  const [tone, label] = PAY_STATUS[p.status] ?? ['muted', p.status];
                  return `<tr>
                    <td>${when(p.createdAt)}</td>
                    <td>${esc(PAY_KIND[p.kind] ?? p.kind)} <span class="muted small">${p.direction === 'IN' ? '(ameingiza)' : '(NAYA imetuma)'}</span></td>
                    <td class="num">${money(p.amount)}</td>
                    <td>${phone(p.phone)}</td>
                    <td class="mono">${esc(p.reference)}${p.providerRef ? `<br><span class="muted small">${esc(p.providerRef)}</span>` : ''}</td>
                    <td>${badge(tone, label)}${p.failure ? `<br><span class="smsc-bad small">${esc(p.failure)}</span>` : ''}${p.createdBy ? `<br><span class="muted small">na ${esc(p.createdBy)}</span>` : ''}</td>
                  </tr>`;
                })
                .join('')}</tbody></table></div>`
          : '<p class="muted">Hakuna muamala wa simu.</p>'
      }
    </section>
    <section class="panel">
      <h2>Ada ya mwezi</h2>
      ${
        d.subscriptions.length
          ? `<ul class="history">${d.subscriptions
              .map(
                (s) => `<li class="${s.voidedAt ? 'is-void' : ''}"><span><strong>${money(s.amount)}</strong> · miezi ${s.months} · ${esc(s.method)}${s.reference ? ` · ${esc(s.reference)}` : ''}</span>
                  <span class="muted">${s.from ? `${esc(formatDate(s.from))} → ${esc(formatDate(s.to))}` : ''} · ${esc(s.recordedBy)} · ${when(s.createdAt)}${s.voidedAt ? ' · IMEFUTWA' : ''}</span></li>`,
              )
              .join('')}</ul>`
          : '<p class="muted">Bado hajalipa ada (au yuko kwenye kipindi cha bure).</p>'
      }
    </section>`;
}

// ------------------------------------------------------------------ Malalamiko + historia

function complaints(d) {
  const rated = d.recentRides.filter((x) => x.rating && x.rating <= 3);
  return `
    <section class="panel">
      <h2>Maombi ya msaada</h2>
      ${
        d.tickets.length
          ? `<ul class="history">${d.tickets
              .map(
                (t) => `<li><span><a href="#/msaada/${esc(t.id)}"><strong>${esc(t.subject)}</strong></a> · ${t.mine ? 'kutoka kwake' : `kutoka kwa abiria ${esc(t.from)}`}</span>
                  <span class="muted">${esc(t.status === 'RESOLVED' ? 'Imetatuliwa' : t.status === 'ANSWERED' ? 'Imejibiwa' : 'Wazi')} · ${when(t.createdAt)}</span></li>`,
              )
              .join('')}</ul>`
          : '<p class="muted">Hakuna ombi la msaada linalomhusu.</p>'
      }
    </section>
    ${
      rated.length
        ? `<section class="panel"><h2>Nyota za chini (3 au chache) — karibuni</h2><ul class="history">${rated
            .map((x) => `<li><span>${'★'.repeat(x.rating)} · ${esc(x.passenger)}${x.comment ? ` — “${esc(x.comment)}”` : ''}</span><span class="muted">${when(x.completedAt)}</span></li>`)
            .join('')}</ul></section>`
        : ''
    }
    ${
      d.sos.length
        ? `<section class="panel"><h2>Dharura kwenye safari zake</h2><ul class="history">${d.sos
            .map(
              (s) => `<li><span><a href="#/safari/${esc(s.rideId)}">${esc(s.role === 'DRIVER' ? 'Yeye mwenyewe' : 'Abiria')}</a> · ${esc(s.status === 'OPEN' ? 'Wazi' : 'Imeshughulikiwa')}</span>
                <span class="muted">${when(s.createdAt)}</span>${s.note ? `<span class="note">${esc(s.note)}</span>` : ''}</li>`,
            )
            .join('')}</ul></section>`
        : ''
    }
    <section class="panel">
      <h2>Kila hatua ya ofisi kwake</h2>
      ${
        d.history.length
          ? `<ul class="history">${d.history
              .map(
                (h) => `<li><span><strong>${esc(AUDIT_ACTIONS[h.action] ?? h.action)}</strong>${h.actor ? ` — na ${esc(h.actor)}` : ''}</span><span class="muted">${when(h.createdAt)}</span>${
                  h.details?.reason || h.details?.note ? `<span class="note">${esc(h.details.reason ?? h.details.note)}</span>` : ''
                }${h.details?.amount ? `<span class="note">${money(h.details.amount)}</span>` : ''}</li>`,
              )
              .join('')}</ul>`
          : '<p class="muted">Hakuna hatua iliyorekodiwa.</p>'
      }
    </section>`;
}

// ------------------------------------------------------------------ vitendo

async function onAction(e) {
  const b = e.target.closest('[data-dv]');
  if (!b) return;
  const act = b.dataset.dv;
  if (act === 'copy-explain') {
    const text = current.data.explanation.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      b.textContent = 'Imenakiliwa';
    } catch {
      b.textContent = 'Imeshindwa — chagua maandishi';
    }
    setTimeout(() => (b.textContent = 'Nakili'), 2000);
    return;
  }
  if (act === 'approve' || act === 'reject') {
    let body = {};
    if (act === 'approve' && !confirm('Lipa bonus ya safari hii sasa?')) return;
    if (act === 'reject') {
      const reason = prompt('Kwa nini bonus hii inakataliwa? (dereva ataona)');
      if (!reason || reason.trim().length < 3) return;
      body = { reason: reason.trim() };
    }
    b.disabled = true;
    try {
      await ctx.api.post(`/api/admin/payments/rides/${b.dataset.id}/${act}`, body);
      await mount(current.id, 'APPROVED');
    } catch (err) {
      if (ctx.onAuthError(err)) return;
      alert(err.message);
      b.disabled = false;
    }
  }
}

function printAll() {
  if (!current?.data) return;
  document.body.classList.add('dv-printing');
  for (const p of document.querySelectorAll('#driver-detail [data-panel]')) p.hidden = false;
  const done = () => {
    document.body.classList.remove('dv-printing');
    show(current.tab);
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
