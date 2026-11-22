import type { Db } from '../db.js';

export type Actor = { id: string | null; biashara_id: string; jina: string | null };

/** Andika kumbukumbu (audit log). Haibadilishwi wala kufutwa. */
export async function audit(c: Db, actor: Actor, kitendo: string, maelezo: string, ip?: string | null): Promise<void> {
  await c.query(
    `INSERT INTO paypoint.kumbukumbu (biashara_id, mtumiaji_id, jina, kitendo, maelezo, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
    [actor.biashara_id, actor.id, actor.jina, kitendo, maelezo.slice(0, 500), ip ?? null],
  );
}

export async function notifyOwner(c: Db, biasharaId: string, aina: string, ujumbe: string): Promise<void> {
  await c.query(`INSERT INTO paypoint.arifa (biashara_id, aina, ujumbe) VALUES ($1, $2, $3)`, [biasharaId, aina, ujumbe.slice(0, 400)]);
}

export const KITENDO_LABEL: Record<string, string> = {
  login: 'Kuingia',
  login_failed: 'Kuingia kumeshindwa',
  logout: 'Kutoka',
  tuma: 'Tuma',
  toa: 'Toa',
  batilisha: 'Kubatilisha',
  float: 'Float / cash',
  mfanyakazi: 'Wafanyakazi',
  mteja: 'Wateja',
  duka: 'Maduka',
  kamisheni: 'Kamisheni',
  hesabu: 'Hesabu ya siku',
  password: 'Password',
  usajili: 'Usajili',
};
