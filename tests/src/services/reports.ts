// Ripoti na dashibodi. Mfanyakazi anaona za kwake tu.
import { db, many, one } from '../db.js';
import type { SessionUser } from '../auth.js';
import { addDays, todayTz } from '../format.js';
import { balances, dukaNetworks } from './ledger.js';

const DATE = `(m.tarehe AT TIME ZONE 'Africa/Dar_es_Salaam')::date`;

export type Filter = { from: string; to: string; duka?: string | null; mfanyakazi?: string | null };

/** Masharti ya WHERE kwa miamala kulingana na mtumiaji na vichujio */
function where(user: SessionUser, f: Filter, params: unknown[]): string {
  params.push(user.biashara_id, f.from, f.to);
  let w = `m.biashara_id = $1 AND ${DATE} BETWEEN $2::date AND $3::date`;
  if (user.role !== 'owner') {
    params.push(user.id);
    w += ` AND m.mtumiaji_id = $${params.length}`;
  } else {
    if (f.mfanyakazi) {
      params.push(f.mfanyakazi);
      w += ` AND m.mtumiaji_id = $${params.length}`;
    }
    if (f.duka) {
      params.push(f.duka);
      w += ` AND m.duka_id = $${params.length}`;
    }
  }
  return w;
}

export type Totals = { idadi: number; tuma: number; toa: number; kamisheni: number; zilizobatilishwa: number };
const TOTALS = `COUNT(*) FILTER (WHERE NOT m.imebatilishwa)::int AS idadi,
  COALESCE(SUM(m.kiasi) FILTER (WHERE m.aina = 'tuma' AND NOT m.imebatilishwa), 0)::bigint AS tuma,
  COALESCE(SUM(m.kiasi) FILTER (WHERE m.aina = 'toa' AND NOT m.imebatilishwa), 0)::bigint AS toa,
  COALESCE(SUM(m.kamisheni) FILTER (WHERE NOT m.imebatilishwa), 0)::bigint AS kamisheni,
  COUNT(*) FILTER (WHERE m.imebatilishwa)::int AS zilizobatilishwa`;

export type TxRow = {
  id: number; aina: 'tuma' | 'toa'; mtandao: string; kiasi: number; kamisheni: number; simu_mteja: string | null;
  jina_mteja: string | null; kumbukumbu_namba: string | null; tarehe: string; imebatilishwa: boolean;
  sababu_kubatilisha: string | null; mfanyakazi: string; mtumiaji_id: string; duka: string; mteja_id: string | null;
};
const TX_SELECT = `SELECT m.id, m.aina, m.mtandao, m.kiasi, m.kamisheni, m.simu_mteja, COALESCE(w.jina, m.jina_mteja) AS jina_mteja,
  m.kumbukumbu_namba, m.tarehe, m.imebatilishwa, m.sababu_kubatilisha, u.jina AS mfanyakazi, m.mtumiaji_id, d.jina AS duka, m.mteja_id
  FROM paypoint.miamala m
  JOIN paypoint.watumiaji u ON u.id = m.mtumiaji_id
  JOIN paypoint.maduka d ON d.id = m.duka_id
  LEFT JOIN paypoint.wateja w ON w.id = m.mteja_id`;

export async function report(user: SessionUser, f: Filter) {
  const p: unknown[] = [];
  const w = where(user, f, p);
  const [totals, byNetwork, byAgent, byDuka, byDay, txs] = await Promise.all([
    one<Totals>(db, `SELECT ${TOTALS} FROM paypoint.miamala m WHERE ${w}`, p),
    many<Totals & { mtandao: string }>(db, `SELECT m.mtandao, ${TOTALS} FROM paypoint.miamala m WHERE ${w} GROUP BY m.mtandao ORDER BY kamisheni DESC`, p),
    user.role === 'owner'
      ? many<Totals & { id: string; jina: string; active: boolean }>(
          db,
          `SELECT u.id, u.jina, u.active, ${TOTALS} FROM paypoint.miamala m JOIN paypoint.watumiaji u ON u.id = m.mtumiaji_id
            WHERE ${w} GROUP BY u.id, u.jina, u.active ORDER BY kamisheni DESC`,
          p,
        )
      : Promise.resolve([]),
    user.role === 'owner'
      ? many<Totals & { id: string; jina: string }>(
          db,
          `SELECT d.id, d.jina, ${TOTALS} FROM paypoint.miamala m JOIN paypoint.maduka d ON d.id = m.duka_id
            WHERE ${w} GROUP BY d.id, d.jina ORDER BY kamisheni DESC`,
          p,
        )
      : Promise.resolve([]),
    many<Totals & { siku: string }>(db, `SELECT to_char(${DATE}, 'YYYY-MM-DD') AS siku, ${TOTALS} FROM paypoint.miamala m WHERE ${w} GROUP BY 1 ORDER BY 1`, p),
    many<TxRow>(db, `${TX_SELECT} WHERE ${w} ORDER BY m.tarehe DESC LIMIT 1000`, p),
  ]);
  return { totals: totals!, byNetwork, byAgent, byDuka, byDay, txs };
}

export async function exportRows(user: SessionUser, f: Filter): Promise<TxRow[]> {
  const p: unknown[] = [];
  const w = where(user, f, p);
  return many<TxRow>(db, `${TX_SELECT} WHERE ${w} ORDER BY m.tarehe DESC LIMIT 50000`, p);
}

export async function getTx(user: SessionUser, id: number) {
  const t = await one<TxRow & { duka_id: string; biashara: string; namba_leseni: string | null; mahali: string | null }>(
    db,
    `SELECT m.id, m.aina, m.mtandao, m.kiasi, m.kamisheni, m.simu_mteja, COALESCE(w.jina, m.jina_mteja) AS jina_mteja,
            m.kumbukumbu_namba, m.tarehe, m.imebatilishwa, m.sababu_kubatilisha, u.jina AS mfanyakazi, m.mtumiaji_id,
            d.jina AS duka, d.id AS duka_id, d.namba_leseni, d.mahali, b.jina AS biashara, m.mteja_id
       FROM paypoint.miamala m
       JOIN paypoint.watumiaji u ON u.id = m.mtumiaji_id
       JOIN paypoint.maduka d ON d.id = m.duka_id
       JOIN paypoint.biashara b ON b.id = m.biashara_id
       LEFT JOIN paypoint.wateja w ON w.id = m.mteja_id
      WHERE m.id = $1 AND m.biashara_id = $2 AND ($3 = 'owner' OR m.mtumiaji_id = $4)`,
    [id, user.biashara_id, user.role, user.id],
  );
  return t;
}

/** Dashibodi */
export async function ownerDashboard(user: SessionUser) {
  const today = todayTz();
  const week = addDays(today, -6);
  const [t, series, maduka, latest, arifa, hesabu] = await Promise.all([
    report(user, { from: today, to: today }).then((r) => r.totals),
    many<{ siku: string; kamisheni: number; idadi: number }>(
      db,
      `SELECT to_char(g::date, 'YYYY-MM-DD') AS siku,
              COALESCE(SUM(m.kamisheni) FILTER (WHERE NOT m.imebatilishwa), 0)::bigint AS kamisheni,
              COUNT(m.id) FILTER (WHERE NOT m.imebatilishwa)::int AS idadi
         FROM generate_series($2::date, $3::date, interval '1 day') g
         LEFT JOIN paypoint.miamala m ON m.biashara_id = $1 AND ${DATE} = g::date
        GROUP BY g ORDER BY g`,
      [user.biashara_id, week, today],
    ),
    many<{ id: string; jina: string; active: boolean; float_chini: number; cash_chini: number }>(
      db, 'SELECT id, jina, active, float_chini, cash_chini FROM paypoint.maduka WHERE biashara_id = $1 ORDER BY active DESC, jina', [user.biashara_id],
    ),
    many<TxRow>(db, `${TX_SELECT} WHERE m.biashara_id = $1 ORDER BY m.tarehe DESC LIMIT 10`, [user.biashara_id]),
    many<{ id: number; aina: string; ujumbe: string; tarehe: string }>(
      db, 'SELECT id, aina, ujumbe, tarehe FROM paypoint.arifa WHERE biashara_id = $1 AND NOT imesomwa ORDER BY tarehe DESC LIMIT 5', [user.biashara_id],
    ),
    many<{ id: number; duka: string; mfanyakazi: string; tofauti: number; tarehe: string }>(
      db,
      `SELECT h.id, d.jina AS duka, u.jina AS mfanyakazi, h.tofauti, h.tarehe FROM paypoint.hesabu h
         JOIN paypoint.maduka d ON d.id = h.duka_id JOIN paypoint.watumiaji u ON u.id = h.mtumiaji_id
        WHERE h.biashara_id = $1 ORDER BY h.tarehe DESC LIMIT 5`,
      [user.biashara_id],
    ),
  ]);
  const madukaFull = await Promise.all(
    maduka.map(async (d) => ({ ...d, mitandao: await dukaNetworks(db, d.id), salio: await balances(db, d.id) })),
  );
  const unread = await one<{ n: number }>(db, 'SELECT COUNT(*)::int AS n FROM paypoint.arifa WHERE biashara_id = $1 AND NOT imesomwa', [user.biashara_id]);
  return { today: t, series, maduka: madukaFull, latest, arifa, unread: unread?.n ?? 0, hesabu };
}

export async function agentDashboard(user: SessionUser & { duka_id: string }) {
  const today = todayTz();
  const r = await report(user, { from: today, to: today });
  const [salio, mitandao, duka] = await Promise.all([
    balances(db, user.duka_id),
    dukaNetworks(db, user.duka_id),
    one<{ jina: string; float_chini: number; cash_chini: number; active: boolean }>(
      db, 'SELECT jina, float_chini, cash_chini, active FROM paypoint.maduka WHERE id = $1', [user.duka_id],
    ),
  ]);
  return { totals: r.totals, txs: r.txs.slice(0, 30), salio, mitandao, duka: duka! };
}
