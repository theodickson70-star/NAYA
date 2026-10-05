// /api/auth — usajili wa mteja, kuingia, kutoka, na "mimi ni nani".
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, authenticate, issueToken } from '../middleware/auth.js';
import { login, logout, registerCustomer } from '../services/auth.js';
import { toPublicUser, type UserRole } from '../services/users.js';
import { ok } from '../utils/http.js';
import { loginSchema, registerSchema } from '../validators/auth.js';

/** Ukurasa unaoingia unaamua roles zinazoruhusiwa (mf. dashboard ya admin = admin tu). */
const PORTAL_ROLES: Record<string, UserRole[]> = {
  admin: ADMIN_ROLES,
  driver: ['DRIVER'],
  customer: ['CUSTOMER'],
};
const portalSchema = z.object({ portal: z.enum(['admin', 'driver', 'customer']).optional() });

// Kuzuia kujaribu password nyingi: maombi 10 kwa dakika kwa kila IP.
const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', authLimit, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const user = await registerCustomer(input);
    request.log.info({ userId: user.id }, 'mteja mpya amejisajili');
    return reply.status(201).send(ok({ token: issueToken(app, user), user: toPublicUser(user) }));
  });

  app.post('/api/auth/login', authLimit, async (request) => {
    const input = loginSchema.parse(request.body);
    const { portal } = portalSchema.parse(request.body);
    const user = await login(input, portal ? PORTAL_ROLES[portal] : undefined);
    return ok({ token: issueToken(app, user), user: toPublicUser(user) });
  });

  /** Inatoa vifaa VYOTE vya mtumiaji huyu (tokens zote za zamani zinakufa). */
  app.post('/api/auth/logout', { preHandler: authenticate }, async (request) => {
    await logout(request.currentUser.id);
    return ok({ loggedOut: true });
  });

  app.get('/api/auth/me', { preHandler: authenticate }, async (request) => ok(toPublicUser(request.currentUser)));
}
