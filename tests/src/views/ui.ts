// Vipande vya UI vinavyotumika kwenye kurasa zote
import { html, raw, type Raw } from '../html.js';
import { netColor, netLabel, tzs } from '../format.js';

export const csrfField = (token: string) => html`<input type="hidden" name="_csrf" value="${token}">`;

export function field(
  label: string,
  name: string,
  opts: {
    value?: string | number | null; type?: string; required?: boolean; hint?: string; placeholder?: string;
    autocomplete?: string; inputmode?: string; money?: boolean; autofocus?: boolean; maxlength?: number; min?: number; max?: number; step?: string; id?: string;
  } = {},
): Raw {
  const id = opts.id ?? `f-${name}`;
  return html`<div class="field">
    <label for="${id}">${label}${opts.required ? '' : raw(' <span class="opt">(hiari)</span>')}</label>
    <input id="${id}" name="${name}" type="${opts.type ?? 'text'}" value="${opts.value ?? ''}"
      ${opts.required ? raw('required') : ''} ${opts.autofocus ? raw('autofocus') : ''}
      ${opts.placeholder ? html`placeholder="${opts.placeholder}"` : ''}
      ${opts.autocomplete ? html`autocomplete="${opts.autocomplete}"` : ''}
      ${opts.money ? raw('inputmode="numeric" data-money') : opts.inputmode ? html`inputmode="${opts.inputmode}"` : ''}
      ${opts.maxlength ? html`maxlength="${opts.maxlength}"` : ''}
      ${opts.min !== undefined ? html`min="${opts.min}"` : ''} ${opts.max !== undefined ? html`max="${opts.max}"` : ''}
      ${opts.step ? html`step="${opts.step}"` : ''}>
    ${opts.hint ? html`<small class="hint">${opts.hint}</small>` : ''}
  </div>`;
}

export function select(
  label: string,
  name: string,
  options: { value: string; label: string }[],
  selected?: string | null,
  opts: { required?: boolean; hint?: string; submitOnChange?: boolean } = {},
): Raw {
  return html`<div class="field">
    <label for="f-${name}">${label}</label>
    <select id="f-${name}" name="${name}" ${opts.required ? raw('required') : ''} ${opts.submitOnChange ? raw('data-autosubmit') : ''}>
      ${options.map((o) => html`<option value="${o.value}" ${o.value === (selected ?? '') ? raw('selected') : ''}>${o.label}</option>`)}
    </select>
    ${opts.hint ? html`<small class="hint">${opts.hint}</small>` : ''}
  </div>`;
}

export const netChip = (n: string) =>
  html`<span class="net" style="--c:${raw(netColor(n))}"><i></i>${netLabel(n)}</span>`;

export const ainaChip = (aina: string) =>
  aina === 'tuma' ? html`<span class="pill pill-tuma">Tuma</span>` : html`<span class="pill pill-toa">Toa</span>`;

export function stat(label: string, value: string, tone: '' | 'gold' | 'green' = ''): Raw {
  return html`<div class="stat ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
}

export function empty(text: string, action?: Raw): Raw {
  return html`<div class="empty"><div class="empty-dot"></div><p>${text}</p>${action ?? ''}</div>`;
}

export const money = (n: number) => tzs(n);

export function variance(v: number): Raw {
  if (v === 0) return html`<span class="var ok">Sawa</span>`;
  return v < 0 ? html`<span class="var bad">Upungufu ${tzs(-v)}</span>` : html`<span class="var more">Ziada ${tzs(v)}</span>`;
}

/** Chati ndogo ya pau (SVG) — haina maktaba ya nje */
export function barChart(points: { label: string; value: number; sub?: string }[], fmt: (n: number) => string): Raw {
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 100 / points.length;
  return html`<div class="chart" role="img" aria-label="Chati ya kamisheni kwa siku">
    ${points.map((p) => {
      const h = Math.round((p.value / max) * 100);
      return html`<div class="bar" style="width:${raw(String(w))}%">
        <span class="bar-val">${p.value ? fmt(p.value) : ''}</span>
        <div class="bar-col"><div class="bar-fill" style="height:${raw(String(Math.max(h, p.value ? 3 : 0)))}%"></div></div>
        <span class="bar-label">${p.label}</span>
      </div>`;
    })}
  </div>`;
}
