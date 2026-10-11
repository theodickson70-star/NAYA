// Ofisi kuu (Phase 11) + Msaada kwenye app.
//   App:   GET/POST /api/support, GET /api/support/:id, POST /api/support/:id/reply
//   Ofisi: /api/admin/users..., /api/admin/support..., /api/admin/broadcasts, /api/admin/live,
//          /api/admin/rides/:id/candidates|offer|complete, /api/admin/reports, /api/admin/reports/rides.csv, /api/admin/search
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import {
  addUserNote,
  forceDriverOffline,
  globalSearch,
  issueTemporaryPassword,
  listUsers,
  messageUser,
  reactivateUser,
  suspendUser,
  USER_FILTERS,
  userCounts,
  userDetail,
  verifyPhoneManually,
} from '../services/admin-users.js';
import { AUDIENCES, audienceSizes, listBroadcasts, sendBroadcast } from '../services/broadcast.js';
import { FEEDBACK_TOPICS, giveFeedback, handleFeedback, listFeedback, myFeedback, rideComments } from '../services/feedback.js';
import { dailyReport, ridesCsv } from '../services/reports.js';
import { candidatesForRide, completeByAdmin, liveOverview, offerRideToDriver } from '../services/rides.js';
import {
  createTicket,
  listTicketsForAdmin,
  listTicketsForUser,
  reopenTicket,
  replyAsStaff,
  replyAsUser,
  SUPPORT_CATEGORIES,
  ticketForAdmin,
  ticketForUser,
} from '../services/support.js';
import { ok } from '../utils/http.js';

const idParam = z.object({ id: z.uuid({ error: 'Haikupatikana' }) });
const text = (max: number, error = 'Andika ujumbe') => z.string({ error }).trim().min(1, error).max(max, `Ujumbe ni mrefu mno (herufi ${max} tu)`);

export async function ofisiRoutes(app: FastifyInstance): Promise<void> {
  const user = { preHandler: requireRole('USER') };
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };

  // ------------------------------------------------------------ Msaada (app)
  app.get('/api/support', user, async (request) => ok(await listTicketsForUser(request.currentUser.id)));

  app.post('/api/support', { ...user, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const input = z
      .object({
        category: z.enum(SUPPORT_CATEGORIES, { error: 'Chagua aina ya tatizo' }),
        message: text(1000, 'Eleza tatizo lako'),
        rideId: z.uuid().nullable().optional(),
      })
      .parse(request.body);
    const role = request.currentUser.active_mode === 'DRIVER' ? 'DRIVER' : 'PASSENGER';
    return reply.status(201).send(ok(await createTicket(request.currentUser.id, { ...input, role })));
  });

  app.get('/api/support/:id', user, async (request) => {
    const { id } = idParam.parse(request.params);
    return ok(await ticketForUser(request.currentUser.id, id, true));
  });

  app.post('/api/support/:id/reply', { ...user, config: { rateLimit: { max: 30, timeWindow: '1 hour' } } }, async (request) => {
    const { id } = idParam.parse(request.params);
    const { body } = z.object({ body: text(1000) }).parse(request.body);
    return ok(await replyAsUser(request.currentUser.id, id, body));
  });

  // ------------------------------------------------------------ Maoni (app)
  app.get('/api/feedback', user, async (request) => ok(await myFeedback(request.currentUser.id)));
  app.post('/api/feedback', { ...user, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const input = z
      .object({
        rating: z.number({ error: 'Chagua nyota' }).int().min(1, 'Chagua nyota').max(5),
        topic: z.enum(FEEDBACK_TOPICS).default('GENERAL'),
        body: text(1000, 'Andika maoni yako'),
      })
      .parse(request.body);
    const role = request.currentUser.active_mode === 'DRIVER' ? 'DRIVER' : 'PASSENGER';
    return reply.status(201).send(ok(await giveFeedback(request.currentUser.id, { ...input, role })));
  });

  // ------------------------------------------------------------ Ofisi: maoni
  app.get('/api/admin/feedback', adminOnly, async (request) => {
    const q = z
      .object({ status: z.enum(['NEW', 'REVIEWED', 'ACTED', 'ALL']).default('NEW'), role: z.enum(['PASSENGER', 'DRIVER']).optional() })
      .parse(request.query);
    return ok(await listFeedback(q));
  });
  app.post('/api/admin/feedback/:id', adminOnly, async (request) => {
    const input = z
      .object({ status: z.enum(['REVIEWED', 'ACTED'], { error: 'Chagua hatua' }), note: z.string().trim().max(500, 'Maelezo ni marefu mno').optional() })
      .parse(request.body);
    return ok(await handleFeedback(request.currentUser.id, idParam.parse(request.params).id, input));
  });
  app.get('/api/admin/ride-comments', adminOnly, async (request) => {
    const { all } = z.object({ all: z.enum(['0', '1']).default('0') }).parse(request.query);
    return ok(await rideComments(all === '0'));
  });

  // ------------------------------------------------------------ Ofisi: watumiaji
  app.get('/api/admin/users', adminOnly, async (request) => {
    const { filter, q } = z
      .object({ filter: z.enum(USER_FILTERS).default('ALL'), q: z.string().trim().max(60).optional() })
      .parse(request.query);
    const [users, counts] = await Promise.all([listUsers(filter, q), userCounts()]);
    return ok({ users, counts });
  });

  app.get('/api/admin/users/:id', adminOnly, async (request) => ok(await userDetail(idParam.parse(request.params).id)));

  app.post('/api/admin/users/:id/suspend', adminOnly, async (request) => {
    const { reason } = z.object({ reason: text(300, 'Andika sababu') }).parse(request.body);
    return ok(await suspendUser(request.currentUser.id, idParam.parse(request.params).id, reason));
  });
  app.post('/api/admin/users/:id/reactivate', adminOnly, async (request) =>
    ok(await reactivateUser(request.currentUser.id, idParam.parse(request.params).id)),
  );
  app.post('/api/admin/users/:id/verify-phone', adminOnly, async (request) =>
    ok(await verifyPhoneManually(request.currentUser.id, idParam.parse(request.params).id)),
  );
  app.post('/api/admin/users/:id/temp-password', { ...adminOnly, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request) =>
    ok(await issueTemporaryPassword(request.currentUser.id, idParam.parse(request.params).id)),
  );
  app.post('/api/admin/users/:id/notes', adminOnly, async (request) => {
    const { body } = z.object({ body: text(1000, 'Andika maelezo') }).parse(request.body);
    return ok(await addUserNote(request.currentUser.id, idParam.parse(request.params).id, body));
  });
  app.post('/api/admin/users/:id/message', adminOnly, async (request) => {
    const input = z.object({ body: text(300), sms: z.boolean().default(false) }).parse(request.body);
    return ok(await messageUser(request.currentUser.id, idParam.parse(request.params).id, input));
  });
  app.post('/api/admin/users/:id/offline', adminOnly, async (request) =>
    ok(await forceDriverOffline(request.currentUser.id, idParam.parse(request.params).id)),
  );

  // ------------------------------------------------------------ Ofisi: msaada
  app.get('/api/admin/support', adminOnly, async (request) => {
    const query = z
      .object({
        status: z.enum(['ACTIVE', 'OPEN', 'ANSWERED', 'RESOLVED', 'ALL']).default('ACTIVE'),
        q: z.string().trim().max(60).optional(),
        userId: z.uuid().optional(),
      })
      .parse(request.query);
    return ok(await listTicketsForAdmin(query));
  });
  app.get('/api/admin/support/:id', adminOnly, async (request) => ok(await ticketForAdmin(idParam.parse(request.params).id)));
  app.post('/api/admin/support/:id/reply', adminOnly, async (request) => {
    const input = z
      .object({ body: z.string().trim().max(1000, 'Jibu ni refu mno').default(''), resolve: z.boolean().default(false) })
      .parse(request.body);
    return ok(await replyAsStaff(request.currentUser.id, idParam.parse(request.params).id, input));
  });
  app.post('/api/admin/support/:id/reopen', adminOnly, async (request) =>
    ok(await reopenTicket(request.currentUser.id, idParam.parse(request.params).id)),
  );

  // ------------------------------------------------------------ Ofisi: matangazo
  app.get('/api/admin/broadcasts', adminOnly, async () => {
    const [history, audience] = await Promise.all([listBroadcasts(), audienceSizes()]);
    return ok({ history, ...audience });
  });
  app.post('/api/admin/broadcasts', { ...adminOnly, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const input = z
      .object({
        audience: z.enum(AUDIENCES, { error: 'Chagua wapokeaji' }),
        title: text(80, 'Andika kichwa'),
        body: text(300),
        sms: z.boolean().default(false),
      })
      .parse(request.body);
    return reply.status(201).send(ok(await sendBroadcast(request.currentUser.id, input)));
  });

  // ------------------------------------------------------------ Ofisi: ramani na kuingilia safari
  app.get('/api/admin/live', adminOnly, async () => ok(await liveOverview()));
  app.get('/api/admin/rides/:id/candidates', adminOnly, async (request) => ok(await candidatesForRide(idParam.parse(request.params).id)));
  app.post('/api/admin/rides/:id/offer', adminOnly, async (request) => {
    const { driverId } = z.object({ driverId: z.uuid({ error: 'Chagua dereva' }) }).parse(request.body);
    return ok(await offerRideToDriver(request.currentUser.id, idParam.parse(request.params).id, driverId));
  });
  app.post('/api/admin/rides/:id/complete', adminOnly, async (request) => {
    const { note } = z.object({ note: z.string().trim().max(300).default('') }).parse(request.body ?? {});
    return ok(await completeByAdmin(request.currentUser.id, idParam.parse(request.params).id, note));
  });

  // ------------------------------------------------------------ Ofisi: ripoti na utafutaji
  const daysQuery = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });
  app.get('/api/admin/reports', adminOnly, async (request) => ok(await dailyReport(daysQuery.parse(request.query).days)));
  app.get('/api/admin/reports/rides.csv', adminOnly, async (request, reply) => {
    const { days } = daysQuery.parse(request.query);
    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="naya-safari-siku-${days}-${stamp}.csv"`)
      .header('cache-control', 'no-store')
      .send(await ridesCsv(days));
  });
  app.get('/api/admin/search', adminOnly, async (request) => {
    const { q } = z.object({ q: z.string().trim().max(60).default('') }).parse(request.query);
    return ok(await globalSearch(q));
  });
}
