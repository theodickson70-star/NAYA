// Hesabu za duka: cash na float ya kila mtandao, miamala (tuma/toa), kubatilisha, na float/cash ya mmiliki.
import type pg from 'pg';
import { type Db, many, one, transaction } from '../db.js';
import { AppError } from '../errors.js';
import { NETWORKS, type Network, netLabel, normPhone, tzs } from '../format.js';
import { type Actor, audit, notifyOwner } from './audit.js';

export type Balances = { cash: number; floats: Record<string, number> };

/** Salio la duka sasa hivi: cash + float ya kila mtandao (kutoka miamala yote na harakati zote). */
export async function balances(c: Db, dukaId: string): Promise<Balances> {
  const rows = await many<{ mtandao: string | null; f: number; c: number }>(
    c,
    `SELECT mtandao,
            SUM(CASE WHEN aina = 'tuma' THEN -kiasi ELSE kiasi END)::bigint AS f,
            SUM(CASE WHEN aina = 'tuma' THEN kiasi ELSE -kiasi END)::bigint AS c
       FROM paypoint.miamala WHERE duka_id = $1 AND NOT imebatilishwa GROUP BY mtandao
     UNION ALL
     SELECT mtandao,
            SUM(CASE aina WHEN 'float_ingia' THEN kiasi WHEN 'nunua_float' THEN kiasi
                          WHEN 'float_toka' THEN -kiasi WHEN 'uza_float' THEN -kiasi ELSE 0 END)::bigint,
            SUM(CASE aina WHEN 'cash_ingia' THEN kiasi WHEN 'uza_float' THEN kiasi
                          WHEN 'cash_toka' THEN -kiasi WHEN 'matumizi' THEN -kiasi WHEN 'nunua_float' THEN -kiasi ELSE 0 END)::bigint
       FROM paypoint.harakati WHERE duka_id = $1 GROUP BY mtandao`,
    [dukaId],
  );
  const out: Balances = { cash: 0, floats: {} };
  for (const r of rows) {
    out.cash += Number(r.c);
    if (r.mtandao) out.floats[r.mtandao] = (out.floats[r.mtandao] ?? 0) + Number(r.f);
  }
  return out;
}

export async function dukaNetworks(c: Db, dukaId: string): Promise<{ mtandao: Network; namba_wakala: string | null }[]> {
  const rows = await many<{ mtandao: Network; namba_wakala: string | null }>(
    c,
    'SELECT mtandao, namba_wakala FROM paypoint.mitandao_duka WHERE duka_id = $1',
    [dukaId],
  );
  return rows.sort((a, b) => NETWORKS.indexOf(a.mtandao) - NETWORKS.indexOf(b.mtandao));
}

/** Kamisheni: ngazi (tier) ikipatikana inatumika; vinginevyo asilimia (chaguo-msingi tuma 1%, toa 1.5%, angalau TSh 100). */
export async function commissionFor(c: Db, biasharaId: string, mtandao: string, aina: 'tuma' | 'toa', kiasi: number): Promise<number> {
  const tier = await one<{ kamisheni: number }>(
    c,
    `SELECT kamisheni FROM paypoint.kamisheni_ngazi
      WHERE biashara_id = $1 AND mtandao = $2 AND aina = $3 AND $4 BETWEEN kuanzia AND hadi
      ORDER BY kuanzia DESC LIMIT 1`,
    [biasharaId, mtandao, aina, kiasi],
  );
  if (tier) return Number(tier.kamisheni);
  const rate = await one<{ asilimia: number; kiwango_chini: number }>(
    c,
    'SELECT asilimia, kiwango_chini FROM paypoint.kamisheni_asilimia WHERE biashara_id = $1 AND mtandao = $2 AND aina = $3',
    [biasharaId, mtandao, aina],
  );
  const pct = rate ? Number(rate.asilimia) : aina === 'tuma' ? 1 : 1.5;
  const min = rate ? Number(rate.kiwango_chini) : 100;
  return Math.max(Math.round((kiasi * pct) / 100), min);
}

async function lockDuka(c: pg.PoolClient, dukaId: string, biasharaId: string) {
  const d = await one<{ id: string; jina: string; active: boolean; float_chini: number; cash_chini: number }>(
    c,
    'SELECT id, jina, active, float_chini, cash_chini FROM paypoint.maduka WHERE id = $1 AND biashara_id = $2 FOR UPDATE',
    [dukaId, biasharaId],
  );
  if (!d) throw new AppError('Duka halipo', 404);
  return d;
}

/** Tahadhari kwa mmiliki salio likivuka kiwango cha chini (mara moja, wakati wa kuvuka). */
async function lowBalanceAlerts(
  c: Db,
  biasharaId: string,
  duka: { jina: string; float_chini: number; cash_chini: number },
  before: Balances,
  after: Balances,
) {
  if (after.cash < duka.cash_chini && before.cash >= duka.cash_chini) {
    await notifyOwner(c, biasharaId, 'cash_chini', `${duka.jina}: cash imeshuka hadi ${tzs(after.cash)}`);
  }
  for (const [net, v] of Object.entries(after.floats)) {
    const b = before.floats[net] ?? 0;
    if (v < duka.float_chini && b >= duka.float_chini) {
      await notifyOwner(c, biasharaId, 'float_chini', `${duka.jina}: float ya ${netLabel(net)} imeshuka hadi ${tzs(v)}`);
    }
  }
}

export type TxInput = {
  aina: 'tuma' | 'toa';
  mtandao: Network;
  simu: string;
  jina?: string | null;
  kiasi: number;
  kumbukumbu_namba?: string | null;
  maelezo?: string | null;
};

/** Rekodi muamala wa mteja (mfanyakazi wa duka). Inazuia muamala usiowezekana kihesabu. */
export async function recordTransaction(
  user: { id: string; biashara_id: string; duka_id: string; jina: string },
  input: TxInput,
  ip?: string,
): Promise<number> {
  return transaction(async (c) => {
    const duka = await lockDuka(c, user.duka_id, user.biashara_id);
    if (!duka.active) throw new AppError('Duka hili limezimwa na mmiliki');
    const nets = await dukaNetworks(c, duka.id);
    if (!nets.some((n) => n.mtandao === input.mtandao)) throw new AppError(`Duka hili halihudumii ${netLabel(input.mtandao)}`);
    if (!Number.isInteger(input.kiasi) || input.kiasi < 100) throw new AppError('Kiasi cha chini ni TSh 100');
    if (input.kiasi > 50_000_000) throw new AppError('Kiasi ni kikubwa mno');
    const simu = normPhone(input.simu);
    if (!simu) throw new AppError('Weka namba sahihi ya simu ya mteja (mf. 0754123456)');

    const before = await balances(c, duka.id);
    if (input.aina === 'tuma') {
      const f = before.floats[input.mtandao] ?? 0;
      if (f < input.kiasi) {
        throw new AppError(`Float ya ${netLabel(input.mtandao)} haitoshi (iliyopo ${tzs(f)}). Mwombe mmiliki aongeze float.`);
      }
    } else if (before.cash < input.kiasi) {
      throw new AppError(`Cash haitoshi (iliyopo ${tzs(before.cash)}). Mwombe mmiliki aongeze cash.`);
    }

    // Daftari la wateja: mteja anasajiliwa yenyewe (au jina lake linajazwa)
    const jina = input.jina?.trim() || null;
    const mteja = await one<{ id: string; jina: string | null }>(
      c,
      `INSERT INTO paypoint.wateja (biashara_id, simu, jina, ameandikwa_na) VALUES ($1, $2, $3, $4)
       ON CONFLICT (biashara_id, simu) DO UPDATE SET jina = COALESCE(EXCLUDED.jina, paypoint.wateja.jina)
       RETURNING id, jina, (xmax = 0) AS mpya`,
      [user.biashara_id, simu, jina, user.id],
    );
    const kamisheni = await commissionFor(c, user.biashara_id, input.mtandao, input.aina, input.kiasi);
    const tx = await one<{ id: number }>(
      c,
      `INSERT INTO paypoint.miamala (biashara_id, duka_id, aina, mtandao, mteja_id, simu_mteja, jina_mteja, mtumiaji_id,
                                     kiasi, kamisheni, kumbukumbu_namba, maelezo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [
        user.biashara_id, duka.id, input.aina, input.mtandao, mteja!.id, simu, mteja!.jina, user.id,
        input.kiasi, kamisheni, input.kumbukumbu_namba?.trim() || null, input.maelezo?.trim() || null,
      ],
    );
    const actor: Actor = { id: user.id, biashara_id: user.biashara_id, jina: user.jina };
    await audit(
      c,
      actor,
      input.aina,
      `${input.aina === 'tuma' ? 'Tuma' : 'Toa'} ${netLabel(input.mtandao)} ${tzs(input.kiasi)} — ${duka.jina} • mteja ${mteja!.jina ?? ''} ${simu} • risiti #${tx!.id}`,
      ip,
    );
    const after = await balances(c, duka.id);
    await lowBalanceAlerts(c, user.biashara_id, duka, before, after);
    return tx!.id;
  });
}

/**
 * Kubatilisha: muamala haufutwi — unabaki kwenye rekodi ukiwa na alama na sababu.
 * Ni mfanyakazi aliyeurekodi tu, siku hiyo hiyo. Mmiliki hawezi.
 */
export async function reverseTransaction(
  user: { id: string; biashara_id: string; jina: string; role: string },
  txId: number,
  sababu: string,
  ip?: string,
): Promise<void> {
  if (user.role !== 'agent') throw new AppError('Mmiliki hawezi kubatilisha muamala. Muamala ni kumbukumbu ya kudumu.', 403);
  if (!sababu.trim() || sababu.trim().length < 3) throw new AppError('Andika sababu ya kubatilisha');
  await transaction(async (c) => {
    const t = await one<{
      id: number; duka_id: string; aina: 'tuma' | 'toa'; mtandao: string; kiasi: number; mtumiaji_id: string;
      imebatilishwa: boolean; leo: boolean;
    }>(
      c,
      `SELECT id, duka_id, aina, mtandao, kiasi, mtumiaji_id, imebatilishwa,
              (tarehe AT TIME ZONE 'Africa/Dar_es_Salaam')::date = (now() AT TIME ZONE 'Africa/Dar_es_Salaam')::date AS leo
         FROM paypoint.miamala WHERE id = $1 AND biashara_id = $2 FOR UPDATE`,
      [txId, user.biashara_id],
    );
    if (!t) throw new AppError('Muamala haupo', 404);
    if (t.mtumiaji_id !== user.id) throw new AppError('Unaweza kubatilisha muamala wako tu', 403);
    if (t.imebatilishwa) throw new AppError('Muamala huu umeshabatilishwa');
    if (!t.leo) throw new AppError('Muamala wa siku zilizopita hauwezi kubatilishwa. Wasiliana na mmiliki.');
    const duka = await lockDuka(c, t.duka_id, user.biashara_id);
    const b = await balances(c, t.duka_id);
    // Kubatilisha tuma kunarudisha float na kuondoa cash; toa kinyume chake
    if (t.aina === 'tuma' && b.cash < t.kiasi) throw new AppError(`Cash haitoshi kubatilisha (iliyopo ${tzs(b.cash)})`);
    if (t.aina === 'toa' && (b.floats[t.mtandao] ?? 0) < t.kiasi) {
      throw new AppError(`Float ya ${netLabel(t.mtandao)} haitoshi kubatilisha`);
    }
    await c.query(
      `UPDATE paypoint.miamala SET imebatilishwa = true, sababu_kubatilisha = $2, batilishwa_saa = now() WHERE id = $1`,
      [t.id, sababu.trim().slice(0, 200)],
    );
    const msg = `${user.jina} amebatilisha muamala #${t.id} (${t.aina === 'tuma' ? 'Tuma' : 'Toa'} ${netLabel(t.mtandao)} ${tzs(t.kiasi)}) — ${duka.jina}. Sababu: ${sababu.trim()}`;
    await audit(c, { id: user.id, biashara_id: user.biashara_id, jina: user.jina }, 'batilisha', msg, ip);
    await notifyOwner(c, user.biashara_id, 'batilisha', msg);
  });
}

export const HARAKATI_LABEL: Record<string, string> = {
  float_ingia: 'Float imeingia',
  float_toka: 'Float imetolewa',
  cash_ingia: 'Cash imeingia (mtaji)',
  cash_toka: 'Cash imechukuliwa',
  nunua_float: 'Kununua float (cash → float)',
  uza_float: 'Kuuza float (float → cash)',
  matumizi: 'Matumizi ya duka',
};
const NEEDS_NET = new Set(['float_ingia', 'float_toka', 'nunua_float', 'uza_float']);

/** Mmiliki anaongeza/kutoa float au cash ya duka */
export async function recordMovement(
  owner: { id: string; biashara_id: string; jina: string },
  input: { duka_id: string; aina: string; mtandao?: string | null; kiasi: number; maelezo?: string | null },
  ip?: string,
): Promise<void> {
  if (!(input.aina in HARAKATI_LABEL)) throw new AppError('Chagua aina sahihi');
  if (!Number.isInteger(input.kiasi) || input.kiasi <= 0) throw new AppError('Weka kiasi sahihi');
  if (input.kiasi > 1_000_000_000) throw new AppError('Kiasi ni kikubwa mno');
  const needNet = NEEDS_NET.has(input.aina);
  const mtandao = needNet ? input.mtandao ?? null : null;
  await transaction(async (c) => {
    const duka = await lockDuka(c, input.duka_id, owner.biashara_id);
    if (needNet) {
      const nets = await dukaNetworks(c, duka.id);
      if (!mtandao || !nets.some((n) => n.mtandao === mtandao)) throw new AppError('Chagua mtandao unaohudumiwa na duka hili');
    }
    const b = await balances(c, duka.id);
    const cashOut = ['cash_toka', 'matumizi', 'nunua_float'].includes(input.aina);
    const floatOut = ['float_toka', 'uza_float'].includes(input.aina);
    if (cashOut && b.cash < input.kiasi) throw new AppError(`Cash ya duka haitoshi (iliyopo ${tzs(b.cash)})`);
    if (floatOut && (b.floats[mtandao!] ?? 0) < input.kiasi) {
      throw new AppError(`Float ya ${netLabel(mtandao!)} haitoshi (iliyopo ${tzs(b.floats[mtandao!] ?? 0)})`);
    }
    await c.query(
      `INSERT INTO paypoint.harakati (biashara_id, duka_id, aina, mtandao, kiasi, maelezo, mtumiaji_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [owner.biashara_id, duka.id, input.aina, mtandao, input.kiasi, input.maelezo?.trim() || null, owner.id],
    );
    await audit(
      c,
      { id: owner.id, biashara_id: owner.biashara_id, jina: owner.jina },
      'float',
      `${HARAKATI_LABEL[input.aina]}${mtandao ? ` ${netLabel(mtandao)}` : ''} ${tzs(input.kiasi)} — ${duka.jina}${input.maelezo?.trim() ? ` (${input.maelezo.trim()})` : ''}`,
      ip,
    );
  });
}
