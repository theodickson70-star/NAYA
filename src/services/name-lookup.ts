// Jina la mwenye namba ya simu (0.20.0) — kutoka mtandao kupitia kampuni ya malipo (Abliner: GET /api/v1/lookup).
//
// Matumizi: namba za malipo za dereva, ofisi ikiongeza staff, staff akisajili bodaboda, na kinga kabla ya kutuma pesa.
// Faragha: inatumiwa na watu walioingia TU (dereva, NAYA Staff, ofisi), kwa kikomo cha namba tofauti kwa siku —
// ili mtu asiitumie NAYA kutafuta majina ya watu. Kila ombi linaandikwa (nani, namba gani, kwa nini).
// Huduma isipopatikana, kazi haisimami: mtumiaji anaandika jina mwenyewe kama zamani.
import { type Db, db, one } from '../db/pool.js';
import { AppError, forbidden } from '../utils/http.js';
import { getProvider, type MobileNetwork } from './payments/provider.js';
import { hasStaffAccess, type UserRow } from './users.js';

export type LookupPurpose = 'PAYOUT' | 'STAFF' | 'DRIVER_REG' | 'GUARD';

const FOUND_TTL_MINUTES = 7 * 24 * 60; // jina lililothibitishwa: wiki moja kwenye cache
const NOT_FOUND_TTL_MINUTES = 60; // "haipo": saa moja (labda namba imesajiliwa sasa hivi)
const LABEL: Record<MobileNetwork, string> = { MPESA: 'M-Pesa (Vodacom)', MIXX: 'Mixx by Yas (Tigo Pesa)', AIRTEL: 'Airtel Money', HALOPESA: 'HaloPesa (Halotel)' };
const DAILY_LIMIT = { DRIVER: 15, STAFF: 80, ADMIN: 300 } as const;

export interface PhoneName {
  /** Huduma ya majina inapatikana (kampuni ya malipo imewashwa na imejibu). */
  available: boolean;
  found: boolean;
  /** Kama mtandao ulivyolisajili (mara nyingi HERUFI KUBWA). */
  name: string | null;
  network: MobileNetwork | null;
}

/** "JOHN JUMA DOE" → "John Juma Doe" (kwa jina la akaunti ya NAYA; jina la mtandao linabaki kama lilivyo). */
export const titleCase = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

const tokens = (name: string) =>
  name
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3);

/** Majina mawili ni ya mtu mmoja? (angalau neno moja la herufi 3+ linafanana — laini iliyohamishwa ina jina tofauti kabisa) */
export function namesMatch(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const set = new Set(tokens(a));
  return tokens(b).some((t) => set.has(t));
}

/** Jina la namba (cache kwanza). maxAgeMinutes = umri wa juu wa jina lililothibitishwa kwenye cache. */
export async function phoneName(phone: string, opts: { maxAgeMinutes?: number; client?: Db } = {}): Promise<PhoneName> {
  const none: PhoneName = { available: false, found: false, name: null, network: null };
  const provider = getProvider();
  if (!provider?.lookupName) return none;
  const client = opts.client ?? db;
  const cached = await one<{ found: boolean; name: string | null; network: MobileNetwork | null; age: number }>(
    client,
    `SELECT found, name, network, extract(epoch FROM now() - checked_at)::int / 60 AS age FROM naya.phone_names WHERE phone = $1`,
    [phone],
  );
  if (cached && cached.age < (cached.found ? (opts.maxAgeMinutes ?? FOUND_TTL_MINUTES) : NOT_FOUND_TTL_MINUTES)) {
    return { available: true, found: cached.found, name: cached.name, network: cached.network };
  }
  try {
    const r = await provider.lookupName(phone);
    const name = r.found ? (r.name ?? '').slice(0, 120) || null : null;
    const found = r.found && !!name;
    await client.query(
      `INSERT INTO naya.phone_names (phone, found, name, network, checked_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (phone) DO UPDATE SET found = EXCLUDED.found, name = EXCLUDED.name, network = EXCLUDED.network, checked_at = now()`,
      [phone, found, name, r.network ?? null],
    );
    return { available: true, found, name, network: r.network ?? null };
  } catch (error) {
    // Namba yenyewe haiandikwi kwenye log (faragha) — tarakimu 3 za mwisho tu.
    console.error(`[majina] lookup …${phone.slice(-3)}: ${(error as Error).message}`);
    return none;
  }
}

/** Nani anaruhusiwa kuuliza majina, na kikomo chake cha kila siku. */
async function lookupRole(user: UserRow): Promise<keyof typeof DAILY_LIMIT> {
  if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') return 'ADMIN';
  if (hasStaffAccess(user)) return 'STAFF';
  if (user.role === 'USER' && (await one(db, 'SELECT 1 FROM naya.drivers WHERE user_id = $1', [user.id]))) return 'DRIVER';
  throw forbidden('Huna ruhusa ya kuangalia majina ya namba.');
}

/** Kwa mtumiaji aliyeingia: jina la namba + kumbukumbu ya ombi + kikomo cha namba tofauti kwa saa 24. */
export async function lookupForUser(user: UserRow, phone: string, purpose: LookupPurpose) {
  const role = await lookupRole(user);
  const seen = await one(db, `SELECT 1 FROM naya.name_lookups WHERE user_id = $1 AND phone = $2 AND created_at > now() - interval '24 hours'`, [user.id, phone]);
  if (!seen) {
    const used = await one<{ n: number }>(
      db,
      `SELECT count(DISTINCT phone)::int AS n FROM naya.name_lookups WHERE user_id = $1 AND created_at > now() - interval '24 hours'`,
      [user.id],
    );
    if ((used?.n ?? 0) >= DAILY_LIMIT[role]) {
      throw new AppError(429, 'Umefikia kikomo cha kuangalia majina ya namba kwa leo. Andika jina mwenyewe, au jaribu kesho.');
    }
  }
  const r = await phoneName(phone);
  if (r.available) await db.query('INSERT INTO naya.name_lookups (user_id, phone, purpose) VALUES ($1, $2, $3)', [user.id, phone, purpose]);
  return view(phone, r);
}

export function view(phone: string, r: PhoneName) {
  return {
    phone,
    available: r.available,
    found: r.found,
    name: r.name,
    displayName: r.name ? titleCase(r.name) : null,
    network: r.network,
    networkLabel: r.network ? (LABEL[r.network] ?? r.network) : null,
  };
}
