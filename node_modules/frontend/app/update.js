// "Sasisha" ndani ya app ya Android: kukiwa na toleo jipya la APK, kadi ndogo inaonekana juu.
//   APK mpya  → "Sasisha": app inapakua (asilimia inaonekana) kisha Android inafungua dirisha la "Install".
//   APK ya zamani → "Pakua toleo jipya": link inafunguka kwenye browser (mara ya mwisho kwa mkono).
// Kwenye browser ya kawaida hakuna kinachoonekana.
import { escapeHtml as esc } from '/shared/api.js';
import { installUpdate, installedVersionCode, isNativeApp, nativeInfo, updateStatus } from '/shared/native.js';

const LATER_KEY = 'naya_update_later';
const LATER_HOURS = 12;
let api = null;
let latest = null;
let info = null;
let poll = null;
let checking = false;

const store = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(LATER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  set(v) {
    try {
      localStorage.setItem(LATER_KEY, JSON.stringify(v));
    } catch {
      // si muhimu
    }
  },
};

function box() {
  let el = document.getElementById('app-update');
  if (!el) {
    el = document.createElement('section');
    el.id = 'app-update';
    el.className = 'app-update';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.hidden = true;
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
  }
  return el;
}

function hide() {
  clearInterval(poll);
  poll = null;
  const el = document.getElementById('app-update');
  if (el) el.hidden = true;
}

function render(view, extra = {}) {
  const el = box();
  const size = latest?.sizeMb ? ` (MB ${latest.sizeMb})` : '';
  const head = `<div class="app-update-text"><strong>Toleo jipya la NAYA</strong>`;
  if (view === 'offer') {
    el.innerHTML = `${head}<span>Lina maboresho mapya. Sasisha ukiwa huna safari inayoendelea${esc(size)}.</span></div>
      <div class="app-update-actions">
        <button class="btn btn-small app-update-go" type="button" data-update="go">Sasisha</button>
        <button class="btn btn-small app-update-later" type="button" data-update="later">Baadaye</button>
      </div>`;
  } else if (view === 'old') {
    el.innerHTML = `${head}<span>Pakua toleo jipya, kisha bonyeza Install. Baada ya hapo masasisho yatakuja ndani ya app.</span></div>
      <div class="app-update-actions">
        <a class="btn btn-small app-update-go" href="${esc(latest.page)}" data-update="old">Pakua toleo jipya</a>
        <button class="btn btn-small app-update-later" type="button" data-update="later">Baadaye</button>
      </div>`;
  } else if (view === 'permission') {
    el.innerHTML = `${head}<span>Ruhusu NAYA kusakinisha toleo jipya: washa "Ruhusu kutoka chanzo hiki" / "Allow from this source", kisha rudi hapa ubonyeze Sasisha.</span></div>
      <div class="app-update-actions">
        <button class="btn btn-small app-update-go" type="button" data-update="go">Sasisha</button>
        <button class="btn btn-small app-update-later" type="button" data-update="later">Baadaye</button>
      </div>`;
  } else if (view === 'downloading') {
    const p = Math.max(0, Math.min(100, extra.percent ?? 0));
    el.innerHTML = `${head}<span>Inapakua toleo jipya… ${p}%</span>
      <div class="app-update-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${p}%"></i></div></div>`;
  } else if (view === 'ready') {
    el.innerHTML = `${head}<span>Bonyeza Install kwenye dirisha la Android. Kama umelifunga, bonyeza Sakinisha.</span></div>
      <div class="app-update-actions">
        <button class="btn btn-small app-update-go" type="button" data-update="go">Sakinisha</button>
      </div>`;
  } else if (view === 'error') {
    el.innerHTML = `${head}<span>${esc(extra.error || 'Upakuaji umeshindwa')}</span></div>
      <div class="app-update-actions">
        <button class="btn btn-small app-update-go" type="button" data-update="go">Jaribu tena</button>
        <button class="btn btn-small app-update-later" type="button" data-update="later">Baadaye</button>
      </div>`;
  }
  el.dataset.view = view;
  el.hidden = false;
}

async function start() {
  try {
    const r = await installUpdate(new URL(latest.apk, location.href).href);
    if (r?.needsPermission) return render('permission');
    render(r?.state === 'ready' ? 'ready' : 'downloading', { percent: 0 });
    watch();
  } catch (err) {
    render('error', { error: err?.message });
  }
}

function watch() {
  clearInterval(poll);
  poll = setInterval(async () => {
    let st;
    try {
      st = await updateStatus();
    } catch {
      return;
    }
    if (st.state === 'downloading') render('downloading', { percent: st.percent });
    else if (st.state === 'ready') {
      clearInterval(poll);
      render('ready');
    } else if (st.state === 'error') {
      clearInterval(poll);
      render('error', { error: st.error });
    }
  }, 700);
}

function onClick(event) {
  const btn = event.target.closest('[data-update]');
  if (!btn) return;
  const what = btn.dataset.update;
  if (what === 'later') {
    store.set({ code: latest?.versionCode, until: Date.now() + LATER_HOURS * 3600_000 });
    hide();
  } else if (what === 'go') {
    start();
  }
  // 'old': link ya kawaida — app inaifungua kwenye browser na kupakua
}

/** Angalia kama kuna toleo jipya. Inaitwa app inapofunguka na ikirudi mbele. */
export async function checkForUpdate() {
  if (!api || !isNativeApp() || checking) return;
  if (poll) return; // inapakua sasa hivi
  checking = true;
  try {
    info = await nativeInfo();
    const have = installedVersionCode(info);
    latest = await api.get('/api/app/latest');
    if (!have || !latest?.versionCode || latest.versionCode <= have) return hide();
    const later = store.get();
    if (later && later.code === latest.versionCode && later.until > Date.now()) return;
    if (!info.updater) return render('old');
    // Upakuaji ulikuwa unaendelea (mf. ukurasa ulijipakia upya)?
    const st = await updateStatus().catch(() => null);
    if (st?.state === 'downloading') {
      render('downloading', { percent: st.percent });
      return watch();
    }
    if (st?.state === 'ready') return render('ready');
    const el = document.getElementById('app-update');
    if (el && !el.hidden && el.dataset.view === 'permission') {
      // Amerudi kutoka mipangilio: kama ameruhusu, endelea kupakua moja kwa moja
      if (info.canInstall) start();
      return;
    }
    render('offer');
  } catch {
    // hakuna mtandao — tutaangalia tena app ikirudi mbele
  } finally {
    checking = false;
  }
}

export function init(deps) {
  api = deps.api;
  checkForUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
}
