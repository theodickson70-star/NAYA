// Ofisi: dharura (SOS) — bango jekundu kwenye kila ukurasa likiwa na dharura iliyo wazi, kengele, na ukurasa wa kushughulikia.
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, onAuthError }
let scope = 'open';
let knownOpen = null; // idadi ya dharura zilizo wazi tulizoona mara ya mwisho (kwa kengele)
let audio = null;

const ROLE = { PASSENGER: 'Abiria', DRIVER: 'Dereva' };

export function setup(context) {
  ctx = context;
  $('sos-filters').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-scope]');
    if (!chip) return;
    scope = chip.dataset.scope;
    for (const c of document.querySelectorAll('#sos-filters [data-scope]')) c.setAttribute('aria-pressed', String(c === chip));
    loadPage();
  });
  // Browsers zinaruhusu sauti baada ya mtumiaji kugusa ukurasa mara moja.
  document.addEventListener(
    'click',
    () => {
      try {
        audio ??= new (window.AudioContext || window.webkitAudioContext)();
        audio.resume?.();
      } catch {
        audio = null;
      }
    },
    { once: true },
  );
}

function alarm() {
  if (!audio) return;
  try {
    const now = audio.currentTime;
    for (let i = 0; i < 4; i++) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = i % 2 ? 660 : 990;
      gain.gain.setValueAtTime(0.0001, now + i * 0.3);
      gain.gain.exponentialRampToValueAtTime(0.5, now + i * 0.3 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.3 + 0.28);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + i * 0.3);
      osc.stop(now + i * 0.3 + 0.29);
    }
  } catch {
    // sauti haipatikani
  }
}

/** Inaitwa kila dashboard inapopakiwa: bango + idadi kwenye menyu + kengele dharura mpya ikiingia. */
export function setOpenCount(count) {
  $('nav-sos').textContent = count;
  $('nav-sos').hidden = !count;
  const banner = $('sos-banner');
  banner.hidden = !count;
  banner.innerHTML = count
    ? `<strong>DHARURA${count > 1 ? ` (${count})` : ''}:</strong> mtu ameomba msaada kwenye safari. <span class="sos-banner-cta">Fungua sasa</span>`
    : '';
  if (knownOpen !== null && count > knownOpen) alarm();
  knownOpen = count;
}

export async function loadPage() {
  $('sos-error').hidden = true;
  try {
    const alerts = await ctx.api.get(`/api/admin/sos?scope=${scope}`);
    if (scope === 'open') setOpenCount(alerts.length);
    $('sos-list').innerHTML =
      alerts.length === 0
        ? `<p class="empty">${scope === 'open' ? 'Hakuna dharura iliyo wazi.' : 'Bado hakuna dharura.'}</p>`
        : alerts.map(alertHtml).join('');
    for (const form of document.querySelectorAll('.sos-resolve')) form.addEventListener('submit', resolve);
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    $('sos-error').textContent = err.message;
    $('sos-error').hidden = false;
  }
}

function mapLink(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function alertHtml(a) {
  const open = a.status === 'OPEN';
  const where =
    a.lat != null
      ? `<a href="${mapLink(a.lat, a.lng)}" target="_blank" rel="noopener">Mahali alipobonyeza (ramani)</a>`
      : a.driverLat != null
        ? `<a href="${mapLink(a.driverLat, a.driverLng)}" target="_blank" rel="noopener">Mahali pa dereva (${esc(formatDate(a.driverSeenAt, true))})</a>`
        : 'Mahali hapajulikani';
  return `<article class="sos-card ${open ? 'is-open' : ''}">
    <div class="detail-head">
      <div>
        <h2>${esc(ROLE[a.role])}: ${esc(a.name)}</h2>
        <p class="muted">${esc(formatDate(a.createdAt, true))} · ${esc(a.pickupName ?? '')} → ${esc(a.destinationName ?? '')}</p>
      </div>
      <span class="badge badge-${open ? 'bad' : 'muted'}">${open ? 'Wazi' : 'Imeshughulikiwa'}</span>
    </div>
    <div class="sos-actions">
      <a class="btn btn-primary" href="tel:+${esc(a.phone)}">Mpigie ${esc(a.name.split(' ')[0])} · ${esc(formatPhone(a.phone))}</a>
      ${a.otherPhone ? `<a class="btn btn-ghost" href="tel:+${esc(a.otherPhone)}">${a.role === 'PASSENGER' ? 'Dereva' : 'Abiria'}: ${esc(a.otherName)} · ${esc(formatPhone(a.otherPhone))}</a>` : ''}
    </div>
    <p class="small">${where}${a.plateNumber ? ` · Plate <span class="plate">${esc(a.plateNumber)}</span>` : ''} · <a href="#/safari/${esc(a.rideId)}">Fungua safari</a></p>
    ${
      open
        ? `<form class="sos-resolve" data-id="${a.id}">
            <label for="sos-note-${a.id}">Hatua uliyochukua</label>
            <input id="sos-note-${a.id}" maxlength="500" placeholder="Mf. Nimempigia, yuko salama; dereva ameonywa">
            <p class="alert alert-danger" role="alert" hidden></p>
            <div class="actions"><button class="btn btn-primary" type="submit">Imeshughulikiwa</button></div>
          </form>`
        : `<p class="note">${esc(a.note ?? '')} — ${esc(a.resolvedBy ?? '')}, ${esc(formatDate(a.resolvedAt, true))}</p>`
    }
  </article>`;
}

async function resolve(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.submitter;
  const box = form.querySelector('.alert');
  box.hidden = true;
  button.disabled = true;
  try {
    await ctx.api.post(`/api/admin/sos/${form.dataset.id}/resolve`, { note: form.querySelector('input').value });
    loadPage();
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    box.textContent = err.message;
    box.hidden = false;
    button.disabled = false;
  }
}
