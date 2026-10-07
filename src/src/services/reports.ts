// Ripoti za ofisi: mwenendo wa kila siku na kupakua safari kama CSV (Excel inaifungua).
import { db, many } from '../db/pool.js';

const TZ = 'Africa/Dar_es_Salaam';

export interface DayRow {
  day: string; // YYYY-MM-DD (saa za Tanzania)
  requested: number;
  completed: number;
  cancelled: number;
  noDriver: number;
  value: number;
  newUsers: number;
  subscriptions: number;
}

/** Siku `days` za mwisho (pamoja na leo), kila siku ikiwa na takwimu zake — hata siku zisizo na safari. */
export async function dailyReport(days: number) {
  const rows = await many<DayRow>(
    db,
    `WITH span AS (
       SELECT generate_series((now() AT TIME ZONE $2)::date - ($1::int - 1), (now() AT TIME ZONE $2)::date, interval '1 day')::date AS day
     ),
     rides AS (
       SELECT (requested_at AT TIME ZONE $2)::date AS day,
              count(*)::int AS requested,
              count(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
              count(*) FILTER (WHERE status = 'NO_DRIVER')::int AS no_driver
         FROM naya.rides WHERE requested_at >= now() - make_interval(days => $1::int + 1) GROUP BY 1
     ),
     done AS (
       SELECT (completed_at AT TIME ZONE $2)::date AS day, count(*)::int AS completed, coalesce(sum(fare), 0)::int AS value
         FROM naya.rides WHERE status = 'COMPLETED' AND completed_at >= now() - make_interval(days => $1::int + 1) GROUP BY 1
     ),
     users AS (
       SELECT (created_at AT TIME ZONE $2)::date AS day, count(*)::int AS n
         FROM naya.users WHERE role = 'USER' AND created_at >= now() - make_interval(days => $1::int + 1) GROUP BY 1
     ),
     subs AS (
       SELECT (created_at AT TIME ZONE $2)::date AS day, coalesce(sum(amount), 0)::int AS total
         FROM naya.subscription_payments WHERE voided_at IS NULL AND created_at >= now() - make_interval(days => $1::int + 1) GROUP BY 1
     )
     SELECT to_char(s.day, 'YYYY-MM-DD') AS day,
            coalesce(r.requested, 0) AS requested, coalesce(d.completed, 0) AS completed, coalesce(r.cancelled, 0) AS cancelled,
            coalesce(r.no_driver, 0) AS "noDriver", coalesce(d.value, 0) AS value, coalesce(u.n, 0) AS "newUsers",
            coalesce(p.total, 0) AS subscriptions
       FROM span s
       LEFT JOIN rides r ON r.day = s.day LEFT JOIN done d ON d.day = s.day
       LEFT JOIN users u ON u.day = s.day LEFT JOIN subs p ON p.day = s.day
      ORDER BY s.day`,
    [days, TZ],
  );
  const totals = rows.reduce(
    (t, r) => ({
      requested: t.requested + r.requested,
      completed: t.completed + r.completed,
      cancelled: t.cancelled + r.cancelled,
      noDriver: t.noDriver + r.noDriver,
      value: t.value + r.value,
      newUsers: t.newUsers + r.newUsers,
      subscriptions: t.subscriptions + r.subscriptions,
    }),
    { requested: 0, completed: 0, cancelled: 0, noDriver: 0, value: 0, newUsers: 0, subscriptions: 0 },
  );
  const topDrivers = await many(
    db,
    `SELECT u.id, u.full_name AS "fullName", d.plate_number AS "plateNumber", count(*)::int AS trips, coalesce(sum(r.fare), 0)::int AS value,
            round(avg(r.rating_for_driver), 1)::float8 AS rating
       FROM naya.rides r JOIN naya.users u ON u.id = r.driver_id JOIN naya.drivers d ON d.user_id = r.driver_id
      WHERE r.status = 'COMPLETED' AND r.completed_at >= now() - make_interval(days => $1::int)
      GROUP BY u.id, u.full_name, d.plate_number ORDER BY trips DESC, value DESC LIMIT 10`,
    [days],
  );
  const topPlaces = await many(
    db,
    `SELECT name, count(*)::int AS trips FROM (
        SELECT pickup_name AS name FROM naya.rides WHERE requested_at >= now() - make_interval(days => $1::int)
        UNION ALL
        SELECT dest_name FROM naya.rides WHERE requested_at >= now() - make_interval(days => $1::int)
      ) x GROUP BY name ORDER BY trips DESC LIMIT 8`,
    [days],
  );
  const hours = await many<{ hour: number; trips: number }>(
    db,
    `SELECT extract(hour FROM requested_at AT TIME ZONE $2)::int AS hour, count(*)::int AS trips
       FROM naya.rides WHERE requested_at >= now() - make_interval(days => $1::int) GROUP BY 1 ORDER BY 1`,
    [days, TZ],
  );
  return { days: rows, totals, topDrivers, topPlaces, hours };
}

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : String(v);
  // Kinga dhidi ya "formula injection" Excel ikifungua faili.
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Safari za kipindi (siku `days` za mwisho) kama CSV. */
export async function ridesCsv(days: number) {
  const rows = await many<Record<string, unknown>>(
    db,
    `SELECT r.id, to_char(r.requested_at AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS "Ilianza",
            r.status AS "Hali", r.vehicle_type AS "Chombo", r.pickup_name AS "Kutoka", r.dest_name AS "Kwenda",
            r.distance_km AS "Km", r.fare AS "Nauli (TSh)",
            p.full_name AS "Abiria", p.phone AS "Simu ya abiria",
            du.full_name AS "Dereva", du.phone AS "Simu ya dereva", d.plate_number AS "Plate",
            r.rating_for_driver AS "Nyota (dereva)", r.cancelled_by AS "Aliyeghairi", r.cancel_reason AS "Sababu"
       FROM naya.rides r JOIN naya.users p ON p.id = r.passenger_id
       LEFT JOIN naya.users du ON du.id = r.driver_id LEFT JOIN naya.drivers d ON d.user_id = r.driver_id
      WHERE r.requested_at >= now() - make_interval(days => $1::int)
      ORDER BY r.requested_at DESC`,
    [days, TZ],
  );
  const header = rows.length
    ? Object.keys(rows[0])
    : ['id', 'Ilianza', 'Hali', 'Chombo', 'Kutoka', 'Kwenda', 'Km', 'Nauli (TSh)', 'Abiria', 'Simu ya abiria', 'Dereva', 'Simu ya dereva', 'Plate'];
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(','))];
  // BOM ili Excel isome herufi vizuri.
  return `﻿${lines.join('\r\n')}\r\n`;
}
