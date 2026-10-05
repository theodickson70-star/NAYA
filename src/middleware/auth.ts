// JWT + roles. Kila request iliyolindwa inahakiki token NA hali ya sasa ya mtumiaji kwenye database,
// ili kusimamishwa (SUSPENDED) au logout vianze kufanya kazi papo hapo.
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { db } from '../db/pool.js';
import { findUserById, type UserRole, type UserRow } from '../services/users.js';
import { forbidden, unauthorized } from '../utils/http.js';

interface TokenPayload {
  sub: string;
  role: UserRole;
  tv: number; // token_version wakati token ilipotolewa
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: UserRow;
  }
}

export async function registerJwt(app: FastifyInstance): Promise<void> {
  await app.register(fastifyJwt, { secret: env.jwtSecret, sign: { expiresIn: env.jwtExpiresIn } });
  app.decorateRequest('currentUser', null as unknown as UserRow);
}

export function issueToken(app: FastifyInstance, user: UserRow): string {
  return app.jwt.sign({ sub: user.id, role: user.role, tv: user.token_version });
}

/** Lazima awe ameingia. */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  let payload: TokenPayload;
  try {
    payload = await request.jwtVerify<TokenPayload>();
  } catch {
    throw unauthorized('Muda wa kuingia umeisha au token si sahihi. Ingia tena.');
  }
  const user = await findUserById(db, payload.sub);
  if (!user || user.token_version !== payload.tv) throw unauthorized('Umetoka. Ingia tena.');
  if (user.status !== 'ACTIVE') throw forbidden('Akaunti hii imesimamishwa. Wasiliana na NAYA.');
  request.currentUser = user;
}

/** Lazima awe ameingia NA awe na moja ya roles hizi. */
export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    if (!roles.includes(request.currentUser.role)) throw forbidden();
  };
}

export const ADMIN_ROLES: UserRole[] = ['ADMIN', 'SUPER_ADMIN'];
