// Muundo wa fedha, tarehe, simu na majina ya mitandao (saa za Tanzania)
export const NETWORKS = ['mpesa', 'mixx', 'airtel', 'halopesa', 'tpesa'] as const;
export type Network = (typeof NETWORKS)[number];
export const NETWORK_LABEL: Record<Network, string> = {
  mpesa: 'M-Pesa',
  mixx: 'Mixx by Yas',
  airtel: 'Airtel Money',
  halopesa: 'HaloPesa',
  tpesa: 'T-Pesa',
};
export const NETWORK_COLOR: Record<Network, string> = {
  mpesa: '#E60000',
  mixx: '#0033A0',
  airtel: '#B71C1C',
  halopesa: '#F57C00',
  tpesa: '#00838F',
};
export const netLabel = (n: string) => NETWORK_LABEL[n as Network] ?? n;
export const netColor = (n: string) => NETWORK_COLOR[n as Network] ?? '#8A958F';

const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
export const tzs = (n: number | null | undefined) => `TSh ${money.format(Math.round(Number(n ?? 0)))}`;
export const num = (n: number | null | undefined) => money.format(Math.round(Number(n ?? 0)));

const TZ = 'Africa/Dar_es_Salaam';
export function dateTime(d: Date | string | null | undefined): string {
  if (!d) return '-';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
}
export function timeOnly(d: Date | string | null | undefined): string {
  if (!d) return '-';
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
}
const MONTHS = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];
export function niceDate(d: Date | string): string {
  const s = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : todayTz(new Date(d));
  const [y, m, day] = s.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]} ${y}`;
}
/** Tarehe ya leo (YYYY-MM-DD) kwa saa za Tanzania */
export function todayTz(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0754 123 456 / +255754123456 → 255754123456; null kama si namba ya simu */
export function normPhone(p: string | null | undefined): string | null {
  const d = (p ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (/^0[67]\d{8}$/.test(d)) return `255${d.slice(1)}`;
  if (/^[67]\d{8}$/.test(d)) return `255${d}`;
  if (/^255[67]\d{8}$/.test(d)) return d;
  return null;
}
/** 255754123456 → 0754 123 456 */
export function phoneLocal(p: string | null | undefined): string {
  const d = (p ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('255')) {
    const l = `0${d.slice(3)}`;
    return `${l.slice(0, 4)} ${l.slice(4, 7)} ${l.slice(7)}`;
  }
  return d || '-';
}
/** "1,250,000" → 1250000 */
export function parseAmount(v: unknown): number {
  const n = Number(String(v ?? '').replace(/[^\d]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
