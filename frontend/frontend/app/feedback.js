// Maoni kwenye app: abiria au dereva anatoa nyota + maoni kuhusu NAYA; ofisi inayasoma na kuyafanyia kazi,
// na mtoaji anaona "Hatua ya ofisi" hapa (pamoja na arifa kwenye simu).
import { escapeHtml as esc } from '/shared/api.js';
import { FEEDBACK_STATUS, FEEDBACK_TOPICS, formatDate } from '/shared/labels.js';

const $ = (id) => document.getElementById(id);
let ctx = null; // { api, handleError, toast }
const RATING_WORDS = ['', 'Mbaya sana', 'Mbaya', 'Wastani', 'Nzuri', 'Nzuri sana'];

export function init(context) {
  ctx = context;
  $('app-content').addEventListener('submit', onSubmit);
  $('app-content').addEventListener('change', (event) => {
    if (event.target.name !== 'fb-rating') return;
    $('fb-rating-word').textContent = RATING_WORDS[Number(event.target.value)] ?? '';
    $('fb-error').hidden = true;
  });
}

export function cardHtml() {
  const topics = Object.entries(FEEDBACK_TOPICS)
    .map(([k, l]) => `<option value="${k}">${esc(l)}</option>`)
    .join('');
  const starInputs = [1, 2, 3, 4, 5]
    .map((n) => `<input type="radio" name="fb-rating" id="fb-star-${n}" value="${n}"><label for="fb-star-${n}" title="${RATING_WORDS[n]}"><span class="sr-only">Nyota ${n}</span>★</label>`)
    .join('');
  return `<section class="card feedback-card" aria-labelledby="fb-title">
    <h2 id="fb-title">Toa maoni</h2>
    <p class="muted">Unaonaje huduma ya NAYA? Maoni yako yanafika moja kwa moja ofisini na yanafanyiwa kazi.</p>
    <form id="feedback-form" class="feedback-form" novalidate>
      <fieldset class="star-pick">
        <legend>Nyota</legend>
        <div class="star-row">${starInputs}</div>
        <span class="muted small" id="fb-rating-word" aria-live="polite"></span>
      </fieldset>
      <label for="fb-topic">Kuhusu</label>
      <select id="fb-topic">${topics}</select>
      <label for="fb-body">Maoni yako</label>
      <textarea id="fb-body" rows="3" maxlength="1000" placeholder="Mfano: bei, madereva, app, au wazo la kuboresha NAYA"></textarea>
      <p class="alert alert-danger" id="fb-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-block" type="submit">Tuma maoni</button>
    </form>
    <div id="fb-mine"></div>
  </section>`;
}

/** Anaandika maoni sasa hivi? (usichore upya Akaunti) */
export const isTyping = () => Boolean($('fb-body')?.value.trim()) || document.activeElement?.id === 'fb-body';

const stars = (n) => `<span class="stars" aria-label="Nyota ${n} kati ya 5">${'★'.repeat(n)}<span class="stars-off">${'★'.repeat(5 - n)}</span></span>`;

export async function loadCardList() {
  try {
    const items = await ctx.api.get('/api/feedback');
    if (!$('fb-mine')) return;
    $('fb-mine').innerHTML = items.length
      ? `<h3 class="fb-mine-title">Maoni uliyotuma</h3><ul class="fb-mine">${items
          .slice(0, 5)
          .map(
            (f) => `<li>
              <div class="fb-mine-head">${stars(f.rating)}<span class="badge badge-${FEEDBACK_STATUS[f.status].tone}">${esc(FEEDBACK_STATUS[f.status].label)}</span></div>
              <p>${esc(f.body)}</p>
              <span class="muted small">${esc(FEEDBACK_TOPICS[f.topic] ?? '')} · ${esc(formatDate(f.createdAt, true))}</span>
              ${f.officeNote ? `<p class="fb-office"><strong>Hatua ya ofisi:</strong> ${esc(f.officeNote)}</p>` : ''}
            </li>`,
          )
          .join('')}</ul>`
      : '';
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
    await ctx.api.post('/api/feedback', { rating, topic: $('fb-topic').value, body: $('fb-body').value });
    form.reset();
    $('fb-rating-word').textContent = '';
    ctx.toast('Asante! Maoni yako yamefika ofisini.');
    await loadCardList();
  } catch (err) {
    ctx.handleError(err, 'fb-error');
  }
  button.disabled = false;
}
