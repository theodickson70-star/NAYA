// Chati ndogo ya nguzo (SVG) kwa ofisi: mfululizo mmoja, rangi ya NAYA, kidokezo ukipitisha kidole/kipanya.
// Hakuna maktaba ya nje — inachora haraka hata kwenye simu za kawaida.

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

/** Namba "nzuri" juu ya kiwango cha juu (1, 2, 5 × 10^n) ili mistari ya gridi iwe namba rahisi. */
function niceMax(max) {
  if (max <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) if (max <= step * pow) return step * pow;
  return 10 * pow;
}

/**
 * @param {HTMLElement} host
 * @param {{label: string, value: number, tip?: string}[]} data
 * @param {{format?: (n:number)=>string, labelEvery?: number}} options
 */
export function barChart(host, data, options = {}) {
  const { format = (n) => n.toLocaleString('en-US'), labelEvery } = options;
  // Chora upya upana ukibadilika (mf. simu ikigeuzwa) — data ile ile.
  host._chart = { data, options, width: host.clientWidth };
  if (!host._ro && 'ResizeObserver' in window) {
    host._ro = new ResizeObserver(() => {
      const c = host._chart;
      if (c && Math.abs(host.clientWidth - c.width) > 8) barChart(host, c.data, c.options);
    });
    host._ro.observe(host);
  }
  host.innerHTML = '';
  if (!data.length || data.every((d) => !d.value)) {
    host.innerHTML = '<div class="chart-empty">Bado hakuna data kwa kipindi hiki.</div>';
    return;
  }
  const width = Math.max(host.clientWidth, 280);
  const height = host.clientHeight || 220;
  const pad = { top: 10, right: 6, bottom: 24, left: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const slot = plotW / data.length;
  const gap = Math.max(2, Math.min(10, slot * 0.28));
  const barW = Math.max(2, slot - gap);
  const y = (v) => pad.top + plotH - (v / max) * plotH;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}` });
  // Gridi tulivu: 0, nusu, juu
  for (const v of [0, max / 2, max]) {
    svg.append(el('line', { class: 'grid', x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v) }));
    const t = el('text', { class: 'axis-label', x: pad.left - 8, y: y(v) + 4, 'text-anchor': 'end' });
    t.textContent = format(v);
    svg.append(t);
  }
  const every = labelEvery ?? Math.max(1, Math.ceil(data.length / 7));
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;

  data.forEach((d, i) => {
    const x = pad.left + i * slot + gap / 2;
    const top = d.value > 0 ? Math.min(y(d.value), pad.top + plotH - 3) : pad.top + plotH - 2;
    const h = pad.top + plotH - top;
    const r = Math.min(4, barW / 2, h);
    // Juu yenye pembe za mviringo, chini tambarare (imeshikamana na msingi).
    const path = `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`;
    const bar = el('path', { class: d.value > 0 ? 'bar' : 'bar bar-zero', d: path });
    svg.append(bar);
    if (i % every === 0 || i === data.length - 1) {
      const t = el('text', { class: 'axis-label', x: x + barW / 2, y: height - 6, 'text-anchor': 'middle' });
      t.textContent = d.label;
      svg.append(t);
    }
    // Eneo kubwa la kugusa kuliko nguzo yenyewe.
    const hit = el('rect', { class: 'hit', x: pad.left + i * slot, y: pad.top, width: slot, height: plotH });
    const show = () => {
      bar.classList.add('hot');
      tip.innerHTML = `<strong>${format(d.value)}</strong>${d.tip ?? d.label}`;
      tip.style.left = `${((x + barW / 2) / width) * 100}%`;
      tip.style.top = `${(top / height) * 100}%`;
      tip.hidden = false;
    };
    const hide = () => {
      bar.classList.remove('hot');
      tip.hidden = true;
    };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointerleave', hide);
    svg.append(hit);
  });
  host.append(svg, tip);
}

/** "2026-10-07" → "7 Okt" */
export function shortDay(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('sw-TZ', { day: 'numeric', month: 'short' });
}
