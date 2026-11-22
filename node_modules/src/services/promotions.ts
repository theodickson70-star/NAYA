// Ofa za wateja: punguzo la nauli ambalo NAYA inalipa kwa dereva.
//
// Kanuni:
//  - Safari moja = ofa moja tu: mfumo unachagua yenye punguzo kubwa zaidi kwa mteja (sawa → kipaumbele kikubwa zaidi).
//  - Punguzo linahesabiwa na SERVER wakati wa kuagiza (kamwe halitoki kwa app) na linahifadhiwa kwenye safari.
//  - Abiria analipa dereva (nauli − punguzo) taslimu; NAYA inamdai dereva punguzo hilo safari ikikamilika.
//  - Kikomo cha dereva (mf. safari 3 za ofa kwa wiki): ombi la safari ya ofa linaenda kwa madereva walio na nafasi tu.
//    Kama hakuna dereva mwenye nafasi aliye karibu, safari inaendelea bila ofa na mteja anaambiwa wazi.
//  - Ofa ni kwa wateja: mtumiaji aliye dereva (au anayeomba kuwa dereva) hapati ofa — kuzuia kujinufaisha.
import type { Db } from '../db/pool.js';
import { db, many, one, transaction } from '../db/pool.js';
import { writeAudit } from './audit.js';
import { notify } from './notify.js';
import { badRequest, conflict, isUniqueViolation, notFound } from '../utils/http.js';

const TZ = 'Africa/Dar_es_Salaam';
type VehicleType = 'BODABODA' | 'BAJAJI';
export type Audience = 'ALL' | 'NEW_CUSTOMERS';
export type DriverPeriod = 'DAY' | 'WEEK' | 'TOTAL';
export type PromoStatus = 'ACTIVE' | 'PAUSED' | 'ENDED';

export interface PromoRow {
  id: string;
  name: string;
  title: string;
  description: string | null;
  audience: Audience;
  discount_percent: number;
  max_discount: number | null;
  min_fare: number | null;
  max_fare: number | null;
  vehicle_types: VehicleType[] | null;
  per_customer_limit: number | null;
  per_driver_limit: number | null;
  per_driver_period: DriverPeriod;
  budget: number | null;
  priority: number;
  status: PromoStatus;
  starts_at: Date;
  ends_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Safari ya ofa "inashikilia" nafasi (mteja / bajeti) isipoghairiwa wala kukosa dereva. */
const HOLDS = `('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED')`;
const DRIVER_HOLDS = `('ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED')`;

const PERIOD_START: Record<DriverPeriod, string> = {
  DAY: `(date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`,
  WEEK: `(date_trunc('week', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')`, // Jumatatu saa 6 usiku
  TOTAL: `'-infinity'::timestamptz`,
};

const parseVehicles = (v: unknown): VehicleType[] | null => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v as VehicleType[];
  // pg inarudisha enum[] kama "{BODABODA,BAJAJI}"
  const s = String(v).replace(/[{}]/g, '');
  return s ? (s.split(',') as VehicleType[]) : null;
};
const normalize = (r: PromoRow): PromoRow => ({ ...r, vehicle_types: parseVehicles(r.vehicle_types) });

/** Punguzo la safari moja: asilimia ya nauli, lisizidi kikomo, likizungushwa chini kwa TSh 50 (taslimu rahisi). */
export function discountFor(promo: Pick<PromoRow, 'discount_percent' | 'max_discount' | 'min_fare' | 'max_fare'>, fare: number) {
  if (promo.min_fare !== null && fare < promo.min_fare) return 0;
  if (promo.max_fare !== null && fare > promo.max_fare) return 0;
  let d = Math.floor((fare * promo.discount_percent) / 100);
  if (promo.max_discount !== null) d = Math.min(d, promo.max_discount);
  d = Math.floor(d / 50) * 50;
  return Math.max(0, Math.min(d, fare));
}

export async function activePromotions(client: Db = db) {
  const rows = await many<PromoRow>(
    client,
    `SELECT * FROM naya.promotions
      WHERE status = 'ACTIVE' AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now())
      ORDER BY priority DESC, created_at`,
  );
  return rows.map(normalize);
}

/** Mtumiaji huyu anaweza kupata ofa kabisa? (si dereva / si anayeomba kuwa dereva) */
async function isCustomer(client: Db, userId: string) {
  return !(await one(client, `SELECT 1 FROM naya.drivers WHERE user_id = $1 AND status IN ('APPROVED', 'PENDING', 'SUSPENDED')`, [userId]));
}

interface Usage {
  customerUsed: number;
  otherCompleted: number;
  budgetUsed: number;
}
async function usage(client: Db, promoId: string, userId: string): Promise<Usage> {
  const row = await one<Usage>(
    client,
    `SELECT
       (SELECT count(*) FROM naya.rides WHERE promotion_id = $1 AND passenger_id = $2 AND status IN ${HOLDS})::int AS "customerUsed",
       (SELECT count(*) FROM naya.rides WHERE passenger_id = $2 AND status = 'COMPLETED' AND promotion_id IS DISTINCT FROM $1)::int AS "otherCompleted",
       (SELECT coalesce(sum(promo_discount), 0) FROM naya.rides WHERE promotion_id = $1 AND status IN ${HOLDS})::int AS "budgetUsed"`,
    [promoId, userId],
  );
  return row ?? { customerUsed: 0, otherCompleted: 0, budgetUsed: 0 };
}

/** Kwa nini ofa hii haimfai mteja huyu sasa (null = inamfaa) — pia inarudisha safari zilizobaki. */
async function eligibility(client: Db, promo: PromoRow, userId: string) {
  const u = await usage(client, promo.id, userId);
  if (promo.audience === 'NEW_CUSTOMERS' && u.otherCompleted > 0) return { ok: false as const, reason: 'not_new', usage: u };
  if (promo.per_customer_limit !== null && u.customerUsed >= promo.per_customer_limit) return { ok: false as const, reason: 'used_up', usage: u };
  if (promo.budget !== null && u.budgetUsed >= promo.budget) return { ok: false as const, reason: 'budget', usage: u };
  return { ok: true as const, usage: u, ridesLeft: promo.per_customer_limit === null ? null : promo.per_customer_limit - u.customerUsed };
}

export interface PromoQuote {
  promotionId: string;
  title: string;
  description: string | null;
  discount: number;
  passengerPays: number;
  ridesLeft: number | null;
}

/** Ofa bora kwa mteja huyu, kwa chombo na nauli hii (null = hakuna). */
export async function bestPromotion(client: Db, userId: string, vehicleType: VehicleType, fare: number, promos?: PromoRow[]): Promise<PromoQuote | null> {
  const list = promos ?? (await activePromotions(client));
  if (!list.length || !(await isCustomer(client, userId))) return null;
  let best: PromoQuote | null = null;
  let bestPriority = -Infinity;
  for (const p of list) {
    if (p.vehicle_types && !p.vehicle_types.includes(vehicleType)) continue;
    let discount = discountFor(p, fare);
    if (discount <= 0) continue;
    const e = await eligibility(client, p, userId);
    if (!e.ok) continue;
    if (p.budget !== null) discount = Math.min(discount, Math.floor((p.budget - e.usage.budgetUsed) / 50) * 50);
    if (discount <= 0) continue;
    if (!best || discount > best.discount || (discount === best.discount && p.priority > bestPriority)) {
      best = { promotionId: p.id, title: p.title, description: p.description, discount, passengerPays: fare - discount, ridesLeft: e.ridesLeft };
      bestPriority = p.priority;
    }
  }
  return best;
}

/** Bei za makadirio + ofa: kila chombo kinapata `promo` kama mteja anastahili. */
export async function withPromotions<T extends { options: { vehicleType: VehicleType; fare: number }[] }>(userId: string, estimate: T) {
  const promos = await activePromotions();
  if (!promos.length) return estimate;
  const options = [];
  const customer = await isCustomer(db, userId);
  for (const o of estimate.options) {
    const promo = await bestPromotion(db, userId, o.vehicleType, o.fare, promos);
    options.push({ ...o, promo, promoNote: !promo && customer ? await promoNoteFor(userId, o.vehicleType, o.fare, promos) : null });
  }
  return { ...estimate, options };
}

/** Ofa ambazo mteja huyu anaweza kutumia sasa (bango kwenye app). */
export async function offersForPassenger(userId: string) {
  const promos = await activePromotions();
  if (!promos.length || !(await isCustomer(db, userId))) return [];
  const out = [];
  for (const p of promos) {
    const e = await eligibility(db, p, userId);
    if (!e.ok) continue;
    out.push({
      id: p.id,
      title: p.title,
      description: p.description,
      discountPercent: p.discount_percent,
      maxDiscount: p.max_discount,
      vehicleTypes: p.vehicle_types,
      ridesLeft: e.ridesLeft,
      endsAt: p.ends_at,
      newCustomers: p.audience === 'NEW_CUSTOMERS',
    });
  }
  return out;
}

// ------------------------------------------------------------------ madereva: kikomo cha safari za ofa

/** Madereva waliofikia kikomo cha ofa hii kwa kipindi chake (hawapewi safari za ofa hii). */
export async function driversOverPromoLimit(client: Db, promotionId: string): Promise<string[]> {
  const p = await one<PromoRow>(client, 'SELECT * FROM naya.promotions WHERE id = $1', [promotionId]);
  if (!p || p.per_driver_limit === null) return [];
  const rows = await many<{ driver_id: string }>(
    client,
    `SELECT driver_id FROM naya.rides
      WHERE promotion_id = $1 AND driver_id IS NOT NULL AND status IN ${DRIVER_HOLDS} AND accepted_at >= ${PERIOD_START[p.per_driver_period]}
      GROUP BY driver_id HAVING count(*) >= $2`,
    [promotionId, p.per_driver_limit],
  );
  return rows.map((r) => r.driver_id);
}

export async function driverPromoUsage(client: Db, promotionId: string, driverId: string) {
  const p = await one<PromoRow>(client, 'SELECT * FROM naya.promotions WHERE id = $1', [promotionId]);
  if (!p || p.per_driver_limit === null) return { limit: null, used: 0, period: p?.per_driver_period ?? 'WEEK' };
  const row = await one<{ n: number }>(
    client,
    `SELECT count(*)::int AS n FROM naya.rides
      WHERE promotion_id = $1 AND driver_id = $2 AND status IN ${DRIVER_HOLDS} AND accepted_at >= ${PERIOD_START[p.per_driver_period]}`,
    [promotionId, driverId],
  );
  return { limit: p.per_driver_limit, used: row?.n ?? 0, period: p.per_driver_period };
}

const PERIOD_WORD: Record<DriverPeriod, string> = { DAY: 'leo', WEEK: 'wiki hii', TOTAL: 'kwenye ofa hii' };
export const driverLimitMessage = (limit: number, period: DriverPeriod) =>
  `Umefikia kikomo cha safari ${limit} za ofa ${PERIOD_WORD[period]}. Safari za kawaida unaendelea kupokea.`;

// ------------------------------------------------------------------ malipo ya NAYA kwa madereva

export const NETWORKS = ['MPESA', 'MIXX', 'AIRTEL', 'HALOPESA', 'TPESA', 'BANK'] as const;
export type Network = (typeof NETWORKS)[number];
export const NETWORK_LABEL: Record<Network, string> = {
  MPESA: 'M-Pesa (Vodacom)',
  MIXX: 'Mixx by Yas (Tigo Pesa)',
  AIRTEL: 'Airtel Money',
  HALOPESA: 'HaloPesa (Halotel)',
  TPESA: 'T-Pesa (TTCL)',
  BANK: 'Benki',
};

interface AccountRow {
  id: string;
  network: Network;
  phone: string;
  account_name: string;
  is_primary: boolean;
}
const accountView = (a: AccountRow) => ({ id: a.id, network: a.network, networkLabel: NETWORK_LABEL[a.network], phone: a.phone, accountName: a.account_name, primary: a.is_primary });

export async function payoutAccounts(client: Db, driverId: string) {
  const rows = await many<AccountRow>(client, 'SELECT * FROM naya.driver_payout_accounts WHERE driver_id = $1 ORDER BY is_primary DESC, created_at', [driverId]);
  return rows.map(accountView);
}

/** Kiasi NAYA inachomdai dereva: punguzo la safari za ofa zilizokamilika − malipo yaliyotumwa. */
export async function promoBalance(client: Db, driverId: string) {
  const row = await one<{ rides: number; earned: number; paid: number; last_paid_at: Date | null }>(
    client,
    `SELECT (SELECT count(*) FROM naya.rides WHERE driver_id = $1 AND status = 'COMPLETED' AND promo_discount > 0 AND coalesce(promo_payout_state, '') <> 'REJECTED')::int AS rides,
            (SELECT coalesce(sum(promo_discount), 0) FROM naya.rides WHERE driver_id = $1 AND status = 'COMPLETED' AND coalesce(promo_payout_state, '') <> 'REJECTED')::int AS earned,
            (SELECT coalesce(sum(amount), 0) FROM naya.promo_payouts WHERE driver_id = $1 AND voided_at IS NULL)::int AS paid,
            (SELECT max(paid_at) FROM naya.promo_payouts WHERE driver_id = $1 AND voided_at IS NULL) AS last_paid_at`,
    [driverId],
  );
  const earned = row?.earned ?? 0;
  const paid = row?.paid ?? 0;
  return { rides: row?.rides ?? 0, earned, paid, balance: earned - paid, lastPaidAt: row?.last_paid_at ?? null };
}

/** Kwa app ya dereva: deni la NAYA, namba zake za malipo, safari za ofa na malipo yaliyotumwa. */
export async function driverPromoWallet(driverId: string) {
  const [balance, accounts, trips, payouts] = await Promise.all([
    promoBalance(db, driverId),
    payoutAccounts(db, driverId),
    many(
      db,
      `SELECT id, completed_at AS "completedAt", pickup_name AS "from", dest_name AS "to", fare, promo_discount AS "nayaPays",
              fare - promo_discount AS "passengerPaid", promo_title AS "promoTitle",
              array_remove(flags, 'PIN_REMINDED') AS flags,
              promo_payout_state AS "payoutState", promo_payout_note AS "payoutNote"
         FROM naya.rides WHERE driver_id = $1 AND status = 'COMPLETED' AND promo_discount > 0
        ORDER BY completed_at DESC LIMIT 50`,
      [driverId],
    ),
    many(
      db,
      `SELECT id, amount, network, phone, reference, paid_at AS "paidAt", (payment_id IS NOT NULL) AS automatic FROM naya.promo_payouts
        WHERE driver_id = $1 AND voided_at IS NULL ORDER BY paid_at DESC LIMIT 50`,
      [driverId],
    ),
  ]);
  return {
    ...balance,
    accounts,
    trips,
    payouts: (payouts as { network: Network }[]).map((p) => ({ ...p, networkLabel: NETWORK_LABEL[p.network] ?? p.network })),
  };
}

export async function savePayoutAccount(
  driverId: string,
  input: { id?: string; network: Network; phone: string; accountName: string; primary?: boolean },
) {
  const driver = await one(db, 'SELECT 1 FROM naya.drivers WHERE user_id = $1', [driverId]);
  if (!driver) throw notFound('Bado hujaomba kuwa dereva.');
  try {
    await transaction(async (client) => {
      const count = await one<{ n: number }>(client, 'SELECT count(*)::int AS n FROM naya.driver_payout_accounts WHERE driver_id = $1', [driverId]);
      const makePrimary = input.primary || (count?.n ?? 0) === 0 || (!!input.id && (await one(client, 'SELECT 1 FROM naya.driver_payout_accounts WHERE id = $1 AND is_primary', [input.id])) !== null);
      if (!input.id && (count?.n ?? 0) >= 3) throw conflict('Unaweza kuweka namba 3 tu. Futa moja kwanza.');
      if (makePrimary) await client.query('UPDATE naya.driver_payout_accounts SET is_primary = false WHERE driver_id = $1', [driverId]);
      if (input.id) {
        const updated = await one(
          client,
          `UPDATE naya.driver_payout_accounts SET network = $3, phone = $4, account_name = $5, is_primary = $6, updated_at = now()
            WHERE id = $1 AND driver_id = $2 RETURNING id`,
          [input.id, driverId, input.network, input.phone, input.accountName, makePrimary],
        );
        if (!updated) throw notFound('Namba hii haikupatikana.');
      } else {
        await client.query(
          `INSERT INTO naya.driver_payout_accounts (driver_id, network, phone, account_name, is_primary) VALUES ($1, $2, $3, $4, $5)`,
          [driverId, input.network, input.phone, input.accountName, makePrimary],
        );
      }
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Namba hii tayari imewekwa.');
    throw error;
  }
  return payoutAccounts(db, driverId);
}

export async function deletePayoutAccount(driverId: string, id: string) {
  await transaction(async (client) => {
    const gone = await one<{ is_primary: boolean }>(client, 'DELETE FROM naya.driver_payout_accounts WHERE id = $1 AND driver_id = $2 RETURNING is_primary', [id, driverId]);
    if (!gone) throw notFound('Namba hii haikupatikana.');
    if (gone.is_primary) {
      await client.query(
        `UPDATE naya.driver_payout_accounts SET is_primary = true
          WHERE id = (SELECT id FROM naya.driver_payout_accounts WHERE driver_id = $1 ORDER BY created_at LIMIT 1)`,
        [driverId],
      );
    }
  });
  return payoutAccounts(db, driverId);
}

// ------------------------------------------------------------------ ofisi: ofa

export interface PromoInput {
  name: string;
  title: string;
  description: string | null;
  audience: Audience;
  discountPercent: number;
  maxDiscount: number | null;
  minFare: number | null;
  maxFare: number | null;
  vehicleTypes: VehicleType[] | null;
  perCustomerLimit: number | null;
  perDriverLimit: number | null;
  perDriverPeriod: DriverPeriod;
  budget: number | null;
  priority: number;
  startsAt: Date | null;
  endsAt: Date | null;
}

function checkInput(i: PromoInput) {
  if (i.minFare !== null && i.maxFare !== null && i.maxFare < i.minFare) throw badRequest('Nauli ya juu iwe kubwa kuliko nauli ya chini.');
  if (i.endsAt && i.startsAt && i.endsAt <= i.startsAt) throw badRequest('Tarehe ya kuisha iwe baada ya tarehe ya kuanza.');
  if (i.endsAt && i.endsAt <= new Date()) throw badRequest('Tarehe ya kuisha imeshapita.');
  if (i.vehicleTypes && i.vehicleTypes.length === 0) throw badRequest('Chagua angalau chombo kimoja.');
}

const promoParams = (i: PromoInput) => [
  i.name, i.title, i.description, i.audience, i.discountPercent, i.maxDiscount, i.minFare, i.maxFare,
  i.vehicleTypes && i.vehicleTypes.length < 2 ? i.vehicleTypes : null, i.perCustomerLimit, i.perDriverLimit, i.perDriverPeriod,
  i.budget, i.priority, i.startsAt ?? new Date(), i.endsAt,
];

export async function createPromotion(adminId: string, input: PromoInput) {
  checkInput(input);
  const row = await transaction(async (client) => {
    const r = await one<{ id: string }>(
      client,
      `INSERT INTO naya.promotions (name, title, description, audience, discount_percent, max_discount, min_fare, max_fare, vehicle_types,
                                    per_customer_limit, per_driver_limit, per_driver_period, budget, priority, starts_at, ends_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::naya.vehicle_type[], $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
      [...promoParams(input), adminId],
    );
    await writeAudit(client, { actorId: adminId, action: 'promotion.created', targetType: 'promotion', targetId: r!.id, details: { name: input.name } });
    return r!;
  });
  return promotionDetail(row.id);
}

export async function updatePromotion(adminId: string, id: string, input: PromoInput) {
  checkInput(input);
  await transaction(async (client) => {
    const r = await one(
      client,
      `UPDATE naya.promotions SET name = $1, title = $2, description = $3, audience = $4, discount_percent = $5, max_discount = $6,
              min_fare = $7, max_fare = $8, vehicle_types = $9::naya.vehicle_type[], per_customer_limit = $10, per_driver_limit = $11,
              per_driver_period = $12, budget = $13, priority = $14, starts_at = $15, ends_at = $16, updated_at = now()
        WHERE id = $17 AND status <> 'ENDED' RETURNING id`,
      [...promoParams(input), id],
    );
    if (!r) throw conflict('Ofa hii haipo au imeshaisha (ofa iliyoisha haibadilishwi).');
    await writeAudit(client, { actorId: adminId, action: 'promotion.updated', targetType: 'promotion', targetId: id, details: { name: input.name } });
  });
  return promotionDetail(id);
}

export async function setPromotionStatus(adminId: string, id: string, status: PromoStatus) {
  await transaction(async (client) => {
    const r = await one(
      client,
      `UPDATE naya.promotions SET status = $2::varchar, updated_at = now(), ends_at = CASE WHEN $2::varchar = 'ENDED' AND (ends_at IS NULL OR ends_at > now()) THEN now() ELSE ends_at END
        WHERE id = $1 AND status <> 'ENDED' RETURNING id`,
      [id, status],
    );
    if (!r) throw conflict('Ofa hii haipo au imeshaisha.');
    await writeAudit(client, { actorId: adminId, action: `promotion.${status.toLowerCase()}`, targetType: 'promotion', targetId: id });
  });
  return promotionDetail(id);
}

const STATS_SQL = `
  SELECT p.id,
         count(r.id) FILTER (WHERE r.status = 'COMPLETED')::int AS completed,
         count(r.id) FILTER (WHERE r.status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))::int AS active,
         count(DISTINCT r.passenger_id) FILTER (WHERE r.status = 'COMPLETED')::int AS customers,
         count(DISTINCT r.driver_id) FILTER (WHERE r.status = 'COMPLETED')::int AS drivers,
         coalesce(sum(r.promo_discount) FILTER (WHERE r.status = 'COMPLETED'), 0)::int AS cost,
         coalesce(sum(r.promo_discount) FILTER (WHERE r.status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS')), 0)::int AS reserved,
         coalesce(sum(r.fare - r.promo_discount) FILTER (WHERE r.status = 'COMPLETED'), 0)::int AS "customersPaid",
         count(r.id) FILTER (WHERE r.status = 'COMPLETED' AND r.completed_at >= (date_trunc('week', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'))::int AS "thisWeek"
    FROM naya.promotions p LEFT JOIN naya.rides r ON r.promotion_id = p.id`;

function promoView(p: PromoRow, s: Record<string, number> | undefined) {
  const stats = s ?? { completed: 0, active: 0, customers: 0, drivers: 0, cost: 0, reserved: 0, customersPaid: 0, thisWeek: 0 };
  const live = p.status === 'ACTIVE' && p.starts_at <= new Date() && (!p.ends_at || p.ends_at > new Date());
  return {
    id: p.id,
    name: p.name,
    title: p.title,
    description: p.description,
    audience: p.audience,
    discountPercent: p.discount_percent,
    maxDiscount: p.max_discount,
    minFare: p.min_fare,
    maxFare: p.max_fare,
    vehicleTypes: parseVehicles(p.vehicle_types),
    perCustomerLimit: p.per_customer_limit,
    perDriverLimit: p.per_driver_limit,
    perDriverPeriod: p.per_driver_period,
    budget: p.budget,
    priority: p.priority,
    status: p.status,
    live,
    scheduled: p.status === 'ACTIVE' && p.starts_at > new Date(),
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    createdAt: p.created_at,
    stats: { ...stats, budgetLeft: p.budget === null ? null : Math.max(0, p.budget - stats.cost - stats.reserved) },
  };
}

export async function listPromotions() {
  const [rows, stats] = await Promise.all([
    many<PromoRow>(db, `SELECT * FROM naya.promotions ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 ELSE 2 END, priority DESC, created_at DESC`),
    many<Record<string, number> & { id: string }>(db, `${STATS_SQL} GROUP BY p.id`),
  ]);
  const byId = new Map(stats.map((s) => [s.id, s]));
  const totals = await one<Record<string, number>>(
    db,
    `SELECT coalesce(sum(promo_discount) FILTER (WHERE status = 'COMPLETED'), 0)::int AS cost,
            count(*) FILTER (WHERE status = 'COMPLETED' AND promo_discount > 0)::int AS rides,
            (SELECT coalesce(sum(amount), 0) FROM naya.promo_payouts WHERE voided_at IS NULL)::int AS paid
       FROM naya.rides WHERE promotion_id IS NOT NULL`,
  );
  const t = totals ?? { cost: 0, rides: 0, paid: 0 };
  return { promotions: rows.map((r) => promoView(r, byId.get(r.id))), totals: { ...t, owed: t.cost - t.paid } };
}

export async function promotionDetail(id: string) {
  const p = await one<PromoRow>(db, 'SELECT * FROM naya.promotions WHERE id = $1', [id]);
  if (!p) throw notFound('Ofa haikupatikana');
  const stats = await one<Record<string, number>>(db, `${STATS_SQL} WHERE p.id = $1 GROUP BY p.id`, [id]);
  const rides = await many(
    db,
    `SELECT r.id, r.status, r.requested_at AS "requestedAt", r.completed_at AS "completedAt", r.fare, r.promo_discount AS discount,
            r.fare - r.promo_discount AS "passengerPays", r.pickup_name AS "from", r.dest_name AS "to",
            pu.full_name AS "passengerName", pu.phone AS "passengerPhone", du.full_name AS "driverName", d.plate_number AS "driverPlate"
       FROM naya.rides r JOIN naya.users pu ON pu.id = r.passenger_id
       LEFT JOIN naya.users du ON du.id = r.driver_id LEFT JOIN naya.drivers d ON d.user_id = r.driver_id
      WHERE r.promotion_id = $1 ORDER BY r.requested_at DESC LIMIT 200`,
    [id],
  );
  return { ...promoView(normalize(p), stats ?? undefined), rides };
}

// ------------------------------------------------------------------ ofisi: malipo ya ofa kwa madereva

export async function driverPayoutsReport(opts: { q?: string; onlyOwed?: boolean } = {}) {
  const q = opts.q?.trim() ? (/^0\d{3,}$/.test(opts.q.trim()) ? `255${opts.q.trim().slice(1)}` : opts.q.trim()) : null;
  const rows = await many<Record<string, unknown> & { balance: number }>(
    db,
    `WITH earned AS (
       SELECT driver_id, count(*)::int AS rides, sum(promo_discount)::int AS earned,
              count(*) FILTER (WHERE completed_at >= (date_trunc('week', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}'))::int AS "weekRides"
         FROM naya.rides WHERE status = 'COMPLETED' AND promo_discount > 0 AND coalesce(promo_payout_state, '') <> 'REJECTED' GROUP BY driver_id
     ), paid AS (
       SELECT driver_id, sum(amount)::int AS paid, max(paid_at) AS last_paid_at FROM naya.promo_payouts WHERE voided_at IS NULL GROUP BY driver_id
     )
     SELECT d.user_id AS id, u.full_name AS name, u.phone, d.plate_number AS plate, d.vehicle_type::text AS "vehicleType",
            coalesce(e.rides, 0) AS rides, coalesce(e."weekRides", 0) AS "weekRides", coalesce(e.earned, 0) AS earned,
            coalesce(p.paid, 0) AS paid, coalesce(e.earned, 0) - coalesce(p.paid, 0) AS balance, p.last_paid_at AS "lastPaidAt",
            a.network, a.phone AS "payPhone", a.account_name AS "payName",
            (SELECT count(*)::int FROM naya.driver_payout_accounts x WHERE x.driver_id = d.user_id) AS "accountCount"
       FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
       LEFT JOIN earned e ON e.driver_id = d.user_id LEFT JOIN paid p ON p.driver_id = d.user_id
       LEFT JOIN naya.driver_payout_accounts a ON a.driver_id = d.user_id AND a.is_primary
      WHERE (e.driver_id IS NOT NULL OR p.driver_id IS NOT NULL)
        AND ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%' OR u.phone ILIKE '%' || $1 || '%' OR d.plate_number ILIKE '%' || $1 || '%')
      ORDER BY coalesce(e.earned, 0) - coalesce(p.paid, 0) DESC, u.full_name`,
    [q],
  );
  const list = opts.onlyOwed ? rows.filter((r) => r.balance > 0) : rows;
  const sum = (k: string) => rows.reduce((t, r) => t + Number(r[k] ?? 0), 0);
  return {
    summary: {
      drivers: rows.length,
      owedDrivers: rows.filter((r) => r.balance > 0).length,
      noNumber: rows.filter((r) => r.balance > 0 && !r.network).length,
      earned: sum('earned'),
      paid: sum('paid'),
      balance: sum('balance'),
    },
    rows: list.map((r) => ({ ...r, networkLabel: r.network ? NETWORK_LABEL[r.network as Network] : null })),
  };
}

export async function driverPayoutDetail(driverId: string) {
  const driver = await one<{ name: string; phone: string; plate: string | null }>(
    db,
    'SELECT u.full_name AS name, u.phone, d.plate_number AS plate FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id WHERE d.user_id = $1',
    [driverId],
  );
  if (!driver) throw notFound('Dereva hakupatikana');
  const wallet = await driverPromoWallet(driverId);
  const allPayouts = await many(
    db,
    `SELECT p.id, p.amount, p.network, p.phone, p.account_name AS "accountName", p.reference, p.note, p.paid_at AS "paidAt",
            coalesce(u.full_name, 'Moja kwa moja (NAYA)') AS "paidBy", (p.payment_id IS NOT NULL) AS automatic,
            p.voided_at AS "voidedAt", p.void_reason AS "voidReason"
       FROM naya.promo_payouts p LEFT JOIN naya.users u ON u.id = p.paid_by WHERE p.driver_id = $1 ORDER BY p.paid_at DESC`,
    [driverId],
  );
  return { driver: { id: driverId, ...driver }, ...wallet, payouts: allPayouts };
}

export async function recordPayout(
  adminId: string,
  driverId: string,
  input: { amount: number; accountId: string; reference: string; note: string | null },
) {
  let out: { amount: number; network: Network; phone: string } | null = null;
  try {
    await transaction(async (client) => {
      await client.query('SELECT 1 FROM naya.drivers WHERE user_id = $1 FOR UPDATE', [driverId]);
      const account = await one<AccountRow>(client, 'SELECT * FROM naya.driver_payout_accounts WHERE id = $1 AND driver_id = $2', [input.accountId, driverId]);
      if (!account) throw badRequest('Chagua namba ya dereva ya kutuma pesa.');
      const { balance } = await promoBalance(client, driverId);
      if (balance <= 0) throw conflict('Dereva huyu hadai NAYA chochote kwa sasa.');
      if (input.amount > balance) throw conflict(`Kiasi kinazidi deni la dereva (TSh ${balance.toLocaleString('en-US')}).`);
      await client.query(
        `INSERT INTO naya.promo_payouts (driver_id, amount, network, phone, account_name, reference, note, paid_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [driverId, input.amount, account.network, account.phone, account.account_name, input.reference, input.note, adminId],
      );
      await writeAudit(client, {
        actorId: adminId,
        action: 'promo_payout.recorded',
        targetType: 'driver',
        targetId: driverId,
        details: { amount: input.amount, network: account.network, reference: input.reference },
      });
      out = { amount: input.amount, network: account.network, phone: account.phone };
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Namba hii ya muamala tayari imeandikwa kwenye malipo mengine.');
    throw error;
  }
  const paid = out as unknown as { amount: number; network: Network; phone: string };
  const body = `NAYA imekutumia TSh ${paid.amount.toLocaleString('en-US')} kwenye ${NETWORK_LABEL[paid.network]} ${paid.phone} (malipo ya safari za ofa). Kumbukumbu: ${input.reference}.`;
  await notify({ userId: driverId, event: 'driver', kind: 'promo_payout', title: 'Umelipwa na NAYA', body, sms: body });
  return driverPayoutDetail(driverId);
}

export async function voidPayout(adminId: string, payoutId: string, reason: string) {
  const row = await transaction(async (client) => {
    const r = await one<{ driver_id: string; amount: number }>(
      client,
      `UPDATE naya.promo_payouts SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1 AND voided_at IS NULL RETURNING driver_id, amount`,
      [payoutId, adminId, reason],
    );
    if (!r) throw notFound('Malipo haya hayapo au yameshafutwa.');
    await writeAudit(client, { actorId: adminId, action: 'promo_payout.voided', targetType: 'driver', targetId: r.driver_id, details: { payoutId, reason } });
    return r;
  });
  return driverPayoutDetail(row.driver_id);
}

export function payoutsCsv(r: Awaited<ReturnType<typeof driverPayoutsReport>>) {
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Dereva', 'Simu', 'Plate', 'Safari za ofa', 'Wiki hii', 'NAYA inadaiwa (TSh)', 'Imeshalipwa (TSh)', 'Salio la kulipa (TSh)',
    'Mtandao', 'Namba ya kutumia pesa', 'Jina la mwenye namba', 'Malipo ya mwisho'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lines = (r.rows as Record<string, any>[]).map((x) => [x.name, x.phone, x.plate, x.rides, x.weekRides, x.earned, x.paid, x.balance, x.networkLabel ?? 'HAJAWEKA NAMBA',
    x.payPhone ?? '', x.payName ?? '', x.lastPaidAt ? new Date(x.lastPaidAt as string).toISOString().slice(0, 10) : '']);
  return `﻿${[header, ...lines].map((l) => l.map(cell).join(',')).join('\r\n')}\r\n`;
}

// ------------------------------------------------------------------ uwazi: kwa nini mteja anaona / haoni ofa

const tz = (d: Date) =>
  new Intl.DateTimeFormat('sw-TZ', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
const VEHICLE_WORD: Record<VehicleType, string> = { BODABODA: 'Bodaboda', BAJAJI: 'Bajaji' };

export type PromoReason =
  | 'ok' | 'paused' | 'ended' | 'not_started' | 'expired' | 'driver' | 'suspended' | 'vehicle' | 'fare_low' | 'fare_high'
  | 'no_discount' | 'not_new' | 'used_up' | 'budget';

interface ReasonResult {
  ok: boolean;
  code: PromoReason;
  text: string;
  discount: number;
  ridesLeft: number | null;
}

/**
 * Sababu moja iliyo wazi kwa nini ofa hii inamfaa / haimfai mteja huyu (kwa nauli na chombo fulani).
 * Kanuni ni zile zile za bestPromotion — hii inaeleza tu.
 */
async function reasonFor(client: Db, p: PromoRow, userId: string, opts: { fare?: number; vehicleType?: VehicleType; driverStatus?: string | null; suspended?: boolean }): Promise<ReasonResult> {
  const no = (code: PromoReason, text: string): ReasonResult => ({ ok: false, code, text, discount: 0, ridesLeft: null });
  const now = new Date();
  if (p.status === 'ENDED') return no('ended', 'Ofa imemalizwa.');
  if (p.status === 'PAUSED') return no('paused', 'Ofa imesimamishwa — bonyeza "Washa ofa" ili wateja waione.');
  if (p.starts_at > now) return no('not_started', `Ofa bado haijaanza — inaanza ${tz(p.starts_at)}.`);
  if (p.ends_at && p.ends_at <= now) return no('expired', `Muda wa ofa uliisha ${tz(p.ends_at)}.`);
  if (opts.suspended) return no('suspended', 'Akaunti ya mteja huyu imesimamishwa — hawezi kuagiza safari.');
  if (opts.driverStatus) return no('driver', `Ni dereva (usajili wake wa dereva: ${DRIVER_STATUS_WORD[opts.driverStatus] ?? opts.driverStatus}). Ofa ni kwa wateja tu, ili dereva asijinufaishe.`);
  if (opts.vehicleType && p.vehicle_types && !p.vehicle_types.includes(opts.vehicleType)) {
    return no('vehicle', `Ofa ni kwa ${p.vehicle_types.map((v) => VEHICLE_WORD[v]).join(' na ')} tu — si ${VEHICLE_WORD[opts.vehicleType]}.`);
  }
  if (opts.fare !== undefined) {
    if (p.min_fare !== null && opts.fare < p.min_fare) return no('fare_low', `Nauli ${tsh(opts.fare)} iko chini ya nauli ya chini ya ofa (${tsh(p.min_fare)}).`);
    if (p.max_fare !== null && opts.fare > p.max_fare) return no('fare_high', `Nauli ${tsh(opts.fare)} iko juu ya nauli ya juu ya ofa (${tsh(p.max_fare)}).`);
  }
  const e = await eligibility(client, p, userId);
  if (!e.ok) {
    if (e.reason === 'not_new') return no('not_new', `Si mteja mpya — ameshamaliza safari ${e.usage.otherCompleted} na NAYA. Ofa hii ni kwa wateja wapya tu.`);
    if (e.reason === 'used_up') return no('used_up', `Ameshatumia safari zake zote ${p.per_customer_limit} za ofa hii.`);
    return no('budget', `Bajeti ya ofa imeisha (${tsh(e.usage.budgetUsed)} kati ya ${tsh(p.budget ?? 0)}).`);
  }
  let discount = opts.fare !== undefined ? discountFor(p, opts.fare) : 0;
  if (opts.fare !== undefined && p.budget !== null) discount = Math.min(discount, Math.floor((p.budget - e.usage.budgetUsed) / 50) * 50);
  if (opts.fare !== undefined && discount <= 0) return no('no_discount', `Punguzo la safari ya ${tsh(opts.fare)} ni chini ya TSh 50, kwa hiyo halitolewi.`);
  const left = e.ridesLeft;
  return {
    ok: true,
    code: 'ok',
    text:
      opts.fare !== undefined
        ? `Inamfaa: safari ya ${tsh(opts.fare)} — analipa ${tsh(opts.fare - discount)}, NAYA inamlipa dereva ${tsh(discount)}.${left !== null ? ` Safari ${left} za ofa zimebaki.` : ''}`
        : `Inamfaa.${left !== null ? ` Safari ${left} za ofa zimebaki.` : ''}`,
    discount,
    ridesLeft: left,
  };
}

const DRIVER_STATUS_WORD: Record<string, string> = { APPROVED: 'amethibitishwa', PENDING: 'anasubiri kuthibitishwa', SUSPENDED: 'amesimamishwa' };
const tsh = (v: number) => `TSh ${Math.round(v).toLocaleString('en-US')}`;

/** Ofisi: "Kwa nini mteja huyu haoni ofa?" — namba ya simu → jibu la sentensi moja + kila ofa + safari zake za karibuni. */
export async function checkCustomerOffers(phone: string, opts: { fare: number; vehicleType: VehicleType }) {
  const user = await one<{ id: string; full_name: string; phone: string; role: string; status: string; phone_verified_at: Date | null; driver_status: string | null; completed: number }>(
    db,
    `SELECT u.id, u.full_name, u.phone, u.role, u.status, u.phone_verified_at, d.status::text AS driver_status,
            (SELECT count(*) FROM naya.rides r WHERE r.passenger_id = u.id AND r.status = 'COMPLETED')::int AS completed
       FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id WHERE u.phone = $1`,
    [phone],
  );
  if (!user) throw notFound('Hakuna mtumiaji mwenye namba hii kwenye NAYA.');
  if (user.role !== 'USER') throw badRequest('Namba hii ni ya mfanyakazi wa ofisi, si mteja.');
  const driverStatus = user.driver_status && ['APPROVED', 'PENDING', 'SUSPENDED'].includes(user.driver_status) ? user.driver_status : null;
  const promos = (await many<PromoRow>(db, `SELECT * FROM naya.promotions WHERE status <> 'ENDED' ORDER BY priority DESC, created_at`)).map(normalize);
  const offers = [];
  for (const p of promos) {
    const r = await reasonFor(db, p, user.id, { ...opts, driverStatus, suspended: user.status === 'SUSPENDED' });
    offers.push({ id: p.id, name: p.name, title: p.title, status: p.status, audience: p.audience, ...r });
  }
  const best = offers.filter((o) => o.ok).sort((a, b) => b.discount - a.discount)[0];
  const live = offers.filter((o) => !['paused', 'not_started', 'expired', 'ended'].includes(o.code));
  let verdict: { ok: boolean; text: string };
  if (best) verdict = { ok: true, text: `Anaona ofa “${best.title}”. ${best.text.replace(/^Inamfaa: /, '')}` };
  else if (!live.length) verdict = { ok: false, text: offers.length ? 'Hakuna ofa inayoendelea sasa hivi — ofa zilizopo zimesimamishwa au muda wake haujafika / umeisha.' : 'Hakuna ofa yoyote iliyoundwa.' };
  else verdict = { ok: false, text: live[0].text };
  const notVerified = !user.phone_verified_at;
  const rides = await many(
    db,
    `SELECT r.id, r.status, r.requested_at AS "requestedAt", r.pickup_name AS "from", r.dest_name AS "to", r.vehicle_type AS "vehicleType",
            r.fare, r.promo_discount AS "promoDiscount", r.promo_title AS "promoTitle",
            (SELECT h.note FROM naya.ride_status_history h WHERE h.ride_id = r.id AND h.note LIKE 'Ofa imeondolewa%' ORDER BY h.created_at LIMIT 1) AS "promoDropped"
       FROM naya.rides r WHERE r.passenger_id = $1 ORDER BY r.requested_at DESC LIMIT 5`,
    [user.id],
  );
  return {
    user: {
      id: user.id,
      name: user.full_name,
      phone: user.phone,
      suspended: user.status === 'SUSPENDED',
      phoneVerified: !notVerified,
      driverStatus: user.driver_status,
      completedRides: user.completed,
    },
    fare: opts.fare,
    vehicleType: opts.vehicleType,
    verdict,
    notes: notVerified ? ['Namba yake bado haijathibitishwa kwa SMS — hawezi kuagiza safari mpaka athibitishe.'] : [],
    offers,
    rides,
  };
}

/** Ofisi: kabla ya kuwasha / kuhifadhi ofa — wateja wangapi wanaweza kuipata sasa, na maonyo ya mipangilio inayozuia. */
export async function previewPromotion(input: Omit<PromoInput, 'name' | 'title' | 'description'>, id?: string) {
  const now = new Date();
  const vehicles = input.vehicleTypes && input.vehicleTypes.length && input.vehicleTypes.length < 2 ? input.vehicleTypes : null;
  const warnings: { level: 'warn' | 'info'; text: string }[] = [];
  // Wateja: watumiaji wa kawaida, hawajasimamishwa, si madereva
  const counts = await one<{ customers: number; eligible: number }>(
    db,
    `SELECT count(*)::int AS customers,
            count(*) FILTER (WHERE ($1::text <> 'NEW_CUSTOMERS' OR NOT EXISTS (
                SELECT 1 FROM naya.rides r WHERE r.passenger_id = u.id AND r.status = 'COMPLETED' AND ($2::uuid IS NULL OR r.promotion_id IS DISTINCT FROM $2::uuid)))
              AND ($3::int IS NULL OR $2::uuid IS NULL OR (
                SELECT count(*) FROM naya.rides r WHERE r.passenger_id = u.id AND r.promotion_id = $2::uuid AND r.status IN ${HOLDS}) < $3::int))::int AS eligible
       FROM naya.users u
      WHERE u.role = 'USER' AND u.status = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM naya.drivers d WHERE d.user_id = u.id AND d.status IN ('APPROVED', 'PENDING', 'SUSPENDED'))`,
    [input.audience, id ?? null, input.perCustomerLimit],
  );
  const customers = counts?.customers ?? 0;
  const eligible = counts?.eligible ?? 0;
  if (customers > 0 && eligible === 0) warnings.push({ level: 'warn', text: 'Hakuna mteja anayeweza kuipata ofa hii sasa hivi.' });

  if (input.startsAt && input.startsAt > now) warnings.push({ level: 'info', text: `Ofa inaanza ${tz(input.startsAt)}. Kabla ya hapo wateja hawataiona, hata ukiiwasha.` });
  if (input.endsAt && input.endsAt <= now) warnings.push({ level: 'warn', text: 'Tarehe ya kuisha imeshapita.' });
  if (vehicles) warnings.push({ level: 'info', text: `Ni kwa ${VEHICLE_WORD[vehicles[0]]} tu — wateja wa ${VEHICLE_WORD[vehicles[0] === 'BODABODA' ? 'BAJAJI' : 'BODABODA']} hawataiona.` });
  if (input.maxDiscount !== null && input.maxDiscount < 50) warnings.push({ level: 'warn', text: 'Punguzo la juu ni chini ya TSh 50. Punguzo linazungushwa kwa TSh 50, kwa hiyo hakuna mteja atakayepata punguzo.' });

  // Nauli za safari za siku 30 zilizopita: ngapi zingepata ofa hii?
  const fares = await many<{ fare: number }>(
    db,
    `SELECT fare FROM naya.rides WHERE requested_at >= now() - interval '30 days' AND ($1::text[] IS NULL OR vehicle_type::text = ANY($1::text[]))`,
    [vehicles],
  );
  const shape = { discount_percent: input.discountPercent, max_discount: input.maxDiscount, min_fare: input.minFare, max_fare: input.maxFare };
  const discounts = fares.map((f) => discountFor(shape, f.fare));
  const inRange = discounts.filter((d) => d > 0);
  const recent = { trips: fares.length, qualifying: inRange.length, avgDiscount: inRange.length ? Math.round(inRange.reduce((a, b) => a + b, 0) / inRange.length) : 0 };
  if (fares.length >= 5) {
    const pct = Math.round((inRange.length / fares.length) * 100);
    if (pct === 0) warnings.push({ level: 'warn', text: `Hakuna hata safari moja kati ya ${fares.length} za siku 30 zilizopita ingepata ofa hii — angalia nauli ya chini/juu.` });
    else if (pct < 50) warnings.push({ level: 'warn', text: `Ni ${pct}% tu ya safari za siku 30 zilizopita (${inRange.length} kati ya ${fares.length}) zingepata ofa hii, kwa sababu ya kiwango cha nauli ulichoweka.` });
  }
  if (input.budget !== null && recent.avgDiscount > 0) {
    const used = id ? (await one<{ used: number }>(db, `SELECT coalesce(sum(promo_discount), 0)::int AS used FROM naya.rides WHERE promotion_id = $1 AND status IN ${HOLDS}`, [id]))?.used ?? 0 : 0;
    const left = Math.max(0, input.budget - used);
    const trips = Math.floor(left / recent.avgDiscount);
    if (left <= 0) warnings.push({ level: 'warn', text: 'Bajeti ya ofa imeshaisha — wateja hawataiona. Ongeza bajeti.' });
    else warnings.push({ level: trips < 10 ? 'warn' : 'info', text: `Bajeti iliyobaki (${tsh(left)}) inatosha takriban safari ${trips} (punguzo la wastani ${tsh(recent.avgDiscount)}).` });
  }
  if (input.perDriverLimit !== null) {
    const drivers = (await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM naya.drivers WHERE status = 'APPROVED'`))?.n ?? 0;
    const period = { DAY: 'kwa siku', WEEK: 'kwa wiki', TOTAL: 'kwa ofa yote' }[input.perDriverPeriod];
    warnings.push({
      level: drivers === 0 ? 'warn' : 'info',
      text: `Madereva ${drivers} waliothibitishwa × safari ${input.perDriverLimit} = nafasi ${drivers * input.perDriverLimit} za ofa ${period}. Madereva walio karibu wakimaliza nafasi zao, mteja anaagiza kwa bei kamili (anaambiwa).`,
    });
  }
  const others = await many<{ id: string; name: string }>(
    db,
    `SELECT id, name FROM naya.promotions WHERE status = 'ACTIVE' AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()) AND ($1::uuid IS NULL OR id <> $1::uuid)`,
    [id ?? null],
  );
  for (const o of others) warnings.push({ level: 'info', text: `Ofa “${o.name}” tayari inaendelea. Safari moja inapata ofa moja tu — yenye punguzo kubwa zaidi kwa mteja.` });
  return { customers, eligible, recent, warnings };
}

export async function previewSavedPromotion(id: string) {
  const p = await one<PromoRow>(db, 'SELECT * FROM naya.promotions WHERE id = $1', [id]);
  if (!p) throw notFound('Ofa haikupatikana');
  const r = normalize(p);
  return previewPromotion(
    {
      audience: r.audience,
      discountPercent: r.discount_percent,
      maxDiscount: r.max_discount,
      minFare: r.min_fare,
      maxFare: r.max_fare,
      vehicleTypes: r.vehicle_types,
      perCustomerLimit: r.per_customer_limit,
      perDriverLimit: r.per_driver_limit,
      perDriverPeriod: r.per_driver_period,
      budget: r.budget,
      priority: r.priority,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
    },
    id,
  );
}

/**
 * App ya mteja: ofa anazoweza kutumia + ujumbe mfupi pale ofa zipo lakini yeye hazimfai (ili asidhani app imeharibika).
 * Hatumwambii "si mteja mpya" — ofa hiyo haikuwa kwake tangu mwanzo.
 */
export async function offersWithNotice(userId: string) {
  const s = await one<{ rides: number; amount: number }>(
    db,
    `SELECT count(*)::int AS rides, coalesce(sum(promo_discount), 0)::int AS amount
       FROM naya.rides WHERE passenger_id = $1 AND status = 'COMPLETED' AND promo_discount > 0`,
    [userId],
  );
  const saved = { rides: s?.rides ?? 0, amount: s?.amount ?? 0 };
  const r = await offersNotice(userId);
  return { ...r, saved };
}

async function offersNotice(userId: string) {
  const list = await offersForPassenger(userId);
  if (list.length) return { offers: list, notice: null };
  const promos = await activePromotions();
  if (!promos.length) return { offers: [], notice: null };
  if (!(await isCustomer(db, userId))) {
    return { offers: [], notice: 'Ofa za NAYA ni kwa wateja tu. Akaunti hii imesajiliwa kama dereva, kwa hiyo haipati ofa.' };
  }
  const reasons = [];
  for (const p of promos) reasons.push({ p, e: await eligibility(db, p, userId) });
  const relevant = reasons.filter((r) => !(r.e.reason === 'not_new'));
  if (relevant.length && relevant.every((r) => r.e.reason === 'used_up')) return { offers: [], notice: 'Umeshatumia safari zako zote za ofa. Asante kwa kusafiri na NAYA!' };
  const full = relevant.find((r) => r.e.reason === 'budget');
  if (full) return { offers: [], notice: `Ofa “${full.p.title}” imejaa. Endelea kufuatilia NAYA kwa ofa mpya.` };
  return { offers: [], notice: null };
}

/** Bei kwenye app: kwa nini safari HII haipati ofa ingawa mteja ana ofa (nauli / chombo). */
export async function promoNoteFor(userId: string, vehicleType: VehicleType, fare: number, promos: PromoRow[]) {
  for (const p of promos) {
    const e = await eligibility(db, p, userId);
    if (!e.ok) continue;
    if (p.vehicle_types && !p.vehicle_types.includes(vehicleType)) return `Ofa “${p.title}” ni kwa ${p.vehicle_types.map((v) => VEHICLE_WORD[v]).join(' na ')} tu`;
    if (p.min_fare !== null && fare < p.min_fare) return `Ofa “${p.title}” ni kwa nauli kuanzia ${tsh(p.min_fare)}`;
    if (p.max_fare !== null && fare > p.max_fare) return `Ofa “${p.title}” ni kwa nauli hadi ${tsh(p.max_fare)}`;
  }
  return null;
}
