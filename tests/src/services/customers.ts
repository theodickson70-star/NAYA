// Daftari la wateja. Mfanyakazi anaona miamala YAKE tu na kila mteja.
import { db, many, one } from '../db.js';
import { AppError } from '../errors.js';
import { normPhone } from '../format.js';
import type { SessionUser } from '../auth.js';
import { audit } from './audit.js';

export type Customer = {
  id: string; jina: string | null; simu: string; maelezo: string | null; tarehe_imeundwa: string;
  miamala: number; thamani: number; mwisho: string | null;
};

export async function listCustomers(user: SessionUser, search: string, limit = 300): Promise<Customer[]> {
  const q = search.trim();
  const digits = q.replace(/\D/g, '');
  return many<Customer>(
    db,
    `SELECT w.id, w.jina, w.simu, w.maelezo, w.tarehe_imeundwa,
            COUNT(m.id)::int AS miamala, COALESCE(SUM(m.kiasi), 0)::bigint AS thamani, MAX(m.tarehe) AS mwisho
       FROM paypoint.wateja w
       LEFT JOIN paypoint.miamala m ON m.mteja_id = w.id AND NOT m.imebatilishwa AND ($2 = 'owner' OR m.mtumiaji_id = $3)
      WHERE w.biashara_id = $1
        AND ($4 = '' OR w.jina ILIKE '%' || $4 || '%' OR ($5 <> '' AND w.simu LIKE '%' || $5 || '%') OR w.simu = $6)
      GROUP BY w.id
      ORDER BY MAX(m.tarehe) DESC NULLS LAST, w.jina
      LIMIT $7`,
    [user.biashara_id, user.role, user.id, q, digits.replace(/^0/, ''), normPhone(q) ?? '', limit],
  );
}

export async function getCustomer(user: SessionUser, id: string) {
  const c = await one<Customer>(
    db,
    `SELECT id, jina, simu, maelezo, tarehe_imeundwa, 0 AS miamala, 0 AS thamani, NULL AS mwisho
       FROM paypoint.wateja WHERE id = $1 AND biashara_id = $2`,
    [id, user.biashara_id],
  );
  if (!c) throw new AppError('Mteja hayupo', 404);
  const txs = await many<{
    id: number; aina: string; mtandao: string; kiasi: number; kamisheni: number; tarehe: string;
    imebatilishwa: boolean; mfanyakazi: string; duka: string;
  }>(
    db,
    `SELECT m.id, m.aina, m.mtandao, m.kiasi, m.kamisheni, m.tarehe, m.imebatilishwa, u.jina AS mfanyakazi, d.jina AS duka
       FROM paypoint.miamala m JOIN paypoint.watumiaji u ON u.id = m.mtumiaji_id JOIN paypoint.maduka d ON d.id = m.duka_id
      WHERE m.mteja_id = $1 AND m.biashara_id = $2 AND ($3 = 'owner' OR m.mtumiaji_id = $4)
      ORDER BY m.tarehe DESC LIMIT 300`,
    [id, user.biashara_id, user.role, user.id],
  );
  return { customer: c, txs };
}

export async function customerByPhone(user: SessionUser, phone: string) {
  const simu = normPhone(phone);
  if (!simu) return null;
  return one<{ id: string; jina: string | null; simu: string }>(
    db, 'SELECT id, jina, simu FROM paypoint.wateja WHERE biashara_id = $1 AND simu = $2', [user.biashara_id, simu],
  );
}

export async function saveCustomer(
  user: SessionUser,
  id: string | null,
  input: { jina: string; simu: string; maelezo?: string | null },
  ip?: string,
): Promise<string> {
  const jina = input.jina.trim();
  if (jina.length < 2) throw new AppError('Andika jina la mteja');
  const maelezo = input.maelezo?.trim() || null;
  const actor = { id: user.id, biashara_id: user.biashara_id, jina: user.jina };
  if (id) {
    const r = await one<{ simu: string }>(
      db,
      'UPDATE paypoint.wateja SET jina = $3, maelezo = $4 WHERE id = $1 AND biashara_id = $2 RETURNING simu',
      [id, user.biashara_id, jina, maelezo],
    );
    if (!r) throw new AppError('Mteja hayupo', 404);
    await audit(db, actor, 'mteja', `Amebadilisha taarifa za mteja ${jina} ${r.simu}`, ip);
    return id;
  }
  const simu = normPhone(input.simu);
  if (!simu) throw new AppError('Weka namba sahihi ya simu (mf. 0754123456)');
  const exists = await one(db, 'SELECT 1 FROM paypoint.wateja WHERE biashara_id = $1 AND simu = $2', [user.biashara_id, simu]);
  if (exists) throw new AppError('Mteja mwenye namba hii yupo tayari kwenye daftari');
  const r = await one<{ id: string }>(
    db,
    'INSERT INTO paypoint.wateja (biashara_id, jina, simu, maelezo, ameandikwa_na) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [user.biashara_id, jina, simu, maelezo, user.id],
  );
  await audit(db, actor, 'mteja', `Amesajili mteja ${jina} ${simu}`, ip);
  return r!.id;
}
