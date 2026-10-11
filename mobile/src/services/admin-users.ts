// Ofisi: watumiaji wa app (abiria na madereva) — kuwatafuta, kuona historia yao yote, na kuwasaidia.
import { randomInt } from 'node:crypto';
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { publish } from '../realtime/hub.js';
import { badRequest, conflict, notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { hashPassword } from './auth.js';
import { notify, notifyAdmins } from './notify.js';
import { sendSms, smsEnabled } from './sms.js';

export const USER_FILTERS = ['ALL', 'PASSENGERS', 'DRIVERS', 'SUSPENDED', 'UNVERIFIED', 'NEW'] as const;
export type UserFilter = (typeof USER_FILTERS)[number];

const likeOf = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;
const phoneDigits = (q: string) => {
  if (/[a-z]/i.test(q)) return ''; // jina au plate, si namba ya simu
  const d = q.replace(/\D/g, '');
  return d.length >= 3 ? d.replace(/^0/, '').replace(/^255/, '') : '';
};

export async function listUsers(filter: UserFilter, q?: string) {
  const text = q?.trim() ? likeOf(q.trim()) : null;
  const digits = q ? phoneDigits(q) : '';
  return many(
    db,
    `SELECT u.id, u.full_name AS "fullName", u.phone, u.status, u.active_mode AS "activeMode",
            u.phone_verified_at IS NOT NULL AS "phoneVerified", u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt",
            d.status AS "driverStatus", d.plate_number AS "plateNumber", d.is_online AS "online",
            (SELECT count(*)::int FROM naya.rides r WHERE r.passenger_id = u.id AND r.status = 'COMPLETED') AS "tripsAsPassenger",
            (SELECT count(*)::int FROM naya.rides r WHERE r.driver_id = u.id AND r.status = 'COMPLETED') AS "tripsAsDriver",
            (SELECT count(*)::int FROM naya.support_tickets t WHERE t.user_id = u.id AND t.status <> 'RESOLVED') AS "openTickets"
       FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id
      WHERE u.role = 'USER'
        AND CASE $1::varchar
              WHEN 'PASSENGERS' THEN d.user_id IS NULL OR d.status <> 'APPROVED'
              WHEN 'DRIVERS' THEN d.status IN ('APPROVED', 'SUSPENDED')
              WHEN 'SUSPENDED' THEN u.status = 'SUSPENDED' OR d.status = 'SUSPENDED'
              WHEN 'UNVERIFIED' THEN u.phone_verified_at IS NULL
              WHEN 'NEW' THEN u.created_at > now() - interval '7 days'
              ELSE true END
        AND ($2::text IS NULL OR u.full_name ILIKE $2 OR d.plate_number ILIKE $2 OR ($3 <> '' AND u.phone LIKE '%' || $3 || '%'))
      ORDER BY u.created_at DESC
      LIMIT 100`,
    [filter, text, digits],
  );
}

export async function userCounts() {
  const row = await one<Record<string, number>>(
    db,
    `SELECT count(*)::int AS "ALL",
            count(*) FILTER (WHERE d.user_id IS NULL OR d.status <> 'APPROVED')::int AS "PASSENGERS",
            count(*) FILTER (WHERE d.status IN ('APPROVED', 'SUSPENDED'))::int AS "DRIVERS",
            count(*) FILTER (WHERE u.status = 'SUSPENDED' OR d.status = 'SUSPENDED')::int AS "SUSPENDED",
            count(*) FILTER (WHERE u.phone_verified_at IS NULL)::int AS "UNVERIFIED",
            count(*) FILTER (WHERE u.created_at > now() - interval '7 days')::int AS "NEW"
       FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id WHERE u.role = 'USER'`,
  );
  return row ?? {};
}

async function appUser(client: Db, id: string) {
  const u = await one<{ id: string; phone: string; full_name: string; status: string; role: string }>(
    client,
    'SELECT id, phone, full_name, status, role FROM naya.users WHERE id = $1',
    [id],
  );
  if (!u || u.role !== 'USER') throw notFound('Mtumiaji hakupatikana');
  return u;
}

export async function userDetail(id: string) {
  const user = await one<Record<string, unknown>>(
    db,
    `SELECT u.id, u.full_name AS "fullName", u.phone, u.status, u.suspended_reason AS "suspendedReason", u.active_mode AS "activeMode",
            u.phone_verified_at AS "phoneVerifiedAt", u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt", u.role, u.terms_accepted_at AS "termsAcceptedAt", u.terms_version AS "termsVersion"
       FROM naya.users u WHERE u.id = $1`,
    [id],
  );
  if (!user || user.role !== 'USER') throw notFound('Mtumiaji hakupatikana');
  const [driver, stats, rides, tickets, sos, notes, history, devices] = await Promise.all([
    one(
      db,
      `SELECT d.status, d.vehicle_type AS "vehicleType", d.plate_number AS "plateNumber", d.vehicle_make AS "vehicleMake",
              d.vehicle_color AS "vehicleColor", d.is_online AS "online", d.last_seen_at AS "lastSeenAt", d.paid_until AS "paidUntil",
              d.last_lat AS "lat", d.last_lng AS "lng"
         FROM naya.drivers d WHERE d.user_id = $1`,
      [id],
    ),
    one(
      db,
      `SELECT count(*) FILTER (WHERE passenger_id = $1 AND status = 'COMPLETED')::int AS "passengerTrips",
              count(*) FILTER (WHERE passenger_id = $1 AND status = 'CANCELLED' AND cancelled_by = 'PASSENGER')::int AS "passengerCancels",
              coalesce(sum(fare) FILTER (WHERE passenger_id = $1 AND status = 'COMPLETED'), 0)::int AS "passengerSpent",
              round(avg(rating_for_passenger) FILTER (WHERE passenger_id = $1), 1)::float8 AS "passengerRating",
              count(*) FILTER (WHERE driver_id = $1 AND status = 'COMPLETED')::int AS "driverTrips",
              count(*) FILTER (WHERE driver_id = $1 AND status = 'CANCELLED' AND cancelled_by = 'DRIVER')::int AS "driverCancels",
              coalesce(sum(fare) FILTER (WHERE driver_id = $1 AND status = 'COMPLETED'), 0)::int AS "driverEarned",
              round(avg(rating_for_driver) FILTER (WHERE driver_id = $1), 1)::float8 AS "driverRating"
         FROM naya.rides WHERE passenger_id = $1 OR driver_id = $1`,
      [id],
    ),
    many(
      db,
      `SELECT r.id, r.status, r.vehicle_type AS "vehicleType", r.pickup_name AS "pickupName", r.dest_name AS "destinationName",
              r.fare, r.requested_at AS "requestedAt", CASE WHEN r.passenger_id = $1 THEN 'PASSENGER' ELSE 'DRIVER' END AS "as",
              CASE WHEN r.passenger_id = $1 THEN du.full_name ELSE p.full_name END AS "otherName"
         FROM naya.rides r JOIN naya.users p ON p.id = r.passenger_id LEFT JOIN naya.users du ON du.id = r.driver_id
        WHERE r.passenger_id = $1 OR r.driver_id = $1
        ORDER BY r.requested_at DESC LIMIT 20`,
      [id],
    ),
    many(
      db,
      `SELECT id, category, status, subject, updated_at AS "updatedAt" FROM naya.support_tickets WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 20`,
      [id],
    ),
    many(
      db,
      `SELECT id, ride_id AS "rideId", role, status, created_at AS "createdAt" FROM naya.sos_alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [id],
    ),
    many(
      db,
      `SELECT n.id, n.body, n.created_at AS "createdAt", a.full_name AS "authorName"
         FROM naya.user_notes n LEFT JOIN naya.users a ON a.id = n.author_id WHERE n.user_id = $1 ORDER BY n.created_at DESC LIMIT 30`,
      [id],
    ),
    many(
      db,
      `SELECT a.action, a.details, u.full_name AS "actorName", a.created_at AS "createdAt"
         FROM naya.audit_logs a LEFT JOIN naya.users u ON u.id = a.actor_id
        WHERE a.target_id = $1 AND a.target_type IN ('user', 'driver')
        ORDER BY a.created_at DESC LIMIT 30`,
      [id],
    ),
    one(
      db,
      `SELECT (SELECT count(*)::int FROM naya.fcm_tokens WHERE user_id = $1) AS "androidApp",
              (SELECT count(*)::int FROM naya.push_subscriptions WHERE user_id = $1) AS "webPush"`,
      [id],
    ),
  ]);
  return { user, driver, stats, rides, tickets, sos, notes, history, devices, smsEnabled: smsEnabled() };
}

export async function suspendUser(adminId: string, id: string, reason: string) {
  if (reason.trim().length < 3) throw badRequest('Andika sababu ya kumsimamisha.');
  await transaction(async (client) => {
    const u = await appUser(client, id);
    if (u.status === 'SUSPENDED') throw conflict('Akaunti hii tayari imesimamishwa.');
    const active = await one(
      client,
      `SELECT 1 FROM naya.rides WHERE (passenger_id = $1 OR driver_id = $1) AND status IN ('SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS')`,
      [id],
    );
    if (active) throw conflict('Mtumiaji huyu ana safari inayoendelea. Ighairi (Safari) au subiri iishe kwanza.');
    // Vikao vyote vinakufa papo hapo; dereva anatoka online; simu zake hazipati tena arifa.
    await client.query(
      `UPDATE naya.users SET status = 'SUSPENDED', suspended_reason = $2, token_version = token_version + 1, updated_at = now() WHERE id = $1`,
      [id, reason.trim().slice(0, 300)],
    );
    await client.query('UPDATE naya.drivers SET is_online = false WHERE user_id = $1', [id]);
    await client.query(
      `UPDATE naya.ride_offers SET status = 'EXPIRED', responded_at = now() WHERE driver_id = $1 AND status = 'PENDING'`,
      [id],
    );
    await client.query('DELETE FROM naya.fcm_tokens WHERE user_id = $1', [id]);
    await writeAudit(client, { actorId: adminId, action: 'user.suspended', targetType: 'user', targetId: id, details: { reason: reason.trim() } });
  });
  await publish({ type: 'account', userId: id });
  await notifyAdmins();
  return userDetail(id);
}

export async function reactivateUser(adminId: string, id: string) {
  await transaction(async (client) => {
    const u = await appUser(client, id);
    if (u.status === 'ACTIVE') throw conflict('Akaunti hii tayari iko hai.');
    await client.query(`UPDATE naya.users SET status = 'ACTIVE', suspended_reason = NULL, updated_at = now() WHERE id = $1`, [id]);
    await writeAudit(client, { actorId: adminId, action: 'user.reactivated', targetType: 'user', targetId: id });
  });
  await notifyAdmins();
  return userDetail(id);
}

export async function verifyPhoneManually(adminId: string, id: string) {
  await transaction(async (client) => {
    await appUser(client, id);
    await client.query('UPDATE naya.users SET phone_verified_at = coalesce(phone_verified_at, now()), updated_at = now() WHERE id = $1', [id]);
    await writeAudit(client, { actorId: adminId, action: 'user.phone_verified', targetType: 'user', targetId: id });
  });
  await publish({ type: 'account', userId: id });
  return userDetail(id);
}

const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/**
 * Mtumiaji amesahau password na hawezi kupokea SMS ya "Umesahau password?": ofisi inatengeneza password ya muda.
 * Inatumwa kwa SMS kama SMS zimewashwa; vinginevyo inaonyeshwa kwa msimamizi MARA MOJA tu (impigie mtumiaji).
 * Haihifadhiwi popote isipokuwa hash yake; vikao vyote vya zamani vinakufa.
 */
export async function issueTemporaryPassword(adminId: string, id: string) {
  const temp = Array.from({ length: 8 }, () => TEMP_ALPHABET[randomInt(0, TEMP_ALPHABET.length)]).join('');
  const u = await transaction(async (client) => {
    const user = await appUser(client, id);
    await client.query('UPDATE naya.users SET password_hash = $2, token_version = token_version + 1, updated_at = now() WHERE id = $1', [
      id,
      await hashPassword(temp),
    ]);
    await writeAudit(client, { actorId: adminId, action: 'user.temp_password', targetType: 'user', targetId: id });
    return user;
  });
  let smsSent = false;
  if (smsEnabled()) {
    smsSent = await sendSms(u.phone, `NAYA: Password yako mpya ya muda ni ${temp}. Ingia, kisha ibadilishe kwenye Akaunti.`, 'temp_password');
  }
  return { smsSent, temporaryPassword: smsSent ? null : temp };
}

export async function addUserNote(adminId: string, id: string, body: string) {
  const text = body.trim();
  if (!text) throw badRequest('Andika maelezo');
  await appUser(db, id);
  await db.query('INSERT INTO naya.user_notes (user_id, author_id, body) VALUES ($1, $2, $3)', [id, adminId, text.slice(0, 1000)]);
  return userDetail(id);
}

export async function messageUser(adminId: string, id: string, input: { body: string; sms: boolean }) {
  const text = input.body.trim();
  if (text.length < 2) throw badRequest('Andika ujumbe');
  const u = await appUser(db, id);
  await notify({ userId: id, event: 'support', kind: 'office_message', title: 'Ujumbe kutoka ofisi ya NAYA', body: text.slice(0, 300), urgent: true });
  let smsSent = false;
  if (input.sms && smsEnabled()) smsSent = await sendSms(u.phone, `NAYA: ${text}`.slice(0, 300), 'office_message');
  await writeAudit(db, { actorId: adminId, action: 'user.messaged', targetType: 'user', targetId: id, details: { sms: smsSent, body: text.slice(0, 300) } });
  return { delivered: true, smsSent };
}

export async function forceDriverOffline(adminId: string, id: string) {
  const updated = await one(db, 'UPDATE naya.drivers SET is_online = false WHERE user_id = $1 AND is_online RETURNING user_id', [id]);
  if (!updated) throw conflict('Dereva huyu hayuko online.');
  await db.query(`UPDATE naya.ride_offers SET status = 'EXPIRED', responded_at = now() WHERE driver_id = $1 AND status = 'PENDING'`, [id]);
  await writeAudit(db, { actorId: adminId, action: 'driver.forced_offline', targetType: 'driver', targetId: id });
  await notify({ userId: id, event: 'driver', kind: 'forced_offline', title: 'Umetolewa online na ofisi', body: 'Ukiwa tayari kupokea safari, nenda online tena.' });
  await notifyAdmins();
  return userDetail(id);
}

// ------------------------------------------------------------------ Utafutaji mmoja (juu ya ofisi)

export async function globalSearch(q: string) {
  const query = q.trim();
  if (query.length < 2) return { users: [], rides: [] };
  const text = likeOf(query);
  const digits = phoneDigits(query);
  const users = await many(
    db,
    `SELECT u.id, u.full_name AS "fullName", u.phone, u.status, d.status AS "driverStatus", d.plate_number AS "plateNumber"
       FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id
      WHERE u.role = 'USER' AND (u.full_name ILIKE $1 OR d.plate_number ILIKE $1 OR ($2 <> '' AND u.phone LIKE '%' || $2 || '%'))
      ORDER BY u.full_name LIMIT 8`,
    [text, digits],
  );
  const hex = query.toLowerCase().replace(/[^0-9a-f-]/g, '');
  const rides =
    hex.length >= 4 && hex === query.toLowerCase()
      ? await many(
          db,
          `SELECT r.id, r.status, r.pickup_name AS "pickupName", r.dest_name AS "destinationName", r.requested_at AS "requestedAt"
             FROM naya.rides r WHERE r.id::text LIKE $1 ORDER BY r.requested_at DESC LIMIT 5`,
          [`${hex}%`],
        )
      : [];
  return { users, rides };
}
