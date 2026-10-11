// Usalama wa safari.
//   Abiria: POST /api/rides/:id/share            → link ya kumtumia ndugu
//   Umma:   POST /api/share                       → ukurasa wa /safari/ (token iko kwenye body, si kwenye URL)
//   Wote:   POST /api/sos                         → dharura kwa ofisi
//   Ofisi:  GET /api/admin/sos, POST /api/admin/sos/:id/resolve
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import { createShareLink, listSos, raiseSos, resolveSos, viewSharedRide } from '../services/safety.js';
import { ok } from '../utils/http.js';

const idParam = z.object({ id: z.uuid({ error: 'Haikupatikana' }) });
const sosSchema = z.object({
  rideId: z.uuid({ error: 'Safari haikupatikana' }),
  lat: z.number().min(-12.5).max(-0.5).optional(),
  lng: z.number().min(29).max(41).optional(),
});

export async function safetyRoutes(app: FastifyInstance): Promise<void> {
  const user = { preHandler: requireRole('USER') };
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };

  app.post('/api/rides/:id/share', { ...user, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request) => {
    const { id } = idParam.parse(request.params);
    return ok(await createShareLink(request.currentUser.id, id));
  });

  app.post('/api/share', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { token } = z.object({ token: z.string().max(64) }).parse(request.body ?? {});
    reply.header('cache-control', 'no-store');
    return ok(await viewSharedRide(token));
  });

  app.post('/api/sos', { ...user, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const result = await raiseSos(request.currentUser.id, sosSchema.parse(request.body));
    request.log.warn({ userId: request.currentUser.id }, 'DHARURA imetumwa');
    return reply.status(result.alreadyOpen ? 200 : 201).send(ok(result));
  });

  app.get('/api/admin/sos', adminOnly, async (request) => {
    const { scope } = z.object({ scope: z.enum(['open', 'all']).default('open') }).parse(request.query);
    return ok(await listSos(scope));
  });

  app.post('/api/admin/sos/:id/resolve', adminOnly, async (request) => {
    const { id } = idParam.parse(request.params);
    const { note } = z
      .object({ note: z.string({ error: 'Andika hatua uliyochukua' }).trim().min(3, 'Andika hatua uliyochukua').max(500, 'Maelezo ni marefu mno') })
      .parse(request.body);
    return ok(await resolveSos(request.currentUser.id, id, note));
  });
}
