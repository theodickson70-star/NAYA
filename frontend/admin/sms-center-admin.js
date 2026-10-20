// Ofisi: Kituo cha SMS (0.26.0) — chagua wapokeaji, template au ujumbe wako, hakiki (idadi, mfano, gharama), tuma,
// na ufuatilie maendeleo. Templates za wateja na madereva zinahifadhiwa hapa.
import { escapeHtml as esc } from '/shared/api.js';
import { formatDate, formatPhone } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null;
let info = null;
let preview = null; // { key, data }
let editing = null; // template inayohaririwa: { id|null, audience, title, body }
let pollTimer = null;
let openFailures = new Set();

const AUDIENCE = [
  ['CUSTOMERS', 'Wateja wote', 'Abiria'],
  ['CUSTOMERS_NEW', 'Wateja wapya', 'Wamejiunga wiki hii'],
  ['CUSTOMERS_INACTIVE', 'Wateja wa zamani', 'Hawajasafiri siku 30'],
  ['DRIVERS', 'Madereva wote', 'Waliothibitishwa'],
  ['DRIVERS_ONLINE', 'Madereva online', 'Walio kazini sasa'],
  ['DRIVERS_FEE_DUE', 'Ada inaisha', 'Ndani ya siku 3 au imeisha'],
  ['DRIVERS_PENDING', 'Madereva wanaosubiri', 'Hawajathibitishwa bado'],
  ['ALL', 'Wote', 'Wateja na madereva'],
  ['NUMBERS', 'Namba maalum', 'Andika namba'],
];
const LABEL = Object.fromEntries(AUDIENCE.map(([k, l]) => [k, l]));
const TPL_GROUP = { CUSTOMERS: 'Wateja', DRIVERS: 'Madereva', ALL: 'Wote' };
const STATUS = { SENDING: ['warn', 'Inatumwa'], DONE: ['ok', 'Imekamilika'], STOPPED: ['muted', 'Imesimamishwa'] };
const PH_HELP = {
  jina: 'jina la kwanza',
  jina_kamili: 'jina kamili',
  plate: 'plate ya dereva',
  ada_hadi: 'ada ya dereva inaisha',
  link: 'link ya app',
  link_pakua: 'link ya kupakua',
};

/** Kama server (toGsm + 160/153): makadirio ya herufi na SMS. */
function gsmLength(text) {
  return text
    .replace(/[—–·•]/g, '-')
    .replace(/[‘’“”]/g, "'")
    .replace(/…/g, '...')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E\n]/g, '').length;
}
const partsOf = (n) => (n === 0 ? 0 : n <= 160 ? 1 : Math.ceil(n / 153));

export function setup(context) {
  ctx = context;
  $('smsc-audience').addEventListener('change', () => {
    $('smsc-numbers-wrap').hidden = audience() !== 'NUMBERS';
    drawChips();
    invalidate();
  });
  $('smsc-numbers').addEventListener('input', invalidate);
  $('smsc-message').addEventListener('input', () => {
    count();
    invalidate();
  });
  $('smsc-tpl-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-use]');
    if (b) useTemplate(b.dataset.use);
  });
  $('smsc-ph').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ph]');
    if (!b) return;
    const ta = $('smsc-message');
    const word = `{${b.dataset.ph}}`;
    const at = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, at) + word + ta.value.slice(ta.selectionEnd ?? at);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = at + word.length;
    ta.dispatchEvent(new Event('input'));
  });
  $('smsc-preview-btn').addEventListener('click', runPreview);
  $('smsc-form').addEventListener('submit', send);
  $('smsc-tpl-new').addEventListener('click', () => {
    editing = { id: null, audience: audienceGroup() === 'ALL' ? 'CUSTOMERS' : audienceGroup(), title: '', body: $('smsc-message').value };
    drawEditor();
  });
  $('smsc-tpl-list').addEventListener('click', onTemplateAction);
  $('smsc-tpl-editor').addEventListener('click', onEditorAction);
  $('smsc-tpl-editor').addEventListener('submit', saveTemplate);
  $('smsc-history').addEventListener('click', onHistoryAction);
}

const audience = () => $('smsc-audience').querySelector('input:checked')?.value ?? 'CUSTOMERS';
/** Kundi la templates linalofaa wapokeaji hawa. */
function audienceGroup() {
  const a = audience();
  if (a.startsWith('CUSTOMERS')) return 'CUSTOMERS';
  if (a.startsWith('DRIVERS')) return 'DRIVERS';
  return 'ALL';
}

function error(message) {
  $('smsc-error').textContent = message ?? '';
  $('smsc-error').hidden = !message;
}

export function stop() {
  clearInterval(pollTimer);
  pollTimer = null;
}

export async function load() {
  error('');
  try {
    info = await ctx.api.get('/api/admin/sms-center');
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    return error(err.message);
  }
  $('smsc-status').textContent = info.enabled
    ? `Sender ID: ${info.senderId} · Salio la Beem: ${info.balance == null ? 'halijulikani' : `SMS ${Number(info.balance).toLocaleString('sw-TZ')}`}`
    : 'SMS hazijawashwa — weka funguo za Beem kwenye Railway → Variables. Unaweza kuandaa templates.';
  const current = audience();
  $('smsc-audience').innerHTML =
    '<legend>Wapokeaji</legend>' +
    AUDIENCE.map(
      ([k, label, sub]) =>
        `<label><input type="radio" name="smsc-aud" value="${k}" ${k === current ? 'checked' : ''}>${esc(label)}<span>${esc(sub)}${
          k === 'NUMBERS' ? '' : ` · ${info.sizes[k] ?? 0}`
        }</span></label>`,
    ).join('');
  if (!$('smsc-audience').querySelector('input:checked')) $('smsc-audience').querySelector('input').checked = true;
  $('smsc-numbers-wrap').hidden = audience() !== 'NUMBERS';
  $('smsc-ph').innerHTML = info.placeholders.map((p) => `<button type="button" class="smsc-ph-btn" data-ph="${p}" title="${esc(PH_HELP[p] ?? '')}">{${p}}</button>`).join('');
  drawChips();
  drawTemplates();
  drawHistory();
  count();
}

// ------------------------------------------------------------------ kuandika

function drawChips() {
  if (!info) return;
  const g = audienceGroup();
  const list = info.templates.filter((t) => g === 'ALL' || t.audience === g || t.audience === 'ALL');
  $('smsc-tpl-note').textContent = list.length ? `(za ${g === 'ALL' ? 'wote' : TPL_GROUP[g].toLowerCase()})` : '';
  $('smsc-tpl-chips').innerHTML = list.length
    ? list.map((t) => `<button type="button" class="chip" data-use="${t.id}" aria-pressed="${$('smsc-message').dataset.template === t.id}">${esc(t.title)}</button>`).join('')
    : '<p class="muted small">Hakuna template ya kundi hili. Unaweza kuandika ujumbe mwenyewe.</p>';
}

function useTemplate(id) {
  const t = info.templates.find((x) => x.id === id);
  if (!t) return;
  $('smsc-message').value = t.body;
  $('smsc-message').dataset.template = t.id;
  count();
  invalidate();
  drawChips();
  $('smsc-message').focus();
}

function count() {
  const text = $('smsc-message').value;
  const n = gsmLength(text);
  const hasWords = /\{[a-z_]+\}/.test(text);
  $('smsc-counter').textContent = `herufi ${n} · SMS ${partsOf(n)}${hasWords ? ' (kabla ya kujaza majina)' : ''}`;
  $('smsc-counter').classList.toggle('is-long', partsOf(n) > (info?.limits.maxParts ?? 3));
}

const formKey = () => JSON.stringify({ a: audience(), m: $('smsc-message').value, n: audience() === 'NUMBERS' ? $('smsc-numbers').value : '' });

function invalidate() {
  if (preview && preview.key === formKey()) return;
  preview = null;
  $('smsc-preview').innerHTML = '';
  $('smsc-send').disabled = true;
  $('smsc-send').textContent = 'Tuma';
  $('smsc-ok').hidden = true;
}

function body() {
  return {
    audience: audience(),
    message: $('smsc-message').value,
    numbers: audience() === 'NUMBERS' ? $('smsc-numbers').value : undefined,
    templateId: $('smsc-message').dataset.template || null,
  };
}

async function runPreview() {
  error('');
  const button = $('smsc-preview-btn');
  button.disabled = true;
  try {
    const data = await ctx.api.post('/api/admin/sms-center/preview', body());
    preview = { key: formKey(), data };
    drawPreview(data);
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    preview = null;
    $('smsc-preview').innerHTML = `<p class="alert alert-danger" role="alert">${esc(err.message)}</p>`;
  } finally {
    button.disabled = false;
  }
}

function drawPreview(d) {
  const blocked = d.problems.length > 0 || d.count === 0;
  $('smsc-preview').innerHTML = `<div class="smsc-preview">
      <div class="smsc-preview-stats">
        <div><strong>${d.count.toLocaleString('sw-TZ')}</strong><span>watu</span></div>
        <div><strong>${d.units.toLocaleString('sw-TZ')}</strong><span>SMS (makadirio)</span></div>
        <div><strong>${d.balance == null ? '—' : Number(d.balance).toLocaleString('sw-TZ')}</strong><span>salio la Beem</span></div>
      </div>
      ${d.invalidCount ? `<p class="alert alert-warn">Namba ${d.invalidCount} si sahihi na zitarukwa: ${esc(d.invalid.join(', '))}</p>` : ''}
      ${d.problems.map((p) => `<p class="alert alert-danger">${esc(p)}</p>`).join('')}
      ${
        d.samples.length
          ? `<p class="smsc-label">Mfano — itafika hivi</p>${d.samples
              .map(
                (s) => `<div class="smsc-bubble"><span class="muted small">${esc(s.name ?? 'Namba isiyosajiliwa')} · ${esc(formatPhone(s.phone))} · SMS ${s.parts}</span><p>${esc(s.text)}</p></div>`,
              )
              .join('')}`
          : '<p class="muted">Hakuna mtu kwenye kundi hili.</p>'
      }
    </div>`;
  $('smsc-send').disabled = blocked;
  $('smsc-send').textContent = blocked ? 'Tuma' : `Tuma kwa watu ${d.count.toLocaleString('sw-TZ')}`;
}

async function send(event) {
  event.preventDefault();
  if (!preview || preview.key !== formKey()) return runPreview();
  const d = preview.data;
  const who = audience() === 'NUMBERS' ? `namba ${d.count}` : `${LABEL[audience()]} (watu ${d.count})`;
  if (!confirm(`Tuma SMS kwa ${who}?\nMakadirio: SMS ${d.units}. Haiwezi kurudishwa nyuma ikishatumwa.`)) return;
  const button = $('smsc-send');
  button.disabled = true;
  button.textContent = 'Inatuma…';
  error('');
  try {
    const res = await ctx.api.post('/api/admin/sms-center/send', { ...body(), expectedCount: d.count });
    $('smsc-ok').textContent = `SMS zinatumwa kwa watu ${res.total} (makadirio SMS ${res.units}). Fuatilia hapa chini kwenye "Zilizotumwa".`;
    $('smsc-ok').hidden = false;
    $('smsc-message').value = '';
    $('smsc-message').dataset.template = '';
    if (audience() === 'NUMBERS') $('smsc-numbers').value = '';
    preview = null;
    $('smsc-preview').innerHTML = '';
    button.textContent = 'Tuma'; // inabaki imezimwa mpaka hakiki mpya
    count();
    await load();
    $('smsc-ok').hidden = false;
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    error(err.message);
    button.disabled = false;
    button.textContent = 'Tuma';
  }
}

// ------------------------------------------------------------------ templates

function drawTemplates() {
  const groups = ['CUSTOMERS', 'DRIVERS', 'ALL'];
  $('smsc-tpl-list').innerHTML = info.templates.length
    ? groups
        .map((g) => {
          const list = info.templates.filter((t) => t.audience === g);
          if (!list.length) return '';
          return `<h3 class="smsc-tpl-group">${TPL_GROUP[g]}</h3><ul class="smsc-tpl-items">${list
            .map(
              (t) => `<li>
                <div><strong>${esc(t.title)}</strong><p class="muted small">${esc(t.body)}</p></div>
                <div class="smsc-tpl-actions">
                  <button class="btn btn-ghost btn-small" type="button" data-tpl="use" data-id="${t.id}">Tumia</button>
                  <button class="btn btn-ghost btn-small" type="button" data-tpl="edit" data-id="${t.id}">Hariri</button>
                  <button class="btn btn-ghost btn-small btn-plain" type="button" data-tpl="remove" data-id="${t.id}">Ondoa</button>
                </div>
              </li>`,
            )
            .join('')}</ul>`;
        })
        .join('')
    : '<p class="muted">Bado hakuna template. Bonyeza "Template mpya".</p>';
}

function drawEditor() {
  if (!editing) {
    $('smsc-tpl-editor').innerHTML = '';
    return;
  }
  $('smsc-tpl-editor').innerHTML = `<form class="smsc-tpl-form" id="smsc-tpl-form" novalidate>
      <label for="smsc-tpl-aud">Ya nani</label>
      <select id="smsc-tpl-aud">${Object.entries(TPL_GROUP)
        .map(([k, l]) => `<option value="${k}" ${k === editing.audience ? 'selected' : ''}>${l}</option>`)
        .join('')}</select>
      <label for="smsc-tpl-name">Jina la template</label>
      <input id="smsc-tpl-name" maxlength="60" value="${esc(editing.title)}" placeholder="Mf. Karibu NAYA">
      <label for="smsc-tpl-body">Ujumbe</label>
      <textarea id="smsc-tpl-body" rows="4" maxlength="480" placeholder="Mf. Habari {jina}, …">${esc(editing.body)}</textarea>
      <p class="muted small">Maneno yanayojazwa: ${info.placeholders.map((p) => `{${p}}`).join(' ')}. Maneno ndani ya [ ] yanabadilishwa kabla ya kutuma.</p>
      <p class="alert alert-danger" id="smsc-tpl-error" role="alert" hidden></p>
      <div class="actions"><button class="btn btn-primary" type="submit">${editing.id ? 'Hifadhi mabadiliko' : 'Hifadhi template'}</button>
      <button class="btn btn-ghost" type="button" data-editor="cancel">Acha</button></div>
    </form>`;
  $('smsc-tpl-name').focus();
}

function onEditorAction(e) {
  if (e.target.closest('[data-editor="cancel"]')) {
    editing = null;
    drawEditor();
  }
}

async function saveTemplate(e) {
  e.preventDefault();
  const payload = { audience: $('smsc-tpl-aud').value, title: $('smsc-tpl-name').value, body: $('smsc-tpl-body').value };
  try {
    info.templates = editing.id
      ? await ctx.api.put(`/api/admin/sms-templates/${editing.id}`, payload)
      : await ctx.api.post('/api/admin/sms-templates', payload);
    editing = null;
    drawEditor();
    drawTemplates();
    drawChips();
  } catch (err) {
    if (ctx.onAuthError(err)) return;
    $('smsc-tpl-error').textContent = err.message;
    $('smsc-tpl-error').hidden = false;
  }
}

async function onTemplateAction(e) {
  const b = e.target.closest('[data-tpl]');
  if (!b) return;
  const t = info.templates.find((x) => x.id === b.dataset.id);
  if (!t) return;
  if (b.dataset.tpl === 'use') {
    const g = audienceGroup();
    if (t.audience !== 'ALL' && g !== t.audience) {
      const first = $('smsc-audience').querySelector(`input[value="${t.audience}"]`);
      if (first) first.checked = true;
      $('smsc-numbers-wrap').hidden = true;
    }
    useTemplate(t.id);
    $('smsc-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (b.dataset.tpl === 'edit') {
    editing = { ...t };
    drawEditor();
  }
  if (b.dataset.tpl === 'remove') {
    if (!confirm(`Ondoa template "${t.title}"?`)) return;
    try {
      info.templates = await ctx.api.post(`/api/admin/sms-templates/${t.id}/archive`);
      drawTemplates();
      drawChips();
    } catch (err) {
      if (ctx.onAuthError(err)) return;
      error(err.message);
    }
  }
}

// ------------------------------------------------------------------ historia

function drawHistory() {
  const list = info.campaigns;
  $('smsc-history').innerHTML = list.length
    ? list
        .map((c) => {
          const [tone, label] = STATUS[c.status] ?? ['muted', c.status];
          const pct = c.total ? Math.round(((c.sent + c.failed) / c.total) * 100) : 0;
          return `<li data-campaign="${c.id}">
            <div class="smsc-h-main">
              <p class="smsc-h-msg">${esc(c.message)}</p>
              <span class="muted small">${esc(LABEL[c.audience] ?? c.audience)}${c.templateTitle ? ` · ${esc(c.templateTitle)}` : ''} · ${esc(formatDate(c.createdAt, true))}${c.createdBy ? ` · ${esc(c.createdBy)}` : ''}</span>
              ${c.status === 'SENDING' ? `<div class="smsc-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>` : ''}
              <div class="smsc-failures" id="smsc-f-${c.id}"></div>
            </div>
            <div class="smsc-h-side">
              <span class="badge badge-${tone}">${label}</span>
              <span class="small"><strong>${c.sent}</strong>/${c.total} zimefika Beem${c.failed ? ` · <span class="smsc-bad">${c.failed} zimeshindwa</span>` : ''}</span>
              <span class="muted small">SMS ${c.units}</span>
              ${c.status === 'SENDING' ? `<button class="btn btn-ghost btn-small" type="button" data-h="stop" data-id="${c.id}">Simamisha</button>` : ''}
              ${c.failed ? `<button class="btn btn-ghost btn-small btn-plain" type="button" data-h="failures" data-id="${c.id}">Zilizoshindwa</button>` : ''}
            </div>
          </li>`;
        })
        .join('')
    : '<li class="muted">Bado hujatuma SMS kutoka hapa.</li>';
  for (const id of openFailures) loadFailures(id);
  const sending = list.some((c) => c.status === 'SENDING');
  if (sending && !pollTimer) {
    pollTimer = setInterval(async () => {
      if (document.visibilityState !== 'visible' || $('page-sms').hidden) return;
      try {
        info.campaigns = (await ctx.api.get('/api/admin/sms-center')).campaigns;
        drawHistory();
      } catch {
        // jaribu tena baadaye
      }
    }, 4000);
  }
  if (!sending) stop();
}

async function loadFailures(id) {
  const box = $(`smsc-f-${id}`);
  if (!box) return;
  try {
    const d = await ctx.api.get(`/api/admin/sms-center/campaigns/${id}`);
    box.innerHTML = d.failures.length
      ? `<ul class="smsc-fail-list">${d.failures
          .map((f) => `<li>${esc(f.name ?? '')} ${esc(formatPhone(f.phone))} <span class="muted small">${esc(f.error ?? '')}</span></li>`)
          .join('')}</ul>`
      : '';
  } catch (err) {
    ctx.onAuthError(err);
  }
}

async function onHistoryAction(e) {
  const b = e.target.closest('[data-h]');
  if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.h === 'failures') {
    if (openFailures.has(id)) {
      openFailures.delete(id);
      $(`smsc-f-${id}`).innerHTML = '';
    } else {
      openFailures.add(id);
      loadFailures(id);
    }
  }
  if (b.dataset.h === 'stop') {
    if (!confirm('Simamisha kutuma? SMS zilizokwisha tumwa haziwezi kurudishwa.')) return;
    try {
      await ctx.api.post(`/api/admin/sms-center/campaigns/${id}/stop`);
      info.campaigns = (await ctx.api.get('/api/admin/sms-center')).campaigns;
      drawHistory();
    } catch (err) {
      if (ctx.onAuthError(err)) return;
      error(err.message);
    }
  }
}
