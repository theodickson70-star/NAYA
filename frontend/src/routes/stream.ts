// /api/stream — taarifa za papo hapo kwa Server-Sent Events.
//   1. POST /api/stream/ticket  (na token ya kawaida)  → tiketi ya sekunde 60
//   2. GET  /api/stream?ticket=…                       → muunganisho unaobaki wazi; matukio: ride, offer, driver, account, admin
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, authenticate, issueStreamTicket, verifyStreamTicket } from '../middleware/auth.js';
import { addClient, closeAllClients } from '../realtime/hub.js';
import { ok } from '../utils/http.js';

const KEEPALIVE_MS = 25_000; // chini ya muda ambao proxy (Railway) hufunga muunganisho usio na shughuli

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onClose', async () => closeAllClients());
  app.post('/api/stream/ticket', { preHandler: authenticate }, async (request) =>
    ok({ ticket: issueStreamTicket(app, request.currentUser), expiresIn: 60 }),
  );

  app.get('/api/stream', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { ticket } = z.object({ ticket: z.string().min(10).max(2000) }).parse(request.query);
    const user = await verifyStreamTicket(app, ticket);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    res.write('retry: 5000\n\n');
    send('ready', { userId: user.id });

    const keepalive = setInterval(() => res.write(': ping\n\n'), KEEPALIVE_MS);
    const remove = addClient({
      userId: user.id,
      admin: ADMIN_ROLES.includes(user.role),
      send,
      end: () => {
        clearInterval(keepalive);
        res.end();
      },
    });
    const close = () => {
      clearInterval(keepalive);
      remove();
    };
    request.raw.on('close', close);
    res.on('error', close);
  });
}
