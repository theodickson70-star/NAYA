// Lugha mbili: maandishi ya server yameandikwa kwa Kiswahili; mtumiaji wa English anapata tafsiri
// kutoka kamusi ile ile ya app (frontend/shared/i18n/en.json) — makosa, arifa (push/FCM) na SMS.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyRequest } from 'fastify';
import { db, one } from '../db/pool.js';

export type Lang = 'sw' | 'en';

const DICT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'shared', 'i18n', 'en.json');
let dict: { exact: Map<string, string>; patterns: [RegExp, string][] } | null = null;

function load() {
  if (dict) return dict;
  try {
    const raw = JSON.parse(readFileSync(DICT_PATH, 'utf8')) as { exact: Record<string, string>; patterns: [string, string][] };
    dict = {
      exact: new Map(Object.entries(raw.exact)),
      patterns: raw.patterns.map(([sw, en]) => [
        new RegExp(`^${sw.split('{}').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.+?)')}$`, 's'),
        en,
      ]),
    };
  } catch (error) {
    console.error(`[i18n] kamusi haikupakia: ${(error as Error).message}`);
    dict = { exact: new Map(), patterns: [] };
  }
  return dict;
}

/** Tafsiri ujumbe mmoja. Usiojulikana unabaki kwa Kiswahili. */
export function tr(text: string, lang: Lang): string {
  if (lang !== 'en' || !text) return text;
  const d = load();
  const core = text.trim().replace(/\s+/g, ' ');
  const direct = d.exact.get(core);
  if (direct !== undefined) return direct;
  for (const [re, en] of d.patterns) {
    const m = re.exec(core);
    if (!m) continue;
    let i = 1;
    return en.replace(/\{\}/g, () => {
      const part = m[i++] ?? '';
      return d.exact.get(part.trim()) ?? part;
    });
  }
  // Ujumbe uliounganishwa kwa ". " (mf. makosa kadhaa ya fomu): tafsiri kila sehemu.
  if (core.includes('. ')) {
    const parts = core.split('. ');
    const out = parts.map((p, n) => tr(n < parts.length - 1 ? p : p, 'en'));
    if (out.some((p, n) => p !== parts[n])) return out.join('. ');
  }
  return text;
}

export const requestLang = (request: FastifyRequest): Lang => (request.headers['x-naya-lang'] === 'en' ? 'en' : 'sw');

export async function userLang(userId: string): Promise<Lang> {
  const row = await one<{ language: Lang }>(db, 'SELECT language FROM naya.users WHERE id = $1', [userId]);
  return row?.language === 'en' ? 'en' : 'sw';
}

export async function phoneLang(phone: string): Promise<Lang> {
  const row = await one<{ language: Lang }>(db, 'SELECT language FROM naya.users WHERE phone = $1', [phone]);
  return row?.language === 'en' ? 'en' : 'sw';
}
