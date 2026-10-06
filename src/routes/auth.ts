// /api/auth — usajili (akaunti moja ya NAYA), kuingia, kutoka, na "mimi ni nani".
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, authenticate, issueToken } from '../middleware/auth.js';
import { login, logout, registerUser } from '../services/auth.js';
import { toPublicUser, type UserRole } from '../services/users.js';
import { ok } from '../utils/http.js';
import { loginSchema, registerSchema } from '../validators/auth.js';

/** Mahali mtu anaingia panaamua roles zinazoruhusiwa: ofisi = admin tu; app ya NAYA = watumiaji tu.
 *  ("driver"/"customer" ni majina ya zamani ya app — yanaelekezwa kwenye app moja.) */
const PORTAL_ROLES: Record<string, UserRole[]> = {
  admin: ADMIN_ROLES,
  app: ['USER'],
  driver: ['USER'],
  customer: ['USER'],
};
const portalSchema = z.object({ portal: z.enum(['admin', 'app', 'driver', 'customer']).optional() });

// Kuzuia kujaribu password nyingi: maombi 10 kwa dakika kwa kila IP.
const authLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', authLimit, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const user = await registerUser(input);
    request.log.info({ userId: user.id }, 'mtumiaji mpya amejisajili');
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
