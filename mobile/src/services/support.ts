// Msaada: abiria au dereva anaripoti tatizo kwenye app ("Msaada"), ofisi inajibu, jibu linamfikia kwenye simu.
import { type Db, db, many, one, transaction } from '../db/pool.js';
import { publish } from '../realtime/hub.js';
import { badRequest, conflict, notFound } from '../utils/http.js';
import { writeAudit } from './audit.js';
import { notify, notifyAdmins } from './notify.js';

export const SUPPORT_CATEGORIES = ['RIDE', 'FARE', 'DRIVER', 'PASSENGER', 'LOST_ITEM', 'SAFETY', 'APP', 'ACCOUNT', 'OTHER'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export type TicketStatus = 'OPEN' | 'ANSWERED' | 'RESOLVED';

const CATEGORY_TITLE: Record<SupportCategory, string> = {
  RIDE: 'Tatizo la safari',
  FARE: 'Nauli',
  DRIVER: 'Kuhusu dereva',
  PASSENGER: 'Kuhusu abiria',
  LOST_ITEM: 'Nimesahau kitu',
  SAFETY: 'Usalama',
  APP: 'App haifanyi kazi vizuri',
  ACCOUNT: 'Akaunti yangu',
  OTHER: 'Mengineyo',
};

/** Mtumiaji asifungue tiketi nyingi mno kwa muda mfupi (kuzuia matumizi mabaya). */
const MAX_OPEN_TICKETS = 5;

const TICKET_COLUMNS = `t.id, t.ride_id AS "rideId", t.role, t.category, t.status, t.subject, t.user_unread AS "userUnread",
  t.created_at AS "createdAt", t.updated_at AS "updatedAt", t.resolved_at AS "resolvedAt"`;

async function messagesOf(client: Db, ticketId: string, withAuthor: boolean) {
  return many(
    client,
    `SELECT m.id, m.from_staff AS "fromStaff", m.body, m.created_at AS "createdAt"${withAuthor ? ', u.full_name AS "authorName"' : ''}
       FROM naya.support_messages m ${withAuthor ? 'LEFT JOIN naya.users u ON u.id = m.author_id' : ''}
      WHERE m.ticket_id = $1 ORDER BY m.id`,
    [ticketId],
  );
}

// ------------------------------------------------------------------ Mtumiaji (app)

export async function createTicket(
  userId: string,
  input: { category: SupportCategory; message: string; rideId?: string | null; role: 'PASSENGER' | 'DRIVER' },
) {
  const message = input.message.trim();
  if (message.length < 5) throw badRequest('Eleza tatizo kwa maneno machache zaidi.');
  const ticket = await transaction(async (client) => {
    const open = await one<{ n: number }>(
      client,
      `SELECT count(*)::int AS n FROM naya.support_tickets WHERE user_id = $1 AND status <> 'RESOLVED'`,
      [userId],
    );
    if ((open?.n ?? 0) >= MAX_OPEN_TICKETS) throw conflict('Una maombi mengi ya msaada ambayo bado yanashughulikiwa. Subiri majibu ya ofisi kwanza.');
    if (input.rideId) {
      const ride = await one(client, 'SELECT 1 FROM naya.rides WHERE id = $1 AND (passenger_id = $2 OR driver_id = $2)', [input.rideId, userId]);
      if (!ride) throw notFound('Safari hiyo haikupatikana kwenye akaunti yako.');
    }
    const subject = `${CATEGORY_TITLE[input.category]}: ${message.replace(/\s+/g, ' ').slice(0, 80)}`;
    const row = await one<{ id: string }>(
      client,
      `INSERT INTO naya.support_tickets (user_id, ride_id, role, category, subject) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, input.rideId ?? null, input.role, input.category, subject.slice(0, 120)],
    );
    await client.query('INSERT INTO naya.support_messages (ticket_id, author_id, from_staff, body) VALUES ($1, $2, false, $3)', [
      row!.id,
      userId,
      message.slice(0, 1000),
    ]);
    return row!.id;
  });
  await notifyAdmins();
  return ticketForUser(userId, ticket);
}

export async function listTicketsForUser(userId: string) {
  return many(db, `SELECT ${TICKET_COLUMNS} FROM naya.support_tickets t WHERE t.user_id = $1 ORDER BY t.updated_at DESC LIMIT 30`, [userId]);
}

export async function ticketForUser(userId: string, ticketId: string, markRead = false) {
  const ticket = await one<{ id: string; userUnread: boolean }>(
    db,
    `SELECT ${TICKET_COLUMNS} FROM naya.support_tickets t WHERE t.id = $1 AND t.user_id = $2`,
    [ticketId, userId],
  );
  if (!ticket) throw notFound('Ombi la msaada halikupatikana');
  if (markRead && ticket.userUnread) {
    await db.query('UPDATE naya.support_tickets SET user_unread = false WHERE id = $1', [ticketId]);
    ticket.userUnread = false;
  }
  // Mtumiaji haoni majina ya wafanyakazi wa ofisi — "Ofisi ya NAYA" tu.
  return { ...ticket, messages: await messagesOf(db, ticketId, false) };
}

export async function replyAsUser(userId: string, ticketId: string, body: string) {
  const text = body.trim();
  if (!text) throw badRequest('Andika ujumbe');
  await transaction(async (client) => {
    const t = await one<{ status: TicketStatus }>(
      client,
      'SELECT status FROM naya.support_tickets WHERE id = $1 AND user_id = $2 FOR UPDATE',
      [ticketId, userId],
    );
    if (!t) throw notFound('Ombi la msaada halikupatikana');
    await client.query('INSERT INTO naya.support_messages (ticket_id, author_id, from_staff, body) VALUES ($1, $2, false, $3)', [
      ticketId,
      userId,
      text.slice(0, 1000),
    ]);
    // Mtumiaji akiandika tena, tiketi inarudi kwa ofisi (hata kama ilikuwa imetatuliwa).
    await client.query(`UPDATE naya.support_tickets SET status = 'OPEN', resolved_at = NULL, updated_at = now() WHERE id = $1`, [ticketId]);
  });
  await notifyAdmins();
  return ticketForUser(userId, ticketId);
}

export async function unreadSupportCount(userId: string) {
  const row = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM naya.support_tickets WHERE user_id = $1 AND user_unread', [userId]);
  return row?.n ?? 0;
}

// ------------------------------------------------------------------ Ofisi

export async function listTicketsForAdmin(filter: { status?: TicketStatus | 'ACTIVE' | 'ALL'; q?: string; userId?: string }) {
  const status = filter.status ?? 'ACTIVE';
  const q = filter.q ? `%${filter.q.replace(/[\\%_]/g, '\\$&')}%` : null;
  const digits = filter.q && !/[a-z]/i.test(filter.q) ? filter.q.replace(/\D/g, '').replace(/^0/, '').replace(/^255/, '') : '';
  const tickets = await many(
    db,
    `SELECT ${TICKET_COLUMNS}, u.full_name AS "userName", u.phone AS "userPhone",
            (SELECT count(*)::int FROM naya.support_messages m WHERE m.ticket_id = t.id) AS "messageCount",
            (SELECT m.body FROM naya.support_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS "lastMessage",
            (SELECT m.from_staff FROM naya.support_messages m WHERE m.ticket_id = t.id ORDER BY m.id DESC LIMIT 1) AS "lastFromStaff"
       FROM naya.support_tickets t JOIN naya.users u ON u.id = t.user_id
      WHERE ($1::varchar = 'ALL' OR ($1::varchar = 'ACTIVE' AND t.status <> 'RESOLVED') OR t.status = $1::varchar)
        AND ($2::uuid IS NULL OR t.user_id = $2)
        AND ($3::text IS NULL OR t.subject ILIKE $3 OR u.full_name ILIKE $3 OR ($4 <> '' AND u.phone LIKE '%' || $4 || '%'))
      ORDER BY (t.status = 'OPEN') DESC, t.updated_at DESC
      LIMIT 100`,
    [status, filter.userId ?? null, q, digits.length >= 3 ? digits : ''],
  );
  const counts = await one<{ open: number; answered: number; resolved: number }>(
    db,
    `SELECT count(*) FILTER (WHERE status = 'OPEN')::int AS open, count(*) FILTER (WHERE status = 'ANSWERED')::int AS answered,
            count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved FROM naya.support_tickets`,
  );
  return { tickets, counts: { OPEN: counts?.open ?? 0, ANSWERED: counts?.answered ?? 0, RESOLVED: counts?.resolved ?? 0 } };
}

export async function openSupportCount() {
  const row = await one<{ n: number }>(db, `SELECT count(*)::int AS n FROM naya.support_tickets WHERE status = 'OPEN'`);
  return row?.n ?? 0;
}

export async function ticketForAdmin(ticketId: string) {
  const ticket = await one<Record<string, unknown> & { userId: string; rideId: string | null }>(
    db,
    `SELECT ${TICKET_COLUMNS}, t.user_id AS "userId", u.full_name AS "userName", u.phone AS "userPhone", u.status AS "userStatus"
       FROM naya.support_tickets t JOIN naya.users u ON u.id = t.user_id WHERE t.id = $1`,
    [ticketId],
  );
  if (!ticket) throw notFound('Ombi la msaada halikupatikana');
  const ride = ticket.rideId
    ? await one(
        db,
        `SELECT r.id, r.status, r.pickup_name AS "pickupName", r.dest_name AS "destinationName", r.fare, r.requested_at AS "requestedAt",
                p.full_name AS "passengerName", du.full_name AS "driverName", d.plate_number AS "plateNumber"
           FROM naya.rides r JOIN naya.users p ON p.id = r.passenger_id
           LEFT JOIN naya.users du ON du.id = r.driver_id LEFT JOIN naya.drivers d ON d.user_id = r.driver_id
          WHERE r.id = $1`,
        [ticket.rideId],
      )
    : null;
  return { ...ticket, ride, messages: await messagesOf(db, ticketId, true) };
}

export async function replyAsStaff(adminId: string, ticketId: string, input: { body: string; resolve?: boolean }) {
  const text = input.body.trim();
  if (!text && !input.resolve) throw badRequest('Andika jibu');
  const ticket = await transaction(async (client) => {
    const t = await one<{ user_id: string; status: TicketStatus; subject: string }>(
      client,
      'SELECT user_id, status, subject FROM naya.support_tickets WHERE id = $1 FOR UPDATE',
      [ticketId],
    );
    if (!t) throw notFound('Ombi la msaada halikupatikana');
    if (text) {
      await client.query('INSERT INTO naya.support_messages (ticket_id, author_id, from_staff, body) VALUES ($1, $2, true, $3)', [
        ticketId,
        adminId,
        text.slice(0, 1000),
      ]);
    }
    const next: TicketStatus = input.resolve ? 'RESOLVED' : 'ANSWERED';
    await client.query(
      `UPDATE naya.support_tickets
          SET status = $2::varchar, user_unread = user_unread OR $3::boolean, updated_at = now(),
              resolved_at = CASE WHEN $2::varchar = 'RESOLVED' THEN now() ELSE NULL END
        WHERE id = $1`,
      [ticketId, next, !!text],
    );
    await writeAudit(client, {
      actorId: adminId,
      action: input.resolve ? 'support.resolved' : 'support.replied',
      targetType: 'user',
      targetId: t.user_id,
      details: { ticketId },
    });
    return t;
  });
  if (text) {
    await notify({
      userId: ticket.user_id,
      event: 'support',
      kind: 'support_reply',
      title: 'Ofisi ya NAYA imekujibu',
      body: text.slice(0, 280),
      urgent: true,
    });
  } else {
    await publish({ type: 'support', userId: ticket.user_id });
  }
  await notifyAdmins();
  return ticketForAdmin(ticketId);
}

export async function reopenTicket(adminId: string, ticketId: string) {
  const updated = await one<{ user_id: string }>(
    db,
    `UPDATE naya.support_tickets SET status = 'OPEN', resolved_at = NULL, updated_at = now() WHERE id = $1 RETURNING user_id`,
    [ticketId],
  );
  if (!updated) throw notFound('Ombi la msaada halikupatikana');
  await writeAudit(db, { actorId: adminId, action: 'support.reopened', targetType: 'user', targetId: updated.user_id, details: { ticketId } });
  await notifyAdmins();
  return ticketForAdmin(ticketId);
}
