// Usajili wa biashara, maduka, wafanyakazi, kamisheni na password.
import { type Db, db, many, one, transaction } from '../db.js';
import { AppError } from '../errors.js';
import { NETWORKS, type Network, netLabel, normPhone, tzs } from '../format.js';
import { checkPassword, endAllSessions, hashPassword } from '../auth.js';
import { type Actor, audit } from './audit.js';

const USERNAME_RE = /^[a-z0-9._-]{3,40}$/;

export function cleanUsername(u: string): string {
  const v = u.trim().toLowerCase();
  if (!USERNAME_RE.test(v)) throw new AppError('Username: herufi ndogo, namba, nukta au - tu (herufi 3 hadi 40), bila nafasi');
  return v;
}
export function checkNewPassword(p: string): void {
  if (p.length < 6) throw new AppError('Password iwe na angalau herufi 6');
  if (p.length > 100) throw new AppError('Password ni ndefu mno');
}

async function usernameFree(c: Db, username: string) {
  const r = await one(c, 'SELECT 1 FROM paypoint.watumiaji WHERE lower(username) = $1', [username]);
  if (r) throw new AppError('Username hii imeshachukuliwa. Chagua nyingine.');
}

export type RegisterInput = {
  jina_duka: string;
  namba_leseni?: string | null;
  mahali?: string | null;
  mitandao: string[];
  jina: string;
  simu: string;
  username: string;
  password: string;
};

/** Mmiliki anasajili biashara: biashara + duka la kwanza + akaunti ya mmiliki */
export async function registerBusiness(input: RegisterInput, ip?: string): Promise<string> {
  const jinaDuka = input.jina_duka.trim();
  const jina = input.jina.trim();
  if (jinaDuka.length < 2) throw new AppError('Andika jina la duka');
  if (jina.length < 2) throw new AppError('Andika jina lako');
  const simu = normPhone(input.simu);
  if (!simu) throw new AppError('Weka namba sahihi ya simu (mf. 0754123456)');
  const username = cleanUsername(input.username);
  checkNewPassword(input.password);
  const mitandao = input.mitandao.filter((n): n is Network => (NETWORKS as readonly string[]).includes(n));
  if (!mitandao.length) throw new AppError('Chagua angalau mtandao mmoja unaohudumia');
  const hash = await hashPassword(input.password);

  return transaction(async (c) => {
    await usernameFree(c, username);
    const b = await one<{ id: string }>(c, 'INSERT INTO paypoint.biashara (jina, simu) VALUES ($1, $2) RETURNING id', [jinaDuka, simu]);
    const d = await one<{ id: string }>(
      c,
      'INSERT INTO paypoint.maduka (biashara_id, jina, namba_leseni, mahali) VALUES ($1, $2, $3, $4) RETURNING id',
      [b!.id, jinaDuka, input.namba_leseni?.trim() || null, input.mahali?.trim() || null],
    );
    for (const n of mitandao) await c.query('INSERT INTO paypoint.mitandao_duka (duka_id, mtandao) VALUES ($1, $2)', [d!.id, n]);
    for (const n of NETWORKS) {
      await c.query(
        `INSERT INTO paypoint.kamisheni_asilimia (biashara_id, mtandao, aina, asilimia, kiwango_chini)
         VALUES ($1, $2, 'tuma', 1, 100), ($1, $2, 'toa', 1.5, 100)`,
        [b!.id, n],
      );
    }
    const u = await one<{ id: string }>(
      c,
      `INSERT INTO paypoint.watumiaji (biashara_id, jina, username, password_hash, simu, role)
       VALUES ($1, $2, $3, $4, $5, 'owner') RETURNING id`,
      [b!.id, jina, username, hash, simu],
    );
    await audit(c, { id: u!.id, biashara_id: b!.id, jina }, 'usajili', `Biashara "${jinaDuka}" imesajiliwa na ${jina}`, ip);
    return u!.id;
  });
}

// ------------------------------------------------------------------ maduka
export type Duka = {
  id: string; jina: string; namba_leseni: string | null; mahali: string | null; active: boolean;
  float_chini: number; cash_chini: number; mitandao: { mtandao: Network; namba_wakala: string | null }[];
};

export async function listMaduka(biasharaId: string): Promise<Duka[]> {
  return many<Duka>(
    db,
    `SELECT d.id, d.jina, d.namba_leseni, d.mahali, d.active, d.float_chini, d.cash_chini,
            COALESCE((SELECT json_agg(json_build_object('mtandao', m.mtandao, 'namba_wakala', m.namba_wakala)
                        ORDER BY array_position(ARRAY['mpesa','mixx','airtel','halopesa','tpesa'], m.mtandao::text))
                        FROM paypoint.mitandao_duka m WHERE m.duka_id = d.id), '[]') AS mitandao
       FROM paypoint.maduka d WHERE d.biashara_id = $1 ORDER BY d.active DESC, d.jina`,
    [biasharaId],
  );
}

export async function getDuka(biasharaId: string, id: string): Promise<Duka> {
  const d = (await listMaduka(biasharaId)).find((x) => x.id === id);
  if (!d) throw new AppError('Duka halipo', 404);
  return d;
}

export type DukaInput = {
  jina: string; namba_leseni?: string | null; mahali?: string | null; active?: boolean;
  float_chini: number; cash_chini: number; mitandao: Record<string, { on: boolean; namba?: string | null }>;
};

export async function saveDuka(owner: Actor & { id: string }, id: string | null, input: DukaInput, ip?: string): Promise<string> {
  const jina = input.jina.trim();
  if (jina.length < 2) throw new AppError('Andika jina la duka');
  const nets = NETWORKS.filter((n) => input.mitandao[n]?.on);
  if (!nets.length) throw new AppError('Chagua angalau mtandao mmoja');
  return transaction(async (c) => {
    let dukaId = id;
    if (dukaId) {
      const r = await c.query(
        `UPDATE paypoint.maduka SET jina = $3, namba_leseni = $4, mahali = $5, active = $6, float_chini = $7, cash_chini = $8
          WHERE id = $1 AND biashara_id = $2`,
        [dukaId, owner.biashara_id, jina, input.namba_leseni?.trim() || null, input.mahali?.trim() || null,
         input.active ?? true, input.float_chini, input.cash_chini],
      );
      if (!r.rowCount) throw new AppError('Duka halipo', 404);
      await c.query('DELETE FROM paypoint.mitandao_duka WHERE duka_id = $1', [dukaId]);
    } else {
      const d = await one<{ id: string }>(
        c,
        `INSERT INTO paypoint.maduka (biashara_id, jina, namba_leseni, mahali, float_chini, cash_chini)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [owner.biashara_id, jina, input.namba_leseni?.trim() || null, input.mahali?.trim() || null, input.float_chini, input.cash_chini],
      );
      dukaId = d!.id;
    }
    for (const n of nets) {
      await c.query('INSERT INTO paypoint.mitandao_duka (duka_id, mtandao, namba_wakala) VALUES ($1, $2, $3)', [
        dukaId, n, input.mitandao[n]?.namba?.trim() || null,
      ]);
    }
    await audit(c, owner, 'duka', `${id ? 'Amebadilisha' : 'Ameongeza'} duka "${jina}" (${nets.map(netLabel).join(', ')})${input.active === false ? ' — limezimwa' : ''}`, ip);
    return dukaId!;
  });
}

// ------------------------------------------------------------------ wafanyakazi
export type Staff = {
  id: string; jina: string; username: string; simu: string | null; role: string; active: boolean;
  duka_id: string | null; duka_jina: string | null; ameingia_mwisho: string | null; tarehe_imeundwa: string;
};

export async function listStaff(biasharaId: string): Promise<Staff[]> {
  return many<Staff>(
    db,
    `SELECT u.id, u.jina, u.username, u.simu, u.role, u.active, u.duka_id, d.jina AS duka_jina, u.ameingia_mwisho, u.tarehe_imeundwa
       FROM paypoint.watumiaji u LEFT JOIN paypoint.maduka d ON d.id = u.duka_id
      WHERE u.biashara_id = $1 AND u.role = 'agent' ORDER BY u.active DESC, u.jina`,
    [biasharaId],
  );
}

export async function addStaff(
  owner: Actor & { id: string },
  input: { jina: string; username: string; simu?: string | null; password: string; duka_id: string },
  ip?: string,
): Promise<void> {
  const jina = input.jina.trim();
  if (jina.length < 2) throw new AppError('Andika jina la mfanyakazi');
  const username = cleanUsername(input.username);
  checkNewPassword(input.password);
  const simu = input.simu?.trim() ? normPhone(input.simu) : null;
  if (input.simu?.trim() && !simu) throw new AppError('Namba ya simu si sahihi');
  const hash = await hashPassword(input.password);
  await transaction(async (c) => {
    await usernameFree(c, username);
    const duka = await one<{ jina: string }>(c, 'SELECT jina FROM paypoint.maduka WHERE id = $1 AND biashara_id = $2', [input.duka_id, owner.biashara_id]);
    if (!duka) throw new AppError('Chagua duka');
    await c.query(
      `INSERT INTO paypoint.watumiaji (biashara_id, duka_id, jina, username, password_hash, simu, role, lazima_abadilishe_password)
       VALUES ($1, $2, $3, $4, $5, $6, 'agent', true)`,
      [owner.biashara_id, input.duka_id, jina, username, hash, simu],
    );
    await audit(c, owner, 'mfanyakazi', `Ameongeza mfanyakazi ${jina} (@${username}) — ${duka.jina}`, ip);
  });
}

async function staffRow(c: Db, biasharaId: string, id: string) {
  const s = await one<{ id: string; jina: string; active: boolean }>(
    c,
    `SELECT id, jina, active FROM paypoint.watumiaji WHERE id = $1 AND biashara_id = $2 AND role = 'agent'`,
    [id, biasharaId],
  );
  if (!s) throw new AppError('Mfanyakazi hayupo', 404);
  return s;
}

/** Kuzima / kuwasha mfanyakazi. Akizimwa, anatolewa kwenye mfumo papo hapo. */
export async function toggleStaff(owner: Actor & { id: string }, id: string, ip?: string): Promise<boolean> {
  const s = await staffRow(db, owner.biashara_id, id);
  const active = !s.active;
  await db.query('UPDATE paypoint.watumiaji SET active = $2 WHERE id = $1', [id, active]);
  if (!active) await endAllSessions(id);
  await audit(db, owner, 'mfanyakazi', `${active ? 'Amewasha' : 'Amezima'} mfanyakazi ${s.jina}`, ip);
  return active;
}

export async function moveStaff(owner: Actor & { id: string }, id: string, dukaId: string, ip?: string): Promise<void> {
  const s = await staffRow(db, owner.biashara_id, id);
  const duka = await one<{ jina: string }>(db, 'SELECT jina FROM paypoint.maduka WHERE id = $1 AND biashara_id = $2', [dukaId, owner.biashara_id]);
  if (!duka) throw new AppError('Chagua duka');
  await db.query('UPDATE paypoint.watumiaji SET duka_id = $2 WHERE id = $1', [id, dukaId]);
  await audit(db, owner, 'mfanyakazi', `Amemhamisha ${s.jina} kwenda ${duka.jina}`, ip);
}

export async function resetStaffPassword(owner: Actor & { id: string }, id: string, password: string, ip?: string): Promise<void> {
  const s = await staffRow(db, owner.biashara_id, id);
  checkNewPassword(password);
  await db.query('UPDATE paypoint.watumiaji SET password_hash = $2, lazima_abadilishe_password = true WHERE id = $1', [id, await hashPassword(password)]);
  await endAllSessions(id);
  await audit(db, owner, 'password', `Amempa ${s.jina} password mpya ya muda`, ip);
}

export async function changeOwnPassword(user: Actor & { id: string }, current: string, next: string, ip?: string): Promise<void> {
  const r = await one<{ password_hash: string }>(db, 'SELECT password_hash FROM paypoint.watumiaji WHERE id = $1', [user.id]);
  if (!r || !(await checkPassword(current, r.password_hash))) throw new AppError('Password ya sasa si sahihi');
  checkNewPassword(next);
  if (current === next) throw new AppError('Password mpya isiwe sawa na ya zamani');
  await db.query('UPDATE paypoint.watumiaji SET password_hash = $2, lazima_abadilishe_password = false WHERE id = $1', [user.id, await hashPassword(next)]);
  await audit(db, user, 'password', 'Amebadilisha password yake', ip);
}

// ------------------------------------------------------------------ kamisheni
export async function commissionSettings(biasharaId: string) {
  const rates = await many<{ mtandao: string; aina: string; asilimia: number; kiwango_chini: number }>(
    db, 'SELECT mtandao, aina, asilimia, kiwango_chini FROM paypoint.kamisheni_asilimia WHERE biashara_id = $1', [biasharaId],
  );
  const tiers = await many<{ id: string; mtandao: string; aina: string; kuanzia: number; hadi: number; kamisheni: number }>(
    db,
    `SELECT id, mtandao, aina, kuanzia, hadi, kamisheni FROM paypoint.kamisheni_ngazi WHERE biashara_id = $1
      ORDER BY array_position(ARRAY['mpesa','mixx','airtel','halopesa','tpesa'], mtandao::text), aina DESC, kuanzia`,
    [biasharaId],
  );
  return { rates, tiers };
}

export async function saveRates(owner: Actor & { id: string }, rates: { mtandao: string; aina: string; asilimia: number; kiwango_chini: number }[], ip?: string) {
  await transaction(async (c) => {
    for (const r of rates) {
      if (!(NETWORKS as readonly string[]).includes(r.mtandao) || !['tuma', 'toa'].includes(r.aina)) continue;
      if (!(r.asilimia >= 0 && r.asilimia <= 20)) throw new AppError('Asilimia iwe kati ya 0 na 20');
      if (!(r.kiwango_chini >= 0 && r.kiwango_chini <= 100000)) throw new AppError('Kamisheni ya chini si sahihi');
      await c.query(
        `INSERT INTO paypoint.kamisheni_asilimia (biashara_id, mtandao, aina, asilimia, kiwango_chini) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (biashara_id, mtandao, aina) DO UPDATE SET asilimia = EXCLUDED.asilimia, kiwango_chini = EXCLUDED.kiwango_chini`,
        [owner.biashara_id, r.mtandao, r.aina, r.asilimia, r.kiwango_chini],
      );
    }
    await audit(c, owner, 'kamisheni', 'Amebadilisha asilimia za kamisheni', ip);
  });
}

export async function addTier(owner: Actor & { id: string }, t: { mtandao: string; aina: string; kuanzia: number; hadi: number; kamisheni: number }, ip?: string) {
  if (!(NETWORKS as readonly string[]).includes(t.mtandao) || !['tuma', 'toa'].includes(t.aina)) throw new AppError('Chagua mtandao na aina');
  if (t.kuanzia <= 0 || t.hadi < t.kuanzia) throw new AppError('Kiasi "hadi" kiwe kikubwa kuliko "kuanzia"');
  const overlap = await one(
    db,
    `SELECT 1 FROM paypoint.kamisheni_ngazi WHERE biashara_id = $1 AND mtandao = $2 AND aina = $3
        AND int8range(kuanzia, hadi, '[]') && int8range($4, $5, '[]')`,
    [owner.biashara_id, t.mtandao, t.aina, t.kuanzia, t.hadi],
  );
  if (overlap) throw new AppError('Ngazi hii inaingiliana na ngazi nyingine ya mtandao huo');
  await db.query(
    'INSERT INTO paypoint.kamisheni_ngazi (biashara_id, mtandao, aina, kuanzia, hadi, kamisheni) VALUES ($1, $2, $3, $4, $5, $6)',
    [owner.biashara_id, t.mtandao, t.aina, t.kuanzia, t.hadi, t.kamisheni],
  );
  await audit(db, owner, 'kamisheni', `Ameongeza ngazi: ${netLabel(t.mtandao)} ${t.aina === 'tuma' ? 'Tuma' : 'Toa'} ${tzs(t.kuanzia)}–${tzs(t.hadi)} = ${tzs(t.kamisheni)}`, ip);
}

export async function deleteTier(owner: Actor & { id: string }, id: string, ip?: string) {
  const t = await one<{ mtandao: string; aina: string; kuanzia: number; hadi: number; kamisheni: number }>(
    db, 'DELETE FROM paypoint.kamisheni_ngazi WHERE id = $1 AND biashara_id = $2 RETURNING mtandao, aina, kuanzia, hadi, kamisheni', [id, owner.biashara_id],
  );
  if (t) await audit(db, owner, 'kamisheni', `Ameondoa ngazi: ${netLabel(t.mtandao)} ${t.aina === 'tuma' ? 'Tuma' : 'Toa'} ${tzs(t.kuanzia)}–${tzs(t.hadi)}`, ip);
}
