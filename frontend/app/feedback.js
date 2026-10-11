// Maoni (kichupo cha menyu ya chini, kwa abiria na madereva): nyota + mada + maneno → ofisi ya NAYA.
// Njia za kufika hapa:
//   #/maoni                                   kichupo cha "Maoni"
//   #/maoni?safari=<id>&aina=baada&…          baada ya safari (kwenye skrini ya nyota)
//   #/maoni?safari=<id>&aina=tatizo&…         safari ilikwama: "Hakuna dereva" / "Imeghairiwa"
// Mtoaji anaona maoni yake na "Jibu la ofisi"; jibu jipya linaonyesha kitone kwenye kichupo.
import { escapeHtml as esc } from '/shared/api.js';
import { FEEDBACK_STATUS, FEEDBACK_TOPICS, formatDate } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, handleError, toast, setUnread }
let context = null; // safari iliyoambatanishwa { rideId, from, to, problem, close }
const RATING_WORDS = ['', 'Mbaya sana', 'Mbaya', 'Wastani', 'Nzuri', 'Nzuri sana'];
const PROBLEM_HINTS = [
  'Nilisubiri muda mrefu bila dereva',
  'Dereva alighairi',
  'Bei haikuwa sawa',
  'App ilikataa / ilikwama',
];

export function init(c) {
  ctx = c;
  $('app-content').addEventListener('submit', onSubmit);
  $('app-content').addEventListener('change', (event) => {
    if (event.target.name !== 'fb-rating') return;
    $('fb-rating-word').textContent = RATING_WORDS[Number(event.target.value)] ?? '';
    $('fb-error').hidden = true;
  });
  $('app-content').addEventListener('click', (event) => {
    const hint = event.target.closest('[data-fb-hint]');
    if (hint) {
      const box = $('fb-body');
      const text = hint.textContent.trim(); // maandishi yanayoonekana (Kiswahili au English)
      box.value = box.value.trim() ? `${box.value.trim()}. ${text}` : text;
      $('fb-count').textContent = String(box.value.length);
      box.focus();
      return;
    }
    if (event.target.closest('[data-fb-unlink]')) {
      context = null;
      history.replaceState(null, '', '#/maoni');
      renderPage();
    }
  });
}

/** Anaandika maoni sasa hivi? (usichore upya ukurasa) */
export const isTyping = () => Boolean($('fb-body')?.value.trim()) || document.activeElement?.id === 'fb-body';

function readContext(params) {
  const rideId = params.get('safari');
  if (!rideId) return null;
  return {
    rideId,
    from: params.get('kutoka') ?? '',
    to: params.get('kwenda') ?? '',
    problem: params.get('aina') === 'tatizo',
    close: params.get('funga') === 'dereva' ? 'dereva' : 'abiria',
  };
}

export function renderPage(params = new URLSearchParams()) {
  context = readContext(params);
  const driver = document.body.classList.contains('mode-driver');
  const topic = context ? 'RIDE' : 'GENERAL';
  const topics = Object.entries(FEEDBACK_TOPICS)
    .filter(([k]) => k !== 'RIDE' || context)
    .map(([k, l]) => `<option value="${k}"${k === topic ? ' selected' : ''}>${esc(l)}</option>`)
    .join('');
  const starInputs = [1, 2, 3, 4, 5]
    .map((n) => `<input type="radio" name="fb-rating" id="fb-star-${n}" value="${n}"><label for="fb-star-${n}" title="${RATING_WORDS[n]}"><span class="sr-only">Nyota ${n}</span>★</label>`)
    .join('');
  const ride = context
    ? `<div class="fb-context${context.problem ? ' is-problem' : ''}">
        <span class="fb-context-label">${context.problem ? 'Safari iliyokwama' : 'Kuhusu safari'}</span>
        <strong>${esc(context.from)} → ${esc(context.to)}</strong>
        <button class="link-btn" type="button" data-fb-unlink>Maoni ya jumla badala yake</button>
      </div>`
    : '';
  const hints = context?.problem
    ? `<div class="fb-hints" role="group" aria-label="Mifano">${PROBLEM_HINTS.map((h) => `<button type="button" class="fb-hint" data-fb-hint="${esc(h)}">${esc(h)}</button>`).join('')}</div>`
    : '';
  $('app-content').innerHTML = `
    <section class="fb-hero">
      <h1>${context?.problem ? 'Tuambie kilichotokea' : 'Maoni'}</h1>
      <p>${
        context?.problem
          ? 'Samahani kwa usumbufu. Eleza kilichotokea — ofisi ya NAYA inasoma na kukujibu hapa.'
          : driver
            ? 'Unaonaje kazi na NAYA? Maoni yako kuhusu maombi, wateja, app au malipo yanafika ofisini moja kwa moja.'
            : 'Unaonaje huduma ya NAYA? Maoni yako yanafika ofisini moja kwa moja, na majibu yanakuja hapa.'
      }</p>
    </section>
    <form id="feedback-form" class="card feedback-form" novalidate>
      ${ride}
      <fieldset class="star-pick">
        <legend>${context ? 'Safari hii ilikuwaje?' : 'Unaipa NAYA nyota ngapi?'}</legend>
        <div class="star-row">${starInputs}</div>
        <span class="muted small" id="fb-rating-word" aria-live="polite"></span>
      </fieldset>
      <label for="fb-topic">Kuhusu</label>
      <select id="fb-topic">${topics}</select>
      <label for="fb-body">Maoni yako</label>
      ${hints}
      <textarea id="fb-body" rows="4" maxlength="1000" placeholder="${
        context?.problem ? 'Mfano: nilisubiri dakika 10 Stendi bila dereva kupatikana' : 'Mfano: bei, madereva, app, au wazo la kuboresha NAYA'
      }"></textarea>
      <p class="muted small fb-count"><span id="fb-count">0</span>/1000</p>
      <p class="alert alert-danger" id="fb-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Tuma maoni</button>
    </form>
    <section class="card fb-mine-card" aria-labelledby="fb-mine-title">
      <h2 id="fb-mine-title">Maoni uliyotuma</h2>
      <div id="fb-mine"><p class="muted">Inaangalia…</p></div>
    </section>`;
  $('fb-body').addEventListener('input', () => {
    $('fb-count').textContent = String($('fb-body').value.length);
  });
  loadList();
}

const stars = (n) => `<span class="stars" aria-label="Nyota ${n} kati ya 5">${'★'.repeat(n)}<span class="stars-off">${'★'.repeat(5 - n)}</span></span>`;

export async function loadList() {
  try {
    const items = await ctx.api.get('/api/feedback');
    if (!$('fb-mine')) return;
    $('fb-mine').innerHTML = items.length
      ? `<ul class="fb-mine">${items
          .map(
            (f) => `<li${f.unread ? ' class="is-unread"' : ''}>
              <div class="fb-mine-head">${stars(f.rating)}${f.unread ? '<span class="badge badge-ok">Jibu jipya</span>' : ''}<span class="badge badge-${FEEDBACK_STATUS[f.status].tone}">${esc(FEEDBACK_STATUS[f.status].label)}</span></div>
              <p>${esc(f.body)}</p>
              <span class="muted small">${esc(FEEDBACK_TOPICS[f.topic] ?? '')}${f.ride ? ` · ${esc(f.ride.from)} → ${esc(f.ride.to)}` : ''} · ${esc(formatDate(f.createdAt, true))}</span>
              ${f.officeNote ? `<p class="fb-office"><strong>Jibu la ofisi:</strong> ${esc(f.officeNote)}</p>` : ''}
            </li>`,
          )
          .join('')}</ul>`
      : '<p class="muted">Bado hujatuma maoni. Maoni yako ya kwanza yanaweza kuboresha NAYA kwa wote.</p>';
    // Majibu mapya yameonekana sasa
    if (items.some((f) => f.unread)) {
      await ctx.api.post('/api/feedback/seen', {}).catch(() => {});
      ctx.setUnread(0);
    }
  } catch (err) {
    ctx.handleError(err);
  }
}

async function onSubmit(event) {
  if (event.target.id !== 'feedback-form') return;
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  $('fb-error').hidden = true;
  const rating = Number(form.querySelector('input[name="fb-rating"]:checked')?.value ?? 0);
  if (!rating) {
    $('fb-error').textContent = 'Chagua nyota (1 hadi 5).';
    $('fb-error').hidden = false;
    return;
  }
  button.disabled = true;
  try {
    const linked = context;
    await ctx.api.post('/api/feedback', {
      rating,
      topic: $('fb-topic').value,
      body: $('fb-body').value,
      ...(linked ? { rideId: linked.rideId, source: linked.problem ? 'PROBLEM' : 'AFTER_RIDE' } : { source: 'MENU' }),
    });
    // Safari iliyokwama: skrini yake imeshashughulikiwa — ifunge kimya.
    if (linked?.problem) {
      const url = linked.close === 'dereva' ? `/api/driver/rides/${linked.rideId}/close` : `/api/rides/${linked.rideId}/close`;
      await ctx.api.post(url, {}).catch(() => {});
    }
    context = null;
    ctx.toast('Asante! Maoni yako yamefika ofisini.');
    if (location.hash !== '#/maoni') history.replaceState(null, '', '#/maoni');
    renderPage();
  } catch (err) {
    ctx.handleError(err, 'fb-error');
    button.disabled = false;
  }
}
