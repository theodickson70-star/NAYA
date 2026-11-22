// Vitu vidogo vya muonekano vinavyotumiwa na kurasa zote za ofisi.
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let toastTimer = null;
/** Ujumbe mfupi chini ya skrini ("Imehifadhiwa") — unajiondoa wenyewe baada ya sekunde 3. */
export function toast(message, tone = 'ok') {
  let el = document.getElementById('admin-toast');
  if (!el) {
    el = document.createElement('p');
    el.id = 'admin-toast';
    el.className = 'admin-toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/** Namba inahesabu kutoka 0 hadi thamani yake (mara ya kwanza tu ukurasa unapofunguka). */
export function countUp(el, value, format = (v) => Math.round(v).toLocaleString('sw-TZ')) {
  if (!el) return;
  if (reducedMotion() || !Number.isFinite(value) || value === 0) {
    el.textContent = format(value);
    return;
  }
  const start = performance.now();
  const duration = 650;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(value * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
