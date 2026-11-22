// Hesabu ya siku: cash na float halisi vs mfumo
import { db, many, transaction } from '../db.js';
import { AppError } from '../errors.js';
import { netLabel, tzs } from '../format.js';
import type { SessionUser } from '../auth.js';
import { audit, notifyOwner } from './audit.js';
import { balances, dukaNetworks } from './ledger.js';

export async function submitCount(
  user: SessionUser & { duka_id: string },
  input: { cash: number; floats: Record<string, number>; maelezo?: string | null },
  ip?: string,
): Promise<number> {
  return transaction(async (c) => {
    const duka = (await c.query('SELECT jina FROM paypoint.maduka WHERE id = $1 FOR UPDATE', [user.duka_id])).rows[0] as { jina: string };
    const nets = await dukaNetworks(c, user.duka_id);
    const b = await balances(c, user.duka_id);
    if (!Number.isInteger(input.cash) || input.cash < 0) throw new AppError('Weka cash halisi uliyohesabu');
    const floats = nets.map((n) => {
      const halisi = input.floats[n.mtandao];
      if (!Number.isInteger(halisi) || halisi < 0) throw new AppError(`Weka float halisi ya ${netLabel(n.mtandao)}`);
      const mfumo = b.floats[n.mtandao] ?? 0;
      return { mtandao: n.mtandao, mfumo, halisi, tofauti: halisi - mfumo };
    });
    const tofauti = input.cash - b.cash + floats.reduce((a, f) => a + f.tofauti, 0);
    const r = await c.query(
      `INSERT INTO paypoint.hesabu (biashara_id, duka_id, mtumiaji_id, cash_mfumo, cash_halisi, floats, tofauti, maelezo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [user.biashara_id, user.duka_id, user.id, b.cash, input.cash, JSON.stringify(floats), tofauti, input.maelezo?.trim() || null],
    );
    const hali = tofauti === 0 ? 'hesabu iko sawa' : tofauti < 0 ? `UPUNGUFU ${tzs(-tofauti)}` : `ziada ${tzs(tofauti)}`;
    const actor = { id: user.id, biashara_id: user.biashara_id, jina: user.jina };
    await audit(c, actor, 'hesabu', `Hesabu ya ${duka.jina}: ${hali}`, ip);
    if (tofauti !== 0) await notifyOwner(c, user.biashara_id, 'hesabu', `${user.jina} amehesabu ${duka.jina}: ${hali}`);
    return Number(r.rows[0].id);
  });
}

export type CountRow = {
  id: number; duka: string; mfanyakazi: string; cash_mfumo: number; cash_halisi: number;
  floats: { mtandao: string; mfumo: number; halisi: number; tofauti: number }[]; tofauti: number; maelezo: string | null; tarehe: string;
};
export async function listCounts(user: SessionUser, from: string, to: string): Promise<CountRow[]> {
  return many<CountRow>(
    db,
    `SELECT h.id, d.jina AS duka, u.jina AS mfanyakazi, h.cash_mfumo, h.cash_halisi, h.floats, h.tofauti, h.maelezo, h.tarehe
       FROM paypoint.hesabu h JOIN paypoint.maduka d ON d.id = h.duka_id JOIN paypoint.watumiaji u ON u.id = h.mtumiaji_id
      WHERE h.biashara_id = $1 AND ($2 = 'owner' OR h.mtumiaji_id = $3)
        AND (h.tarehe AT TIME ZONE 'Africa/Dar_es_Salaam')::date BETWEEN $4::date AND $5::date
      ORDER BY h.tarehe DESC LIMIT 300`,
    [user.biashara_id, user.role, user.id, from, to],
  );
}
