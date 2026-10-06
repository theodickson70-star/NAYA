// App moja ya NAYA: akaunti moja → "Utatumiaje NAYA?" → mode ya Abiria au Dereva → Akaunti → Badili mode.
import { createApi, escapeHtml as esc } from '/shared/api.js';
import { DOCUMENT_ORDER, DOCUMENT_STATUS, DOCUMENTS, DRIVER_STATUS, formatDate, formatPhone, VEHICLE_TYPES } from '/shared/labels.js';

const api = createApi('naya_app_token');
const $ = (id) => document.getElementById(id);
const views = ['view-loading', 'view-auth', 'view-role', 'view-offline', 'view-app'];
const MAX_BYTES = 3 * 1024 * 1024;
const VERSION = '0.4.0';

let account = null; // { user, activeMode, driverStatus, canDrive }
let driver = null; // wasifu wa udereva (mode ya Dereva)
let tab = 'home';
let editingVehicle = false;
let uploadingType = null;
let pendingUploadType = null;
const thumbs = new Map();

// Akaunti ya zamani ya app ya dereva: mtu asilazimike kuingia upya.
try {
  const legacy = localStorage.getItem('naya_driver_token');
  if (legacy && !api.token) api.setToken(legacy);
  localStorage.removeItem('naya_driver_token');
} catch {
  // storage imezuiwa
}

function show(view) {
  for (const v of views) $(v).hidden = v !== view;
}

function toast(message) {
  for (const old of document.querySelectorAll('.toast')) old.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

/** Kosa la mtandao/server → ujumbe rafiki; token imekataliwa → rudi kwenye kuingia. */
function handleError(err, boxId) {
  if (err.status === 401) return signOutLocally(), true;
  const box = boxId && $(boxId);
  if (box) {
    box.textContent = err.message;
    box.hidden = false;
  }
  return false;
}

// ---------- Kuingia / kujisajili ----------
function selectTab(name) {
  const register = name === 'register';
  $('tab-register').setAttribute('aria-selected', String(register));
  $('tab-login').setAttribute('aria-selected', String(!register));
  $('register-form').hidden = !register;
  $('login-form').hidden = register;
}
$('tab-register').addEventListener('click', () => selectTab('register'));
$('tab-login').addEventListener('click', () => selectTab('login'));

async function submitAuth(event, work, errorId) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const label = button.textContent;
  $(errorId).hidden = true;
  button.disabled = true;
  button.textContent = 'Subiri…';
  try {
    const result = await work();
    api.setToken(result.token);
    await loadAccount();
  } catch (err) {
    $(errorId).textContent = err.message;
    $(errorId).hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

$('register-form').addEventListener('submit', (e) =>
  submitAuth(
    e,
    () => api.post('/api/auth/register', { fullName: $('reg-name').value, phone: $('reg-phone').value, password: $('reg-password').value }),
    'register-error',
  ),
);
$('login-form').addEventListener('submit', (e) =>
  submitAuth(
    e,
    () => api.post('/api/auth/login', { phone: $('login-phone').value, password: $('login-password').value, portal: 'app' }),
    'login-error',
  ),
);

// ---------- Akaunti na mode ----------
async function loadAccount() {
  account = await api.get('/api/account');
  if (!account.activeMode) return showRoleChoice();
  show('view-app');
  route();
}

function showRoleChoice() {
  show('view-role');
  $('role-form').reset();
  $('role-continue').disabled = true;
  $('role-error').hidden = true;
}

$('role-form').addEventListener('change', () => {
  $('role-continue').disabled = !$('role-form').querySelector('input[name="mode"]:checked');
});

$('role-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const mode = $('role-form').querySelector('input[name="mode"]:checked')?.value;
  if (!mode) return;
  const button = $('role-continue');
  button.disabled = true;
  button.textContent = 'Subiri…';
  try {
    await switchMode(mode, { goHome: true });
  } catch (err) {
    handleError(err, 'role-error');
    button.disabled = false;
  } finally {
    button.textContent = 'Endelea';
  }
});

async function switchMode(mode, { goHome } = {}) {
  account = await api.put('/api/account/mode', { mode });
  driver = null;
  editingVehicle = false;
  show('view-app');
  if (goHome && location.hash !== '#/') location.hash = '#/';
  else route();
}

// ---------- Njia (tabs) ----------
function route() {
  if (!account) return;
  tab = location.hash.startsWith('#/akaunti') ? 'account' : 'home';
  for (const a of document.querySelectorAll('[data-tab]')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const driverMode = account.activeMode === 'DRIVER';
  document.querySelector('.bar').classList.toggle('driver', driverMode);
  $('bar-icon').src = driverMode ? '/shared/brand/naya-dereva-icon.svg' : '/shared/brand/naya-icon.svg';
  $('mode-chip').textContent = driverMode ? 'Dereva' : 'Abiria';
  document.querySelector('meta[name="theme-color"]').content = driverMode ? '#06502F' : '#0A6E47';
  window.scrollTo(0, 0);
  if (tab === 'account') return renderAccount();
  if (driverMode) return loadDriver();
  renderPassengerHome();
}
window.addEventListener('hashchange', route);

const firstName = () => esc(account.user.fullName.split(' ')[0]);

// ---------- Mode ya Abiria ----------
function renderPassengerHome() {
  const ds = account.driverStatus;
  $('app-content').innerHTML = `
    <h1>Habari, ${firstName()}</h1>
    <section class="card" aria-labelledby="where-title">
      <h2 id="where-title">Unaenda wapi?</h2>
      <div class="where" aria-disabled="true">
        <span class="icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg></span>
        Weka unakoenda
      </div>
      <span class="badge badge-warn soon">Inakuja hivi karibuni</span>
      <p class="muted">Kuagiza bodaboda na bajaji kupitia NAYA kunaanza hivi karibuni Urambo. Utaanza kuagiza hapa hapa.</p>
    </section>
    <section class="card">
      <h2>Safari zako</h2>
      <p class="empty-state">Bado hujasafiri na NAYA.</p>
    </section>
    ${
      ds
        ? `<section class="card">
            <h2>Udereva wako</h2>
            <p>${statusBadge(ds)}</p>
            <button class="link-btn" type="button" data-action="to-driver">Fungua mode ya Dereva</button>
          </section>`
        : `<section class="card">
            <h2>Una bodaboda au bajaji?</h2>
            <p class="muted">Endesha na NAYA kwa akaunti hii hii. Pakia nyaraka zako, ofisi ikuthibitishe.</p>
            <button class="btn btn-ghost btn-block" type="button" data-action="to-driver">Kuwa dereva</button>
          </section>`
    }`;
}

function statusBadge(status) {
  const s = DRIVER_STATUS[status];
  const label = { INCOMPLETE: 'Hujamaliza usajili', PENDING: 'Inasubiri uthibitisho', APPROVED: 'Umethibitishwa', REJECTED: 'Rekebisha taarifa', SUSPENDED: 'Umesimamishwa' }[status];
  return `<span class="badge badge-${s.tone}">${esc(label)}</span>`;
}

// ---------- Akaunti ----------
function renderAccount() {
  const { user, activeMode, driverStatus } = account;
  const driverMode = activeMode === 'DRIVER';
  const initials = user.fullName.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const target = driverMode ? 'PASSENGER' : 'DRIVER';
  $('app-content').innerHTML = `
    <h1>Akaunti</h1>
    <section class="card profile">
      <span class="avatar" aria-hidden="true">${esc(initials)}</span>
      <span><strong>${esc(user.fullName)}</strong><span class="muted">${esc(formatPhone(user.phone))}</span></span>
    </section>

    <section class="card" aria-labelledby="mode-title">
      <h2 id="mode-title">Badili mode</h2>
      <div class="mode-row">
        <span><span class="muted">Mode ya sasa</span><br><span class="mode-now">${driverMode ? 'Dereva' : 'Abiria'}</span></span>
        ${driverStatus ? statusBadge(driverStatus) : ''}
      </div>
      <p class="alert alert-danger" id="switch-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="button" data-switch="${target}">${
        driverMode ? 'Badili kwenda Abiria' : driverStatus ? 'Badili kwenda Dereva' : 'Kuwa dereva wa NAYA'
      }</button>
      <p class="muted small" style="margin-top:10px">${
        !driverMode && !driverStatus
          ? 'Utafungua ombi la udereva kwa akaunti hii hii — hakuna akaunti mpya.'
          : 'Ni akaunti ile ile; unaweza kubadili wakati wowote.'
      }</p>
    </section>

    <button class="btn btn-ghost btn-out" type="button" data-action="logout">Toka</button>
    <p class="version">NAYA ${VERSION} · TWENDE PAMOJA</p>`;
}

// ---------- Mode ya Dereva ----------
async function loadDriver() {
  if (!driver) $('app-content').innerHTML = '<p class="muted">Inapakia…</p>';
  try {
    driver = await api.get('/api/drivers/me');
    account.driverStatus = driver.driver.status;
    renderDriver();
  } catch (err) {
    if (handleError(err)) return;
    $('app-content').innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>
      <button class="btn btn-primary btn-block" type="button" data-action="refresh">Jaribu tena</button>`;
  }
}

function renderDriver() {
  if (tab !== 'home' || account.activeMode !== 'DRIVER') return;
  const status = driver.driver.status;
  if (status === 'PENDING') return renderDriverStatus('wait');
  if (status === 'APPROVED') return renderDriverStatus('ok');
  if (status === 'SUSPENDED') return renderDriverStatus('bad');
  renderOnboarding();
}

const ICONS = {
  wait: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  bad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
};

const vehicleLine = (d) => [VEHICLE_TYPES[d.vehicleType], d.plateNumber].filter(Boolean).join(' · ');

function recap() {
  const d = driver.driver;
  return `<section class="recap">
    <h2>Taarifa zako</h2>
    <dl>
      <dt>Chombo</dt><dd>${esc(vehicleLine(d))}</dd>
      <dt>Aina</dt><dd>${esc([d.vehicleMake, d.vehicleModel].filter(Boolean).join(' '))}</dd>
      <dt>Rangi</dt><dd>${esc(d.vehicleColor ?? '–')}</dd>
      <dt>Leseni</dt><dd>${esc(d.licenseNumber ?? '–')}</dd>
      <dt>Nyaraka</dt><dd>${driver.documents.length} zimepakiwa</dd>
    </dl>
  </section>`;
}

function renderDriverStatus(kind) {
  const d = driver.driver;
  const content = {
    wait: `<h1>Tumepokea taarifa zako</h1>
      <p class="muted">Ofisi ya NAYA inakagua nyaraka zako. Utaona majibu hapa — rudi baadaye.</p>
      <p class="muted small">Ulituma ${esc(formatDate(d.submittedAt, true))}</p>
      <button class="btn btn-ghost" type="button" data-action="refresh">Angalia tena</button>`,
    ok: `<h1>Umethibitishwa, ${firstName()}!</h1>
      <p class="muted">Karibu NAYA. Kupokea maombi ya safari kutaanza hivi karibuni hapa hapa kwenye mode ya Dereva.</p>`,
    bad: `<h1>Udereva wako umesimamishwa</h1>
      ${d.rejectionReason ? `<p><strong>Sababu:</strong> ${esc(d.rejectionReason)}</p>` : ''}
      <p class="muted">Wasiliana na ofisi ya NAYA kwa maelezo zaidi. Bado unaweza kusafiri kama abiria.</p>`,
  }[kind];
  $('app-content').innerHTML = `<section class="status-card">
      <div class="status-mark mark-${kind}">${ICONS[kind]}</div>
      ${content}
    </section>${recap()}`;
}

function renderOnboarding() {
  const { driver: d, requirements: req } = driver;
  const docs = new Map(driver.documents.map((doc) => [doc.type, doc]));
  const step1Done = req.vehicleComplete;
  const step2Done = req.missingDocuments.length === 0 && req.rejectedDocuments.length === 0;
  const current = !step1Done ? 1 : !step2Done ? 2 : 3;
  const stepClass = (n, done) => `step${done ? ' done' : ''}${current === n ? ' current' : ''}`;
  const showForm = !step1Done || editingVehicle;

  $('app-content').innerHTML = `
    ${d.status === 'REJECTED' ? `<p class="alert alert-warn" role="alert"><strong>Ofisi imeomba urekebishe:</strong> ${esc(d.rejectionReason ?? '')}</p>` : ''}
    <h1>Kuwa dereva wa NAYA</h1>
    <p class="lead">${d.status === 'REJECTED' ? 'Rekebisha kilichoombwa, kisha tuma tena.' : 'Kamilisha hatua hizi tatu ili ofisi ikuthibitishe.'}</p>

    <ol class="steps">
      <li class="${stepClass(1, step1Done)}">
        <div class="step-head"><span class="step-num">1</span><h2>Chombo chako</h2>${step1Done && !editingVehicle ? '<span class="badge badge-ok">Tayari</span>' : ''}</div>
        <div class="step-body">${showForm ? vehicleForm(d) : vehicleSummary(d)}</div>
      </li>
      <li class="${stepClass(2, step2Done)}">
        <div class="step-head"><span class="step-num">2</span><h2>Nyaraka</h2>${step2Done ? '<span class="badge badge-ok">Tayari</span>' : ''}</div>
        <div class="step-body">
          <ul class="docs">${DOCUMENT_ORDER.map((type) => documentRow(type, docs.get(type), req.requiredDocuments.includes(type))).join('')}</ul>
        </div>
      </li>
      <li class="${stepClass(3, false)}">
        <div class="step-head"><span class="step-num">3</span><h2>Tuma kwa uthibitisho</h2></div>
        <div class="step-body">
          ${
            req.canSubmit
              ? '<p class="muted" style="margin:0">Kila kitu kiko tayari. Ofisi ya NAYA itakagua na kukujibu hapa.</p>'
              : `<ul class="todo">${[
                  !step1Done ? '<li>Jaza taarifa za chombo</li>' : '',
                  ...req.missingDocuments.map((t) => `<li>Pakia: ${esc(DOCUMENTS[t].label)}</li>`),
                  ...req.rejectedDocuments.map((t) => `<li>Badilisha: ${esc(DOCUMENTS[t].label)}</li>`),
                ].join('')}</ul>`
          }
          <p class="alert alert-danger" id="submit-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="button" data-action="submit" ${req.canSubmit ? '' : 'disabled'}>Tuma kwa uthibitisho</button>
        </div>
      </li>
    </ol>`;

  if (showForm) bindVehicleForm();
  loadThumbs(docs);
}

function vehicleSummary(d) {
  return `<p class="summary">${esc(vehicleLine(d))}</p>
    <p class="muted">${esc([d.vehicleMake, d.vehicleModel, d.vehicleColor].filter(Boolean).join(', '))} · Leseni ${esc(d.licenseNumber)}</p>
    <button class="link-btn" type="button" data-action="edit-vehicle">Badilisha</button>`;
}

function vehicleForm(d) {
  const v = (x) => esc(x ?? '');
  const type = d.vehicleType ?? 'BODABODA';
  return `<form id="vehicle-form" novalidate>
    <fieldset class="choice">
      <legend>Aina ya chombo</legend>
      <label><input type="radio" name="vehicleType" value="BODABODA" ${type === 'BODABODA' ? 'checked' : ''}><span>Bodaboda</span></label>
      <label><input type="radio" name="vehicleType" value="BAJAJI" ${type === 'BAJAJI' ? 'checked' : ''}><span>Bajaji</span></label>
    </fieldset>
    <label for="v-plate">Namba ya plate</label>
    <input id="v-plate" name="plateNumber" value="${v(d.plateNumber)}" placeholder="MC 123 ABC" autocapitalize="characters" required>
    <label for="v-make">Kampuni / aina</label>
    <input id="v-make" name="vehicleMake" value="${v(d.vehicleMake)}" placeholder="Mf. Boxer, TVS, Bajaj" required>
    <label for="v-model">Modeli <span class="optional">(si lazima)</span></label>
    <input id="v-model" name="vehicleModel" value="${v(d.vehicleModel)}" placeholder="Mf. BM 150">
    <label for="v-color">Rangi</label>
    <input id="v-color" name="vehicleColor" value="${v(d.vehicleColor)}" placeholder="Mf. Nyekundu" required>
    <label for="v-license">Namba ya leseni ya udereva</label>
    <input id="v-license" name="licenseNumber" value="${v(d.licenseNumber)}" autocapitalize="characters" required>
    <label for="v-nida">Namba ya NIDA <span class="optional">(si lazima)</span></label>
    <input id="v-nida" name="nationalIdNumber" value="${v(d.nationalIdNumber)}" inputmode="numeric" placeholder="Tarakimu 20">
    <p class="alert alert-danger" id="vehicle-error" role="alert" hidden></p>
    <button class="btn btn-primary btn-block" type="submit">Hifadhi chombo</button>
  </form>`;
}

function bindVehicleForm() {
  $('vehicle-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    $('vehicle-error').hidden = true;
    button.disabled = true;
    button.textContent = 'Inahifadhi…';
    try {
      driver = await api.put('/api/drivers/me/vehicle', Object.fromEntries(new FormData(form)));
      editingVehicle = false;
      renderDriver();
      toast('Chombo kimehifadhiwa');
    } catch (err) {
      handleError(err, 'vehicle-error');
      button.disabled = false;
      button.textContent = 'Hifadhi chombo';
    }
  });
}

function documentRow(type, doc, required) {
  const info = DOCUMENTS[type];
  const rejected = doc?.status === 'REJECTED';
  const busy = uploadingType === type;
  return `<li class="doc${rejected ? ' rejected' : ''}">
    <div class="doc-thumb${doc ? ' has-file' : ''}" data-thumb="${type}">${doc ? (doc.mimeType === 'application/pdf' ? 'PDF' : '') : 'Bado'}</div>
    <div>
      <div class="doc-title"><strong>${esc(info.label)}${required ? '' : ' <span class="optional">(si lazima)</span>'}</strong>${
        doc ? `<span class="badge badge-${DOCUMENT_STATUS[doc.status].tone}">${esc(DOCUMENT_STATUS[doc.status].label)}</span>` : ''
      }</div>
      <p class="doc-hint">${esc(info.hint)}</p>
      ${rejected && doc.reviewNote ? `<p class="doc-note">${esc(doc.reviewNote)}</p>` : ''}
      <p class="alert alert-danger" id="doc-error-${type}" role="alert" hidden></p>
      <button class="btn ${doc && !rejected ? 'btn-ghost' : 'btn-primary'}" type="button" data-upload="${type}" ${busy ? 'disabled' : ''}>${
        busy ? 'Inapakia…' : doc ? 'Badilisha picha' : 'Pakia picha'
      }</button>
    </div>
  </li>`;
}

function loadThumbs(docs) {
  for (const [type, doc] of docs) {
    if (doc.mimeType === 'application/pdf') continue;
    const key = doc.uploadedAt;
    const cached = thumbs.get(type);
    const place = (url) => {
      const el = document.querySelector(`[data-thumb="${type}"]`);
      if (el) el.innerHTML = `<img src="${url}" alt="">`;
    };
    if (cached?.key === key) {
      place(cached.url);
      continue;
    }
    api
      .blob(`/api/drivers/me/documents/${type}/file`)
      .then((blob) => {
        if (cached) URL.revokeObjectURL(cached.url);
        const url = URL.createObjectURL(blob);
        thumbs.set(type, { key, url });
        place(url);
      })
      .catch(() => {});
  }
}

/** Picha za simu ni kubwa: tunazipunguza hadi upande mrefu = 1600px, JPEG — kawaida KB 200–400. */
async function prepareFile(file) {
  if (file.type === 'application/pdf') {
    if (file.size > MAX_BYTES) throw new Error('PDF ni kubwa mno (mwisho MB 3). Piga picha ya nyaraka badala yake.');
    return file;
  }
  if (!file.type.startsWith('image/')) throw new Error('Chagua picha au PDF.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Picha hii haifunguki. Jaribu picha nyingine (JPG au PNG).');
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  for (const quality of [0.82, 0.7, 0.55]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  throw new Error('Picha ni kubwa mno. Jaribu kupiga picha upya.');
}

$('file-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  const type = pendingUploadType;
  pendingUploadType = null;
  if (!file || !type) return;
  uploadingType = type;
  renderDriver();
  try {
    const prepared = await prepareFile(file);
    driver = await api.upload(`/api/drivers/me/documents/${type}`, prepared);
    uploadingType = null;
    renderDriver();
    toast(`${DOCUMENTS[type].label}: imepakiwa`);
  } catch (err) {
    uploadingType = null;
    if (err.status === 401) return signOutLocally();
    if (err.status === 403) return loadDriver();
    renderDriver();
    handleError(err, `doc-error-${type}`);
  }
});

// ---------- Vitufe ----------
$('app-content').addEventListener('click', async (event) => {
  const upload = event.target.closest('[data-upload]');
  if (upload) {
    pendingUploadType = upload.dataset.upload;
    $('file-input').click();
    return;
  }
  const switchTo = event.target.closest('[data-switch]');
  if (switchTo) {
    switchTo.disabled = true;
    try {
      await switchMode(switchTo.dataset.switch, { goHome: true });
      toast(switchTo.dataset.switch === 'DRIVER' ? 'Uko kwenye mode ya Dereva' : 'Uko kwenye mode ya Abiria');
    } catch (err) {
      handleError(err, 'switch-error');
      switchTo.disabled = false;
    }
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'refresh') return loadDriver();
  if (action === 'to-driver') {
    return switchMode('DRIVER', { goHome: true })
      .then(() => toast('Uko kwenye mode ya Dereva'))
      .catch((err) => handleError(err));
  }
  if (action === 'logout') return logout();
  if (action === 'edit-vehicle') {
    editingVehicle = true;
    return renderDriver();
  }
  if (action === 'submit') {
    const button = event.target.closest('[data-action]');
    button.disabled = true;
    button.textContent = 'Inatuma…';
    try {
      driver = await api.post('/api/drivers/me/submit');
      account.driverStatus = driver.driver.status;
      renderDriver();
      window.scrollTo(0, 0);
    } catch (err) {
      handleError(err, 'submit-error');
      button.disabled = false;
      button.textContent = 'Tuma kwa uthibitisho';
    }
  }
});

// Ukisubiri uthibitisho, hali inaangaliwa tena kila dakika moja.
setInterval(() => {
  if (account?.activeMode === 'DRIVER' && tab === 'home' && driver?.driver.status === 'PENDING' && document.visibilityState === 'visible') {
    loadDriver();
  }
}, 60_000);

// ---------- Kutoka ----------
async function logout() {
  try {
    await api.post('/api/auth/logout');
  } catch {
    // toka kwenye kifaa hiki hata server isipofikika
  }
  signOutLocally();
}

function signOutLocally() {
  account = null;
  driver = null;
  editingVehicle = false;
  api.setToken(null);
  for (const { url } of thumbs.values()) URL.revokeObjectURL(url);
  thumbs.clear();
  if (location.hash) history.replaceState(null, '', location.pathname);
  show('view-auth');
}

$('retry-button').addEventListener('click', start);

// ---------- Mwanzo ----------
async function start() {
  if (!api.token) return show('view-auth');
  show('view-loading');
  try {
    await loadAccount();
  } catch (err) {
    // 403 = akaunti ya ofisi au iliyosimamishwa → kuingia upya
    if (err.status === 401 || err.status === 403) return signOutLocally();
    $('offline-reason').textContent = err.status === 0 ? 'Internet haipo. Tafadhali hakikisha umeunganishwa.' : err.message;
    show('view-offline');
  }
}

start();
