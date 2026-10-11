// Ripoti kamili za ofisi, zimetengana (hazichanganyi madereva na wateja):
//   1. madereva     — madereva (kwa chaguo-msingi waliothibitishwa) na utendaji wao
//   2. wateja       — waliojisajili kama wateja tu (si madereva)
//   3. app          — wanaotumia APK dhidi ya link (browser)
//   4. maombi       — kila ombi la safari: lilifanikiwa au la, na kila dereva aliyepewa alifanya nini
//   5. online       — madereva walio online sasa na kama wako tayari kupokea ombi
// Kila orodha inakuja kurasa kwa kurasa (ukurasa = 100) na pia kama CSV kamili (Excel).
import { db, many, one } from '../db/pool.js';
import { downloadStats } from '../routes/pakua.js';
import { DRIVER_STALE_SECONDS, FRESH_SQL } from './rides.js';
import { getSettings, SUBSCRIPTION_OK_SQL } from './subscriptions.js';

const TZ = 'Africa/Dar_es_Salaam';
export const PAGE_SIZE = 100;
const CSV_MAX = 50_000;

export type Client = 'apk' | 'web' | 'unknown';

const clientSql = (alias: string, param: string) => `(
  $${param}::text IS NULL
  OR ($${param} = 'unknown' AND ${alias}.app_client IS NULL)
  OR ${alias}.app_client = $${param})`;

const searchSql = (param: string, ...cols: string[]) =>
  `($${param}::text IS NULL OR ${cols.map((c) => `${c} ILIKE '%' || $${param} || '%'`).join(' OR ')})`;

/** Namba ya simu au jina — "0712..." inatafutwa kama "255712...". */
const searchTerm = (q?: string | null) => {
  const t = (q ?? '').trim();
  if (!t) return null;
  return /^0\d{3,}$/.test(t) ? `255${t.slice(1)}` : t;
};

const paging = (page = 1, csv = false) => (csv ? { limit: CSV_MAX, offset: 0 } : { limit: PAGE_SIZE, offset: (Math.max(1, page) - 1) * PAGE_SIZE });

// =================================================================== 1. Madereva

export type DriverFilter = 'APPROVED' | 'PENDING' | 'SUSPENDED' | 'REJECTED' | 'INCOMPLETE' | 'ALL';

export async function driversReport(opts: { status?: DriverFilter; q?: string; client?: Client; page?: number; csv?: boolean }) {
  const { graceDays } = await getSettings();
  const status = opts.status && opts.status !== 'ALL' ? opts.status : null;
  const q = searchTerm(opts.q);
  const client = opts.client ?? null;
  const { limit, offset } = paging(opts.page, opts.csv);
  const where = `u.role = 'USER' AND ($1::text IS NULL OR d.status::text = $1)
      AND ${searchSql('2', 'u.full_name', 'u.phone', 'd.plate_number')}
      AND ${clientSql('u', '3')}`;
  const rows = await many<Record<string, unknown>>(
    db,
    `SELECT u.id, u.full_name AS "name", u.phone, d.status::text AS status, d.vehicle_type::text AS "vehicleType",
            d.plate_number AS plate, concat_ws(' ', d.vehicle_make, d.vehicle_model) AS vehicle, d.vehicle_color AS color,
            u.created_at AS "registeredAt", d.reviewed_at AS "approvedAt", d.paid_until AS "paidUntil",
            ${SUBSCRIPTION_OK_SQL('d', '$4')} AS "feeOk",
            d.is_online AS online, d.last_seen_at AS "lastSeenAt", u.app_client AS client, u.app_seen_at AS "appSeenAt",
            coalesce(r.completed, 0)::int AS completed, coalesce(r.value, 0)::int AS value, r.rating,
            coalesce(o.offers, 0)::int AS offers, coalesce(o.accepted, 0)::int AS accepted,
            coalesce(o.declined, 0)::int AS declined, coalesce(o.missed, 0)::int AS missed,
            u.status::text AS "accountStatus"
       FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
                sum(fare) FILTER (WHERE status = 'COMPLETED') AS value,
                round(avg(rating_for_driver), 1)::float8 AS rating
           FROM naya.rides WHERE driver_id = d.user_id) r ON true
       LEFT JOIN LATERAL (
         SELECT count(*) AS offers, count(*) FILTER (WHERE status = 'ACCEPTED') AS accepted,
                count(*) FILTER (WHERE status = 'DECLINED') AS declined, count(*) FILTER (WHERE status = 'EXPIRED') AS missed
           FROM naya.ride_offers WHERE driver_id = d.user_id) o ON true
      WHERE ${where}
      ORDER BY d.is_online DESC, coalesce(r.completed, 0) DESC, u.full_name
      LIMIT ${limit} OFFSET ${offset}`,
    [status, q, client, graceDays],
  );
  const summary = await one<Record<string, number>>(
    db,
    `SELECT count(*) FILTER (WHERE d.status = 'APPROVED')::int AS approved,
            count(*) FILTER (WHERE d.status = 'PENDING')::int AS pending,
            count(*) FILTER (WHERE d.status = 'SUSPENDED')::int AS suspended,
            count(*) FILTER (WHERE d.status = 'REJECTED')::int AS rejected,
            count(*) FILTER (WHERE d.status = 'INCOMPLETE')::int AS incomplete,
            count(*)::int AS "all",
            count(*) FILTER (WHERE d.status = 'APPROVED' AND d.is_online)::int AS online,
            count(*) FILTER (WHERE d.status = 'APPROVED' AND ${SUBSCRIPTION_OK_SQL('d', '$1')})::int AS "feeOk",
            count(*) FILTER (WHERE d.status = 'APPROVED' AND u.app_client = 'apk')::int AS apk,
            count(*) FILTER (WHERE d.status = 'APPROVED' AND d.vehicle_type = 'BODABODA')::int AS bodaboda,
            count(*) FILTER (WHERE d.status = 'APPROVED' AND d.vehicle_type = 'BAJAJI')::int AS bajaji
       FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id WHERE u.role = 'USER'`,
    [graceDays],
  );
  const total = await one<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id WHERE ${where}`,
    [status, q, client],
  );
  return { summary, total: total?.n ?? 0, page: opts.page ?? 1, pageSize: PAGE_SIZE, rows };
}

// =================================================================== 2. Wateja (si madereva)

/** Mteja = mtumiaji wa app ambaye HANA usajili wowote wa dereva. */
const PASSENGER_SQL = `u.role = 'USER' AND NOT EXISTS (SELECT 1 FROM naya.drivers dd WHERE dd.user_id = u.id)`;

export type PassengerFilter = 'ALL' | 'ACTIVE' | 'NEVER' | 'NEW' | 'SUSPENDED';

export async function passengersReport(opts: { filter?: PassengerFilter; q?: string; client?: Client; page?: number; csv?: boolean }) {
  const q = searchTerm(opts.q);
  const client = opts.client ?? null;
  const filter = opts.filter ?? 'ALL';
  const { limit, offset } = paging(opts.page, opts.csv);
  const filterSql = {
    ALL: 'true',
    ACTIVE: `EXISTS (SELECT 1 FROM naya.rides x WHERE x.passenger_id = u.id AND x.requested_at > now() - interval '30 days')`,
    NEVER: `NOT EXISTS (SELECT 1 FROM naya.rides x WHERE x.passenger_id = u.id)`,
    NEW: `u.created_at > now() - interval '7 days'`,
    SUSPENDED: `u.status = 'SUSPENDED'`,
  }[filter];
  const where = `${PASSENGER_SQL} AND ${filterSql} AND ${searchSql('1', 'u.full_name', 'u.phone')} AND ${clientSql('u', '2')}`;
  const rows = await many<Record<string, unknown>>(
    db,
    `SELECT u.id, u.full_name AS name, u.phone, u.created_at AS "registeredAt", u.phone_verified_at IS NOT NULL AS verified,
            u.language, u.app_client AS client, u.app_seen_at AS "appSeenAt", u.last_login_at AS "lastLoginAt",
            u.status::text AS "accountStatus",
            coalesce(r.requested, 0)::int AS requested, coalesce(r.completed, 0)::int AS completed,
            coalesce(r.cancelled, 0)::int AS cancelled, coalesce(r.no_driver, 0)::int AS "noDriver",
            coalesce(r.spent, 0)::int AS spent, r.last_at AS "lastRideAt"
       FROM naya.users u
       LEFT JOIN LATERAL (
         SELECT count(*) AS requested, count(*) FILTER (WHERE status = 'COMPLETED') AS completed,
                count(*) FILTER (WHERE status = 'CANCELLED') AS cancelled, count(*) FILTER (WHERE status = 'NO_DRIVER') AS no_driver,
                sum(fare) FILTER (WHERE status = 'COMPLETED') AS spent, max(requested_at) AS last_at
           FROM naya.rides WHERE passenger_id = u.id) r ON true
      WHERE ${where}
      ORDER BY u.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    [q, client],
  );
  const summary = await one<Record<string, number>>(
    db,
    `SELECT count(*)::int AS "all",
            count(*) FILTER (WHERE u.created_at >= date_trunc('day', now() AT TIME ZONE '${TZ}') AT TIME ZONE '${TZ}')::int AS today,
            count(*) FILTER (WHERE u.created_at > now() - interval '7 days')::int AS "new",
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM naya.rides x WHERE x.passenger_id = u.id AND x.requested_at > now() - interval '30 days'))::int AS active,
            count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM naya.rides x WHERE x.passenger_id = u.id))::int AS never,
            count(*) FILTER (WHERE u.status = 'SUSPENDED')::int AS suspended,
            count(*) FILTER (WHERE u.phone_verified_at IS NOT NULL)::int AS verified,
            count(*) FILTER (WHERE u.app_client = 'apk')::int AS apk,
            count(*) FILTER (WHERE u.app_client = 'web')::int AS web,
            count(*) FILTER (WHERE u.app_client IS NULL)::int AS unknown
       FROM naya.users u WHERE ${PASSENGER_SQL}`,
  );
  const total = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM naya.users u WHERE ${where}`, [q, client]);
  return { summary, total: total?.n ?? 0, page: opts.page ?? 1, pageSize: PAGE_SIZE, rows };
}

// =================================================================== 3. APK dhidi ya link

export async function appReport() {
  const groups = await many<{ grp: string; apk: number; web: number; unknown: number; total: number }>(
    db,
    `SELECT CASE WHEN d.user_id IS NULL THEN 'passengers' ELSE 'drivers' END AS grp,
            count(*) FILTER (WHERE u.app_client = 'apk')::int AS apk,
            count(*) FILTER (WHERE u.app_client = 'web')::int AS web,
            count(*) FILTER (WHERE u.app_client IS NULL)::int AS unknown,
            count(*)::int AS total
       FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id AND d.status = 'APPROVED'
      WHERE u.role = 'USER' AND (d.user_id IS NOT NULL OR NOT EXISTS (SELECT 1 FROM naya.drivers dd WHERE dd.user_id = u.id))
      GROUP BY 1`,
  );
  const pick = (g: string) => groups.find((x) => x.grp === g) ?? { apk: 0, web: 0, unknown: 0, total: 0 };
  const days = await many<{ day: string; downloads: number; newApk: number }>(
    db,
    `WITH span AS (
       SELECT generate_series((now() AT TIME ZONE $1)::date - 29, (now() AT TIME ZONE $1)::date, interval '1 day')::date AS day
     )
     SELECT to_char(s.day, 'YYYY-MM-DD') AS day,
            (SELECT count(*) FROM naya.app_downloads a WHERE a.platform = 'android' AND (a.created_at AT TIME ZONE $1)::date = s.day)::int AS downloads,
            (SELECT count(*) FROM naya.users u WHERE u.role = 'USER' AND (u.apk_since AT TIME ZONE $1)::date = s.day)::int AS "newApk"
       FROM span s ORDER BY s.day`,
    [TZ],
  );
  // Safari za siku 30 kwa njia ya abiria (APK / link)
  const rides = await many<{ client: string; requested: number; completed: number }>(
    db,
    `SELECT coalesce(u.app_client, 'unknown') AS client, count(*)::int AS requested, count(*) FILTER (WHERE r.status = 'COMPLETED')::int AS completed
       FROM naya.rides r JOIN naya.users u ON u.id = r.passenger_id
      WHERE r.requested_at > now() - interval '30 days' GROUP BY 1`,
  );
  return { passengers: pick('passengers'), drivers: pick('drivers'), downloads: await downloadStats(), days, rides };
}

// =================================================================== 4. Maombi ya safari

export type RequestFilter = 'ALL' | 'COMPLETED' | 'ACTIVE' | 'CANCELLED' | 'NO_DRIVER';

export async function requestsReport(opts: { days?: number; filter?: RequestFilter; q?: string; page?: number; csv?: boolean }) {
  const days = opts.days ?? 30;
  const q = searchTerm(opts.q);
  const { limit, offset } = paging(opts.page, opts.csv);
  const filterSql = {
    ALL: 'true',
    COMPLETED: `r.status = 'COMPLETED'`,
    ACTIVE: `r.status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS')`,
    CANCELLED: `r.status = 'CANCELLED'`,
    NO_DRIVER: `r.status = 'NO_DRIVER'`,
  }[opts.filter ?? 'ALL'];
  const where = `r.requested_at >= now() - make_interval(days => $1::int) AND ${filterSql}
      AND ${searchSql('2', 'p.full_name', 'p.phone', 'du.full_name', 'dd.plate_number', 'r.pickup_name', 'r.dest_name')}`;
  const from = `FROM naya.rides r JOIN naya.users p ON p.id = r.passenger_id
       LEFT JOIN naya.users du ON du.id = r.driver_id LEFT JOIN naya.drivers dd ON dd.user_id = r.driver_id`;
  const rows = await many<Record<string, unknown>>(
    db,
    `SELECT r.id, r.requested_at AS "requestedAt", r.status::text AS status, r.vehicle_type::text AS "vehicleType",
            r.pickup_name AS "from", r.dest_name AS "to", r.distance_km::float8 AS km, r.fare,
            r.promo_discount AS "promoDiscount", r.promo_title AS "promoTitle",
            p.id AS "passengerId", p.full_name AS "passengerName", p.phone AS "passengerPhone", p.app_client AS "passengerClient",
            r.driver_id AS "driverId", du.full_name AS "driverName", du.phone AS "driverPhone", dd.plate_number AS "driverPlate",
            CASE WHEN r.accepted_at IS NOT NULL THEN round(extract(epoch FROM r.accepted_at - r.requested_at))::int END AS "secondsToDriver",
            r.cancelled_by AS "cancelledBy", r.cancel_reason AS "cancelReason", r.rating_for_driver AS rating,
            coalesce((
              SELECT json_agg(json_build_object(
                       'driverId', o.driver_id, 'name', ou.full_name, 'plate', od.plate_number, 'phone', ou.phone,
                       'km', o.distance_km::float8, 'status', o.status, 'offeredAt', o.offered_at, 'respondedAt', o.responded_at,
                       'seconds', CASE WHEN o.responded_at IS NOT NULL THEN round(extract(epoch FROM o.responded_at - o.offered_at))::int END)
                     ORDER BY o.offered_at, o.distance_km)
                FROM naya.ride_offers o JOIN naya.users ou ON ou.id = o.driver_id JOIN naya.drivers od ON od.user_id = o.driver_id
               WHERE o.ride_id = r.id), '[]'::json) AS offers
       ${from}
      WHERE ${where}
      ORDER BY r.requested_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    [days, q],
  );
  const summary = await one<Record<string, number>>(
    db,
    `SELECT count(*)::int AS "all",
            count(*) FILTER (WHERE r.status = 'COMPLETED')::int AS completed,
            count(*) FILTER (WHERE r.status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'))::int AS active,
            count(*) FILTER (WHERE r.status = 'CANCELLED')::int AS cancelled,
            count(*) FILTER (WHERE r.status = 'CANCELLED' AND r.cancelled_by = 'PASSENGER')::int AS "cancelledByPassenger",
            count(*) FILTER (WHERE r.status = 'CANCELLED' AND r.cancelled_by = 'DRIVER')::int AS "cancelledByDriver",
            count(*) FILTER (WHERE r.status = 'NO_DRIVER')::int AS "noDriver",
            round(avg(extract(epoch FROM r.accepted_at - r.requested_at)) FILTER (WHERE r.accepted_at IS NOT NULL))::int AS "avgSecondsToDriver",
            count(DISTINCT r.passenger_id)::int AS passengers
       FROM naya.rides r WHERE r.requested_at >= now() - make_interval(days => $1::int)`,
    [days],
  );
  // Kila dereva: maombi aliyopewa kwenye kipindi na alichofanya
  const drivers = await many<Record<string, unknown>>(
    db,
    `SELECT o.driver_id AS id, u.full_name AS name, d.plate_number AS plate, u.phone,
            count(*)::int AS offers,
            count(*) FILTER (WHERE o.status = 'ACCEPTED')::int AS accepted,
            count(*) FILTER (WHERE o.status = 'DECLINED')::int AS declined,
            count(*) FILTER (WHERE o.status = 'EXPIRED')::int AS missed,
            count(*) FILTER (WHERE o.status = 'TAKEN')::int AS taken,
            count(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
            round(avg(extract(epoch FROM o.responded_at - o.offered_at)) FILTER (WHERE o.status = 'ACCEPTED'))::int AS "avgSecondsToAccept"
       FROM naya.ride_offers o JOIN naya.users u ON u.id = o.driver_id JOIN naya.drivers d ON d.user_id = o.driver_id
      WHERE o.offered_at >= now() - make_interval(days => $1::int)
      GROUP BY o.driver_id, u.full_name, d.plate_number, u.phone
      ORDER BY offers DESC, u.full_name`,
    [days],
  );
  const total = await one<{ n: number }>(db, `SELECT count(*)::int AS n ${from} WHERE ${where}`, [days, q]);
  return { days, summary, drivers, total: total?.n ?? 0, page: opts.page ?? 1, pageSize: PAGE_SIZE, rows };
}

// =================================================================== 5. Madereva online sasa

export type Readiness = 'READY' | 'OFFER' | 'ON_RIDE' | 'NOT_SEEN' | 'FEE' | 'NO_GPS';

export async function onlineReport() {
  const { graceDays } = await getSettings();
  const rows = await many<Record<string, unknown> & { readiness: Readiness }>(
    db,
    `SELECT u.id, u.full_name AS name, u.phone, d.plate_number AS plate, d.vehicle_type::text AS "vehicleType",
            d.online_since AS "onlineSince", d.last_seen_at AS "lastSeenAt",
            round(extract(epoch FROM now() - d.last_seen_at))::int AS "secondsSinceSeen",
            d.last_lat::float8 AS lat, d.last_lng::float8 AS lng, u.app_client AS client,
            EXISTS (SELECT 1 FROM naya.fcm_tokens t WHERE t.user_id = d.user_id AND t.failures < 5) AS "hasAlarm",
            near.name AS "nearPlace",
            active.status AS "rideStatus", active.pickup_name AS "ridePickup",
            CASE
              WHEN active.status IS NOT NULL THEN 'ON_RIDE'
              WHEN EXISTS (SELECT 1 FROM naya.ride_offers o WHERE o.driver_id = d.user_id AND o.status = 'PENDING') THEN 'OFFER'
              WHEN NOT ${SUBSCRIPTION_OK_SQL('d', '$2')} THEN 'FEE'
              WHEN d.last_lat IS NULL THEN 'NO_GPS'
              WHEN NOT ${FRESH_SQL('d', '$1')} THEN 'NOT_SEEN'
              ELSE 'READY'
            END AS readiness
       FROM naya.drivers d JOIN naya.users u ON u.id = d.user_id
       LEFT JOIN LATERAL (
         SELECT r.status::text AS status, r.pickup_name FROM naya.rides r
          WHERE r.driver_id = d.user_id AND r.status IN ('ACCEPTED', 'ARRIVED', 'IN_PROGRESS') LIMIT 1) active ON true
       LEFT JOIN LATERAL (
         SELECT l.name FROM naya.locations l WHERE l.is_active AND d.last_lat IS NOT NULL
          ORDER BY power(l.lat - d.last_lat, 2) + power((l.lng - d.last_lng) * cos(radians(d.last_lat::float8)), 2) LIMIT 1) near ON true
      WHERE d.status = 'APPROVED' AND d.is_online AND u.status = 'ACTIVE'
      ORDER BY CASE WHEN active.status IS NULL THEN 0 ELSE 1 END, d.last_seen_at DESC NULLS LAST`,
    [DRIVER_STALE_SECONDS, graceDays],
  );
  const count = (r: Readiness, v?: string) => rows.filter((x) => x.readiness === r && (!v || x.vehicleType === v)).length;
  return {
    at: new Date(),
    summary: {
      online: rows.length,
      ready: count('READY'),
      readyBodaboda: count('READY', 'BODABODA'),
      readyBajaji: count('READY', 'BAJAJI'),
      offer: count('OFFER'),
      onRide: count('ON_RIDE'),
      notSeen: count('NOT_SEEN') + count('NO_GPS'),
      fee: count('FEE'),
    },
    rows,
  };
}

// =================================================================== CSV

const LABELS: Record<string, Record<string, string>> = {
  status: {
    APPROVED: 'Amethibitishwa', PENDING: 'Anasubiri', SUSPENDED: 'Amesimamishwa', REJECTED: 'Amekataliwa', INCOMPLETE: 'Hajakamilisha',
    SEARCHING: 'Inatafuta dereva', ACCEPTED: 'Dereva anakuja', ARRIVED: 'Dereva amefika', IN_PROGRESS: 'Safarini',
    COMPLETED: 'Imekamilika', CANCELLED: 'Imeghairiwa', NO_DRIVER: 'Hakuna dereva',
  },
  offer: { PENDING: 'Linasubiri', ACCEPTED: 'Alikubali', DECLINED: 'Alikataa', EXPIRED: 'Hakujibu', TAKEN: 'Mwingine amewahi', CANCELLED: 'Limeghairiwa' },
  client: { apk: 'APK', web: 'Link' },
  readiness: { READY: 'Tayari', OFFER: 'Ana ombi sasa', ON_RIDE: 'Yuko safarini', NOT_SEEN: 'Hajaonekana', FEE: 'Ada imeisha', NO_GPS: 'Hana GPS' },
  cancelledBy: { PASSENGER: 'Abiria', DRIVER: 'Dereva', ADMIN: 'Ofisi', SYSTEM: 'Mfumo' },
};
const label = (kind: string, v: unknown) => (v === null || v === undefined || v === '' ? '' : (LABELS[kind]?.[String(v)] ?? String(v)));
const local = (v: unknown) =>
  v ? new Date(v as string).toLocaleString('sv-SE', { timeZone: TZ, hour12: false }).slice(0, 16) : '';
const clientLabel = (v: unknown) => (v ? label('client', v) : 'Haijulikani');

const cell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`; // kinga ya "formula injection" kwenye Excel
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (header: string[], rows: unknown[][]) =>
  `﻿${[header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;

export function driversCsv(r: Awaited<ReturnType<typeof driversReport>>) {
  return toCsv(
    ['Jina', 'Simu', 'Hali', 'Chombo', 'Plate', 'Aina', 'Rangi', 'Alijisajili', 'Alithibitishwa', 'Ada hadi', 'Ada iko sawa',
      'Online sasa', 'Alionekana mwisho', 'APK au Link', 'Safari zilizokamilika', 'Thamani (TSh)', 'Nyota', 'Maombi aliyopewa',
      'Alikubali', 'Alikataa', 'Hakujibu'],
    r.rows.map((d) => [d.name, d.phone, label('status', d.status), d.vehicleType, d.plate, d.vehicle, d.color, local(d.registeredAt),
      local(d.approvedAt), local(d.paidUntil), d.feeOk ? 'Ndiyo' : 'Hapana', d.online ? 'Ndiyo' : 'Hapana', local(d.lastSeenAt),
      clientLabel(d.client), d.completed, d.value, d.rating ?? '', d.offers, d.accepted, d.declined, d.missed]),
  );
}

export function passengersCsv(r: Awaited<ReturnType<typeof passengersReport>>) {
  return toCsv(
    ['Jina', 'Simu', 'Alijisajili', 'Simu imethibitishwa', 'Lugha', 'APK au Link', 'Alitumia app mwisho', 'Maombi', 'Yaliyokamilika',
      'Aliyoghairi', 'Hayakupata dereva', 'Alilipa (TSh)', 'Ombi la mwisho', 'Akaunti'],
    r.rows.map((p) => [p.name, p.phone, local(p.registeredAt), p.verified ? 'Ndiyo' : 'Hapana', p.language === 'en' ? 'English' : 'Kiswahili',
      clientLabel(p.client), local(p.appSeenAt), p.requested, p.completed, p.cancelled, p.noDriver, p.spent, local(p.lastRideAt),
      p.accountStatus === 'SUSPENDED' ? 'Imesimamishwa' : 'Hai']),
  );
}

type Offer = { name: string; plate: string | null; status: string; km: number | null; seconds: number | null };
export function requestsCsv(r: Awaited<ReturnType<typeof requestsReport>>) {
  return toCsv(
    ['Muda', 'Hali', 'Chombo', 'Kutoka', 'Kwenda', 'Km', 'Nauli (TSh)', 'Abiria', 'Simu ya abiria', 'Abiria anatumia', 'Dereva aliyepokea',
      'Plate', 'Simu ya dereva', 'Sekunde hadi kupata dereva', 'Aliyeghairi', 'Sababu', 'Madereva waliopewa ombi', 'Kila dereva alifanya nini'],
    r.rows.map((x) => {
      const offers = (x.offers as Offer[]) ?? [];
      return [local(x.requestedAt), label('status', x.status), x.vehicleType, x.from, x.to, x.km, x.fare, x.passengerName, x.passengerPhone,
        clientLabel(x.passengerClient), x.driverName ?? '', x.driverPlate ?? '', x.driverPhone ?? '', x.secondsToDriver ?? '',
        label('cancelledBy', x.cancelledBy), x.cancelReason ?? '', offers.length,
        offers.map((o) => `${o.name}${o.plate ? ` (${o.plate})` : ''}: ${label('offer', o.status)}`).join(' | ')];
    }),
  );
}

export function onlineCsv(r: Awaited<ReturnType<typeof onlineReport>>) {
  return toCsv(
    ['Jina', 'Simu', 'Plate', 'Chombo', 'Hali', 'Karibu na', 'Online tangu', 'Alionekana mwisho', 'APK au Link', 'Kengele ya simu'],
    r.rows.map((d) => [d.name, d.phone, d.plate, d.vehicleType, label('readiness', d.readiness), d.nearPlace ?? '', local(d.onlineSince),
      local(d.lastSeenAt), clientLabel(d.client), d.hasAlarm ? 'Ndiyo' : 'Hapana']),
  );
}
