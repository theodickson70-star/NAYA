// Akaunti (0.15.0): ukurasa mkuu wenye menyu, na kurasa zake:
//   #/akaunti              menyu: picha + jina, Wasifu · Ofa · Shughuli · Usalama · Msaada · Mipangilio (+ udereva)
//   #/akaunti/wasifu       picha (dereva anaiona akipokea ombi), jina, simu, takwimu
//   #/akaunti/ofa          ofa zinazomfaa + alichookoa
//   #/akaunti/shughuli     safari zake + arifa
//   #/akaunti/usalama      mtu wa dharura, vipengele vya usalama, namba za dharura
//   #/akaunti/msaada       simu / WhatsApp / barua pepe, ripoti tatizo, maswali
//   (Mipangilio, Ada ya mwezi na Malipo ya ofa zinachorwa na app.js — zinatumia sehemu zake.)
import { escapeHtml as esc } from '/shared/api.js';
import { SUPPORT } from '/shared/contact.js';
import { formatDate, formatPhone, formatTsh, VEHICLE_TYPES } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, account(), setAccount(a), handleError, toast, offers(), supportCardHtml, loadSupportList, isDriverMode() }
let photoUrl = null; // { version, url } — picha ya mtumiaji (blob URL)
let profile = null; // GET /api/account/profile (cache ya ukurasa)
let activityTab = 'trips';

const ICON = {
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  gift: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h16v10H4z"/><path d="M3 7h18v4H3zM12 7v14"/><path d="M12 7c-1.5-3-5-3-5-.5S12 7 12 7zm0 0c1.5-3 5-3 5-.5S12 7 12 7z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
  help: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-1a8 8 0 0 1 16 0v1"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 1.5-2 2.5-5 2.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
  card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/></svg>',
  coins: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.7-2.7-3-6-3"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.5-4A8 8 0 1 1 9 19.5z"/><path d="M9 10.5c.5 2 2 3.5 4 4l1.5-1.2 2 1"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 7l8 6 8-6"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8"/></svg>',
  plate: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 12h2M11 12h2M15 12h2"/></svg>',
  helmet: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 15a9 9 0 0 1 18 0v2H3z"/><path d="M12 6v5M3 17h18"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="12" r="4"/><path d="M12 12h9M17 12v3M20 12v2"/></svg>',
};

export function init(context) {
  ctx = context;
  const root = $('app-content');
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  root.addEventListener('change', onChange);
}

/** Akaunti imebadilika (mf. mtu mwingine ameingia): sahau picha na wasifu wa zamani. */
export function reset() {
  if (photoUrl) URL.revokeObjectURL(photoUrl.url);
  photoUrl = null;
  profile = null;
  activityTab = 'trips';
}

const initials = (name) => esc(name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(''));
const back = (title, lead = '') => `<a class="back" href="#/akaunti">‹ Akaunti</a><h1 class="acct-title">${esc(title)}</h1>${lead ? `<p class="muted acct-lead">${lead}</p>` : ''}`;

// ------------------------------------------------------------------ picha ya mtumiaji

async function photoSrc() {
  const u = ctx.account().user;
  if (!u.hasPhoto) return null;
  if (photoUrl?.version === u.photoVersion) return photoUrl.url;
  const blob = await ctx.api.blob(`/api/account/photo?v=${u.photoVersion ?? 0}`);
  if (photoUrl) URL.revokeObjectURL(photoUrl.url);
  photoUrl = { version: u.photoVersion, url: URL.createObjectURL(blob) };
  return photoUrl.url;
}

/** Weka picha kwenye kila .acct-avatar iliyo kwenye skrini (au herufi za jina kama hakuna). */
async function paintAvatars() {
  try {
    const src = await photoSrc();
    if (!src) return;
    for (const el of document.querySelectorAll('[data-avatar]')) el.innerHTML = `<img src="${src}" alt="">`;
  } catch {
    // picha haikupatikana — herufi za jina zinabaki
  }
}

const avatarHtml = (cls = '') => `<span class="acct-avatar ${cls}" data-avatar aria-hidden="true">${initials(ctx.account().user.fullName)}</span>`;

// ------------------------------------------------------------------ menyu kuu

function row({ href, icon, title, sub, badge = '', id = '' }) {
  return `<a class="acct-row" href="${href}"${id ? ` id="${id}"` : ''}>
    <span class="acct-ico">${ICON[icon]}</span>
    <span class="acct-txt"><strong>${esc(title)}</strong><span class="muted" ${id ? `id="${id}-sub"` : ''}>${sub}</span></span>
    ${badge}<span class="acct-chev" aria-hidden="true">›</span>
  </a>`;
}

/** Menyu kuu ya Akaunti. modeCardHtml = kadi ya "Badili mode" (inatoka app.js). */
export function renderHub({ modeCardHtml, version }) {
  const a = ctx.account();
  const u = a.user;
  const driverMode = a.activeMode === 'DRIVER';
  const driverPaid = a.driverStatus === 'APPROVED' || a.driverStatus === 'SUSPENDED';
  const offers = ctx.offers();
  const offerSub = offers?.list?.length
    ? esc(offers.list[0].title)
    : 'Punguzo za NAYA kwa safari zako';
  $('app-content').innerHTML = `
    <section class="acct-head${driverMode ? ' is-driver' : ''}">
      <a class="acct-head-photo" href="#/akaunti/wasifu" aria-label="Badilisha picha na wasifu">
        ${avatarHtml('is-big')}
        <span class="acct-head-cam" aria-hidden="true">${ICON.camera}</span>
      </a>
      <div class="acct-head-who">
        <h1>${esc(u.fullName)}</h1>
        <p>${esc(formatPhone(u.phone))}</p>
        <p class="acct-head-meta" id="acct-meta"></p>
      </div>
    </section>
    ${u.hasPhoto ? '' : `<a class="card acct-nudge" href="#/akaunti/wasifu"><span class="acct-ico">${ICON.camera}</span><span><strong>Weka picha yako</strong><span class="muted">Dereva anaiona akipokea ombi lako — anakutambua haraka mahali pa kukuchukua.</span></span></a>`}
    <nav class="card acct-menu" aria-label="Akaunti">
      ${row({ href: '#/akaunti/wasifu', icon: 'user', title: 'Wasifu', sub: 'Picha, jina na namba yako' })}
      ${driverMode ? '' : row({ href: '#/akaunti/ofa', icon: 'gift', title: 'Ofa', sub: offerSub, badge: offers?.list?.length ? `<span class="acct-badge">−${offers.list[0].discountPercent}%</span>` : '', id: 'acct-ofa' })}
      ${row({ href: '#/akaunti/shughuli', icon: 'clock', title: 'Shughuli', sub: 'Safari zako na arifa' })}
    </nav>
    <nav class="card acct-menu" aria-label="Msaada na usalama">
      ${row({ href: '#/akaunti/usalama', icon: 'shield', title: 'Usalama', sub: a.emergency ? `Mtu wa dharura: ${esc(a.emergency.name || formatPhone(a.emergency.phone))}` : 'Weka mtu wa dharura' })}
      ${row({ href: '#/akaunti/msaada', icon: 'help', title: 'Msaada', sub: 'Piga simu, WhatsApp au ripoti tatizo', badge: a.supportUnread ? `<span class="acct-badge is-alert">${a.supportUnread} jipya</span>` : '' })}
      ${row({ href: '#/akaunti/mipangilio', icon: 'gear', title: 'Mipangilio', sub: 'Lugha, arifa, password na masharti' })}
    </nav>
    ${
      driverPaid
        ? `<nav class="card acct-menu" aria-label="Udereva">
            <h2 class="acct-menu-title">Udereva</h2>
            ${row({ href: '#/akaunti/ada', icon: 'card', title: 'Ada ya mwezi', sub: 'Hali ya ada na malipo yako' })}
            ${row({ href: '#/akaunti/malipo-ya-ofa', icon: 'coins', title: 'Malipo ya ofa', sub: 'NAYA inakudai kiasi gani, na namba zako' })}
          </nav>`
        : ''
    }
    ${modeCardHtml}
    <button class="btn btn-ghost btn-out" type="button" data-action="logout">Toka</button>
    <p class="version">NAYA ${esc(version)} · TWENDE PAMOJA</p>`;
  paintAvatars();
  loadHubMeta();
}

async function loadHubMeta() {
  try {
    profile = await ctx.api.get('/api/account/profile');
    const el = $('acct-meta');
    if (!el) return;
    const s = profile.stats;
    el.innerHTML = [
      s.rating ? `<span>★ ${s.rating}</span>` : '',
      `<span>Safari: ${s.trips.toLocaleString('en-US')}</span>`,
      `<span>Tangu ${esc(formatDate(profile.memberSince).replace(/^\d+\s/, ''))}</span>`,
    ]
      .filter(Boolean)
      .join('');
  } catch (err) {
    ctx.handleError(err);
  }
}

// ------------------------------------------------------------------ Wasifu

export async function renderProfile() {
  $('app-content').innerHTML = `${back('Wasifu')}<p class="muted">Inapakia…</p>`;
  try {
    profile = await ctx.api.get('/api/account/profile');
  } catch (err) {
    if (ctx.handleError(err)) return;
    $('app-content').innerHTML = `${back('Wasifu')}<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
    return;
  }
  const p = profile;
  const s = p.stats;
  $('app-content').innerHTML = `${back('Wasifu')}
    <section class="card wf-photo">
      <button class="wf-avatar-btn" type="button" data-acct="photo-pick" aria-label="${p.hasPhoto ? 'Badilisha picha' : 'Weka picha'}">
        ${avatarHtml('is-xl')}
        <span class="acct-head-cam" aria-hidden="true">${ICON.camera}</span>
      </button>
      <h2>${p.hasPhoto ? 'Picha yako' : 'Weka picha yako'}</h2>
      <p class="muted">Ukiagiza safari, dereva anaiona picha yako pamoja na jina lako la kwanza — anakutambua haraka mahali pa kukuchukua. Hakuna mtu mwingine anayeiona.</p>
      <p class="alert alert-danger" id="wf-photo-error" role="alert" hidden></p>
      <div class="actions${p.hasPhoto ? ' two' : ''}">
        <button class="btn btn-primary" type="button" data-acct="photo-pick" id="wf-pick">${ICON.camera} ${p.hasPhoto ? 'Badilisha picha' : 'Piga au chagua picha'}</button>
        ${p.hasPhoto ? '<button class="btn btn-ghost" type="button" data-acct="photo-remove">Ondoa picha</button>' : ''}
      </div>
      <input type="file" id="wf-file" accept="image/*" hidden>
    </section>

    <form class="card" id="wf-form" novalidate>
      <h2>Taarifa zako</h2>
      <label for="wf-name">Jina kamili</label>
      <input id="wf-name" autocomplete="name" maxlength="120" value="${esc(p.fullName)}"${p.canEditName ? '' : ' readonly aria-describedby="wf-name-note"'}>
      ${p.canEditName ? '' : '<p class="muted small" id="wf-name-note">Jina lako la udereva limethibitishwa na nyaraka zako. Kulibadilisha, wasiliana na <a href="#/akaunti/msaada">Msaada</a>.</p>'}
      <label for="wf-phone">Namba ya simu</label>
      <input id="wf-phone" value="${esc(formatPhone(p.phone))}" readonly aria-describedby="wf-phone-note">
      <p class="muted small" id="wf-phone-note">Namba yako ndiyo unayoingilia NAYA. Kuibadilisha, wasiliana na <a href="#/akaunti/msaada">Msaada</a>.</p>
      <p class="alert alert-danger" id="wf-error" role="alert" hidden></p>
      ${p.canEditName ? '<button class="btn btn-primary btn-block" type="submit">Hifadhi</button>' : ''}
    </form>

    <section class="card">
      <h2>Safari zako na NAYA</h2>
      <dl class="wf-stats">
        <div><dt>Safari zilizokamilika</dt><dd>${s.trips.toLocaleString('en-US')}</dd></div>
        <div><dt>Nyota kutoka kwa madereva</dt><dd>${s.rating ? `★ ${s.rating} <small>(${s.ratings})</small>` : '<small>Bado</small>'}</dd></div>
        <div><dt>Umeokoa kwa ofa</dt><dd>${formatTsh(s.saved)}</dd></div>
        <div><dt>Mwanachama tangu</dt><dd>${esc(formatDate(p.memberSince))}</dd></div>
      </dl>
    </section>`;
  paintAvatars();
}

/** Picha ya wasifu: mraba wa katikati, 640px, JPEG — kawaida KB 60–120. */
async function squarePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Chagua picha (JPG, PNG au WEBP).');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Picha hii haifunguki. Jaribu picha nyingine.');
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(640, side);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close?.();
  for (const quality of [0.85, 0.7, 0.55]) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 2_500_000) return blob;
  }
  throw new Error('Picha ni kubwa mno. Jaribu picha nyingine.');
}

async function uploadPhoto(file) {
  const err = $('wf-photo-error');
  if (err) err.hidden = true;
  const pick = $('wf-pick');
  if (pick) {
    pick.disabled = true;
    pick.textContent = 'Inapakia picha…';
  }
  try {
    profile = await ctx.api.upload('/api/account/photo', await squarePhoto(file));
    await refreshAccount();
    ctx.toast('Picha imehifadhiwa');
    renderProfile();
  } catch (e) {
    if (e.status === 401) return ctx.handleError(e);
    if (pick) {
      pick.disabled = false;
      pick.textContent = 'Jaribu tena';
    }
    if (err) {
      err.textContent = e.message;
      err.hidden = false;
    }
  }
}

async function refreshAccount() {
  ctx.setAccount(await ctx.api.get('/api/account'));
}

// ------------------------------------------------------------------ Ofa

export async function renderOffers() {
  $('app-content').innerHTML = `${back('Ofa', 'Punguzo la nauli kutoka NAYA. Unamlipa dereva kiasi kilichopunguzwa taslimu; NAYA inamlipa dereva kilichobaki.')}<p class="muted">Inapakia…</p>`;
  let r;
  try {
    r = await ctx.api.get('/api/offers?full=1');
    ctx.setOffers(r);
  } catch (err) {
    if (ctx.handleError(err)) return;
    $('app-content').innerHTML = `${back('Ofa')}<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
    return;
  }
  const until = (d) => new Date(d).toLocaleDateString('sw-TZ', { day: 'numeric', month: 'long' });
  const cards = (r.offers ?? [])
    .map(
      (o) => `<article class="promo-banner ofa-page-card">
        <span class="promo-pct" aria-hidden="true">−${o.discountPercent}%</span>
        <div class="promo-text">
          <h2>${esc(o.title)}</h2>
          ${o.description ? `<p>${esc(o.description)}</p>` : ''}
          <div class="promo-chips">
            ${o.maxDiscount ? `<span class="offer-chip">Hadi ${formatTsh(o.maxDiscount)} kwa safari</span>` : ''}
            ${o.ridesLeft !== null && o.ridesLeft !== undefined ? `<span class="offer-chip">Safari ${o.ridesLeft} zimebaki</span>` : ''}
            ${o.vehicleTypes?.length === 1 ? `<span class="offer-chip">${esc(VEHICLE_TYPES[o.vehicleTypes[0]])} tu</span>` : ''}
            ${o.endsAt ? `<span class="offer-chip">Hadi ${esc(until(o.endsAt))}</span>` : ''}
          </div>
        </div>
      </article>`,
    )
    .join('');
  const saved = r.saved ?? { rides: 0, amount: 0 };
  $('app-content').innerHTML = `${back('Ofa', 'Punguzo la nauli kutoka NAYA. Unamlipa dereva kiasi kilichopunguzwa taslimu; NAYA inamlipa dereva kilichobaki.')}
    ${saved.rides ? `<section class="card ofa-saved"><span class="ofa-saved-amount">${formatTsh(saved.amount)}</span><span class="muted">umeokoa kwenye safari ${saved.rides} za ofa</span></section>` : ''}
    ${cards || (r.notice ? `<p class="promo-notice" role="note">${esc(r.notice)}</p>` : '<section class="card acct-empty"><span class="acct-ico">' + ICON.gift + '</span><h2>Hakuna ofa kwa sasa</h2><p class="muted">Ofa mpya ikianza, utaiona hapa na kwenye skrini ya Nyumbani — bei iliyopunguzwa inaonekana unapochagua unakoenda.</p></section>')}
    ${cards ? '<a class="btn btn-primary btn-block acct-cta" href="#/">Agiza safari</a>' : ''}
    <section class="card">
      <h2>Ofa zinavyofanya kazi</h2>
      <ul class="acct-points">
        <li>NAYA inachagua yenyewe ofa yenye punguzo kubwa zaidi kwako — safari moja inapata ofa moja tu.</li>
        <li>Bei iliyopunguzwa inaonekana kabla ya kuagiza: bei ya zamani imekatwa, na unacholipa kiko pembeni.</li>
        <li>Ukighairi safari, nafasi yako ya ofa inarudi.</li>
        <li>Madereva walio karibu wakiwa wamemaliza nafasi zao za ofa, unaambiwa kabla dereva hajafika na unaweza kughairi bila gharama.</li>
      </ul>
    </section>`;
}

// ------------------------------------------------------------------ Shughuli

export async function renderActivity() {
  const a = ctx.account();
  const driverToo = a.driverStatus === 'APPROVED' || a.driverStatus === 'SUSPENDED';
  if (activityTab === 'drives' && !driverToo) activityTab = 'trips';
  const tabs = [
    ['trips', 'Safari zako'],
    ...(driverToo ? [['drives', 'Udereva']] : []),
    ['notes', 'Arifa'],
  ];
  $('app-content').innerHTML = `${back('Shughuli')}
    <div class="segmented acct-seg" role="tablist" aria-label="Shughuli">
      ${tabs.map(([k, l]) => `<button type="button" role="tab" data-acct-tab="${k}" aria-selected="${activityTab === k}">${esc(l)}</button>`).join('')}
    </div>
    <div id="acct-activity" role="tabpanel"><p class="muted">Inapakia…</p></div>`;
  try {
    const box = () => $('acct-activity');
    if (activityTab === 'notes') {
      const notes = await ctx.api.get('/api/notifications');
      if (!box()) return;
      box().innerHTML = notes.length
        ? `<ul class="card acct-list">${notes
            .slice(0, 30)
            .map(
              (n) => `<li class="${n.readAt ? '' : 'unread'}"><strong>${esc(n.title)}</strong>${n.body ? `<span>${esc(n.body)}</span>` : ''}<span class="muted small">${esc(formatDate(n.createdAt, true))}</span></li>`,
            )
            .join('')}</ul>`
        : `<section class="card acct-empty"><span class="acct-ico">${ICON.clock}</span><h2>Bado huna arifa</h2><p class="muted">Dereva akipatikana, safari ikibadilika au ofisi ikikujibu, utaona hapa.</p></section>`;
      if (notes.some((n) => !n.readAt)) ctx.api.post('/api/notifications/read').catch(() => {});
      return;
    }
    const drives = activityTab === 'drives';
    const list = await ctx.api.get(drives ? '/api/driver/rides' : '/api/rides/history');
    if (!box()) return;
    const label = { COMPLETED: ['ok', 'Imekamilika'], CANCELLED: ['muted', 'Imeghairiwa'], NO_DRIVER: ['muted', 'Hakuna dereva'] };
    const total = list.filter((r) => r.status === 'COMPLETED').reduce((sum, r) => sum + (drives ? r.fare : r.passengerPays ?? r.fare), 0);
    box().innerHTML = list.length
      ? `<p class="acct-sum"><strong>${formatTsh(total)}</strong> <span class="muted">${drives ? 'mapato' : 'umelipa'} · safari ${list.filter((r) => r.status === 'COMPLETED').length} za karibuni</span></p>
        <ul class="card acct-trips">${list
          .map(
            (r) => `<li>
              <span class="acct-trip-route"><strong>${esc(r.destination.name)}</strong><span class="muted">kutoka ${esc(r.pickup.name)}</span>
                <span class="muted small">${esc(formatDate(r.requestedAt, true))} · ${esc(VEHICLE_TYPES[r.vehicleType] ?? '')}</span></span>
              <span class="trip-right">${
                r.status === 'COMPLETED'
                  ? `<strong>${formatTsh(drives ? r.fare : r.passengerPays ?? r.fare)}</strong>${r.promo ? `<span class="acct-promo-tag">Ofa −${formatTsh(r.promo.discount)}</span>` : ''}`
                  : ''
              }<span class="badge badge-${label[r.status]?.[0] ?? 'muted'}">${label[r.status]?.[1] ?? esc(r.status)}</span></span>
            </li>`,
          )
          .join('')}</ul>
        <p class="muted small acct-foot">Tatizo kwenye safari mojawapo? <a href="#/akaunti/msaada/mpya">Ripoti tatizo</a></p>`
      : `<section class="card acct-empty"><span class="acct-ico">${ICON.clock}</span><h2>${drives ? 'Bado hujabeba abiria' : 'Bado hujasafiri na NAYA'}</h2><p class="muted">${drives ? 'Safari ulizokamilisha zitaonekana hapa.' : 'Safari zako za kwanza zitaonekana hapa, pamoja na ulicholipa.'}</p>${drives ? '' : '<a class="btn btn-primary btn-block" href="#/">Agiza safari</a>'}</section>`;
  } catch (err) {
    if (ctx.handleError(err)) return;
    if ($('acct-activity')) $('acct-activity').innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
  }
}

// ------------------------------------------------------------------ Usalama

export function renderSafety() {
  const e = ctx.account().emergency;
  $('app-content').innerHTML = `${back('Usalama', 'NAYA inakulinda kabla, wakati na baada ya safari.')}
    <section class="card" aria-labelledby="em-title">
      <h2 id="em-title">Mtu wa dharura</h2>
      <p class="muted">Ndugu au rafiki wa kumpigia haraka. Ukibonyeza <strong>Dharura</strong> safarini, kitufe cha kumpigia kinaonekana pale pale, na ofisi ya NAYA inaona namba yake.</p>
      ${
        e
          ? `<div class="em-saved"><span class="acct-ico">${ICON.user}</span><span><strong>${esc(e.name)}</strong><span class="muted">${esc(formatPhone(e.phone))}</span></span>
              <a class="btn btn-ghost btn-small" href="tel:+${esc(e.phone)}">${ICON.phone} Piga</a></div>`
          : ''
      }
      <details class="em-edit"${e ? '' : ' open'}>
        <summary>${e ? 'Badilisha mtu wa dharura' : 'Weka mtu wa dharura'}</summary>
        <form id="em-form" novalidate>
          <label for="em-name">Jina</label>
          <input id="em-name" maxlength="80" autocomplete="off" placeholder="Mf. Mama Neema" value="${esc(e?.name ?? '')}">
          <label for="em-phone">Namba ya simu</label>
          <input id="em-phone" inputmode="tel" autocomplete="off" placeholder="0712 345 678" value="${esc(e ? formatPhone(e.phone) : '')}">
          <p class="alert alert-danger" id="em-error" role="alert" hidden></p>
          <button class="btn btn-primary btn-block" type="submit">Hifadhi</button>
          ${e ? '<button class="btn btn-ghost btn-block btn-plain" type="button" data-acct="em-remove">Ondoa mtu wa dharura</button>' : ''}
        </form>
      </details>
    </section>

    <section class="card" aria-labelledby="ride-safe-title">
      <h2 id="ride-safe-title">Ukiwa safarini</h2>
      <ul class="acct-features">
        <li><span class="acct-ico is-red">${ICON.alert}</span><span><strong>Kitufe cha Dharura</strong><span class="muted">Kiko kwenye skrini ya safari. Kinatuma ujumbe kwa ofisi ya NAYA papo hapo pamoja na safari na mahali ulipo, na ofisi inakupigia.</span></span></li>
        <li><span class="acct-ico">${ICON.share}</span><span><strong>Shiriki safari</strong><span class="muted">Tuma link kwa ndugu au rafiki — ataona dereva, plate na ramani mpaka ufike, bila kuona namba za simu.</span></span></li>
        <li><span class="acct-ico">${ICON.plate}</span><span><strong>Hakikisha plate kabla ya kupanda</strong><span class="muted">Linganisha plate, jina na picha ya dereva na zilizo kwenye app. Zisipolingana, usipande — ghairi au piga Msaada.</span></span></li>
        <li><span class="acct-ico">${ICON.helmet}</span><span><strong>Kofia ngumu</strong><span class="muted">Dereva wa bodaboda wa NAYA anatakiwa kuwa na kofia mbili — omba yako kabla ya kuondoka.</span></span></li>
        <li><span class="acct-ico">${ICON.key}</span><span><strong>PIN ya safari za ofa</strong><span class="muted">Safari ya ofa inaanza baada ya kumpa dereva PIN iliyo kwenye app yako, ukishapanda.</span></span></li>
      </ul>
    </section>

    <section class="card" aria-labelledby="sos-num-title">
      <h2 id="sos-num-title">Namba za dharura</h2>
      <div class="acct-contacts">
        <a class="acct-contact is-red" href="tel:112"><span class="acct-ico">${ICON.phone}</span><span><strong>Polisi na dharura · 112</strong><span class="muted">Ukiwa hatarini sasa hivi</span></span></a>
        <a class="acct-contact" href="tel:${SUPPORT.phone}"><span class="acct-ico">${ICON.help}</span><span><strong>Msaada wa NAYA</strong><span class="muted">${esc(SUPPORT.phoneLabel)}</span></span></a>
      </div>
    </section>`;
}

// ------------------------------------------------------------------ Msaada

export function renderSupport() {
  const a = ctx.account();
  $('app-content').innerHTML = `${back('Msaada', 'Tuko hapa kukusaidia — chagua njia inayokufaa.')}
    <section class="card" aria-labelledby="contact-title">
      <h2 id="contact-title">Wasiliana na NAYA</h2>
      <div class="acct-contacts">
        <a class="acct-contact" href="tel:${SUPPORT.phone}"><span class="acct-ico">${ICON.phone}</span><span><strong>Piga simu</strong><span class="muted">${esc(SUPPORT.phoneLabel)}</span></span></a>
        <a class="acct-contact" href="${SUPPORT.whatsapp}?text=${encodeURIComponent(`Habari NAYA, mimi ni ${a.user.fullName} (${formatPhone(a.user.phone)}).`)}" target="_blank" rel="noopener"><span class="acct-ico is-wa">${ICON.chat}</span><span><strong>WhatsApp</strong><span class="muted">${esc(SUPPORT.phoneLabel)}</span></span></a>
        <a class="acct-contact" href="mailto:${SUPPORT.email}?subject=${encodeURIComponent('NAYA — Msaada')}"><span class="acct-ico">${ICON.mail}</span><span><strong>Barua pepe</strong><span class="muted acct-email">${esc(SUPPORT.email)}</span></span></a>
      </div>
    </section>
    ${ctx.supportCardHtml(a.supportUnread)}
    <section class="card" aria-labelledby="faq-title">
      <h2 id="faq-title">Maswali ya haraka</h2>
      <div class="acct-faq">
        <details><summary>Nimesahau kitu kwenye bodaboda au bajaji</summary><p>Fungua <a href="#/akaunti/shughuli">Shughuli</a>, angalia safari husika, kisha <a href="#/akaunti/msaada/mpya">ripoti tatizo</a> ukichagua "Umesahau kitu". Ofisi itawasiliana na dereva.</p></details>
        <details><summary>Nauli inahesabiwaje?</summary><p>NAYA inahesabu nauli kwa umbali wa safari kabla hujaagiza — unaona bei kamili kabla ya kubonyeza Agiza. Unamlipa dereva taslimu mkifika.</p></details>
        <details><summary>Dereva hakufika au alichelewa sana</summary><p>Unaweza kughairi kabla safari haijaanza. Kisha <a href="#/akaunti/msaada/mpya">ripoti tatizo</a> ili ofisi ifuatilie.</p></details>
        <details><summary>Ofa haionekani kwenye safari yangu</summary><p>Angalia <a href="#/akaunti/ofa">Ofa</a>. Kama huioni hapo, ofa haikufai kwa sasa (mf. imeisha, umeshatumia safari zako, au ni kwa chombo kingine). Bado una swali? Tupigie.</p></details>
      </div>
    </section>
    <a class="card fb-account-link" href="#/maoni">
      <span><strong>Toa maoni</strong><span class="muted">Wazo la kuboresha NAYA? Ofisi inasoma kila ujumbe.</span></span>
      <span aria-hidden="true">›</span>
    </a>`;
  ctx.loadSupportList();
}

// ------------------------------------------------------------------ matukio

async function onClick(event) {
  if (!location.hash.startsWith('#/akaunti')) return;
  const tabBtn = event.target.closest('[data-acct-tab]');
  if (tabBtn) {
    activityTab = tabBtn.dataset.acctTab;
    return renderActivity();
  }
  const act = event.target.closest('[data-acct]')?.dataset.acct;
  if (!act) return;
  if (act === 'photo-pick') return $('wf-file')?.click();
  if (act === 'photo-remove') {
    if (!confirm('Ondoa picha yako? Madereva wataona herufi za jina lako badala yake.')) return;
    try {
      await ctx.api.post('/api/account/photo/delete', {});
      await refreshAccount();
      reset();
      ctx.toast('Picha imeondolewa');
      renderProfile();
    } catch (err) {
      ctx.handleError(err, 'wf-photo-error');
    }
    return;
  }
  if (act === 'em-remove') {
    try {
      await ctx.api.post('/api/account/emergency/delete', {});
      await refreshAccount();
      ctx.toast('Mtu wa dharura ameondolewa');
      renderSafety();
    } catch (err) {
      ctx.handleError(err, 'em-error');
    }
  }
}

function onChange(event) {
  if (event.target.id !== 'wf-file') return;
  const file = event.target.files?.[0];
  event.target.value = '';
  if (file) uploadPhoto(file);
}

async function onSubmit(event) {
  const form = event.target;
  if (form.id !== 'wf-form' && form.id !== 'em-form') return;
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    if (form.id === 'wf-form') {
      $('wf-error').hidden = true;
      profile = await ctx.api.put('/api/account/profile', { fullName: $('wf-name').value });
      await refreshAccount();
      ctx.toast('Taarifa zimehifadhiwa');
      renderProfile();
    } else {
      $('em-error').hidden = true;
      await ctx.api.put('/api/account/emergency', { name: $('em-name').value, phone: $('em-phone').value });
      await refreshAccount();
      ctx.toast('Mtu wa dharura amehifadhiwa');
      renderSafety();
    }
  } catch (err) {
    ctx.handleError(err, form.id === 'wf-form' ? 'wf-error' : 'em-error');
    button.disabled = false;
  }
}
