// Ofisi → Fedha → Malipo → Nauli kwa simu (0.22.0)
//   #/malipo/nauli   kuwasha / kuzima, ada juu ya nauli, takwimu za leo, madeni ya abiria (kuondoa: amelipa cash / kusamehe)
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone, formatTsh } from '/shared/labels.js';
import { toast } from './ui.js';

let ctx = null; // { api, onAuthError, tabs() }
let host = null;
let view = 0;
let showAll = false;
const n = (v) => Number(v ?? 0).toLocaleString('en-US');
const HOW = { MOBILE: 'Amelipa kwa simu', CASH: 'Amemlipa dereva taslimu', FORGIVEN: 'Limesamehewa' };

export function setup(context, hostEl) {
  ctx = context;
  host = hostEl;
  host.addEventListener('click', onClick);
  host.addEventListener('submit', onSubmit);
}

const active = () => host.querySelector('[data-nauli]');

export function open() {
  view += 1;
  host.innerHTML = `${ctx.tabs()}<p class="muted rp-loading">Inapakia…</p>`;
  return load();
}

async function load() {
  const v = view;
  try {
    const [s, debts] = await Promise.all([ctx.api.get('/api/admin/ride-payments/summary'), ctx.api.get(`/api/admin/ride-debts?open=${showAll ? 0 : 1}`)]);
    if (v === view) render(s, debts);
  } catch (err) {
    if (v !== view || ctx.onAuthError(err)) return;
    host.insertAdjacentHTML('beforeend', `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`);
  }
}

function render(s, debts) {
  const st = s.settings;
  const example = 3000;
  const fee = Math.max(Math.round(st.feeMin), Math.ceil((example * st.feePercent) / 100));
  host.innerHTML = `${ctx.tabs()}<div data-nauli>
    <p class="rp-lead">Abiria akifika analipa nauli kwa simu kwenye app (namba yoyote, hadi namba ${n(s.maxNumbers)}) au taslimu. Ada ya kupokea pesa inaongezwa juu ya nauli; dereva anapata nauli kamili kwenye wallet yake. Asiyelipa → deni, na hawezi kuagiza safari mpaka alipe.</p>
    ${!s.providerReady ? '<p class="alert alert-danger" role="alert">Kampuni ya malipo haijaunganishwa — malipo ya simu hayawezi kuwashwa.</p>' : ''}
    <section class="rp-stats">
      <div class="rp-stat rp-stat-hero"><span>Hali</span><strong>${st.enabled ? 'Imewashwa' : 'Imezimwa'}</strong><small>${st.enabled ? 'Abiria wanaona "Lipa kwa simu"' : 'Abiria wanalipa taslimu tu'}</small></div>
      <div class="rp-stat"><span>Nauli kwa simu leo</span><strong>${formatTsh(s.today.total)}</strong><small>Malipo ${n(s.today.n)} · ada ${formatTsh(s.today.fees)}</small></div>
      <div class="rp-stat${s.debts.n ? ' rp-stat-bad' : ''}"><span>Madeni ya abiria</span><strong>${formatTsh(s.debts.total)}</strong><small>Safari ${n(s.debts.n)} · abiria ${n(s.debts.people)}</small></div>
    </section>
    <form class="settings-card fa-settings" id="fa-settings" novalidate>
      <h3>Mipangilio</h3>
      <label class="check"><input type="checkbox" id="fa-on"${st.enabled ? ' checked' : ''}${s.providerReady ? '' : ' disabled'}> Abiria walipe nauli kwa simu wakifika</label>
      <div class="settings-grid">
        <div><label for="fa-pct">Ada juu ya nauli (%)</label><input id="fa-pct" inputmode="decimal" value="${esc(st.feePercent)}"></div>
        <div><label for="fa-min">Ada ya chini kwa kila malipo (TSh)</label><input id="fa-min" inputmode="numeric" value="${esc(st.feeMin)}"></div>
      </div>
      <p class="small muted">Weka ada sawa na ada ya Abliner ya kupokea pesa, ili NAYA isipoteze. Mfano sasa: nauli ${formatTsh(example)} → abiria analipa <strong>${formatTsh(example + fee)}</strong> (ada ${formatTsh(fee)}).${
        st.enabled && !st.feePercent && !st.feeMin ? ' <strong>Ada ni 0 — NAYA inabeba ada ya Abliner.</strong>' : ''
      }</p>
      <p class="alert alert-danger" id="fa-settings-error" role="alert" hidden></p>
      <div class="actions"><button class="btn btn-primary btn-small" type="submit">Hifadhi</button></div>
    </form>
    <div class="fa-head"><h3>Madeni ya abiria</h3>
      <div class="filters rp-chips" role="group" aria-label="Madeni"><button type="button" class="chip" data-fa="open" aria-pressed="${!showAll}">Yasiyolipwa</button><button type="button" class="chip" data-fa="all" aria-pressed="${showAll}">Yote</button></div></div>
    <p class="alert alert-danger" id="fa-error" role="alert" hidden></p>
    ${
      debts.length
        ? `<div class="rp-scroll"><table class="rp-table"><thead><tr><th>Safari</th><th>Abiria</th><th>Dereva</th><th class="num">Deni</th><th>Hali</th></tr></thead><tbody>${debts
            .map(
              (d) => `<tr>
                <td class="rp-nowrap">${esc(formatDate(d.completedAt, true))}<span class="rp-sub"><a href="#/safari/${esc(d.id)}">${esc(d.from)} → ${esc(d.to)}</a></span></td>
                <td><a href="#/wateja/${esc(d.passengerId)}">${esc(d.passengerName)}</a><span class="rp-sub">${esc(formatPhone(d.passengerPhone))}</span></td>
                <td>${d.driverId ? `<a href="#/malipo/wallet/${esc(d.driverId)}">${esc(d.driverName ?? '')}</a>` : '–'}</td>
                <td class="num"><strong>${formatTsh(d.amount)}</strong></td>
                <td>${
                  d.clearedAt
                    ? `<span class="badge badge-${d.clearedHow === 'MOBILE' ? 'ok' : 'muted'}">${esc(HOW[d.clearedHow] ?? d.clearedHow)}</span><span class="rp-sub">${esc(formatDate(d.clearedAt, true))}${d.clearedBy ? ` · ${esc(d.clearedBy)}` : ''}${d.note ? ` · ${esc(d.note)}` : ''}</span>`
                    : `<span class="badge badge-bad">Halijalipwa</span><span class="fa-act"><button class="link-btn" type="button" data-clear="CASH" data-id="${esc(d.id)}">Amemlipa dereva taslimu</button><button class="link-btn link-danger" type="button" data-clear="FORGIVEN" data-id="${esc(d.id)}">Samehe</button></span>`
                }</td>
              </tr>`,
            )
            .join('')}</tbody></table></div>`
        : `<div class="rp-scroll"><p class="empty">${showAll ? 'Bado hakuna deni lililowahi kuandikwa.' : 'Hakuna abiria mwenye deni sasa hivi.'}</p></div>`
    }</div>`;
}

async function onClick(event) {
  if (!active()) return;
  const chip = event.target.closest('[data-fa]');
  if (chip) {
    showAll = chip.dataset.fa === 'all';
    view += 1;
    return load();
  }
  const b = event.target.closest('[data-clear]');
  if (!b) return;
  const cash = b.dataset.clear === 'CASH';
  const note = prompt(
    cash ? 'Abiria amemlipa dereva taslimu? Andika maelezo (mf. dereva amethibitisha kwa simu):' : 'Samehe deni hili? Dereva hatalipwa. Andika sababu:',
  );
  if (!note || note.trim().length < 3) return;
  b.disabled = true;
  try {
    await ctx.api.post(`/api/admin/ride-debts/${b.dataset.id}/clear`, { how: b.dataset.clear, note: note.trim() });
    toast(cash ? 'Deni limeondolewa (taslimu)' : 'Deni limesamehewa');
    view += 1;
    load();
  } catch (err) {
    b.disabled = false;
    if (ctx.onAuthError(err)) return;
    const box = document.getElementById('fa-error');
    box.textContent = err.message;
    box.hidden = false;
  }
}

async function onSubmit(event) {
  if (event.target.id !== 'fa-settings' || !active()) return;
  event.preventDefault();
  const box = document.getElementById('fa-settings-error');
  box.hidden = true;
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    await ctx.api.put('/api/admin/settings/ride-payments', {
      enabled: document.getElementById('fa-on').checked,
      feePercent: Number(String(document.getElementById('fa-pct').value).replace(',', '.')) || 0,
      feeMin: Number(String(document.getElementById('fa-min').value).replace(/[^\d]/g, '')) || 0,
    });
    toast('Mipangilio ya nauli kwa simu imehifadhiwa');
    view += 1;
    load();
  } catch (err) {
    button.disabled = false;
    if (ctx.onAuthError(err)) return;
    box.textContent = err.message;
    box.hidden = false;
  }
}
