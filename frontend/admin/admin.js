// Dashboard ya ofisi ya NAYA: login → muhtasari. Session inahifadhiwa; refresh haikutoi isipokuwa
// API imekataa token (401/403). Server ikiwa haipatikani, unaona "Jaribu tena" na session inabaki.
import { createApi, fetchHealth } from '/shared/api.js';

const api = createApi('naya_admin_token');
const $ = (id) => document.getElementById(id);
const views = ['view-loading', 'view-login', 'view-offline', 'view-dashboard'];

function show(view) {
  for (const v of views) $(v).hidden = v !== view;
}

function setDot(id, state) {
  $(id).className = `dot dot-${state}`;
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
  const error = $('login-error');
  error.hidden = true;
  button.disabled = true;
  button.textContent = 'Inaingia…';
  try {
    const result = await api.post('/api/auth/login', {
      phone: $('phone').value,
      password: $('password').value,
      portal: 'admin',
    });
    api.setToken(result.token);
    $('password').value = '';
    await showDashboard(result.user);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = 'Ingia';
  }
});

// ---------- Dashboard ----------
function greetingFor(date) {
  const h = date.getHours();
  if (h < 12) return 'Habari za asubuhi';
  if (h < 16) return 'Habari za mchana';
  return 'Habari za jioni';
}

async function showDashboard(user) {
  show('view-dashboard');
  const firstName = user.fullName.split(' ')[0];
  $('me-name').textContent = user.fullName;
  $('greeting').textContent = `${greetingFor(new Date())}, ${firstName}`;
  $('today').textContent = new Date().toLocaleDateString('sw-TZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  await loadDashboard();
}

async function loadDashboard() {
  const error = $('dashboard-error');
  try {
    const data = await api.get('/api/admin/dashboard');
    error.hidden = true;
    $('stat-customers').textContent = data.users.customers.toLocaleString('sw-TZ');
    $('stat-drivers').textContent = data.users.drivers.toLocaleString('sw-TZ');
    $('stat-new').textContent = data.users.newToday.toLocaleString('sw-TZ');
    $('stat-admins').textContent = data.users.admins.toLocaleString('sw-TZ');
    setDot('sys-api', 'ok');
    setDot('sys-db', data.system.database === 'ok' ? 'ok' : 'bad');
    $('sys-version').textContent = `NAYA ${data.system.version} · ${data.system.phase}`;
  } catch (err) {
    if (err.status === 401 || err.status === 403) return signOutLocally();
    error.textContent = err.message;
    error.hidden = false;
    setDot('sys-api', err.status === 0 ? 'bad' : 'ok');
    setDot('sys-db', 'wait');
  }
}

async function logout() {
  try {
    await api.post('/api/auth/logout');
  } catch {
    // hata server isipofikika, toka kwenye kifaa hiki
  }
  signOutLocally();
}

function signOutLocally() {
  api.setToken(null);
  showLogin();
}

$('logout-button').addEventListener('click', logout);
$('offline-logout').addEventListener('click', signOutLocally);
$('retry-button').addEventListener('click', start);

// Takwimu zinasasishwa kila sekunde 30 ukiwa kwenye dashboard.
setInterval(() => {
  if (!$('view-dashboard').hidden && document.visibilityState === 'visible') loadDashboard();
}, 30_000);

// ---------- Mwanzo ----------
async function start() {
  if (!api.token) return showLogin();
  show('view-loading');
  try {
    const me = await api.get('/api/auth/me');
    if (me.role !== 'ADMIN' && me.role !== 'SUPER_ADMIN') return signOutLocally();
    await showDashboard(me);
  } catch (err) {
    if (err.status === 401 || err.status === 403) return signOutLocally();
    $('offline-reason').textContent = err.message;
    show('view-offline');
  }
}

start();
