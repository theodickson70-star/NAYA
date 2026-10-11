// Animation ya kufunguka NAYA (CSS inaiendesha; hapa ni muda, maandishi na kuifunga).
// Mara ya kwanza kwenye kikao: ~sekunde 2.9 (logo inang'aa → inazunguka na chembe → jina NAYA linajichora).
// Refresh baadaye kwenye kikao kile kile: fupi. App ikichelewa kupakia, animation inaendelea mpaka iwe tayari.
const root = document.documentElement;
const el = document.getElementById('view-loading');
const quick = root.classList.contains('splash-quick');
const minUntil = performance.now() + (quick ? 650 : 2900);
let done = false;

const status = (text) => {
  const s = document.getElementById('splash-status');
  if (s) s.textContent = text;
};
if (!quick) {
  setTimeout(() => !done && status('Inapakia mfumo…'), 950);
  setTimeout(() => !done && status('Tunakuletea uzoefu bora…'), 1900);
}

// ---- Sauti ya logo (imeanzishwa na boot.js) ----
const audio = window.__nayaIntroAudio ?? null;
/** Muda wa animation ya logo sasa hivi (sekunde) — sauti ilingane nayo hata ikichelewa kuanza. */
function animationTime() {
  // Mstari wa maendeleo unadumu muda wote wa animation (sek 2.8) — ndio saa yetu.
  const anim = document.querySelector('.splash-progress span')?.getAnimations?.()[0];
  return anim && typeof anim.currentTime === 'number' ? anim.currentTime / 1000 : null;
}
if (audio) {
  // Sauti na picha zilingane: sahihisha mara chache mwanzoni kama zimeachana zaidi ya sek 0.1.
  let fixes = 0;
  const sync = () => {
    const t = animationTime();
    if (t === null || t <= 0) return;
    if (fixes >= 2 || audio.currentTime > 1.6) return audio.removeEventListener('timeupdate', sync);
    if (Math.abs(audio.currentTime - t) > 0.1 && t < 2.6) {
      audio.currentTime = t;
      fixes += 1;
    }
  };
  audio.addEventListener('timeupdate', sync);
  // Browser imezuia sauti kabla ya kugusa skrini → jaribu tena mtu akigusa wakati logo bado inajitengeneza.
  const retry = () => {
    if (done || !audio.paused) return;
    const t = animationTime();
    if (t !== null && t > 2.4) return; // imechelewa mno — usipige sauti katikati ya skrini nyingine
    audio.play().catch(() => {});
  };
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, retry, { once: true, capture: true });
}

export const soundEnabled = () => {
  try {
    return localStorage.getItem('naya_sound') !== 'off';
  } catch {
    return true;
  }
};
export function setSoundEnabled(on) {
  try {
    if (on) localStorage.removeItem('naya_sound');
    else localStorage.setItem('naya_sound', 'off');
  } catch {
    // storage imezuiwa
  }
}
/** Sikiliza sauti ya NAYA (kutoka kwenye Akaunti). */
export function previewSound() {
  const a = new Audio('/shared/sounds/naya-intro.mp3');
  a.volume = 0.85;
  return a.play();
}

export const splashActive = () => !done;

/** Inatimia muda wa chini wa animation (haichelewi zaidi ya hapo). */
export const splashReady = () => new Promise((resolve) => setTimeout(resolve, Math.max(0, minUntil - performance.now())));

/** Funga animation: logo inafifia na kukua kidogo huku skrini inayofuata ikiingia. */
export function finishSplash() {
  if (done) return;
  done = true;
  try {
    sessionStorage.setItem('naya_splash_seen', '1');
  } catch {
    // storage imezuiwa
  }
  el.classList.add('splash-out');
  setTimeout(() => {
    el.hidden = true;
    el.classList.remove('splash-out');
    root.classList.add('splash-quick'); // ikionekana tena (mf. "Jaribu tena"), iwe fupi
  }, 650);
}
