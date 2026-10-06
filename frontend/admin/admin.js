// Ofisi ya NAYA: login → muhtasari, madereva (orodha → dereva mmoja → kuthibitisha/kukataa).
// Session inahifadhiwa; refresh haikutoi isipokuwa API imekataa token (401/403).
import { createApi, escapeHtml as esc, fetchHealth } from '/shared/api.js';
import { connectRealtime } from '/shared/realtime.js';
import * as places from './places.js';
import * as ridesAdmin from './rides-admin.js';
import * as safetyAdmin from './safety-admin.js';
import * as subsAdmin from './subscriptions-admin.js';
import {
  AUDIT_ACTIONS,
  DOCUMENT_ORDER,
  DOCUMENT_STATUS,
  DOCUMENTS,
  DRIVER_STATUS,
  formatDate,
  formatPhone,
  VEHICLE_TYPES,
} from '/shared/labels.js';

const api = createApi('naya_admin_token');
const $ = (id) => document.getElementById(id);
const views = ['view-loading', 'view-login', 'view-offline', 'view-app'];
const pages = ['page-overview', 'page-drivers', 'page-driver', 'page-locations', 'page-fares', 'page-rides', 'page-ride', 'page-subscriptions', 'page-sos'];
let me = null;

function show(view) {
  for (const v of views) $(v).hidden = v !== view;
}
function setDot(id, state) {
  $(id).className = `dot dot-${state}`;
}
function badge(map, key) {
  const s = map[key] ?? { label: key, tone: 'muted' };
  return `<span class="badge badge-${s.tone}">${esc(s.label)}</span>`;
}
function showError(id, err) {
  $(id).textContent = err.message;
  $(id).hidden = false;
}
/** Token imekataliwa (imeisha, logout, au akaunti imesimamishwa) → rudi kwenye login. */
function handleAuthError(err) {
  if (err.status !== 401 && err.status !== 403) return false;
  signOutLocally();
  return true;
}

// ---------- Login ----------
async function showLogin() {
  show('view-login');
  $('phone').focus();
  const health = await fetchHealth();
  if (health.api && health.database) {
    setDot('login-health', 'ok');
    $('login-health-text').textContent = 'Mfumo unafanya kazi';
  } else {
    setDot('login-health', 'bad');
    $('login-health-text').textContent = health.api ? 'Database haipatikani kwa sasa' : 'Server haipatikani kwa sasa';
  }
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('login-button');
  $('login-error').hidden = true;
  button.disabled = true;
  button.textContent = 'Inaingia…';
  try {
    const result = await api.post('/api/auth/login', { phone: $('phone').value, password: $('password').value, portal: 'admin' });
    api.setToken(result.token);
    $('password').value = '';
    enterApp(result.user);
  } catch (err) {
    showError('login-error', err);
  } finally {
    button.disabled = false;
    button.textContent = 'Ingia';
  }
});

let realtime = null;
let liveTimer = null;

/** Kitu kimebadilika (safari, dereva) → sasisha ukurasa ulio wazi (mara moja kwa matukio mengi ya karibu). */
function onAdminEvent(_type, data) {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    if (!me) return;
    if (!$('page-overview').hidden) loadOverview();
    else if (!$('page-rides').hidden) ridesAdmin.refreshList();
    else if (!$('page-ride').hidden && data?.rideId && location.hash.endsWith(data.rideId)) ridesAdmin.loadRide(data.rideId);
    else if (!$('page-drivers').hidden) loadDrivers(driversState.status, driversState.q);
    // Usifute maelezo ambayo msimamizi anaandika sasa hivi.
    else if (!$('page-sos').hidden && !document.activeElement?.closest('#sos-list form')) safetyAdmin.loadPage();
    else if (!$('page-subscriptions').hidden) subsAdmin.loadList();
    if ($('page-overview').hidden) loadPendingCount();
  }, 700);
}

function enterApp(user) {
  me = user;
  loadPendingCount(); // idadi kwenye menyu + bango la dharura tangu mwanzo
  realtime ??= connectRealtime(api, {
    onEvent: onAdminEvent,
    onStatus: (up) => {
      $('admin-live').classList.toggle('on', up);
      $('admin-live').title = up ? 'Live: inajisasisha yenyewe' : 'Inaunganisha upya…';
    },
  });
  $('me-name').textContent = user.fullName;
  show('view-app');
  route();
}

// ---------- Njia (hash routing) ----------
function route() {
  if (!me) return;
  const [path, query] = location.hash.replace(/^#/, '').split('?');
  const parts = (path || '/').split('/').filter(Boolean);
  const params = new URLSearchParams(query ?? '');
  let page = 'page-overview';
  if (parts[0] === 'madereva' && parts[1]) page = 'page-driver';
  else if (parts[0] === 'madereva') page = 'page-drivers';
  else if (parts[0] === 'maeneo') page = 'page-locations';
  else if (parts[0] === 'bei') page = 'page-fares';
  else if (parts[0] === 'safari' && parts[1]) page = 'page-ride';
  else if (parts[0] === 'safari') page = 'page-rides';
  else if (parts[0] === 'ada') page = 'page-subscriptions';
  else if (parts[0] === 'dharura') page = 'page-sos';
  ridesAdmin.stop();
  driverOnPage = null;
  for (const p of pages) $(p).hidden = p !== page;
  const navFor = { 'page-overview': 'overview', 'page-drivers': 'drivers', 'page-driver': 'drivers', 'page-locations': 'locations', 'page-fares': 'fares', 'page-rides': 'rides', 'page-ride': 'rides', 'page-subscriptions': 'subscriptions', 'page-sos': 'sos' };
  for (const a of document.querySelectorAll('[data-nav]')) {
    const active = a.dataset.nav === navFor[page];
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);
  if (page === 'page-overview') loadOverview();
  if (page === 'page-drivers') loadDrivers(params.get('hali') ?? driversState.status, params.get('q') ?? driversState.q);
  if (page === 'page-driver') loadDriver(parts[1]);
  if (page === 'page-locations') places.loadLocations();
  if (page === 'page-fares') places.loadFares();
  if (page === 'page-rides') ridesAdmin.loadRides();
  if (page === 'page-ride') ridesAdmin.loadRide(parts[1]);
  if (page === 'page-subscriptions') subsAdmin.loadPage();
  if (page === 'page-sos') safetyAdmin.loadPage();
}
window.addEventListener('hashchange', route);

// ---------- Muhtasari ----------
function greetingFor(date) {
  const h = date.getHours();
  if (h < 12) return 'Habari za asubuhi';
  if (h < 16) return 'Habari za mchana';
  return 'Habari za jioni';
}

function setPendingBadge(count) {
  $('nav-pending').textContent = count;
  $('nav-pending').hidden = !count;
}

async function loadOverview() {
  $('greeting').textContent = `${greetingFor(new Date())}, ${me.fullName.split(' ')[0]}`;
  $('today').textContent = new Date().toLocaleDateString('sw-TZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  try {
    const data = await api.get('/api/admin/dashboard');
    $('dashboard-error').hidden = true;
    const n = (v) => Number(v).toLocaleString('sw-TZ');
    $('stat-members').textContent = n(data.users.members);
    $('stat-drivers').textContent = n(data.drivers.APPROVED);
    $('stat-pending').textContent = n(data.drivers.PENDING);
    $('stat-new').textContent = n(data.users.newToday);
    setPendingBadge(data.drivers.PENDING);
    setDot('sys-api', 'ok');
    setDot('sys-db', data.system.database === 'ok' ? 'ok' : 'bad');
    $('sys-version').textContent = `NAYA ${data.system.version} · ${data.system.phase}`;
    renderSetup(data);
    $('stat-active').textContent = n(data.rides.active);
    $('stat-completed').textContent = n(data.rides.completedToday);
    $('stat-value').textContent = `TSh ${n(data.rides.valueToday)}`;
    $('stat-online').textContent = n(data.rides.driversOnline);
    $('nav-active').textContent = data.rides.active;
    $('nav-active').hidden = !data.rides.active;
    $('stat-sub-month').textContent = `TSh ${n(data.subscriptions.monthTotal)}`;
    $('stat-sub-expired').textContent = n(data.subscriptions.expiredDrivers);
    $('stat-sos').textContent = n(data.sosOpen);
    safetyAdmin.setOpenCount(data.sosOpen);
  } catch (err) {
    if (handleAuthError(err)) return;
    showError('dashboard-error', err);
    setDot('sys-api', err.status === 0 ? 'bad' : 'ok');
    setDot('sys-db', 'wait');
  }
}

function renderSetup(data) {
  const priced = data.setup.pricedVehicleTypes;
  const items = [
    [data.setup.activeLocations > 0, data.setup.activeLocations > 0 ? `Maeneo ${data.setup.activeLocations} yanatumika` : 'Ongeza maeneo ya Urambo', '#/maeneo', 'Maeneo'],
    [priced.includes('BODABODA'), 'Bei za bodaboda', '#/bei', 'Bei'],
    [priced.includes('BAJAJI'), 'Bei za bajaji', '#/bei', 'Bei'],
    [data.drivers.APPROVED > 0, data.drivers.APPROVED > 0 ? `Madereva ${data.drivers.APPROVED} wamethibitishwa` : 'Thibitisha madereva', '#/madereva', 'Madereva'],
  ];
  $('setup-list').innerHTML = items
    .map(
      ([done, label, href, link]) =>
        `<li><span class="setup-mark ${done ? 'ok' : 'todo'}" aria-hidden="true">${done ? '✓' : '!'}</span><span>${esc(label)}</span>${
          done ? '' : `<a href="${href}">${link}</a>`
        }</li>`,
    )
    .join('');
}

// ---------- Orodha ya madereva ----------
const FILTERS = [
  ['PENDING', 'Wanasubiri'],
  ['APPROVED', 'Wamethibitishwa'],
  ['REJECTED', 'Wamekataliwa'],
  ['SUSPENDED', 'Wamesimamishwa'],
  ['INCOMPLETE', 'Hawajamaliza'],
  ['ALL', 'Wote'],
];
const driversState = { status: 'PENDING', q: '' };

async function loadDrivers(status, q) {
  driversState.status = FILTERS.some(([key]) => key === status) ? status : 'PENDING';
  driversState.q = q ?? '';
  $('driver-q').value = driversState.q;
  $('drivers-error').hidden = true;
  const list = $('driver-list');
  list.innerHTML = '<p class="empty">Inapakia…</p>';
  try {
    const params = new URLSearchParams({ status: driversState.status });
    if (driversState.q) params.set('q', driversState.q);
    const data = await api.get(`/api/admin/drivers?${params}`);
    renderFilters(data.counts);
    setPendingBadge(data.counts.PENDING);
    if (data.drivers.length === 0) {
      list.innerHTML = `<p class="empty">${
        driversState.q ? 'Hakuna dereva anayelingana na utafutaji huu.' : emptyText(driversState.status)
      }</p>`;
      return;
    }
    list.innerHTML = data.drivers
      .map(
        (d) => `<a class="driver-row" href="#/madereva/${esc(d.id)}">
          <span><span class="driver-name">${esc(d.fullName)}</span><br><span class="driver-sub">${esc(formatPhone(d.phone))}</span></span>
          <span class="col-vehicle">${d.plateNumber ? `<span class="plate">${esc(d.plateNumber)}</span><br><span class="driver-sub">${esc(VEHICLE_TYPES[d.vehicleType] ?? '')}</span>` : '<span class="driver-sub">Chombo bado</span>'}</span>
          <span class="col-date driver-sub">${d.submittedAt ? `Alituma ${esc(formatDate(d.submittedAt))}` : `Alijisajili ${esc(formatDate(d.createdAt))}`}</span>
          <span>${badge(DRIVER_STATUS, d.status)}</span>
        </a>`,
      )
      .join('');
  } catch (err) {
    if (handleAuthError(err)) return;
    list.innerHTML = '';
    showError('drivers-error', err);
  }
}

function emptyText(status) {
  return {
    PENDING: 'Hakuna dereva anayesubiri uthibitisho kwa sasa.',
    APPROVED: 'Bado hakuna dereva aliyethibitishwa.',
    REJECTED: 'Hakuna dereva aliyekataliwa.',
    SUSPENDED: 'Hakuna dereva aliyesimamishwa.',
    INCOMPLETE: 'Hakuna dereva ambaye hajamaliza usajili.',
    ALL: 'Bado hakuna dereva. Watumiaji wanaomba udereva ndani ya app ya NAYA (Akaunti → Kuwa dereva).',
  }[status];
}

function renderFilters(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  $('driver-filters').innerHTML = FILTERS.map(
    ([key, label]) =>
      `<button type="button" class="chip" data-status="${key}" aria-pressed="${key === driversState.status}">${label}<span>${
        key === 'ALL' ? total : counts[key]
      }</span></button>`,
  ).join('');
}

$('driver-filters').addEventListener('click', (event) => {
  const chip = event.target.closest('[data-status]');
  if (!chip) return;
  location.hash = `#/madereva?hali=${chip.dataset.status}${driversState.q ? `&q=${encodeURIComponent(driversState.q)}` : ''}`;
});

$('driver-search').addEventListener('submit', (event) => {
  event.preventDefault();
  const q = $('driver-q').value.trim();
  location.hash = `#/madereva?hali=${q ? 'ALL' : driversState.status}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
});

// ---------- Dereva mmoja ----------
let blobUrls = [];
let driverOnPage = null; // dereva aliye wazi kwenye ukurasa
function releaseBlobs() {
  for (const url of blobUrls) URL.revokeObjectURL(url);
  blobUrls = [];
}

async function loadDriver(id) {
  releaseBlobs();
  $('driver-error').hidden = true;
  $('driver-detail').innerHTML = '<p class="muted">Inapakia…</p>';
  try {
    renderDriver(await api.get(`/api/admin/drivers/${encodeURIComponent(id)}`));
  } catch (err) {
    if (handleAuthError(err)) return;
    $('driver-detail').innerHTML = '';
    showError('driver-error', err);
  }
}

function renderDriver(data) {
  const { user, driver, documents, history } = data;
  const docs = new Map(documents.map((d) => [d.type, d]));
  const fact = (label, value) => `<div><dt>${label}</dt><dd>${value ? esc(value) : '–'}</dd></div>`;

  $('driver-detail').innerHTML = `
    <div class="detail-head">
      <div>
        <h1>${esc(user.fullName)}</h1>
        <p class="muted"><a href="tel:+${esc(user.phone)}">${esc(formatPhone(user.phone))}</a> · Alijisajili ${esc(formatDate(driver.createdAt))}${
          driver.submittedAt ? ` · Alituma ${esc(formatDate(driver.submittedAt, true))}` : ''
        }</p>
      </div>
      ${badge(DRIVER_STATUS, driver.status)}
    </div>
    ${driver.rejectionReason ? `<p class="alert ${driver.status === 'SUSPENDED' ? 'alert-danger' : 'alert-warn'}"><strong>Sababu:</strong> ${esc(driver.rejectionReason)}</p>` : ''}

    <section class="panel">
      <h2>Chombo na leseni</h2>
      <dl class="facts">
        ${fact('Aina', VEHICLE_TYPES[driver.vehicleType])}
        ${fact('Plate', driver.plateNumber)}
        ${fact('Kampuni / aina', driver.vehicleMake)}
        ${fact('Modeli', driver.vehicleModel)}
        ${fact('Rangi', driver.vehicleColor)}
        ${fact('Namba ya leseni', driver.licenseNumber)}
        ${fact('Namba ya NIDA', driver.nationalIdNumber)}
        ${fact('Simu', formatPhone(user.phone))}
      </dl>
    </section>

    <section class="panel">
      <h2>Nyaraka</h2>
      <div class="docs">
        ${DOCUMENT_ORDER.map((type) => {
          const doc = docs.get(type);
          return `<div class="doc">
            <button type="button" class="doc-thumb" data-doc="${type}" ${doc ? '' : 'disabled'} aria-label="Fungua ${esc(DOCUMENTS[type].label)}">
              ${doc ? (doc.mimeType === 'application/pdf' ? 'PDF — bonyeza kufungua' : 'Inapakia…') : 'Haijapakiwa'}
            </button>
            <div class="doc-meta"><strong>${esc(DOCUMENTS[type].label)}</strong>${doc ? badge(DOCUMENT_STATUS, doc.status) : ''}</div>
          </div>`;
        }).join('')}
      </div>
    </section>

    ${['APPROVED', 'SUSPENDED'].includes(driver.status) ? '<section class="panel" id="driver-sub"><h2>Ada ya mwezi</h2><p class="muted">Inapakia…</p></section>' : ''}

    ${decisionPanel(driver, docs)}

    <section class="panel">
      <h2>Historia</h2>
      ${
        history.length === 0
          ? '<p class="muted">Bado hakuna hatua iliyochukuliwa.</p>'
          : `<ul class="history">${history
              .map(
                (h) => `<li><span><strong>${esc(AUDIT_ACTIONS[h.action] ?? h.action)}</strong>${
                  h.actorName && !['driver.submitted', 'driver.applied'].includes(h.action) ? ` — na ${esc(h.actorName)}` : ''
                }</span><span class="muted">${esc(formatDate(h.createdAt, true))}</span>${
                  h.details?.reason ? `<span class="note">${esc(h.details.reason)}</span>` : ''
                }</li>`,
              )
              .join('')}</ul>`
      }
    </section>`;

  // Picha ndogo za nyaraka (zinapakuliwa kwa token, si URL za wazi).
  for (const button of document.querySelectorAll('.doc-thumb[data-doc]')) {
    const doc = docs.get(button.dataset.doc);
    if (!doc || doc.mimeType === 'application/pdf') continue;
    api
      .blob(`/api/admin/drivers/${data.user.id}/documents/${doc.type}/file`)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        blobUrls.push(url);
        button.innerHTML = `<img src="${url}" alt="">`;
      })
      .catch(() => {
        button.textContent = 'Imeshindwa kupakia';
      });
  }

  bindDecision(data);
  driverOnPage = ['APPROVED', 'SUSPENDED'].includes(driver.status) ? data.user.id : null;
  if (driverOnPage) subsAdmin.loadDriverPanel(driverOnPage);
}

function decisionPanel(driver, docs) {
  if (driver.status === 'PENDING') {
    return `<section class="decision" aria-labelledby="decision-title">
      <h2 id="decision-title">Uamuzi</h2>
      <p class="muted">Angalia nyaraka zote. Ukithibitisha, dereva ataweza kupokea safari zikianza.</p>
      <div class="actions">
        <button class="btn btn-primary" type="button" data-action="approve">Thibitisha dereva</button>
        <button class="btn btn-danger" type="button" data-action="show-reject">Kataa</button>
      </div>
      <form class="reject-form" id="reject-form" hidden>
        <label for="reject-reason">Sababu (dereva ataiona)</label>
        <textarea id="reject-reason" maxlength="500" placeholder="Mf. Picha ya leseni haisomeki, piga picha upya mahali penye mwanga"></textarea>
        <p class="muted small" style="margin-top:12px">Nyaraka zipi abadilishe?</p>
        ${DOCUMENT_ORDER.filter((t) => docs.has(t))
          .map((t) => `<label class="check"><input type="checkbox" name="docs" value="${t}"> ${esc(DOCUMENTS[t].label)}</label>`)
          .join('')}
        <div class="actions"><button class="btn btn-danger" type="submit">Tuma kukataa</button></div>
      </form>
      <p class="alert alert-danger" id="decision-error" role="alert" hidden></p>
    </section>`;
  }
  if (driver.status === 'APPROVED') {
    return `<section class="decision">
      <h2>Simamisha dereva</h2>
      <p class="muted">Dereva aliyesimamishwa hataweza kupokea safari mpaka arudishwe.</p>
      <form class="reject-form" id="suspend-form">
        <label for="suspend-reason">Sababu</label>
        <textarea id="suspend-reason" maxlength="500"></textarea>
        <div class="actions"><button class="btn btn-danger" type="submit">Simamisha</button></div>
      </form>
      <p class="alert alert-danger" id="decision-error" role="alert" hidden></p>
    </section>`;
  }
  if (driver.status === 'SUSPENDED') {
    return `<section class="decision">
      <h2>Rudisha kazini</h2>
      <div class="actions"><button class="btn btn-primary" type="button" data-action="reinstate">Rudisha dereva kazini</button></div>
      <p class="alert alert-danger" id="decision-error" role="alert" hidden></p>
    </section>`;
  }
  return `<section class="decision"><p class="muted" style="margin:0">${
    driver.status === 'REJECTED'
      ? 'Dereva anarekebisha taarifa zake. Akituma tena, utaweza kuamua.'
      : 'Dereva bado hajamaliza kujaza taarifa na kutuma nyaraka zake.'
  }</p></section>`;
}

function bindDecision(data) {
  const id = data.user.id;
  const run = async (button, work) => {
    $('decision-error').hidden = true;
    button.disabled = true;
    try {
      renderDriver(await work());
      loadPendingCount();
    } catch (err) {
      if (handleAuthError(err)) return;
      showError('decision-error', err);
      button.disabled = false;
    }
  };

  document.querySelector('[data-action="approve"]')?.addEventListener('click', (e) =>
    run(e.currentTarget, () => api.post(`/api/admin/drivers/${id}/approve`)),
  );
  document.querySelector('[data-action="reinstate"]')?.addEventListener('click', (e) =>
    run(e.currentTarget, () => api.post(`/api/admin/drivers/${id}/reinstate`)),
  );
  document.querySelector('[data-action="show-reject"]')?.addEventListener('click', () => {
    $('reject-form').hidden = false;
    $('reject-reason').focus();
  });
  $('reject-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const documents = [...e.currentTarget.querySelectorAll('input[name="docs"]:checked')].map((c) => c.value);
    run(e.submitter, () => api.post(`/api/admin/drivers/${id}/reject`, { reason: $('reject-reason').value, documents }));
  });
  $('suspend-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    run(e.submitter, () => api.post(`/api/admin/drivers/${id}/suspend`, { reason: $('suspend-reason').value }));
  });

  for (const button of document.querySelectorAll('.doc-thumb[data-doc]')) {
    button.addEventListener('click', () => openDocument(id, button.dataset.doc));
  }
}

async function openDocument(driverId, type) {
  const dialog = $('doc-viewer');
  $('doc-viewer-title').textContent = DOCUMENTS[type].label;
  $('doc-viewer-body').innerHTML = '<p style="color:#fff;padding:40px">Inapakia…</p>';
  dialog.showModal();
  try {
    const blob = await api.blob(`/api/admin/drivers/${driverId}/documents/${type}/file`);
    const url = URL.createObjectURL(blob);
    blobUrls.push(url);
    $('doc-viewer-body').innerHTML =
      blob.type === 'application/pdf' ? `<iframe src="${url}" title="${esc(DOCUMENTS[type].label)}"></iframe>` : `<img src="${url}" alt="${esc(DOCUMENTS[type].label)}">`;
  } catch (err) {
    $('doc-viewer-body').innerHTML = `<p style="color:#fff;padding:40px">${esc(err.message)}</p>`;
  }
}
$('doc-viewer').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === e.currentTarget) $('doc-viewer').close();
});

async function loadPendingCount() {
  try {
    const data = await api.get('/api/admin/dashboard');
    setPendingBadge(data.drivers.PENDING);
    $('nav-active').textContent = data.rides.active;
    $('nav-active').hidden = !data.rides.active;
    safetyAdmin.setOpenCount(data.sosOpen);
  } catch {
    // si muhimu
  }
}

// ---------- Kutoka ----------
async function logout() {
  try {
    await api.post('/api/auth/logout');
  } catch {
    // hata server isipofikika, toka kwenye kifaa hiki
  }
  signOutLocally();
}

function signOutLocally() {
  realtime?.close();
  realtime = null;
  me = null;
  api.setToken(null);
  releaseBlobs();
  showLogin();
}

$('logout-button').addEventListener('click', logout);
$('offline-logout').addEventListener('click', signOutLocally);
$('retry-button').addEventListener('click', start);

// Takwimu zinasasishwa kila sekunde 30 ukiwa kwenye muhtasari.
setInterval(() => {
  if (me && !$('page-overview').hidden && document.visibilityState === 'visible') loadOverview();
}, 30_000);

// ---------- Mwanzo ----------
async function start() {
  if (!api.token) return showLogin();
  show('view-loading');
  try {
    const user = await api.get('/api/auth/me');
    if (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN') return signOutLocally();
    enterApp(user);
  } catch (err) {
    if (err.status === 401 || err.status === 403) return signOutLocally();
    $('offline-reason').textContent = err.message;
    show('view-offline');
  }
}

places.setup({ api, onAuthError: handleAuthError });
ridesAdmin.setup({ api, onAuthError: handleAuthError });
subsAdmin.setup({ api, onAuthError: handleAuthError });
safetyAdmin.setup({ api, onAuthError: handleAuthError });
start();
