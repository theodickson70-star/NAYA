// Ofisi: ripoti kamili zilizotengana — Madereva, Wateja, APK na link, Maombi ya safari, Online sasa.
// Kila ripoti: namba za muhtasari, vichujio, kutafuta, orodha nzima (safu 100 kwa mara, "Onyesha zaidi"), na CSV ya Excel.
import { escapeHtml as esc } from '/shared/api.js';
import { COMPLETED_BY, flagBadges, formatDate, formatPhone, formatTsh, VEHICLE_TYPES } from '/shared/labels.js';
import { barChart, shortDay } from './charts.js';

let ctx = null;
let host = null;
let tab = '';
let timer = null;
let searchTimer = null;
let seq = 0;

const state = {
  madereva: { status: 'APPROVED', q: '', client: '' },
  wateja: { filter: 'ALL', q: '', client: '' },
  app: { group: 'wateja', client: 'apk', q: '' },
  maombi: { days: 30, filter: 'ALL', q: '' },
  online: { readiness: 'ALL' },
};
let list = { rows: [], total: 0, page: 1 };

const n = (v) => Number(v ?? 0).toLocaleString('en-US');
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const when = (v) => (v ? formatDate(v, true) : '–');
const day = (v) => (v ? formatDate(v) : '–');
function ago(v) {
  if (!v) return 'Hajaonekana';
  const s = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 1000));
  if (s < 60) return 'Sasa hivi';
  if (s < 3600) return `Dak ${Math.round(s / 60)} zilizopita`;
  if (s < 86400) return `Saa ${Math.round(s / 3600)} zilizopita`;
  return `Siku ${Math.round(s / 86400)} zilizopita`;
}
const secs = (v) => (v === null || v === undefined ? '–' : v < 60 ? `Sek ${v}` : `Dak ${Math.floor(v / 60)} sek ${v % 60}`);
const clientBadge = (c) =>
  c === 'apk'
    ? '<span class="badge badge-ok">APK</span>'
    : c === 'web'
      ? '<span class="badge badge-warn">Link</span>'
      : '<span class="badge badge-muted" title="Hajafungua app tangu ripoti hii ianze">Haijulikani</span>';
const person = (name, phone, id, base = 'wateja') =>
  `<a class="rp-person" href="#/${base}/${esc(id)}"><strong>${esc(name)}</strong><span>${esc(formatPhone(phone))}</span></a>`;

const DRIVER_STATUS = { APPROVED: 'Amethibitishwa', PENDING: 'Anasubiri', SUSPENDED: 'Amesimamishwa', REJECTED: 'Amekataliwa', INCOMPLETE: 'Hajakamilisha' };
const RIDE_STATUS = {
  SEARCHING: ['Inatafuta dereva', 'warn'], ACCEPTED: ['Dereva anakuja', 'ok'], ARRIVED: ['Dereva amefika', 'ok'], IN_PROGRESS: ['Safarini', 'ok'],
  COMPLETED: ['Imefanikiwa', 'ok'], CANCELLED: ['Imeghairiwa', 'muted'], NO_DRIVER: ['Haikupata dereva', 'bad'],
};
const OFFER = {
  ACCEPTED: ['Alikubali', 'ok'], DECLINED: ['Alikataa', 'bad'], EXPIRED: ['Hakujibu', 'warn'], TAKEN: ['Mwingine amewahi', 'muted'],
  CANCELLED: ['Limeghairiwa', 'muted'], PENDING: ['Linasubiri', 'warn'],
};
const READY = {
  READY: ['Tayari kupokea ombi', 'ok'], OFFER: ['Ana ombi sasa', 'warn'], ON_RIDE: ['Yuko safarini', 'muted'],
  NOT_SEEN: ['Hajaonekana (simu imezima?)', 'bad'], NO_GPS: ['Hana GPS', 'bad'], FEE: ['Ada imeisha', 'bad'],
};
const CANCELLED_BY = { PASSENGER: 'abiria', DRIVER: 'dereva', ADMIN: 'ofisi', SYSTEM: 'mfumo' };
const badge = ([label, tone]) => `<span class="badge badge-${tone}">${esc(label)}</span>`;

export function setup(context) {
  ctx = context;
  host = document.getElementById('rp-view');
  host.addEventListener('click', onClick);
  host.addEventListener('input', (event) => {
    if (event.target.id !== 'rp-q') return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state[tab].q = event.target.value.trim();
      reload();
    }, 350);
  });
}

export function stop() {
  clearInterval(timer);
  timer = null;
}

export function show(name) {
  stop();
  clearTimeout(searchTimer);
  tab = name;
  host.innerHTML = '<p class="muted rp-loading">Inapakia ripoti…</p>';
  reload();
  if (tab === 'online') timer = setInterval(() => document.visibilityState === 'visible' && reload({ quiet: true }), 15_000);
}

// ------------------------------------------------------------------ kupakia

function query(extra = {}) {
  const s = state[tab];
  const p = new URLSearchParams();
  if (tab === 'madereva') Object.entries({ status: s.status, q: s.q, client: s.client }).forEach(([k, v]) => v && p.set(k, v));
  if (tab === 'wateja') Object.entries({ filter: s.filter, q: s.q, client: s.client }).forEach(([k, v]) => v && p.set(k, v));
  if (tab === 'maombi') Object.entries({ days: s.days, filter: s.filter, q: s.q }).forEach(([k, v]) => v && p.set(k, String(v)));
  if (tab === 'app') {
    p.set('client', s.client);
    if (s.q) p.set('q', s.q);
    if (s.group === 'madereva') p.set('status', 'APPROVED');
  }
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
}
const listUrl = (csv = false) => {
  const base = tab === 'app' ? state.app.group : tab;
  return `/api/admin/ripoti/${base}${csv ? '.csv' : ''}`;
};

async function reload(opts) {
  const typing = document.activeElement?.id === 'rp-q' ? document.activeElement.selectionStart : null;
  await load(opts);
  if (typing !== null) {
    const input = host.querySelector('#rp-q');
    if (input) {
      input.focus();
      input.setSelectionRange(typing, typing);
    }
  }
}

async function load({ quiet = false } = {}) {
  const mine = ++seq;
  try {
    if (tab === 'online') {
      const data = await ctx.api.get('/api/admin/ripoti/online');
      if (mine === seq) renderOnline(data, quiet);
      return;
    }
    if (tab === 'app') {
      const [summary, rows] = await Promise.all([ctx.api.get('/api/admin/ripoti/app'), ctx.api.get(`${listUrl()}?${query()}`)]);
      if (mine !== seq) return;
      list = { rows: rows.rows, total: rows.total, page: 1 };
      return renderApp(summary, rows);
    }
    const data = await ctx.api.get(`${listUrl()}?${query()}`);
    if (mine !== seq) return;
    list = { rows: data.rows, total: data.total, page: 1 };
    ({ madereva: renderDrivers, wateja: renderPassengers, maombi: renderRequests })[tab](data);
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    if (!quiet) host.innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
  }
}

async function more(button) {
  button.disabled = true;
  button.textContent = 'Inapakia…';
  try {
    const data = await ctx.api.get(`${listUrl()}?${query({ page: list.page + 1 })}`);
    list.page += 1;
    list.rows = list.rows.concat(data.rows);
    const body = host.querySelector('#rp-body');
    body.insertAdjacentHTML('beforeend', data.rows.map(rowRenderer()).join(''));
    host.querySelector('#rp-foot').outerHTML = footHtml();
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    button.disabled = false;
    button.textContent = 'Jaribu tena';
  }
}

async function downloadCsv(button) {
  button.disabled = true;
  try {
    const qs = query();
    const blob = await ctx.api.blob(`${listUrl(true)}${qs ? `?${qs}` : ''}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `naya-${tab === 'app' ? `${state.app.group}-${state.app.client}` : tab}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err) {
    if (!ctx.onAuthError(err)) alert(err.message);
  } finally {
    button.disabled = false;
  }
}

function onClick(event) {
  const chip = event.target.closest('[data-set]');
  if (chip) {
    const [key, value] = chip.dataset.set.split('=');
    state[tab][key] = key === 'days' ? Number(value) : value;
    if (tab === 'online') return reload({ quiet: true });
    host.querySelector('#rp-table')?.classList.add('is-loading');
    return reload();
  }
  if (event.target.closest('[data-more]')) return more(event.target.closest('[data-more]'));
  if (event.target.closest('[data-csv]')) return downloadCsv(event.target.closest('[data-csv]'));
}

// ------------------------------------------------------------------ vipande vya pamoja

const stats = (items) =>
  `<section class="rp-stats" aria-label="Muhtasari">${items
    .map(([label, value, sub, tone]) => `<div class="rp-stat${tone ? ` rp-stat-${tone}` : ''}"><span>${esc(label)}</span><strong>${value}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`)
    .join('')}</section>`;

const chips = (key, current, items, label) =>
  `<div class="filters rp-chips" role="group" aria-label="${esc(label)}">${items
    .map(([value, text, count]) => `<button type="button" class="chip" data-set="${key}=${value}" aria-pressed="${String(String(current) === String(value))}">${esc(text)}${count !== undefined ? `<span>${n(count)}</span>` : ''}</button>`)
    .join('')}</div>`;

const toolbar = (placeholder, withSearch = true) =>
  `<div class="rp-toolbar">
    ${withSearch ? `<input type="search" id="rp-q" class="search" placeholder="${esc(placeholder)}" value="${esc(state[tab].q ?? '')}" aria-label="Tafuta">` : '<span></span>'}
    <button class="btn btn-ghost btn-small" type="button" data-csv>Pakua Excel (CSV)</button>
  </div>`;

function footHtml() {
  const shown = list.rows.length;
  return `<div class="rp-foot" id="rp-foot"><span class="muted">${shown ? `Inaonyesha ${n(shown)} kati ya ${n(list.total)}` : ''}</span>${
    shown < list.total ? `<button class="btn btn-ghost btn-small" type="button" data-more>Onyesha ${n(Math.min(100, list.total - shown))} zaidi</button>` : ''
  }</div>`;
}

const table = (head, rows, empty) =>
  rows.length
    ? `<div class="rp-scroll" id="rp-table"><table class="rp-table"><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>
        <tbody id="rp-body">${rows.join('')}</tbody></table></div>${footHtml()}`
    : `<div class="rp-scroll" id="rp-table"><p class="empty">${esc(empty)}</p></div>`;

function rowRenderer() {
  if (tab === 'madereva' || (tab === 'app' && state.app.group === 'madereva')) return driverRow;
  if (tab === 'maombi') return requestRow;
  return passengerRow;
}

// ------------------------------------------------------------------ 1. Madereva

function driverRow(d) {
  const fee = d.status === 'APPROVED' ? (d.feeOk ? '<span class="badge badge-ok">Ada iko sawa</span>' : '<span class="badge badge-bad">Ada imeisha</span>') : '';
  const online = d.online ? '<span class="rp-dot rp-dot-on"></span>Online' : '<span class="rp-dot"></span>Offline';
  return `<tr>
    <td>${person(d.name, d.phone, d.id, 'madereva')}</td>
    <td><strong class="rp-nowrap">${esc(d.plate ?? '–')}</strong><span class="rp-sub">${esc(VEHICLE_TYPES[d.vehicleType] ?? '–')}${d.vehicle ? ` · ${esc(d.vehicle)}` : ''}${d.color ? ` · ${esc(d.color)}` : ''}</span></td>
    <td><span class="rp-badges"><span class="badge badge-${d.status === 'APPROVED' ? 'ok' : d.status === 'PENDING' ? 'warn' : 'muted'}">${esc(DRIVER_STATUS[d.status] ?? d.status)}</span>${fee}</span>
        <span class="rp-sub">${d.approvedAt ? `Tangu ${day(d.approvedAt)}` : `Alijisajili ${day(d.registeredAt)}`}</span></td>
    <td><span class="rp-online">${online}</span><span class="rp-sub">${esc(ago(d.lastSeenAt))}</span></td>
    <td class="num"><strong>${n(d.completed)}</strong><span class="rp-sub">${formatTsh(d.value)}</span></td>
    <td class="num">${d.rating ? `★ ${d.rating}` : '–'}</td>
    <td class="num"><span class="rp-offers" title="Alipewa · Alikubali · Alikataa · Hakujibu"><b>${n(d.offers)}</b> · <i class="ok">${n(d.accepted)}</i> · <i class="bad">${n(d.declined)}</i> · <i class="warn">${n(d.missed)}</i></span>
        <span class="rp-sub">${d.offers ? `Alikubali ${pct(d.accepted, d.offers)}%` : 'Bado hajapewa ombi'}</span></td>
    <td>${clientBadge(d.client)}</td>
  </tr>`;
}
const DRIVER_HEAD = ['Dereva', 'Chombo', 'Hali', 'Online', 'Safari', 'Nyota', 'Maombi <small>(alipewa · alikubali · alikataa · hakujibu)</small>', 'App'];

function renderDrivers(data) {
  const s = data.summary;
  const st = state.madereva;
  host.innerHTML = `
    <p class="rp-lead">Madereva tu (wateja wako kwenye ripoti yao). Chaguo-msingi: waliothibitishwa.</p>
    ${stats([
      ['Waliothibitishwa', n(s.approved), `Bodaboda ${n(s.bodaboda)} · Bajaji ${n(s.bajaji)}`, 'hero'],
      ['Online sasa', n(s.online), `${pct(s.online, s.approved)}% ya waliothibitishwa`],
      ['Ada iko sawa', n(s.feeOk), `${n(s.approved - s.feeOk)} ada imeisha`],
      ['Wanatumia APK', n(s.apk), `${pct(s.apk, s.approved)}% ya waliothibitishwa`],
      ['Wanasubiri ukaguzi', n(s.pending), `Wamesimamishwa ${n(s.suspended)}`],
    ])}
    ${chips('status', st.status, [
      ['APPROVED', 'Waliothibitishwa', s.approved], ['PENDING', 'Wanasubiri', s.pending], ['SUSPENDED', 'Wamesimamishwa', s.suspended],
      ['REJECTED', 'Wamekataliwa', s.rejected], ['INCOMPLETE', 'Hawajakamilisha', s.incomplete], ['ALL', 'Wote', s.all],
    ], 'Hali ya dereva')}
    ${chips('client', st.client, [['', 'APK na link'], ['apk', 'APK tu'], ['web', 'Link tu'], ['unknown', 'Haijulikani']], 'App')}
    ${toolbar('Tafuta jina, simu au plate')}
    ${table(DRIVER_HEAD, data.rows.map(driverRow), 'Hakuna dereva kwenye kichujio hiki.')}`;
}

// ------------------------------------------------------------------ 2. Wateja

function passengerRow(p) {
  return `<tr>
    <td>${person(p.name, p.phone, p.id)}${p.accountStatus === 'SUSPENDED' ? ' <span class="badge badge-bad">Imesimamishwa</span>' : ''}</td>
    <td>${esc(day(p.registeredAt))}<span class="rp-sub">${p.verified ? 'Simu imethibitishwa' : 'Simu haijathibitishwa'}</span></td>
    <td>${clientBadge(p.client)}<span class="rp-sub">${esc(p.appSeenAt ? ago(p.appSeenAt) : '–')}</span></td>
    <td class="num"><strong>${n(p.requested)}</strong></td>
    <td class="num">${n(p.completed)}</td>
    <td class="num">${n(p.cancelled)}<span class="rp-sub">Bila dereva ${n(p.noDriver)}</span></td>
    <td class="num">${formatTsh(p.spent)}</td>
    <td class="rp-nowrap">${esc(p.lastRideAt ? when(p.lastRideAt) : 'Bado hajaagiza')}</td>
    <td>${p.language === 'en' ? 'English' : 'Kiswahili'}</td>
  </tr>`;
}
const PASSENGER_HEAD = ['Mteja', 'Alijisajili', 'App', 'Maombi', 'Yamefanikiwa', 'Ameghairi', 'Amelipa', 'Ombi la mwisho', 'Lugha'];

function renderPassengers(data) {
  const s = data.summary;
  const st = state.wateja;
  host.innerHTML = `
    <p class="rp-lead">Waliojisajili kama wateja tu — madereva hawamo hapa.</p>
    ${stats([
      ['Wateja wote', n(s.all), `${n(s.today)} leo · ${n(s.new)} siku 7`, 'hero'],
      ['Wanaoagiza (siku 30)', n(s.active), `${pct(s.active, s.all)}% ya wateja`],
      ['Hawajawahi kuagiza', n(s.never), `${pct(s.never, s.all)}% ya wateja`],
      ['APK / Link', `${n(s.apk)} / ${n(s.web)}`, `Haijulikani ${n(s.unknown)}`],
      ['Simu zimethibitishwa', n(s.verified), `Wamesimamishwa ${n(s.suspended)}`],
    ])}
    ${chips('filter', st.filter, [
      ['ALL', 'Wote', s.all], ['NEW', 'Wapya (siku 7)', s.new], ['ACTIVE', 'Wanaoagiza (siku 30)', s.active],
      ['NEVER', 'Hawajaagiza', s.never], ['SUSPENDED', 'Wamesimamishwa', s.suspended],
    ], 'Kundi la wateja')}
    ${chips('client', st.client, [['', 'APK na link'], ['apk', 'APK', s.apk], ['web', 'Link', s.web], ['unknown', 'Haijulikani', s.unknown]], 'App')}
    ${toolbar('Tafuta jina au namba ya simu')}
    ${table(PASSENGER_HEAD, data.rows.map(passengerRow), 'Hakuna mteja kwenye kichujio hiki.')}`;
}

// ------------------------------------------------------------------ 3. APK na link

function split(title, g) {
  const parts = [['apk', 'APK', g.apk], ['web', 'Link', g.web], ['unknown', 'Haijulikani', g.unknown]];
  return `<section class="panel rp-split">
    <div class="panel-head"><h2>${esc(title)}</h2><span class="muted">${n(g.total)}</span></div>
    <div class="rp-bar" role="img" aria-label="${esc(parts.map(([, l, v]) => `${l} ${v}`).join(', '))}">${parts
      .map(([k, , v]) => (v ? `<i class="rp-bar-${k}" style="flex:${v}"></i>` : ''))
      .join('')}</div>
    <ul class="rp-legend">${parts.map(([k, l, v]) => `<li><i class="rp-bar-${k}"></i>${l} <strong>${n(v)}</strong> <span>${pct(v, g.total)}%</span></li>`).join('')}</ul>
  </section>`;
}

function renderApp(sum, data) {
  const st = state.app;
  const rides = Object.fromEntries(sum.rides.map((r) => [r.client, r]));
  const rideLine = (k, l) => `<li>${l}: <strong>${n(rides[k]?.requested)}</strong> maombi · ${n(rides[k]?.completed)} yamefanikiwa</li>`;
  host.innerHTML = `
    <p class="rp-lead">Nani anatumia app ya Android (APK) na nani anatumia link kwenye browser. "Haijulikani" = hajafungua NAYA tangu ripoti hii ianze kuhesabu.</p>
    ${stats([
      ['Wateja kwenye APK', n(sum.passengers.apk), `${pct(sum.passengers.apk, sum.passengers.total)}% ya wateja`, 'hero'],
      ['Wateja kwenye link', n(sum.passengers.web), `${pct(sum.passengers.web, sum.passengers.total)}% ya wateja`],
      ['Madereva kwenye APK', n(sum.drivers.apk), `${pct(sum.drivers.apk, sum.drivers.total)}% ya waliothibitishwa`],
      ['APK zimepakuliwa', n(sum.downloads.total), `${n(sum.downloads.today)} leo · ${n(sum.downloads.week)} siku 7`],
    ])}
    <div class="overview-split">${split('Wateja', sum.passengers)}${split('Madereva waliothibitishwa', sum.drivers)}</div>
    <div class="overview-split">
      <section class="panel chart-panel"><div class="panel-head"><h2>Upakuaji wa APK kila siku (siku 30)</h2></div><div id="rp-dl" class="bar-chart bar-chart-short" role="img" aria-label="Upakuaji wa APK kila siku"></div></section>
      <section class="panel"><h2>Maombi ya siku 30 kwa njia ya mteja</h2><ul class="rp-lines">${rideLine('apk', 'APK')}${rideLine('web', 'Link')}${rideLine('unknown', 'Haijulikani')}</ul></section>
    </div>
    <h2 class="rp-h2">Orodha</h2>
    ${chips('group', st.group, [['wateja', 'Wateja'], ['madereva', 'Madereva']], 'Kundi')}
    ${chips('client', st.client, [['apk', 'APK'], ['web', 'Link'], ['unknown', 'Haijulikani']], 'App')}
    ${toolbar(st.group === 'madereva' ? 'Tafuta jina, simu au plate' : 'Tafuta jina au namba ya simu')}
    ${st.group === 'madereva'
      ? table(DRIVER_HEAD, data.rows.map(driverRow), 'Hakuna dereva kwenye kundi hili.')
      : table(PASSENGER_HEAD, data.rows.map(passengerRow), 'Hakuna mteja kwenye kundi hili.')}`;
  barChart(host.querySelector('#rp-dl'), sum.days.map((d) => ({ label: shortDay(d.day), value: d.downloads, tip: `${shortDay(d.day)} · wapya kwenye APK ${d.newApk}` })), { labelEvery: 5 });
}

// ------------------------------------------------------------------ 4. Maombi ya safari

function requestRow(r) {
  const [label, tone] = RIDE_STATUS[r.status] ?? [r.status, 'muted'];
  const offers = r.offers.length
    ? `<ol class="rp-offer-list">${r.offers
        .map((o) => {
          const [ol, ot] = OFFER[o.status] ?? [o.status, 'muted'];
          return `<li><a href="#/madereva/${esc(o.driverId)}">${esc(o.name)}</a> <span class="rp-sub-inline">${esc(o.plate ?? '')}${o.km !== null ? ` · km ${o.km}` : ''}</span>
            <span class="badge badge-${ot}">${esc(ol)}${o.seconds !== null && o.status !== 'EXPIRED' ? ` · ${esc(secs(o.seconds))}` : ''}</span></li>`;
        })
        .join('')}</ol>`
    : '<span class="muted">Hakuna dereva aliyepewa</span>';
  const result =
    r.driverName
      ? `<a href="#/madereva/${esc(r.driverId)}"><strong>${esc(r.driverName)}</strong></a><span class="rp-sub">${esc(r.driverPlate ?? '')} · baada ya ${esc(secs(r.secondsToDriver))}</span>`
      : r.status === 'CANCELLED'
        ? `<span class="rp-sub">Imeghairiwa na ${esc(CANCELLED_BY[r.cancelledBy] ?? '–')}${r.cancelReason ? `: ${esc(r.cancelReason)}` : ''}</span>`
        : '<span class="rp-sub">–</span>';
  return `<tr>
    <td class="rp-nowrap"><a href="#/safari/${esc(r.id)}">${esc(when(r.requestedAt))}</a></td>
    <td>${person(r.passengerName, r.passengerPhone, r.passengerId)}<span class="rp-sub">${r.passengerClient === 'apk' ? 'APK' : r.passengerClient === 'web' ? 'Link' : ''}</span></td>
    <td>${esc(r.from)} → ${esc(r.to)}<span class="rp-sub">${esc(VEHICLE_TYPES[r.vehicleType] ?? '')} · km ${r.km} · ${formatTsh(r.fare)}${r.promoDiscount ? ` · ofa −${formatTsh(r.promoDiscount)}` : ''}</span></td>
    <td>${badge([label, tone])}${r.status === 'COMPLETED' && r.completedBy && r.completedBy !== 'DRIVER' ? `<span class="rp-sub">Imemalizwa na ${esc(COMPLETED_BY[r.completedBy] ?? r.completedBy)}</span>` : ''}${(r.flags ?? []).length ? `<span class="rp-sub">${flagBadges(r.flags, esc)}</span>` : ''}</td>
    <td>${result}</td>
    <td>${offers}</td>
  </tr>`;
}

function renderRequests(data) {
  const s = data.summary;
  const st = state.maombi;
  const avg = s.avgSecondsToDriver;
  const driverRows = data.drivers.map(
    (d) => `<tr>
      <td>${person(d.name, d.phone, d.id, 'madereva')}</td><td>${esc(d.plate ?? '')}</td>
      <td class="num"><strong>${n(d.offers)}</strong></td><td class="num ok">${n(d.accepted)}</td><td class="num bad">${n(d.declined)}</td>
      <td class="num warn">${n(d.missed)}</td><td class="num">${n(d.taken)}</td>
      <td class="num">${pct(d.accepted, d.offers - d.taken - d.cancelled)}%</td><td class="num">${esc(secs(d.avgSecondsToAccept))}</td>
    </tr>`,
  );
  host.innerHTML = `
    <p class="rp-lead">Kila ombi la mteja: lilifanikiwa au la, nani alilipokea, na kila dereva aliyepewa alifanya nini.</p>
    ${chips('days', st.days, [[1, 'Leo'], [7, 'Siku 7'], [30, 'Siku 30'], [90, 'Siku 90']], 'Kipindi')}
    ${stats([
      ['Maombi', n(s.all), `Wateja ${n(s.passengers)}`, 'hero'],
      ['Yamefanikiwa', n(s.completed), `${pct(s.completed, s.all)}% ya maombi`, 'ok'],
      ['Hayakupata dereva', n(s.noDriver), `${pct(s.noDriver, s.all)}% ya maombi`, 'bad'],
      ['Yameghairiwa', n(s.cancelled), `Abiria ${n(s.cancelledByPassenger)} · dereva ${n(s.cancelledByDriver)}`],
      ['Muda wa kupata dereva', avg === null ? '–' : esc(secs(avg)), 'Wastani'],
    ])}
    ${chips('filter', st.filter, [
      ['ALL', 'Yote', s.all], ['COMPLETED', 'Yamefanikiwa', s.completed], ['ACTIVE', 'Yanaendelea', s.active],
      ['NO_DRIVER', 'Hayakupata dereva', s.noDriver], ['CANCELLED', 'Yameghairiwa', s.cancelled],
    ], 'Hali ya ombi')}
    ${toolbar('Tafuta mteja, dereva, plate au eneo')}
    ${table(['Muda', 'Mteja', 'Safari', 'Hali', 'Aliyepokea', 'Madereva waliopewa ombi (kwa mpangilio)'], data.rows.map(requestRow), 'Hakuna ombi kwenye kipindi hiki.')}
    <section class="panel">
      <div class="panel-head"><h2>Kila dereva: maombi aliyopewa</h2><span class="muted">Kipindi hiki</span></div>
      ${driverRows.length
        ? `<div class="rp-scroll"><table class="rp-table"><thead><tr><th>Dereva</th><th>Plate</th><th>Alipewa</th><th>Alikubali</th><th>Alikataa</th><th>Hakujibu</th><th>Mwingine amewahi</th><th>Kiwango cha kukubali</th><th>Muda wa kukubali</th></tr></thead><tbody>${driverRows.join('')}</tbody></table></div>`
        : '<p class="empty">Hakuna dereva aliyepewa ombi kwenye kipindi hiki.</p>'}
    </section>`;
}

// ------------------------------------------------------------------ 5. Online sasa

function renderOnline(data, quiet) {
  const s = data.summary;
  const st = state.online;
  const rows = st.readiness === 'ALL' ? data.rows : data.rows.filter((d) => (st.readiness === 'NOT_SEEN' ? ['NOT_SEEN', 'NO_GPS'].includes(d.readiness) : d.readiness === st.readiness));
  const keepFocus = quiet && document.activeElement?.closest?.('#rp-view');
  const html = `
    <p class="rp-lead">Madereva walioko online sasa hivi. "Tayari" = anaweza kupewa ombi la mteja muda huu. Inasasishwa yenyewe kila sekunde 15.</p>
    ${stats([
      ['Tayari kupokea ombi', n(s.ready), `Bodaboda ${n(s.readyBodaboda)} · Bajaji ${n(s.readyBajaji)}`, 'hero'],
      ['Online wote', n(s.online), ''],
      ['Wako safarini', n(s.onRide), `Wenye ombi sasa ${n(s.offer)}`],
      ['Hawajaonekana', n(s.notSeen), 'Simu imezima au haina mtandao', s.notSeen ? 'bad' : ''],
      ['Ada imeisha', n(s.fee), 'Hawapewi maombi', s.fee ? 'bad' : ''],
    ])}
    ${chips('readiness', st.readiness, [
      ['ALL', 'Wote', s.online], ['READY', 'Tayari', s.ready], ['OFFER', 'Wana ombi', s.offer], ['ON_RIDE', 'Safarini', s.onRide],
      ['NOT_SEEN', 'Hawajaonekana', s.notSeen], ['FEE', 'Ada imeisha', s.fee],
    ], 'Hali')}
    <div class="rp-toolbar"><span class="muted">Imesasishwa ${esc(new Date(data.at).toLocaleTimeString('sw-TZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</span>
      <button class="btn btn-ghost btn-small" type="button" data-csv>Pakua Excel (CSV)</button></div>
    ${rows.length
      ? `<div class="rp-scroll" id="rp-table"><table class="rp-table"><thead><tr><th>Dereva</th><th>Chombo</th><th>Hali</th><th>Karibu na</th><th>Alionekana</th><th>Online tangu</th><th>App</th><th>Kengele</th></tr></thead><tbody>${rows
          .map(
            (d) => `<tr>
              <td>${person(d.name, d.phone, d.id, 'madereva')}</td>
              <td><strong class="rp-nowrap">${esc(d.plate ?? '–')}</strong><span class="rp-sub">${esc(VEHICLE_TYPES[d.vehicleType] ?? '')}</span></td>
              <td>${badge(READY[d.readiness] ?? [d.readiness, 'muted'])}${d.rideStatus ? `<span class="rp-sub">${esc(d.ridePickup ?? '')}</span>` : ''}</td>
              <td>${esc(d.nearPlace ?? '–')}</td>
              <td>${esc(ago(d.lastSeenAt))}</td>
              <td class="rp-nowrap">${esc(d.onlineSince ? when(d.onlineSince) : '–')}</td>
              <td>${clientBadge(d.client)}</td>
              <td>${d.hasAlarm ? '<span class="badge badge-ok">Inalia</span>' : '<span class="badge badge-muted" title="Hana app ya Android yenye arifa">Haina</span>'}</td>
            </tr>`,
          )
          .join('')}</tbody></table></div>`
      : `<div class="rp-scroll" id="rp-table"><p class="empty">${s.online ? 'Hakuna dereva kwenye kichujio hiki.' : 'Hakuna dereva online sasa hivi.'}</p></div>`}`;
  host.innerHTML = html;
  if (keepFocus) host.querySelector(`[data-set="readiness=${st.readiness}"]`)?.focus();
}
