// 0.27.0: Taarifa kamili za dereva (ofisi) — kila kitu cha dereva mmoja mahali pamoja:
// wasifu, safari na mapato, bonus za ofa safari kwa safari (zimekwenda wapi), wallet, malipo yote ya simu,
// ada ya mwezi, malalamiko, na maelezo ya lugha rahisi ya kumweleza dereva akidai "sijapata bonus".
// Inasoma tu — haibadilishi chochote.
import { db, many, one } from '../db/pool.js';
import { notFound } from '../utils/http.js';
import { NETWORK_LABEL, payoutAccounts, promoBalance } from './promotions.js';

const TZ = 'Africa/Dar_es_Salaam';
const tsh = (v: number) => `TSh ${Math.round(v).toLocaleString('en-US')}`;
const local = (p: string) => (/^255\d{9}$/.test(p) ? `0${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p);
const day = (d: Date | string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d));

/** Hali ya bonus ya safari moja kwa lugha ya ofisi (na ya kumweleza dereva). */
export const BONUS_STATE: Record<string, string> = {
  PAID: 'Imelipwa',
  PENDING: 'Inatumwa sasa',
  WAITING: 'Inakusanywa (kiasi kidogo — itatumwa pamoja na safari zijazo)',
  HELD: 'Imeshikiliwa — inasubiri ukaguzi wa ofisi',
  FAILED: 'Kutuma kumeshindwa — ofisi itume tena',
  REJECTED: 'Imekataliwa na ofisi',
  NONE: 'Bado haijashughulikiwa',
};

const PERIODS = `WITH b AS (
  SELECT (date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}') AS today,
         (date_trunc('week', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}') AS week,
         (date_trunc('month', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}') AS month)`;

export async function driverFull(driverId: string) {
  const profile = await one<Record<string, any>>(
    db,
    `SELECT u.id, u.full_name AS "name", u.phone, u.status AS "accountStatus", u.suspended_reason AS "accountSuspendedReason",
            u.created_at AS "joinedAt", u.last_login_at AS "lastLoginAt", u.phone_verified_at AS "phoneVerifiedAt", u.active_mode AS "activeMode",
            u.app_client AS "appClient", u.app_seen_at AS "appSeenAt", u.language, u.emergency_name AS "emergencyName", u.emergency_phone AS "emergencyPhone",
            d.status AS "driverStatus", d.vehicle_type AS "vehicleType", d.plate_number AS "plate", d.vehicle_make AS "make", d.vehicle_model AS "model",
            d.vehicle_color AS "color", d.license_number AS "license", d.national_id_number AS "nationalId", d.rejection_reason AS "driverReason",
            d.submitted_at AS "submittedAt", d.reviewed_at AS "reviewedAt", d.created_at AS "driverSince",
            d.is_online AS "online", d.online_since AS "onlineSince", d.last_seen_at AS "lastSeenAt", d.last_lat::float8 AS "lastLat", d.last_lng::float8 AS "lastLng",
            d.paid_until AS "paidUntil", rb.full_name AS "registeredBy", rv.full_name AS "reviewedBy"
       FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
       LEFT JOIN naya.users rb ON rb.id = d.registered_by
       LEFT JOIN naya.users rv ON rv.id = d.reviewed_by
      WHERE d.user_id = $1`,
    [driverId],
  );
  if (!profile) throw notFound('Dereva hakupatikana');

  const [rides, offers, ratings, recentRides, bonusRides, payouts, balance, accounts, walletRow, walletTotals, walletEntries, payments, subs, debts, tickets, sos, notes] =
    await Promise.all([
      // Safari na mapato (nauli kamili ya safari alizokamilisha)
      one<Record<string, number>>(
        db,
        `${PERIODS}
         SELECT count(*) FILTER (WHERE r.status = 'COMPLETED')::int AS completed,
                coalesce(sum(r.fare) FILTER (WHERE r.status = 'COMPLETED'), 0)::int AS "fareTotal",
                count(*) FILTER (WHERE r.status = 'COMPLETED' AND r.completed_at >= b.today)::int AS "todayTrips",
                coalesce(sum(r.fare) FILTER (WHERE r.status = 'COMPLETED' AND r.completed_at >= b.today), 0)::int AS "todayFare",
                count(*) FILTER (WHERE r.status = 'COMPLETED' AND r.completed_at >= b.week)::int AS "weekTrips",
                coalesce(sum(r.fare) FILTER (WHERE r.status = 'COMPLETED' AND r.completed_at >= b.week), 0)::int AS "weekFare",
                count(*) FILTER (WHERE r.status = 'COMPLETED' AND r.completed_at >= b.month)::int AS "monthTrips",
                coalesce(sum(r.fare) FILTER (WHERE r.status = 'COMPLETED' AND r.completed_at >= b.month), 0)::int AS "monthFare",
                count(*) FILTER (WHERE r.status = 'COMPLETED' AND r.fare_settlement = 'MOBILE')::int AS "paidMobile",
                count(*) FILTER (WHERE r.status = 'COMPLETED' AND r.fare_settlement = 'WALLET')::int AS "paidWallet",
                count(*) FILTER (WHERE r.status = 'COMPLETED' AND r.fare_settlement = 'DEBT')::int AS "unpaid",
                count(*) FILTER (WHERE r.status = 'COMPLETED' AND r.promo_discount > 0)::int AS "promoTrips",
                count(*) FILTER (WHERE r.status = 'CANCELLED' AND r.cancelled_by = 'ADMIN')::int AS "cancelledByOffice",
                max(r.completed_at) AS "lastTripAt"
           FROM naya.rides r, b WHERE r.driver_id = $1`,
        [driverId],
      ),
      one<Record<string, number>>(
        db,
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE status = 'ACCEPTED')::int AS accepted,
                count(*) FILTER (WHERE status = 'DECLINED')::int AS declined,
                count(*) FILTER (WHERE status = 'EXPIRED')::int AS missed,
                count(*) FILTER (WHERE status IN ('TAKEN', 'CANCELLED'))::int AS gone,
                (SELECT count(*)::int FROM naya.ride_status_history h
                  WHERE h.actor_id = $1 AND h.to_status = 'SEARCHING' AND h.from_status IN ('ACCEPTED', 'ARRIVED')) AS "driverCancels"
           FROM naya.ride_offers WHERE driver_id = $1`,
        [driverId],
      ),
      one<{ average: number | null; count: number }>(
        db,
        `SELECT round(avg(rating_for_driver)::numeric, 1)::float8 AS average, count(rating_for_driver)::int AS count FROM naya.rides WHERE driver_id = $1`,
        [driverId],
      ),
      many(
        db,
        `SELECT r.id, r.status, r.requested_at AS "requestedAt", r.completed_at AS "completedAt", r.pickup_name AS "from", r.dest_name AS "to",
                r.fare, r.promo_discount AS "promo", r.fare_settlement AS "settlement", r.rating_for_driver AS "rating", r.comment_for_driver AS "comment",
                r.cancel_reason AS "cancelReason", p.full_name AS "passenger", r.rider_name AS "riderName"
           FROM naya.rides r JOIN naya.users p ON p.id = r.passenger_id
          WHERE r.driver_id = $1 ORDER BY r.requested_at DESC LIMIT 40`,
        [driverId],
      ),
      // Bonus za ofa: kila safari ya ofa iliyokamilika + imelipwa vipi
      many<Record<string, any>>(
        db,
        `SELECT r.id, r.completed_at AS "completedAt", r.pickup_name AS "from", r.dest_name AS "to", r.fare, r.promo_discount AS "amount",
                r.promo_title AS "promoTitle", coalesce(r.promo_payout_state, 'NONE') AS state, r.promo_payout_note AS "note",
                array_remove(r.flags, 'PIN_REMINDED') AS flags,
                pay.reference AS "payRef", pay.status AS "payStatus", pay.provider_ref AS "payProviderRef", pay.phone AS "payPhone",
                pay.network AS "payNetwork", pay.failure_reason AS "payFailure", pay.amount AS "payAmount", pay.completed_at AS "payAt",
                we.created_at AS "walletAt", we.amount AS "walletAmount"
           FROM naya.rides r
           LEFT JOIN naya.payments pay ON pay.id = r.promo_payment_id
           LEFT JOIN naya.wallet_entries we ON we.ride_id = r.id AND we.kind = 'PROMO_EARNING'
          WHERE r.driver_id = $1 AND r.status = 'COMPLETED' AND r.promo_discount > 0
          ORDER BY r.completed_at DESC LIMIT 300`,
        [driverId],
      ),
      many<Record<string, any>>(
        db,
        `SELECT p.id, p.amount, p.network, p.phone, p.account_name AS "accountName", p.reference, p.note, p.paid_at AS "paidAt",
                CASE WHEN p.network = 'WALLET' THEN 'WALLET' WHEN p.payment_id IS NOT NULL THEN 'AUTO' ELSE 'MANUAL' END AS how,
                coalesce(u.full_name, 'NAYA (moja kwa moja)') AS "paidBy", p.voided_at AS "voidedAt", p.void_reason AS "voidReason",
                pay.status AS "payStatus", pay.provider_ref AS "providerRef"
           FROM naya.promo_payouts p LEFT JOIN naya.users u ON u.id = p.paid_by LEFT JOIN naya.payments pay ON pay.id = p.payment_id
          WHERE p.driver_id = $1 ORDER BY p.paid_at DESC`,
        [driverId],
      ),
      promoBalance(db, driverId),
      payoutAccounts(db, driverId),
      one<Record<string, any>>(
        db,
        `SELECT balance, status, suspended_reason AS "suspendedReason", hold_until AS "holdUntil", hold_reason AS "holdReason",
                (pin_hash IS NOT NULL) AS "pinSet", pin_blocked AS "pinBlocked", created_at AS "openedAt"
           FROM naya.wallets WHERE driver_id = $1`,
        [driverId],
      ),
      one<Record<string, number>>(
        db,
        `SELECT coalesce(sum(e.amount) FILTER (WHERE e.kind = 'PROMO_EARNING'), 0)::int AS "promoIn",
                coalesce(sum(e.amount) FILTER (WHERE e.kind = 'RIDE_EARNING'), 0)::int AS "ridesIn",
                coalesce(sum(e.amount) FILTER (WHERE e.kind = 'ADJUSTMENT' AND e.amount > 0), 0)::int AS "adjustIn",
                coalesce(-sum(e.amount) FILTER (WHERE e.kind = 'ADJUSTMENT' AND e.amount < 0), 0)::int AS "adjustOut",
                coalesce(-sum(e.amount) FILTER (WHERE e.kind = 'SUBSCRIPTION'), 0)::int AS "subscriptionOut",
                coalesce(-sum(e.amount) FILTER (WHERE e.kind = 'WITHDRAWAL' AND p.status = 'SUCCESS'), 0)::int AS "withdrawn",
                coalesce(-sum(e.amount) FILTER (WHERE e.kind = 'WITHDRAWAL' AND p.status = 'PENDING'), 0)::int AS "withdrawPending",
                count(*) FILTER (WHERE e.kind = 'WITHDRAWAL' AND p.status = 'FAILED')::int AS "withdrawFailed",
                max(e.created_at) FILTER (WHERE e.kind = 'WITHDRAWAL' AND p.status = 'SUCCESS') AS "lastWithdrawAt"
           FROM naya.wallet_entries e LEFT JOIN naya.payments p ON p.id = e.payment_id WHERE e.driver_id = $1`,
        [driverId],
      ),
      many(
        db,
        `SELECT e.id, e.amount, e.balance_after AS "balanceAfter", e.kind, e.note, e.created_at AS "createdAt", e.ride_id AS "rideId",
                p.status AS "payStatus", p.reference, p.provider_ref AS "providerRef", p.phone AS "payPhone", p.failure_reason AS "payFailure",
                u.full_name AS "createdBy"
           FROM naya.wallet_entries e LEFT JOIN naya.payments p ON p.id = e.payment_id LEFT JOIN naya.users u ON u.id = e.created_by
          WHERE e.driver_id = $1 ORDER BY e.id DESC LIMIT 200`,
        [driverId],
      ),
      many(
        db,
        `SELECT p.id, p.kind, p.direction, p.amount, p.network, p.phone, p.reference, p.provider_ref AS "providerRef", p.status,
                p.failure_reason AS "failure", p.created_at AS "createdAt", p.completed_at AS "completedAt", u.full_name AS "createdBy"
           FROM naya.payments p LEFT JOIN naya.users u ON u.id = p.created_by
          WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 100`,
        [driverId],
      ),
      many(
        db,
        `SELECT s.id, s.months, s.amount, s.method, s.reference, s.period_start AS "from", s.period_end AS "to", s.created_at AS "createdAt",
                s.voided_at AS "voidedAt", coalesce(u.full_name, 'Kwa simu (mfumo)') AS "recordedBy"
           FROM naya.subscription_payments s LEFT JOIN naya.users u ON u.id = s.recorded_by
          WHERE s.driver_id = $1 ORDER BY s.created_at DESC LIMIT 24`,
        [driverId],
      ),
      many(
        db,
        `SELECT r.id, r.completed_at AS "completedAt", r.fare - r.promo_discount AS amount, p.full_name AS passenger, p.phone,
                r.debt_cleared_at AS "clearedAt", r.debt_cleared_how AS "clearedHow"
           FROM naya.rides r JOIN naya.users p ON p.id = r.passenger_id
          WHERE r.driver_id = $1 AND r.fare_settlement = 'DEBT' ORDER BY r.completed_at DESC LIMIT 30`,
        [driverId],
      ),
      many(
        db,
        `SELECT t.id, t.subject, t.category, t.status, t.role, t.created_at AS "createdAt", u.full_name AS "from",
                (t.user_id = $1) AS mine
           FROM naya.support_tickets t JOIN naya.users u ON u.id = t.user_id
          WHERE t.user_id = $1 OR t.ride_id IN (SELECT id FROM naya.rides WHERE driver_id = $1)
          ORDER BY t.created_at DESC LIMIT 30`,
        [driverId],
      ),
      many(
        db,
        `SELECT s.id, s.role, s.status, s.created_at AS "createdAt", s.resolution_note AS "note", s.ride_id AS "rideId"
           FROM naya.sos_alerts s JOIN naya.rides r ON r.id = s.ride_id
          WHERE r.driver_id = $1 ORDER BY s.created_at DESC LIMIT 20`,
        [driverId],
      ),
      many(
        db,
        `SELECT a.action, a.details, a.created_at AS "createdAt", u.full_name AS "actor"
           FROM naya.audit_logs a LEFT JOIN naya.users u ON u.id = a.actor_id
          WHERE a.target_id = $1
             OR (a.target_type = 'ride' AND a.target_id IN (SELECT id FROM naya.rides WHERE driver_id = $1)) -- mf. bonus imelipwa / imekataliwa
          ORDER BY a.created_at DESC LIMIT 80`,
        [driverId],
      ),
    ]);

  // ---- bonus: muhtasari kwa hali
  const byState: Record<string, { count: number; amount: number }> = {};
  for (const r of bonusRides) {
    const s = byState[r.state] ?? (byState[r.state] = { count: 0, amount: 0 });
    s.count += 1;
    s.amount += r.amount;
  }
  const bonusRows = bonusRides.map((r) => ({
    ...r,
    stateLabel: BONUS_STATE[r.state] ?? r.state,
    // Pesa ilienda wapi
    destination: r.walletAt
      ? { how: 'WALLET', at: r.walletAt, amount: r.walletAmount }
      : r.payRef
        ? { how: 'PHONE', at: r.payAt, amount: r.payAmount, reference: r.payRef, status: r.payStatus, providerRef: r.payProviderRef, phone: r.payPhone, networkLabel: NETWORK_LABEL[r.payNetwork as keyof typeof NETWORK_LABEL] ?? r.payNetwork, failure: r.payFailure }
        : r.state === 'PAID'
          ? { how: 'BATCH' } // imelipwa pamoja na safari nyingine (au kwa mkono)
          : null,
  }));
  const activePayouts = payouts.filter((p) => !p.voidedAt);
  const paidBy = (how: string) => activePayouts.filter((p) => p.how === how).reduce((t, p) => t + p.amount, 0);

  const wallet = walletRow
    ? { ...walletRow, ...(walletTotals ?? {}), entries: walletEntries }
    : null;

  return {
    profile: { ...profile, rating: ratings?.count ? ratings : null },
    rides: rides ?? {},
    offers: { ...(offers ?? {}), acceptRate: offers?.total ? Math.round(((offers.accepted ?? 0) / offers.total) * 100) : null },
    recentRides,
    bonus: {
      ...balance,
      paidToWallet: paidBy('WALLET'),
      paidAuto: paidBy('AUTO'),
      paidManual: paidBy('MANUAL'),
      byState,
      trips: bonusRows, // kila safari ya ofa (rides = idadi yake, kutoka promoBalance)
      payouts: payouts.map((p) => ({ ...p, networkLabel: p.network === 'WALLET' ? 'Wallet ya NAYA' : NETWORK_LABEL[p.network as keyof typeof NETWORK_LABEL] ?? p.network })),
    },
    accounts,
    wallet,
    payments,
    subscriptions: subs,
    debts,
    tickets,
    sos,
    history: notes,
    explanation: explain(profile.name as string, balance, byState, wallet as Record<string, any> | null, activePayouts),
  };
}

/**
 * Maelezo ya lugha rahisi ya kumweleza dereva (ofisi inanakili au kusoma kwa simu).
 * Yanatokana na takwimu zilizo hapo juu tu — hakuna makisio.
 */
function explain(
  name: string,
  balance: { rides: number; earned: number; paid: number; balance: number },
  byState: Record<string, { count: number; amount: number }>,
  wallet: Record<string, any> | null,
  payouts: Array<Record<string, any>>,
): string[] {
  const first = name.split(' ')[0];
  const lines: string[] = [];
  if (!balance.rides) {
    lines.push(`${first} hana safari ya ofa iliyokamilika, kwa hiyo hana bonus ya ofa.`);
  } else {
    lines.push(`${first} amekamilisha safari ${balance.rides} za ofa. Bonus yake yote ni ${tsh(balance.earned)}; NAYA imeshalipa ${tsh(balance.paid)}.`);
    lines.push(balance.balance > 0 ? `NAYA bado inamdai ${tsh(balance.balance)}.` : 'NAYA haimdai chochote cha bonus kwa sasa.');
  }
  const toWallet = payouts.filter((p) => p.how === 'WALLET');
  if (toWallet.length) {
    const sum = toWallet.reduce((t, p) => t + p.amount, 0);
    lines.push(`${tsh(sum)} ya bonus iliingia kwenye WALLET yake ya NAYA (si moja kwa moja kwenye simu) — mara ya mwisho ${day(toWallet[0].paidAt)}.`);
  }
  const toPhone = payouts.filter((p) => p.how !== 'WALLET');
  if (toPhone.length) {
    const sum = toPhone.reduce((t, p) => t + p.amount, 0);
    const last = toPhone[0];
    lines.push(`${tsh(sum)} ilitumwa moja kwa moja kwenye simu — mwisho ${tsh(last.amount)} tarehe ${day(last.paidAt)} kwenda ${local(last.phone)} (kumbukumbu ${last.reference}).`);
  }
  if (wallet) {
    lines.push(
      `Wallet: salio sasa ni ${tsh(wallet.balance)}. Ametoa kwenda simu ${tsh(wallet.withdrawn ?? 0)} kwa jumla${wallet.lastWithdrawAt ? ` (mara ya mwisho ${day(wallet.lastWithdrawAt)})` : ''}.`,
    );
    if (wallet.balance > 0) lines.push(`Kama anasema hajapata pesa: ${tsh(wallet.balance)} iko kwenye wallet yake — aingie app: Wallet yangu → Toa pesa.`);
    if (wallet.withdrawPending) lines.push(`${tsh(wallet.withdrawPending)} iko njiani kwenda simu yake (inasubiri uthibitisho wa mtandao).`);
    if (wallet.withdrawFailed) lines.push(`Kutoa mara ${wallet.withdrawFailed} kulishindwa — pesa hiyo ilirudi kwenye wallet yake.`);
    if (wallet.status === 'SUSPENDED') lines.push(`Wallet yake IMESIMAMISHWA na ofisi${wallet.suspendedReason ? `: ${wallet.suspendedReason}` : ''} — hawezi kutoa pesa mpaka ifunguliwe.`);
    if (wallet.holdUntil && new Date(wallet.holdUntil) > new Date()) lines.push(`Kutoa kumesimamishwa kwa muda mpaka ${day(wallet.holdUntil)} (alibadilisha namba ya malipo au PIN).`);
  }
  for (const [state, s] of Object.entries(byState)) {
    if (state === 'PAID') continue;
    lines.push(`Safari ${s.count} (${tsh(s.amount)}): ${BONUS_STATE[state] ?? state}.`);
  }
  return lines;
}
