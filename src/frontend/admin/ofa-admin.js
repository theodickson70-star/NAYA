// Ofisi: Ofa za wateja (kuunda, kuwasha, kusimamisha, takwimu) na Malipo ya ofa kwa madereva (deni, namba, kuandika malipo).
//   #/ofa                    orodha ya ofa
//   #/ofa/mpya               kuunda ofa
//   #/ofa/<id>               ofa moja: kanuni, takwimu, safari zake, kubadilisha
//   #/ofa/malipo             madereva wanaodaiwa na NAYA
//   #/ofa/malipo/<driverId>  dereva mmoja: deni, namba za kutuma pesa, kuandika malipo, historia
import { escapeHtml as esc } from '/shared/api.js';
import { flagBadges, formatDate, formatPhone, formatTsh } from '/shared/labels.js';

let ctx = null;
let host = null;
let payState = { owed: true, q: '' };
let searchTimer = null;

const n = (v) => Number(v ?? 0).toLocaleString('en-US');
const STATUS = { ACTIVE: ['Inaendelea', 'ok'], PAUSED: ['Imesimamishwa', 'warn'], ENDED: ['Imeisha', 'muted'] };
const PERIOD = { DAY: 'kwa siku', WEEK: 'kwa wiki', TOTAL: 'kipindi chote cha ofa' };
const RIDE = { SEARCHING: 'Inatafuta', ACCEPTED: 'Dereva anakuja', ARRIVED: 'Amefika', IN_PROGRESS: 'Safarini', COMPLETED: 'Imekamilika', CANCELLED: 'Imeghairiwa', NO_DRIVER: 'Hakuna dereva' };
function toast(message) {
  let el = document.getElementById('ofa-toast');
  if (!el) {
    el = document.createElement('p');
    el.id = 'ofa-toast';
    el.className = 'ofa-toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.hidden = false;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.hidden = true), 3500);
}
const showNumber = (network, phone) => (network === 'BANK' ? phone : formatPhone(phone));

export function setup(context) {
  ctx = context;
  host = document.getElementById('page-offers');
  host.addEventListener('click', onClick);
  host.addEventListener('submit', onSubmit);
  host.addEventListener('input', onInput);
}

let view = 0; // kila ukurasa mpya: kazi za zamani (utafutaji uliochelewa n.k.) hazichori juu yake
const current = (v) => v === view && !document.getElementById('page-offers').hidden;

export function open(parts) {
  view += 1;
  clearTimeout(searchTimer);
  const [, a, b] = parts;
  host.innerHTML = '<p class="muted rp-loading">Inapakia…</p>';
  if (a === 'malipo' && b) return loadPayoutDriver(b);
  if (a === 'malipo') return loadPayouts();
  if (a === 'mpya') return renderForm(null);
  if (a) return loadOffer(a);
  return loadList();
}

const tabs = (current) => `<h1>Ofa za wateja</h1>
  <nav class="rp-tabs" aria-label="Ofa">
    <a href="#/ofa"${current === 'list' ? ' aria-current="page"' : ''}>Ofa</a>
    <a href="#/ofa/malipo"${current === 'pay' ? ' aria-current="page"' : ''}>Malipo kwa madereva</a>
  </nav>`;

const fail = (err) => {
  if (ctx.onAuthError(err)) return;
  host.insertAdjacentHTML('afterbegin', `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`);
};

// ------------------------------------------------------------------ kanuni kwa maneno rahisi

function rulesText(p) {
  const parts = [p.audience === 'NEW_CUSTOMERS' ? 'Wateja wapya (hawajawahi kusafiri)' : 'Wateja wote', `punguzo ${p.discountPercent}%`];
  if (p.maxDiscount) parts.push(`hadi ${formatTsh(p.maxDiscount)} kwa safari`);
  if (p.minFare || p.maxFare) parts.push(`nauli ${p.minFare ? `kuanzia ${formatTsh(p.minFare)}` : ''}${p.minFare && p.maxFare ? ' ' : ''}${p.maxFare ? `hadi ${formatTsh(p.maxFare)}` : ''}`);
  if (p.vehicleTypes?.length === 1) parts.push(p.vehicleTypes[0] === 'BAJAJI' ? 'bajaji tu' : 'bodaboda tu');
  if (p.perCustomerLimit) parts.push(`safari ${p.perCustomerLimit} kwa kila mteja`);
  if (p.perDriverLimit) parts.push(`kila dereva safari ${p.perDriverLimit} za ofa ${PERIOD[p.perDriverPeriod]}`);
  if (p.budget) parts.push(`bajeti ${formatTsh(p.budget)}`);
  return parts.join(' · ');
}

function example(p) {
  const fares = [2000, 3000, 5000];
  const calc = (fare) => {
    if (p.minFare && fare < p.minFare) return 0;
    if (p.maxFare && fare > p.maxFare) return 0;
    let d = Math.floor((fare * (p.discountPercent || 0)) / 100);
    if (p.maxDiscount) d = Math.min(d, p.maxDiscount);
    return Math.floor(d / 50) * 50;
  };
  return fares
    .map((f) => {
      const d = calc(f);
      return `<li><span>Safari ya ${formatTsh(f)}</span><span>${d ? `mteja analipa <strong>${formatTsh(f - d)}</strong> · NAYA inamlipa dereva <strong>${formatTsh(d)}</strong>` : '<span class="muted">haipati ofa</span>'}</span></li>`;
    })
    .join('');
}

function stateBadge(p) {
  if (p.status === 'ACTIVE' && p.scheduled) return '<span class="badge badge-warn">Imepangwa</span>';
  if (p.status === 'ACTIVE' && !p.live) return '<span class="badge badge-muted">Muda umeisha</span>';
  const [label, tone] = STATUS[p.status] ?? [p.status, 'muted'];
  return `<span class="badge badge-${tone}">${label}</span>`;
}

const budgetBar = (p) => {
  if (!p.budget) return '';
  const used = p.stats.cost + p.stats.reserved;
  const pct = Math.min(100, Math.round((used / p.budget) * 100));
  return `<div class="ofa-budget"><div class="ofa-budget-bar"><i style="width:${pct}%"></i></div>
    <span>${formatTsh(used)} kati ya ${formatTsh(p.budget)} (${pct}%) · imebaki ${formatTsh(p.stats.budgetLeft)}</span></div>`;
};

const actions = (p) =>
  p.status === 'ENDED'
    ? ''
    : `<div class="ofa-actions">
        ${p.status === 'ACTIVE'
          ? `<button class="btn btn-ghost btn-small" type="button" data-ofa-status="PAUSED" data-id="${esc(p.id)}">Simamisha</button>`
          : `<button class="btn btn-primary btn-small" type="button" data-ofa-status="ACTIVE" data-id="${esc(p.id)}">Washa ofa</button>`}
        <a class="btn btn-ghost btn-small" href="#/ofa/${esc(p.id)}?hariri=1">Badilisha</a>
        <button class="btn btn-danger btn-small" type="button" data-ofa-status="ENDED" data-id="${esc(p.id)}">Maliza ofa</button>
      </div>`;

// ------------------------------------------------------------------ orodha

async function loadList() {
  const v = view;
  try {
    const { promotions, totals } = await ctx.api.get('/api/admin/promotions');
    if (!current(v)) return;
    const live = promotions.filter((p) => p.live).length;
    host.innerHTML = `${tabs('list')}
      <p class="rp-lead">Ofa zinapunguza nauli ya mteja; NAYA inamlipa dereva sehemu iliyopunguzwa. Safari moja inapata ofa moja tu — yenye punguzo kubwa zaidi kwa mteja.</p>
      <section class="rp-stats">
        <div class="rp-stat rp-stat-hero"><span>Ofa zinazoendelea</span><strong>${n(live)}</strong><small>Kati ya ${n(promotions.length)}</small></div>
        <div class="rp-stat"><span>Safari za ofa</span><strong>${n(totals.rides)}</strong><small>Zilizokamilika</small></div>
        <div class="rp-stat"><span>Gharama ya NAYA</span><strong>${formatTsh(totals.cost)}</strong><small>Punguzo lote</small></div>
        <div class="rp-stat"><span>Imeshalipwa madereva</span><strong>${formatTsh(totals.paid)}</strong></div>
        <a class="rp-stat rp-stat-link${totals.owed > 0 ? ' rp-stat-bad' : ''}" href="#/ofa/malipo"><span>Deni kwa madereva</span><strong>${formatTsh(totals.owed)}</strong><small>Fungua malipo</small></a>
      </section>
      <div class="rp-toolbar"><span></span><a class="btn btn-primary" href="#/ofa/mpya">Unda ofa mpya</a></div>
      <div class="ofa-list">${promotions.length ? promotions.map(card).join('') : '<p class="empty">Bado hakuna ofa. Bonyeza "Unda ofa mpya".</p>'}</div>`;
  } catch (err) {
    host.innerHTML = tabs('list');
    fail(err);
  }
}

function card(p) {
  return `<article class="ofa-card${p.live ? ' is-live' : ''}">
    <header>
      <div><h2><a href="#/ofa/${esc(p.id)}">${esc(p.name)}</a></h2><p class="muted">Mteja anaona: “${esc(p.title)}”</p></div>
      ${stateBadge(p)}
    </header>
    <p class="ofa-rules">${esc(rulesText(p))}</p>
    <dl class="ofa-stats">
      <div><dt>Safari</dt><dd>${n(p.stats.completed)}${p.stats.active ? ` <small>+${n(p.stats.active)} zinaendelea</small>` : ''}</dd></div>
      <div><dt>Wiki hii</dt><dd>${n(p.stats.thisWeek)}</dd></div>
      <div><dt>Wateja</dt><dd>${n(p.stats.customers)}</dd></div>
      <div><dt>Madereva</dt><dd>${n(p.stats.drivers)}</dd></div>
      <div><dt>Gharama ya NAYA</dt><dd>${formatTsh(p.stats.cost)}</dd></div>
      <div><dt>Wateja walilipa</dt><dd>${formatTsh(p.stats.customersPaid)}</dd></div>
    </dl>
    ${budgetBar(p)}
    <p class="muted small">Kuanzia ${esc(formatDate(p.startsAt, true))}${p.endsAt ? ` hadi ${esc(formatDate(p.endsAt, true))}` : ' · haina tarehe ya mwisho'}</p>
    ${actions(p)}
  </article>`;
}

// ------------------------------------------------------------------ ofa moja

async function loadOffer(id) {
  const v = view;
  try {
    const p = await ctx.api.get(`/api/admin/promotions/${id}`);
    if (!current(v)) return;
    if (new URLSearchParams(location.hash.split('?')[1] ?? '').get('hariri') === '1' && p.status !== 'ENDED') return renderForm(p);
    host.innerHTML = `${tabs('list')}<a class="back-link" href="#/ofa">Rudi kwa ofa</a>
      ${card(p)}
      <section class="panel">
        <div class="panel-head"><h2>Mfano wa bei</h2></div>
        <ul class="ofa-example">${example(p)}</ul>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Safari za ofa hii</h2><span class="muted">${n(p.rides.length)} za karibuni</span></div>
        ${p.rides.length
          ? `<div class="rp-scroll"><table class="rp-table"><thead><tr><th>Muda</th><th>Mteja</th><th>Dereva</th><th>Safari</th><th>Hali</th><th class="num">Nauli</th><th class="num">Mteja alilipa</th><th class="num">NAYA inalipa</th></tr></thead><tbody>${p.rides
              .map(
                (r) => `<tr>
                  <td class="rp-nowrap"><a href="#/safari/${esc(r.id)}">${esc(formatDate(r.requestedAt, true))}</a></td>
                  <td><strong>${esc(r.passengerName)}</strong><span class="rp-sub">${esc(formatPhone(r.passengerPhone))}</span></td>
                  <td>${r.driverName ? `<strong>${esc(r.driverName)}</strong><span class="rp-sub">${esc(r.driverPlate ?? '')}</span>` : '–'}</td>
                  <td>${esc(r.from)} → ${esc(r.to)}</td>
                  <td><span class="badge badge-${r.status === 'COMPLETED' ? 'ok' : ['CANCELLED', 'NO_DRIVER'].includes(r.status) ? 'muted' : 'warn'}">${esc(RIDE[r.status] ?? r.status)}</span></td>
                  <td class="num">${formatTsh(r.fare)}</td><td class="num">${formatTsh(r.passengerPays)}</td><td class="num"><strong>${formatTsh(r.discount)}</strong></td>
                </tr>`,
              )
              .join('')}</tbody></table></div>`
          : '<p class="empty">Bado hakuna safari iliyotumia ofa hii.</p>'}
      </section>`;
  } catch (err) {
    host.innerHTML = tabs('list');
    fail(err);
  }
}

// ------------------------------------------------------------------ fomu ya kuunda / kubadilisha

const localInput = (v) => {
  if (!v) return '';
  const d = new Date(v);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function renderForm(p) {
  const v = p ?? { audience: 'ALL', discountPercent: 50, perDriverPeriod: 'WEEK', priority: 0, vehicleTypes: null };
  const has = (t) => !v.vehicleTypes || v.vehicleTypes.includes(t);
  host.innerHTML = `${tabs('list')}<a class="back-link" href="${p ? `#/ofa/${esc(p.id)}` : '#/ofa'}">Rudi</a>
    <h2 class="ofa-form-title">${p ? 'Badilisha ofa' : 'Unda ofa mpya'}</h2>
    <form class="decision ofa-form" id="ofa-form" data-id="${esc(p?.id ?? '')}" novalidate>
      <div class="ofa-form-grid">
        <div class="ofa-form-main">
          <fieldset class="audience ofa-audience">
            <legend>Ofa ni kwa nani?</legend>
            <label><input type="radio" name="of-audience" value="ALL"${v.audience === 'ALL' ? ' checked' : ''}>Wateja wote<span>Kila mteja anayeagiza</span></label>
            <label><input type="radio" name="of-audience" value="NEW_CUSTOMERS"${v.audience === 'NEW_CUSTOMERS' ? ' checked' : ''}>Wateja wapya<span>Hawajawahi kusafiri na NAYA</span></label>
          </fieldset>
          <label for="of-name">Jina la ofa <span class="muted">(ofisini tu)</span></label>
          <input id="of-name" maxlength="80" value="${esc(v.name ?? '')}" placeholder="Mf. Nusu bei kwa wateja wote — Oktoba">
          <label for="of-title">Kichwa anachoona mteja</label>
          <input id="of-title" maxlength="80" value="${esc(v.title ?? '')}" placeholder="Mf. Nusu bei!">
          <label for="of-desc">Maelezo kwa mteja</label>
          <textarea id="of-desc" maxlength="300" rows="2" placeholder="Mf. Lipa nusu ya nauli — NAYA inamlipa dereva kilichobaki.">${esc(v.description ?? '')}</textarea>

          <h3>Punguzo</h3>
          <div class="ofa-fields">
            <div><label for="of-pct">Asilimia (%)</label><input id="of-pct" type="number" min="1" max="100" value="${esc(v.discountPercent ?? '')}"></div>
            <div><label for="of-max">Punguzo la juu kwa safari (TSh)</label><input id="of-max" type="number" min="1" value="${esc(v.maxDiscount ?? '')}" placeholder="Hakuna kikomo"></div>
            <div><label for="of-minfare">Nauli ya chini (TSh)</label><input id="of-minfare" type="number" min="0" value="${esc(v.minFare ?? '')}" placeholder="Yoyote"></div>
            <div><label for="of-maxfare">Nauli ya juu (TSh)</label><input id="of-maxfare" type="number" min="1" value="${esc(v.maxFare ?? '')}" placeholder="Yoyote"></div>
          </div>
          <fieldset class="ofa-vehicles"><legend>Vyombo</legend>
            <label class="check"><input type="checkbox" id="of-boda"${has('BODABODA') ? ' checked' : ''}> Bodaboda</label>
            <label class="check"><input type="checkbox" id="of-bajaji"${has('BAJAJI') ? ' checked' : ''}> Bajaji</label>
          </fieldset>

          <h3>Vikomo</h3>
          <div class="ofa-fields">
            <div><label for="of-cust">Safari za ofa kwa kila mteja</label><input id="of-cust" type="number" min="1" value="${esc(v.perCustomerLimit ?? '')}" placeholder="Bila kikomo"></div>
            <div><label for="of-drv">Safari za ofa kwa kila dereva</label><input id="of-drv" type="number" min="1" value="${esc(v.perDriverLimit ?? '')}" placeholder="Bila kikomo"></div>
            <div><label for="of-period">Kikomo cha dereva ni</label><select id="of-period">
              ${Object.entries(PERIOD).map(([k, l]) => `<option value="${k}"${v.perDriverPeriod === k ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
            <div><label for="of-budget">Bajeti yote ya NAYA (TSh)</label><input id="of-budget" type="number" min="1" value="${esc(v.budget ?? '')}" placeholder="Bila kikomo"></div>
          </div>

          <h3>Muda</h3>
          <div class="ofa-fields">
            <div><label for="of-start">Inaanza</label><input id="of-start" type="datetime-local" value="${esc(localInput(v.startsAt))}"></div>
            <div><label for="of-end">Inaisha</label><input id="of-end" type="datetime-local" value="${esc(localInput(v.endsAt))}"></div>
            <div><label for="of-prio">Kipaumbele <span class="muted">(ofa zikilingana)</span></label><input id="of-prio" type="number" min="-100" max="100" value="${esc(v.priority ?? 0)}"></div>
          </div>
        </div>
        <aside class="ofa-preview" aria-live="polite">
          <h3>Itakavyofanya kazi</h3>
          <p id="of-rules" class="ofa-rules"></p>
          <ul class="ofa-example" id="of-example"></ul>
          <p class="muted small">Ofa mpya inaanza ikiwa imesimamishwa. Ukimaliza kuikagua, bonyeza <strong>Washa ofa</strong>.</p>
        </aside>
      </div>
      <p class="alert alert-danger" id="of-error" role="alert" hidden></p>
      <div class="actions"><button class="btn btn-primary" type="submit">${p ? 'Hifadhi mabadiliko' : 'Unda ofa'}</button><a class="btn btn-ghost" href="${p ? `#/ofa/${esc(p.id)}` : '#/ofa'}">Acha</a></div>
    </form>`;
  updatePreview();
}

const num = (id) => {
  const raw = document.getElementById(id)?.value.trim();
  return raw === '' || raw === undefined ? null : Number(raw);
};
function formValue() {
  const boda = document.getElementById('of-boda').checked;
  const bajaji = document.getElementById('of-bajaji').checked;
  const start = document.getElementById('of-start').value;
  const end = document.getElementById('of-end').value;
  return {
    name: document.getElementById('of-name').value,
    title: document.getElementById('of-title').value,
    description: document.getElementById('of-desc').value,
    audience: host.querySelector('input[name="of-audience"]:checked')?.value ?? 'ALL',
    discountPercent: num('of-pct'),
    maxDiscount: num('of-max'),
    minFare: num('of-minfare'),
    maxFare: num('of-maxfare'),
    vehicleTypes: boda && bajaji ? null : [boda ? 'BODABODA' : null, bajaji ? 'BAJAJI' : null].filter(Boolean),
    perCustomerLimit: num('of-cust'),
    perDriverLimit: num('of-drv'),
    perDriverPeriod: document.getElementById('of-period').value,
    budget: num('of-budget'),
    priority: num('of-prio') ?? 0,
    startsAt: start ? new Date(start).toISOString() : null,
    endsAt: end ? new Date(end).toISOString() : null,
  };
}

function updatePreview() {
  if (!document.getElementById('of-rules')) return;
  const v = formValue();
  document.getElementById('of-rules').textContent = rulesText(v);
  document.getElementById('of-example').innerHTML = example(v);
}

// ------------------------------------------------------------------ malipo kwa madereva

async function loadPayouts() {
  const v = view;
  try {
    const qs = new URLSearchParams();
    if (payState.owed) qs.set('owed', '1');
    if (payState.q) qs.set('q', payState.q);
    const r = await ctx.api.get(`/api/admin/promo-payouts?${qs}`);
    if (!current(v)) return;
    const s = r.summary;
    const typing = document.activeElement?.id === 'pay-q';
    host.innerHTML = `${tabs('pay')}
      <p class="rp-lead">Kila dereva aliyebeba wateja wa ofa: NAYA inadaiwa kiasi gani, na pesa itumwe kwenye namba ipi. Tuma pesa kwanza, kisha andika malipo hapa pamoja na namba ya muamala.</p>
      <section class="rp-stats">
        <div class="rp-stat rp-stat-hero"><span>Salio la kulipa</span><strong>${formatTsh(s.balance)}</strong><small>Madereva ${n(s.owedDrivers)}</small></div>
        <div class="rp-stat"><span>NAYA inadaiwa (jumla)</span><strong>${formatTsh(s.earned)}</strong></div>
        <div class="rp-stat"><span>Imeshalipwa</span><strong>${formatTsh(s.paid)}</strong></div>
        <div class="rp-stat${s.noNumber ? ' rp-stat-bad' : ''}"><span>Hawajaweka namba</span><strong>${n(s.noNumber)}</strong><small>Wanadai lakini hawana namba</small></div>
      </section>
      <div class="filters rp-chips" role="group" aria-label="Kichujio">
        <button type="button" class="chip" data-pay-owed="1" aria-pressed="${payState.owed}">Wanaodai</button>
        <button type="button" class="chip" data-pay-owed="0" aria-pressed="${!payState.owed}">Wote</button>
      </div>
      <div class="rp-toolbar">
        <input type="search" id="pay-q" class="search" placeholder="Tafuta jina, simu au plate" value="${esc(payState.q)}" aria-label="Tafuta">
        <button class="btn btn-ghost btn-small" type="button" data-pay-csv>Pakua Excel (CSV)</button>
      </div>
      ${r.rows.length
        ? `<div class="rp-scroll"><table class="rp-table"><thead><tr><th>Dereva</th><th class="num">Safari za ofa</th><th class="num">NAYA inadaiwa</th><th class="num">Imelipwa</th><th class="num">Salio</th><th>Tuma kwenye namba</th><th>Malipo ya mwisho</th><th></th></tr></thead><tbody>${r.rows
            .map(
              (d) => `<tr>
                <td><a class="rp-person" href="#/ofa/malipo/${esc(d.id)}"><strong>${esc(d.name)}</strong><span>${esc(formatPhone(d.phone))} · ${esc(d.plate ?? '')}</span></a></td>
                <td class="num"><strong>${n(d.rides)}</strong><span class="rp-sub">Wiki hii ${n(d.weekRides)}</span></td>
                <td class="num">${formatTsh(d.earned)}</td>
                <td class="num">${formatTsh(d.paid)}</td>
                <td class="num"><strong class="${d.balance > 0 ? 'ofa-owed' : ''}">${formatTsh(d.balance)}</strong></td>
                <td>${d.network ? `<strong>${esc(d.networkLabel)}</strong><span class="rp-sub">${esc(showNumber(d.network, d.payPhone))} · ${esc(d.payName)}</span>` : '<span class="badge badge-bad">Hajaweka namba</span>'}</td>
                <td class="rp-nowrap">${d.lastPaidAt ? esc(formatDate(d.lastPaidAt)) : '–'}</td>
                <td>${d.balance > 0 ? `<a class="btn btn-primary btn-small" href="#/ofa/malipo/${esc(d.id)}">Lipa</a>` : `<a class="btn btn-ghost btn-small" href="#/ofa/malipo/${esc(d.id)}">Angalia</a>`}</td>
              </tr>`,
            )
            .join('')}</tbody></table></div>`
        : `<div class="rp-scroll"><p class="empty">${payState.owed ? 'Hakuna dereva anayedai NAYA kwa sasa.' : 'Bado hakuna dereva aliyebeba mteja wa ofa.'}</p></div>`}`;
    if (typing) {
      const input = document.getElementById('pay-q');
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  } catch (err) {
    host.innerHTML = tabs('pay');
    fail(err);
  }
}

async function loadPayoutDriver(driverId) {
  const v = view;
  try {
    const d = await ctx.api.get(`/api/admin/promo-payouts/${driverId}`);
    if (!current(v)) return;
    const primary = d.accounts.find((a) => a.primary) ?? d.accounts[0];
    const form =
      d.balance > 0
        ? d.accounts.length
          ? `<form class="decision" id="payout-form" data-driver="${esc(driverId)}" novalidate>
              <h2>Andika malipo uliyotuma</h2>
              <p class="muted">Tuma pesa kwanza kwa simu ya ofisi, kisha andika hapa. Dereva atapata arifa na SMS.</p>
              <fieldset class="audience pay-accounts"><legend>Namba uliyotumia</legend>
                ${d.accounts
                  .map(
                    (a) => `<label><input type="radio" name="pay-account" value="${esc(a.id)}"${a.id === primary.id ? ' checked' : ''}>${esc(a.networkLabel)}${a.primary ? ' · kuu' : ''}
                      <span>${esc(showNumber(a.network, a.phone))} · ${esc(a.accountName)}</span></label>`,
                  )
                  .join('')}
              </fieldset>
              <div class="ofa-fields">
                <div><label for="pay-amount">Kiasi (TSh)</label><input id="pay-amount" type="number" min="1" max="${d.balance}" value="${d.balance}"></div>
                <div><label for="pay-ref">Namba ya muamala</label><input id="pay-ref" maxlength="60" placeholder="Mf. QJK2A7B9XY"></div>
              </div>
              <label for="pay-note">Maelezo <span class="muted">(si lazima)</span></label>
              <input id="pay-note" maxlength="300">
              <p class="alert alert-danger" id="pay-error" role="alert" hidden></p>
              <div class="actions"><button class="btn btn-primary" type="submit">Hifadhi malipo</button></div>
            </form>`
          : `<p class="alert alert-warn" role="status">Dereva huyu bado hajaweka namba ya kupokea pesa. Mwambie afungue NAYA → Akaunti → <strong>Malipo ya ofa</strong> → Weka namba.</p>`
        : '';
    host.innerHTML = `${tabs('pay')}<a class="back-link" href="#/ofa/malipo">Rudi kwa malipo</a>
      <div class="page-head"><div><h2 class="ofa-form-title">${esc(d.driver.name)}</h2><p class="muted">${esc(formatPhone(d.driver.phone))} · ${esc(d.driver.plate ?? '')}</p></div>
        <a class="btn btn-ghost btn-small" href="#/madereva/${esc(driverId)}">Fungua dereva</a></div>
      <section class="rp-stats">
        <div class="rp-stat rp-stat-hero"><span>Salio la kulipa</span><strong>${formatTsh(d.balance)}</strong></div>
        <div class="rp-stat"><span>Safari za ofa</span><strong>${n(d.rides)}</strong></div>
        <div class="rp-stat"><span>NAYA inadaiwa</span><strong>${formatTsh(d.earned)}</strong></div>
        <div class="rp-stat"><span>Imeshalipwa</span><strong>${formatTsh(d.paid)}</strong></div>
      </section>
      <section class="panel"><h2>Namba za kutuma pesa</h2>
        ${d.accounts.length
          ? `<ul class="pay-acc-list">${d.accounts.map((a) => `<li><strong>${esc(a.networkLabel)}</strong>${a.primary ? ' <span class="badge badge-ok">Kuu</span>' : ''}<span>${esc(showNumber(a.network, a.phone))} · ${esc(a.accountName)}</span></li>`).join('')}</ul>`
          : '<p class="muted">Hajaweka namba bado.</p>'}
      </section>
      ${form}
      <section class="panel"><h2>Malipo yaliyotumwa</h2>
        ${d.payouts.length
          ? `<div class="rp-scroll"><table class="rp-table"><thead><tr><th>Tarehe</th><th class="num">Kiasi</th><th>Namba</th><th>Muamala</th><th>Aliyeandika</th><th></th></tr></thead><tbody>${d.payouts
              .map(
                (p) => `<tr class="${p.voidedAt ? 'is-void' : ''}">
                  <td class="rp-nowrap">${esc(formatDate(p.paidAt, true))}</td>
                  <td class="num"><strong>${formatTsh(p.amount)}</strong></td>
                  <td>${esc(p.network)} ${esc(showNumber(p.network, p.phone))}<span class="rp-sub">${esc(p.accountName ?? '')}</span></td>
                  <td>${esc(p.reference)}${p.note ? `<span class="rp-sub">${esc(p.note)}</span>` : ''}</td>
                  <td>${esc(p.paidBy)}</td>
                  <td>${p.voidedAt ? `<span class="badge badge-muted" title="${esc(p.voidReason ?? '')}">Imefutwa</span>` : `<button class="link-btn link-danger" type="button" data-void="${esc(p.id)}" data-driver="${esc(driverId)}">Futa (nimekosea)</button>`}</td>
                </tr>`,
              )
              .join('')}</tbody></table></div>`
          : '<p class="empty">Bado hajatumiwa malipo.</p>'}
      </section>
      <section class="panel"><h2>Safari za ofa alizobeba</h2>
        ${d.trips.length
          ? `<div class="rp-scroll"><table class="rp-table"><thead><tr><th>Ilikamilika</th><th>Safari</th><th>Ofa</th><th class="num">Nauli</th><th class="num">Mteja alilipa</th><th class="num">NAYA inalipa</th></tr></thead><tbody>${d.trips
              .map(
                (t) => `<tr><td class="rp-nowrap"><a href="#/safari/${esc(t.id)}">${esc(formatDate(t.completedAt, true))}</a></td><td>${esc(t.from)} → ${esc(t.to)}${(t.flags ?? []).length ? `<span class="rp-sub">Ya kutiliwa shaka: ${flagBadges(t.flags, esc)}</span>` : ''}</td>
                  <td>${esc(t.promoTitle ?? '')}</td><td class="num">${formatTsh(t.fare)}</td><td class="num">${formatTsh(t.passengerPaid)}</td><td class="num"><strong>${formatTsh(t.nayaPays)}</strong></td></tr>`,
              )
              .join('')}</tbody></table></div>`
          : '<p class="empty">Hakuna.</p>'}
      </section>`;
  } catch (err) {
    host.innerHTML = tabs('pay');
    fail(err);
  }
}

// ------------------------------------------------------------------ matukio

async function onClick(event) {
  const status = event.target.closest('[data-ofa-status]');
  if (status) {
    const to = status.dataset.ofaStatus;
    const ask = { ACTIVE: 'Washa ofa hii sasa? Wateja wataanza kuiona mara moja.', PAUSED: 'Simamisha ofa hii? Safari zilizokwisha agizwa zinabaki na bei yake.', ENDED: 'Maliza ofa hii kabisa? Haitaweza kuwashwa tena.' }[to];
    if (!confirm(ask)) return;
    status.disabled = true;
    try {
      await ctx.api.post(`/api/admin/promotions/${status.dataset.id}/status`, { status: to });
      toast({ ACTIVE: 'Ofa imewashwa', PAUSED: 'Ofa imesimamishwa', ENDED: 'Ofa imemalizwa' }[to]);
      return open(location.hash.replace(/^#/, '').split('?')[0].split('/').filter(Boolean));
    } catch (err) {
      status.disabled = false;
      return fail(err);
    }
  }
  const owed = event.target.closest('[data-pay-owed]');
  if (owed) {
    payState.owed = owed.dataset.payOwed === '1';
    return loadPayouts();
  }
  if (event.target.closest('[data-pay-csv]')) {
    const qs = new URLSearchParams();
    if (payState.owed) qs.set('owed', '1');
    if (payState.q) qs.set('q', payState.q);
    try {
      const blob = await ctx.api.blob(`/api/admin/promo-payouts.csv?${qs}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `naya-malipo-ya-ofa-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      fail(err);
    }
    return;
  }
  const voidBtn = event.target.closest('[data-void]');
  if (voidBtn) {
    const reason = prompt('Kwa nini unafuta malipo haya? (mf. nimekosea kiasi)');
    if (!reason || reason.trim().length < 3) return;
    try {
      await ctx.api.post(`/api/admin/promo-payouts/void/${voidBtn.dataset.void}`, { reason: reason.trim() });
      loadPayoutDriver(voidBtn.dataset.driver);
    } catch (err) {
      fail(err);
    }
  }
}

function onInput(event) {
  if (event.target.closest('#ofa-form')) return updatePreview();
  if (event.target.id === 'pay-q') {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      payState.q = event.target.value.trim();
      loadPayouts();
    }, 350);
  }
}

async function onSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  if (form.id === 'ofa-form') {
    document.getElementById('of-error').hidden = true;
    button.disabled = true;
    try {
      const body = formValue();
      const saved = form.dataset.id ? await ctx.api.put(`/api/admin/promotions/${form.dataset.id}`, body) : await ctx.api.post('/api/admin/promotions', body);
      toast(form.dataset.id ? 'Mabadiliko yamehifadhiwa' : 'Ofa imeundwa — iwashe ukiwa tayari');
      location.hash = `#/ofa/${saved.id}`;
    } catch (err) {
      if (ctx.onAuthError(err)) return;
      const box = document.getElementById('of-error');
      box.textContent = err.message;
      box.hidden = false;
      button.disabled = false;
    }
  }
  if (form.id === 'payout-form') {
    const box = document.getElementById('pay-error');
    box.hidden = true;
    const amount = Number(document.getElementById('pay-amount').value);
    const account = host.querySelector('input[name="pay-account"]:checked');
    const label = account?.closest('label')?.textContent.trim().replace(/\s+/g, ' ') ?? '';
    if (!confirm(`Thibitisha: umeshatuma ${formatTsh(amount)} kwa ${label}?`)) return;
    button.disabled = true;
    try {
      await ctx.api.post(`/api/admin/promo-payouts/${form.dataset.driver}`, {
        amount,
        accountId: account?.value,
        reference: document.getElementById('pay-ref').value,
        note: document.getElementById('pay-note').value,
      });
      toast('Malipo yamehifadhiwa — dereva amejulishwa');
      loadPayoutDriver(form.dataset.driver);
    } catch (err) {
      if (ctx.onAuthError(err)) return;
      box.textContent = err.message;
      box.hidden = false;
      button.disabled = false;
    }
  }
}
