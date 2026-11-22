// Templates salama: kila kitu kinachoingizwa kwenye html`...` kinasafishwa (escape) isipokuwa kimefungwa na raw().
export class Raw {
  constructor(readonly value: string) {}
  toString() {
    return this.value;
  }
}
export const raw = (s: string) => new Raw(s);

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

function render(v: unknown): string {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(String(v));
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}
