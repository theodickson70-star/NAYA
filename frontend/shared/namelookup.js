// Jina la mwenye namba (0.20.0): mtumiaji anaandika namba tu → NAYA inauliza mtandao (kupitia Abliner) jina lake.
// Inatumika kwenye: namba za malipo za dereva, Ofisi → Ongeza staff, NAYA Staff → Sajili bodaboda.
// Huduma isipopatikana, fomu inaendelea kama zamani (mtumiaji anaandika jina).

/** Namba ya Tanzania iliyokamilika → 2557XXXXXXXX, vinginevyo null (bado anaandika). */
export function completePhone(value) {
  const d = String(value ?? '').replace(/[^\d]/g, '');
  if (/^0[67]\d{8}$/.test(d)) return `255${d.slice(1)}`;
  if (/^255[67]\d{8}$/.test(d)) return d;
  if (/^[67]\d{8}$/.test(d)) return `255${d}`;
  return null;
}

/**
 * Sikiliza input ya namba: ikikamilika, uliza jina (mara moja kwa kila namba). onState anapokea:
 *   { state: 'idle' } · { state: 'loading', phone } · { state: 'done', phone, result } · { state: 'error', phone, message }
 * result = { available, found, name, displayName, network, networkLabel }
 */
export function watchPhone(input, { api, purpose, onState, path = '/api/name-lookup', body = (phone) => ({ phone, purpose }) }) {
  let last = null;
  let timer = null;
  let seq = 0;
  const run = async () => {
    const phone = completePhone(input.value);
    if (phone === last) return;
    last = phone;
    if (!phone) return onState({ state: 'idle' });
    const my = ++seq;
    onState({ state: 'loading', phone });
    try {
      const result = await api.post(path, body(phone));
      if (my === seq) onState({ state: 'done', phone, result });
    } catch (err) {
      if (my === seq) onState({ state: 'error', phone, message: err.message, err });
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, 450);
  };
  // Wakati wa kuandika tu (si blur/change): kisanduku cha jina kikitokea mtu akibonyeza kitufe, kitufe kingesogea
  // chini ya kidole na kubonyeza kungepotea.
  input.addEventListener('input', schedule);
  // Namba iliyokwisha andikwa (mf. kubadilisha) → uliza mara moja
  if (completePhone(input.value)) schedule();
  return {
    /** Namba imekamilika lakini jibu bado halijafika? */
    pending: () => !!completePhone(input.value) && completePhone(input.value) !== last,
    /** Lazimisha kuuliza tena (mf. baada ya kosa) */
    retry() {
      last = null;
      run();
    },
    stop() {
      clearTimeout(timer);
      input.removeEventListener('input', schedule);
    },
  };
}
