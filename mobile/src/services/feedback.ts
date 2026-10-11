// Maoni: abiria na madereva wanatoa maoni (nyota + maelezo) kuhusu NAYA; ofisi inayasoma, inayafanyia kazi
// na kumjulisha mtoaji ("Tumefanyia kazi maoni yako: …"). Pia ofisi inaona maoni ya safari (nyota na maneno ya abiria).
import { db, many, one } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { notify, notifyAdmins } from './notify.js';

export const FEEDBACK_TOPICS = ['GENERAL', 'APP', 'PRICES', 'DRIVERS', 'SAFETY', 'IDEA'] as const;
export type FeedbackTopic = (typeof FEEDBACK_TOPICS)[number];
export type FeedbackStatus = 'NEW' | 'REVIEWED' | 'ACTED';

/** Mtumiaji mmoja asitume maoni zaidi ya haya kwa siku (kuzuia kujaza). */
const MAX_PER_DAY = 5;

const COLUMNS = `f.id, f.role, f.rating, f.topic, f.body, f.status, f.office_note AS "officeNote", f.created_at AS "createdAt", f.handled_at AS "handledAt"`;

export async function giveFeedback(userId: string, input: { rating: number; topic: FeedbackTopic; body: string; role: 'PASSENGER' | 'DRIVER' }) {
  const body = input.body.trim();
  if (body.length < 3) throw badRequest('Andika maoni yako kwa maneno machache.');
  const today = await one<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM naya.feedback WHERE user_id = $1 AND created_at > now() - interval '1 day'`,
    [userId],
  );
  if ((today?.n ?? 0) >= MAX_PER_DAY) throw conflict('Asante! Umeshatuma maoni mengi leo — tutayasoma yote. Jaribu tena kesho.');
  const row = await one(
    db,
    `INSERT INTO naya.feedback (user_id, role, rating, topic, body) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, role, rating, topic, body, status, office_note AS "officeNote", created_at AS "createdAt", handled_at AS "handledAt"`,
    [userId, input.role, input.rating, input.topic, body.slice(0, 1000)],
  );
  await notifyAdmins();
  return row;
}

export function myFeedback(userId: string) {
  return many(db, `SELECT ${COLUMNS} FROM naya.feedback f WHERE f.user_id = $1 ORDER BY f.created_at DESC LIMIT 20`, [userId]);
}

// ------------------------------------------------------------------ Ofisi

export async function listFeedback(filter: { status: FeedbackStatus | 'ALL'; role?: 'PASSENGER' | 'DRIVER' }) {
  const items = await many(
    db,
    `SELECT ${COLUMNS}, u.id AS "userId", u.full_name AS "userName", u.phone AS "userPhone", h.full_name AS "handledBy"
       FROM naya.feedback f JOIN naya.users u ON u.id = f.user_id LEFT JOIN naya.users h ON h.id = f.handled_by
      WHERE ($1::varchar = 'ALL' OR f.status = $1::varchar) AND ($2::varchar IS NULL OR f.role = $2::varchar)
      ORDER BY (f.status = 'NEW') DESC, f.created_at DESC
      LIMIT 100`,
    [filter.status, filter.role ?? null],
  );
  const summary = await one<Record<string, number>>(
    db,
    `SELECT count(*) FILTER (WHERE status = 'NEW')::int AS "NEW", count(*) FILTER (WHERE status = 'REVIEWED')::int AS "REVIEWED",
            count(*) FILTER (WHERE status = 'ACTED')::int AS "ACTED", count(*)::int AS "ALL",
            round(avg(rating) FILTER (WHERE created_at > now() - interval '30 days'), 1)::float8 AS "avg30",
            round(avg(rating) FILTER (WHERE role = 'PASSENGER' AND created_at > now() - interval '30 days'), 1)::float8 AS "avgPassengers",
            round(avg(rating) FILTER (WHERE role = 'DRIVER' AND created_at > now() - interval '30 days'), 1)::float8 AS "avgDrivers"
       FROM naya.feedback`,
  );
  return { items, summary: summary ?? {} };
}

export async function newFeedbackCount() {
  const row = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM naya.feedback WHERE status = 'NEW'`);
  return row?.n ?? 0;
}

/** Ofisi: "Nimesoma" (REVIEWED) au "Imefanyiwa kazi" (ACTED). Maelezo yakiwepo, mtoaji anajulishwa. */
export async function handleFeedback(adminId: string, id: string, input: { status: 'REVIEWED' | 'ACTED'; note?: string }) {
  const note = input.note?.trim() || null;
  const row = await one<{ user_id: string }>(
    db,
    `UPDATE naya.feedback SET status = $2, office_note = coalesce($3, office_note), handled_by = $4, handled_at = now()
      WHERE id = $1 RETURNING user_id`,
    [id, input.status, note?.slice(0, 500) ?? null, adminId],
  );
  if (!row) throw notFound('Maoni hayakupatikana');
  await writeAudit(db, {
    actorId: adminId,
    action: input.status === 'ACTED' ? 'feedback.acted' : 'feedback.reviewed',
    targetType: 'user',
    targetId: row.user_id,
    details: { feedbackId: id, note },
  });
  if (note) {
    await notify({
      userId: row.user_id,
      event: 'support',
      kind: 'feedback_reply',
      title: input.status === 'ACTED' ? 'Tumefanyia kazi maoni yako' : 'Ofisi imesoma maoni yako',
      body: note.slice(0, 280),
    });
  }
  await notifyAdmins();
  return one(
    db,
    `SELECT ${COLUMNS}, u.id AS "userId", u.full_name AS "userName", u.phone AS "userPhone", h.full_name AS "handledBy"
       FROM naya.feedback f JOIN naya.users u ON u.id = f.user_id LEFT JOIN naya.users h ON h.id = f.handled_by WHERE f.id = $1`,
    [id],
  );
}

/** Maoni ya safari: nyota na maneno ya abiria kuhusu dereva (siku 30), ya chini kwanza. */
export function rideComments(onlyLow: boolean) {
  return many(
    db,
    `SELECT r.id AS "rideId", r.rating_for_driver AS rating, r.comment_for_driver AS comment, r.completed_at AS "completedAt",
            r.pickup_name AS "pickupName", r.dest_name AS "destinationName",
            p.id AS "passengerId", p.full_name AS "passengerName", du.id AS "driverId", du.full_name AS "driverName", d.plate_number AS "plateNumber"
       FROM naya.rides r JOIN naya.users p ON p.id = r.passenger_id
       LEFT JOIN naya.users du ON du.id = r.driver_id LEFT JOIN naya.drivers d ON d.user_id = r.driver_id
      WHERE r.rating_for_driver IS NOT NULL AND r.completed_at > now() - interval '30 days'
        AND (NOT $1::boolean OR r.rating_for_driver <= 3 OR r.comment_for_driver IS NOT NULL)
      ORDER BY r.rating_for_driver ASC, r.completed_at DESC
      LIMIT 100`,
    [onlyLow],
  );
}
