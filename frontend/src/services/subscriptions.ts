// Ada ya mwezi ya madereva.
//
// - Kila dereva ana `paid_until`: anaweza kupokea safari mpaka hapo, + siku chache za kuvumiliwa (graceDays).
// - Dereva mpya anapothibitishwa anapata siku za bure (trialDays).
// - Malipo yanarekodiwa na ofisi tu (taslimu au namba ya muamala wa simu) — hakuna kitu kinachojifanya kimelipwa.
//   Kila malipo yanaongeza siku 30 × miezi, kuanzia paid_until (kama bado ina siku) au leo (kama imeshaisha).
// - Malipo yaliyokosewa yanabatilishwa (si kufutwa): paid_until inarudi pale ilipokuwa kabla yake.
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { AppError, badRequest, conflict, isUniqueViolation, notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { notify, notifyAdmins } from './notify.js';

export const PERIOD_DAYS = 30;
const DAY_MS = 86_400_000;

export interface SubscriptionSettings {
  monthlyFee: number;
  trialDays: number;
  graceDays: number;
  paymentInstructions: string;
}

const DEFAULTS: SubscriptionSettings = {
  monthlyFee: 5000,
  trialDays: 30,
  graceDays: 3,
  paymentInstructions: 'Lipa ada yako ofisini kwa NAYA. Ofisi itarekodi malipo yako na utaweza kwenda online mara moja.',
};

export const PAYMENT_METHODS = ['CASH', 'MPESA', 'AIRTEL', 'TIGO', 'HALOPESA', 'BANK'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export async function getSettings(client: Db = db): Promise<SubscriptionSettings> {
  const row = await one<{ value: Partial<SubscriptionSettings> }>(client, `SELECT value FROM naya.settings WHERE key = 'subscription'`);
  return { ...DEFAULTS, ...(row?.value ?? {}) };
}

export async function saveSettings(adminId: string, input: SubscriptionSettings) {
  await transaction(async (client) => {
    const before = await getSettings(client);
    await client.query(
      `INSERT INTO naya.settings (key, value, updated_by, updated_at) VALUES ('subscription', $1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(input), adminId],
    );
    await writeAudit(client, {
      actorId: adminId,
      action: 'settings.subscription',
      targetType: 'settings',
      targetId: null,
      details: { before, after: input },
    });
  });
  return getSettings();
}

export type SubscriptionState = 'ACTIVE' | 'GRACE' | 'EXPIRED' | 'NONE';

/** Hali ya ada kwa paid_until fulani (bila database). */
export function describeSubscription(paidUntil: Date | null, settings: SubscriptionSettings, now = new Date()) {
  if (!paidUntil) {
    return { state: 'NONE' as SubscriptionState, paidUntil: null, graceEndsAt: null, daysLeft: 0, monthlyFee: settings.monthlyFee };
  }
  const graceEndsAt = new Date(paidUntil.getTime() + settings.graceDays * DAY_MS);
  const state: SubscriptionState = paidUntil > now ? 'ACTIVE' : graceEndsAt > now ? 'GRACE' : 'EXPIRED';
  return {
    state,
    paidUntil,
    graceEndsAt,
    daysLeft: Math.max(0, Math.ceil((paidUntil.getTime() - now.getTime()) / DAY_MS)),
    monthlyFee: settings.monthlyFee,
  };
}

/** SQL: dereva bado anaruhusiwa kupokea safari (ada iko hai au ndani ya siku za kuvumiliwa). $graceParam = siku. */
export const SUBSCRIPTION_OK_SQL = (alias: string, graceParam: string) =>
  `(${alias}.paid_until IS NOT NULL AND ${alias}.paid_until + make_interval(secs => ${graceParam}::float8 * 86400) > now())`;

/** Dereva anayethibitishwa kwa mara ya kwanza anapata siku za bure (inaitwa ndani ya transaction ya kuthibitisha). */
export async function startTrialIfNeeded(client: Db, driverId: string) {
  const settings = await getSettings(client);
  await client.query(
    `UPDATE naya.drivers SET paid_until = now() + make_interval(secs => $2::float8 * 86400) WHERE user_id = $1 AND paid_until IS NULL`,
    [driverId, settings.trialDays],
  );
}

/** Kosa la wazi kwa dereva ambaye ada yake imeisha (kwa kwenda online). */
export async function assertSubscriptionOk(client: Db, driverId: string) {
  const settings = await getSettings(client);
  const row = await one<{ paid_until: Date | null }>(client, 'SELECT paid_until FROM naya.drivers WHERE user_id = $1', [driverId]);
  const sub = describeSubscription(row?.paid_until ?? null, settings);
  if (sub.state === 'EXPIRED' || sub.state === 'NONE') {
    throw new AppError(
      402,
      `Ada yako ya mwezi (TSh ${settings.monthlyFee.toLocaleString('en-US')}) imeisha. Lipa ili uendelee kupokea safari. ${settings.paymentInstructions}`,
    );
  }
}

// ------------------------------------------------------------------ Dereva

export async function subscriptionForDriver(driverId: string) {
  const settings = await getSettings();
  const row = await one<{ paid_until: Date | null }>(db, 'SELECT paid_until FROM naya.drivers WHERE user_id = $1', [driverId]);
  if (!row) throw notFound('Bado hujaomba kuwa dereva.');
  const payments = await many(
    db,
    `SELECT id, months, amount, method, reference, period_start AS "periodStart", period_end AS "periodEnd", created_at AS "createdAt"
       FROM naya.subscription_payments WHERE driver_id = $1 AND voided_at IS NULL ORDER BY created_at DESC LIMIT 12`,
    [driverId],
  );
  return {
    ...describeSubscription(row.paid_until, settings),
    graceDays: settings.graceDays,
    paymentInstructions: settings.paymentInstructions,
    payments,
  };
}

// ------------------------------------------------------------------ Ofisi

export async function subscriptionForAdmin(driverId: string) {
  const settings = await getSettings();
  const row = await one<{ paid_until: Date | null }>(db, 'SELECT paid_until FROM naya.drivers WHERE user_id = $1', [driverId]);
  if (!row) throw notFound('Dereva hajapatikana');
  const payments = await many(
    db,
    `SELECT p.id, p.months, p.amount, p.method, p.reference, p.note, p.period_start AS "periodStart", p.period_end AS "periodEnd",
            p.created_at AS "createdAt", r.full_name AS "recordedBy",
            p.voided_at AS "voidedAt", v.full_name AS "voidedBy", p.void_reason AS "voidReason"
       FROM naya.subscription_payments p
       JOIN naya.users r ON r.id = p.recorded_by
       LEFT JOIN naya.users v ON v.id = p.voided_by
      WHERE p.driver_id = $1 ORDER BY p.created_at DESC LIMIT 50`,
    [driverId],
  );
  const latest = payments.find((p) => !(p as { voidedAt: Date | null }).voidedAt) as { id: string } | undefined;
  return { ...describeSubscription(row.paid_until, settings), graceDays: settings.graceDays, payments, voidableId: latest?.id ?? null };
}

export async function recordPayment(
  adminId: string,
  driverId: string,
  input: { months: number; method: PaymentMethod; reference: string | null; note: string | null },
) {
  if (input.method !== 'CASH' && !input.reference) throw badRequest('Andika namba ya muamala (mf. ya M-Pesa).');
  let paidUntil: Date;
  let amount: number;
  try {
    ({ paidUntil, amount } = await transaction(async (client) => {
      const settings = await getSettings(client);
      const driver = await one<{ status: string; paid_until: Date | null }>(
        client,
        'SELECT status, paid_until FROM naya.drivers WHERE user_id = $1 FOR UPDATE',
        [driverId],
      );
      if (!driver) throw notFound('Dereva hajapatikana');
      if (!['APPROVED', 'SUSPENDED'].includes(driver.status)) throw conflict('Dereva huyu bado hajathibitishwa.');
      const amount = settings.monthlyFee * input.months;
      const row = await one<{ period_end: Date }>(
        client,
        `INSERT INTO naya.subscription_payments
           (driver_id, months, amount, method, reference, note, previous_paid_until, period_start, period_end, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, greatest(now(), coalesce($7, now())),
                 greatest(now(), coalesce($7, now())) + make_interval(secs => $8::float8 * 86400), $9)
         RETURNING period_end`,
        [driverId, input.months, amount, input.method, input.reference, input.note, driver.paid_until, PERIOD_DAYS * input.months, adminId],
      );
      await client.query('UPDATE naya.drivers SET paid_until = $2, updated_at = now() WHERE user_id = $1', [driverId, row!.period_end]);
      await writeAudit(client, {
        actorId: adminId,
        action: 'subscription.paid',
        targetType: 'driver',
        targetId: driverId,
        details: { months: input.months, amount, method: input.method, reference: input.reference, paidUntil: row!.period_end },
      });
      return { paidUntil: row!.period_end, amount };
    }));
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Namba hii ya muamala imeshatumika kwa malipo mengine.');
    throw error;
  }
  await notify({
    userId: driverId,
    event: 'account',
    kind: 'subscription_paid',
    title: 'Ada imepokelewa — asante!',
    body: `TSh ${amount.toLocaleString('en-US')} imerekodiwa. Ada yako iko hai mpaka ${formatDay(paidUntil)}.`,
  });
  await notifyAdmins();
  return subscriptionForAdmin(driverId);
}

/** Kubatilisha malipo yaliyokosewa — malipo ya mwisho tu, ili tarehe zisichanganyike. */
export async function voidPayment(adminId: string, driverId: string, paymentId: string, reason: string) {
  await transaction(async (client) => {
    await client.query('SELECT 1 FROM naya.drivers WHERE user_id = $1 FOR UPDATE', [driverId]);
    const latest = await one<{ id: string; previous_paid_until: Date | null; amount: number }>(
      client,
      `SELECT id, previous_paid_until, amount FROM naya.subscription_payments
        WHERE driver_id = $1 AND voided_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [driverId],
    );
    if (!latest) throw notFound('Hakuna malipo ya kubatilisha.');
    if (latest.id !== paymentId) throw conflict('Unaweza kubatilisha malipo ya mwisho tu.');
    await client.query(
      'UPDATE naya.subscription_payments SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1',
      [paymentId, adminId, reason],
    );
    await client.query('UPDATE naya.drivers SET paid_until = $2, updated_at = now() WHERE user_id = $1', [driverId, latest.previous_paid_until]);
    await writeAudit(client, {
      actorId: adminId,
      action: 'subscription.voided',
      targetType: 'driver',
      targetId: driverId,
      details: { paymentId, amount: latest.amount, reason },
    });
  });
  await notify({ userId: driverId, event: 'account' });
  await notifyAdmins();
  return subscriptionForAdmin(driverId);
}

/** Orodha ya ofisi: madereva na hali ya ada zao. */
export async function listSubscriptions(filter: 'all' | 'expired' | 'due') {
  const settings = await getSettings();
  const rows = await many<{ id: string; name: string; phone: string; plate: string | null; paid_until: Date | null; is_online: boolean }>(
    db,
    `SELECT d.user_id AS id, u.full_name AS name, u.phone, d.plate_number AS plate, d.paid_until, d.is_online
       FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
      WHERE d.status = 'APPROVED'
        AND ($1 = 'all'
          OR ($1 = 'expired' AND (d.paid_until IS NULL OR d.paid_until <= now()))
          OR ($1 = 'due' AND d.paid_until > now() AND d.paid_until <= now() + interval '7 days'))
      ORDER BY d.paid_until ASC NULLS FIRST
      LIMIT 200`,
    [filter],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    plateNumber: r.plate,
    online: r.is_online,
    ...describeSubscription(r.paid_until, settings),
  }));
}

/** Takwimu za ofisi: ada zilizopokelewa mwezi huu (malipo halisi yaliyorekodiwa) na madereva wenye ada iliyoisha. */
export async function subscriptionStats() {
  const row = await one<{ month_total: number; month_count: number; expired: number; due: number }>(
    db,
    `WITH m AS (SELECT (date_trunc('month', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam') AS start)
     SELECT
       (SELECT coalesce(sum(amount), 0)::int FROM naya.subscription_payments, m WHERE voided_at IS NULL AND created_at >= m.start) AS month_total,
       (SELECT count(*)::int FROM naya.subscription_payments, m WHERE voided_at IS NULL AND created_at >= m.start) AS month_count,
       (SELECT count(*)::int FROM naya.drivers WHERE status = 'APPROVED' AND (paid_until IS NULL OR paid_until <= now())) AS expired,
       (SELECT count(*)::int FROM naya.drivers WHERE status = 'APPROVED' AND paid_until > now() AND paid_until <= now() + interval '7 days') AS due`,
  );
  return {
    monthTotal: row?.month_total ?? 0,
    monthPayments: row?.month_count ?? 0,
    expiredDrivers: row?.expired ?? 0,
    dueSoonDrivers: row?.due ?? 0,
  };
}

// ------------------------------------------------------------------ Kazi ya nyuma (kila dakika chache)

const REMIND_DAYS = 3;

/**
 * - Ukumbusho siku 3 kabla ada haijaisha, na arifa ikiisha (mara moja kwa kila paid_until).
 * - Siku za kuvumiliwa zikiisha: dereva aliye online (bila safari inayoendelea) anarudishwa offline.
 * Kila hatua "inajichukulia" safu kwa UPDATE … RETURNING, kwa hiyo servers mbili hazitumi arifa mara mbili.
 */
export async function runSubscriptionChecks(): Promise<void> {
  const settings = await getSettings();
  const fee = `TSh ${settings.monthlyFee.toLocaleString('en-US')}`;

  const remind = await many<{ user_id: string; paid_until: Date }>(
    db,
    `UPDATE naya.drivers SET reminder_sent_for = paid_until
      WHERE status = 'APPROVED' AND paid_until > now() AND paid_until <= now() + make_interval(secs => $1::float8 * 86400)
        AND reminder_sent_for IS DISTINCT FROM paid_until
      RETURNING user_id, paid_until`,
    [REMIND_DAYS],
  );
  for (const d of remind) {
    await notify({
      userId: d.user_id,
      event: 'account',
      kind: 'subscription_due',
      title: 'Ada yako ya mwezi inakaribia kuisha',
      body: `Inaisha ${formatDay(d.paid_until)}. Lipa ${fee} mapema ili usikose safari.`,
      sms: `NAYA: Ada yako ya mwezi inaisha ${formatDay(d.paid_until)}. Lipa ${fee} mapema ili usikose safari.`,
    });
  }

  const expired = await many<{ user_id: string; paid_until: Date }>(
    db,
    `UPDATE naya.drivers SET expiry_sent_for = paid_until
      WHERE status = 'APPROVED' AND paid_until <= now() AND expiry_sent_for IS DISTINCT FROM paid_until
      RETURNING user_id, paid_until`,
  );
  for (const d of expired) {
    await notify({
      userId: d.user_id,
      event: 'account',
      kind: 'subscription_expired',
      title: 'Ada yako ya mwezi imeisha',
      body:
        settings.graceDays > 0
          ? `Una siku ${settings.graceDays} za kulipa ${fee} kabla hujaacha kupokea safari.`
          : `Lipa ${fee} ili uendelee kupokea safari.`,
      urgent: true,
      sms: `NAYA: Ada yako ya mwezi imeisha. Lipa ${fee} ili uendelee kupokea safari. ${settings.paymentInstructions}`.slice(0, 300),
    });
  }

  const offline = await many<{ user_id: string }>(
    db,
    `UPDATE naya.drivers d SET is_online = false, updated_at = now()
      WHERE d.is_online AND NOT ${SUBSCRIPTION_OK_SQL('d', '$1')}
        AND NOT EXISTS (SELECT 1 FROM naya.rides r WHERE r.driver_id = d.user_id AND r.status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))
      RETURNING d.user_id`,
    [settings.graceDays],
  );
  for (const d of offline) await notify({ userId: d.user_id, event: 'driver' });
  if (remind.length + expired.length + offline.length > 0) await notifyAdmins();
}

function formatDay(date: Date) {
  return new Intl.DateTimeFormat('sw-TZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Dar_es_Salaam' }).format(date);
}
