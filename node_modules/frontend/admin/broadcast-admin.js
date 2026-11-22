// Ofisi: Matangazo — ujumbe mmoja kwa kundi zima (arifa ndani ya app + simu; SMS ni hiari).
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null;
let info = null;

const AUDIENCE = [
  ['ALL', 'Wote', 'Wateja na madereva'],
  ['PASSENGERS', 'Wateja', 'Abiria tu'],
  ['DRIVERS', 'Madereva', 'Waliothibitishwa'],
  ['ONLINE_DRIVERS', 'Madereva online', 'Walio kazini sasa'],
];
const LABEL = Object.fromEntries(AUDIENCE.map(([k, l]) => [k, l]));

export function setup(context) {
  ctx = context;
  const preview = () => {
    $('bc-prev-title').textContent = $('bc-title').value.trim() || 'Kichwa';
    $('bc-prev-body').textContent = $('bc-body').value.trim() || 'Ujumbe wako';
    $('bc-count').textContent = $('bc-body').value.length;
    $('bc-ok').hidden = true;
  };
  $('bc-title').addEventListener('input', preview);
  $('bc-body').addEventListener('input', preview);
  $('broadcast-audience').addEventListener('change', updateSmsNote);
  $('broadcast-form').addEventListener('submit', send);
}

function selected() {
  return $('broadcast-audience').querySelector('input:checked')?.value ?? 'ALL';
}

function updateSmsNote() {
  if (!info) return;
  const n = info.sizes[selected()] ?? 0;
  $('bc-sms').disabled = !info.smsEnabled;
  $('bc-sms-note').textContent = !info.smsEnabled
    ? '(SMS hazijawashwa)'
    : n > info.maxSms
      ? `(kundi hili lina watu ${n} — SMS zinaruhusiwa kwa ${info.maxSms} tu)`
      : `(SMS ${n} — zinalipiwa kwa Beem)`;
}

export async function load() {
  try {
    info = await ctx.api.get('/api/admin/broadcasts');
    const current = selected();
    $('broadcast-audience').innerHTML =
      '<legend>Wapokeaji</legend>' +
      AUDIENCE.map(
        ([k, label, sub]) => `<label><input type="radio" name="audience" value="${k}" ${k === current ? 'checked' : ''}>${label}<span>${sub} · ${info.sizes[k] ?? 0}</span></label>`,
      ).join('');
    if (!$('broadcast-audience').querySelector('input:checked')) $('broadcast-audience').querySelector('input').checked = true;
    updateSmsNote();
    $('broadcast-history').innerHTML = info.history.length
      ? info.history
          .map(
            (b) => `<li><span><strong>${esc(b.title)}</strong> — ${esc(b.body)}</span><span class="muted">${esc(LABEL[b.audience] ?? b.audience)} · watu ${b.recipients}${
              b.withSms ? ` · SMS ${b.smsSent}` : ''
            } · ${esc(formatDate(b.createdAt, true))}${b.createdBy ? ` · ${esc(b.createdBy)}` : ''}</span></li>`,
          )
          .join('')
      : '<li class="muted">Bado hujatuma tangazo.</li>';
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    $('bc-error').textContent = err.message;
    $('bc-error').hidden = false;
  }
}

async function send(event) {
  event.preventDefault();
  $('bc-error').hidden = true;
  $('bc-ok').hidden = true;
  const audience = selected();
  const n = info?.sizes[audience] ?? 0;
  if (!confirm(`Tuma tangazo hili kwa ${LABEL[audience]} (watu ${n})?`)) return;
  const button = $('bc-send');
  button.disabled = true;
  try {
    const res = await ctx.api.post('/api/admin/broadcasts', { audience, title: $('bc-title').value, body: $('bc-body').value, sms: $('bc-sms').checked });
    $('bc-ok').textContent = `Tangazo linatumwa kwa watu ${res.recipients}${res.sms ? ' (pamoja na SMS)' : ''}.`;
    $('bc-ok').hidden = false;
    $('bc-title').value = '';
    $('bc-body').value = '';
    $('bc-sms').checked = false;
    $('bc-title').dispatchEvent(new Event('input'));
    load();
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    $('bc-error').textContent = err.message;
    $('bc-error').hidden = false;
  } finally {
    button.disabled = false;
  }
}
