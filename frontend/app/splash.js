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
