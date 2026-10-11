// Ofisi: Ripoti — mwenendo wa kila siku, saa zenye shughuli, maeneo, madereva bora, na kupakua CSV.
import { escapeHtml as esc } from '/shared/api.js';
import { formatTsh } from '/shared/labels.js';
import { barChart, shortDay } from './charts.js';

const $ = (id) => document.getElementById(id);
let ctx = null;
let days = 30;
const compactTsh = (n) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));

export function setup(context) {
  ctx = context;
  $('report-range').addEventListener('click', (event) => {
    const chip = event.target.closest('[data-days]');
    if (!chip) return;
    days = Number(chip.dataset.days);
    for (const c of $('report-range').querySelectorAll('[data-days]')) c.setAttribute('aria-pressed', String(c === chip));
    load();
  });
  $('report-csv').addEventListener('click', downloadCsv);
}

export async function load() {
  $('reports-error').hidden = true;
  try {
    const r = await ctx.api.get(`/api/admin/reports?days=${days}`);
    const t = r.totals;
    const rate = t.requested ? Math.round((t.completed / t.requested) * 100) : 0;
    $('report-totals').innerHTML = [
      ['Safari zilizokamilika', t.completed.toLocaleString('en-US'), `${rate}% ya maombi ${t.requested}`],
      ['Thamani ya safari', formatTsh(t.value), 'Taslimu kwa madereva'],
      ['Hazikupata dereva', t.noDriver.toLocaleString('en-US'), `Zilizoghairiwa: ${t.cancelled}`],
      ['Watumiaji wapya', t.newUsers.toLocaleString('en-US'), `Siku ${days}`],
      ['Ada zilizolipwa', formatTsh(t.subscriptions), 'Mapato ya NAYA'],
    ]
      .map(([label, value, sub]) => `<div class="kpi"><span class="kpi-label">${label}</span><span class="kpi-value kpi-money">${value}</span><span class="kpi-sub">${sub}</span></div>`)
      .join('');
    barChart(
      $('report-trips'),
      r.days.map((d) => ({ label: shortDay(d.day), value: d.completed, tip: `${shortDay(d.day)} · maombi ${d.requested}` })),
    );
    barChart(
      $('report-value'),
      r.days.map((d) => ({ label: shortDay(d.day), value: d.value, tip: shortDay(d.day) })),
      { format: compactTsh },
    );
    const byHour = Array.from({ length: 24 }, (_, h) => r.hours.find((x) => x.hour === h)?.trips ?? 0);
    barChart(
      $('report-hours'),
      byHour.map((v, h) => ({ label: String(h).padStart(2, '0'), value: v, tip: `Saa ${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59` })),
      { labelEvery: 3 },
    );
    $('report-places').innerHTML = r.topPlaces.length
      ? r.topPlaces.map((p) => `<li>${esc(p.name)} <span>${p.trips}</span></li>`).join('')
      : '<li class="muted">Bado hakuna safari.</li>';
    $('report-drivers').innerHTML = r.topDrivers.length
      ? r.topDrivers
          .map(
            (d, i) => `<a class="user-row" href="#/wateja/${esc(d.id)}">
              <span><span class="driver-name">${i + 1}. ${esc(d.fullName)}</span><br><span class="driver-sub">${esc(d.plateNumber ?? '')}</span></span>
              <span class="driver-sub col-hide">Safari ${d.trips}</span>
              <span class="driver-sub col-hide">${formatTsh(d.value)}</span>
              <span class="tags">${d.rating ? `<span class="badge badge-ok">★ ${d.rating}</span>` : ''}</span>
            </a>`,
          )
          .join('')
      : '<p class="empty">Bado hakuna safari zilizokamilika kwenye kipindi hiki.</p>';
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    $('reports-error').textContent = err.message;
    $('reports-error').hidden = false;
  }
}

async function downloadCsv() {
  const button = $('report-csv');
  button.disabled = true;
  try {
    const blob = await ctx.api.blob(`/api/admin/reports/rides.csv?days=${days}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `naya-safari-siku-${days}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    $('reports-error').textContent = err.message;
    $('reports-error').hidden = false;
  } finally {
    button.disabled = false;
  }
}
