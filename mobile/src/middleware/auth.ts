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
  purpose?: 'stream'; // tiketi ya muda mfupi ya /api/stream — HAIRUHUSIWI kama token ya kawaida
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
  if (payload.purpose) throw unauthorized('Token si sahihi. Ingia tena.');
  const user = await findUserById(db, payload.sub);
  if (!user || user.token_version !== payload.tv) throw unauthorized('Umetoka. Ingia tena.');
  if (user.status !== 'ACTIVE') throw forbidden('Akaunti hii imesimamishwa. Wasiliana na NAYA.');
  request.currentUser = user;
  // Lugha ya app ya mtumiaji (kichwa x-naya-lang): ihifadhiwe ili arifa na SMS zimfikie kwa lugha hiyo.
  const lang = request.headers['x-naya-lang'];
  if ((lang === 'en' || lang === 'sw') && user.language && lang !== user.language && user.role === 'USER') {
    await db.query('UPDATE naya.users SET language = $2 WHERE id = $1', [user.id, lang]);
    user.language = lang;
  }
  // APK au link? (kwa ripoti za ofisi) — tunaandika tu ikibadilika au baada ya dakika 10, si kila ombi.
  if (user.role === 'USER') await rememberClient(user, request.headers['x-naya-client']);
}

async function rememberClient(user: UserRow, header: unknown) {
  const raw = String(header ?? '');
  const client = raw === 'apk' || raw.startsWith('android-') ? 'apk' : raw === 'web' ? 'web' : null;
  if (!client) return;
  const seen = user.app_seen_at ? new Date(user.app_seen_at).getTime() : 0;
  if (client === user.app_client && Date.now() - seen < 10 * 60_000) return;
  try {
    await db.query(
      `UPDATE naya.users SET app_client = $2::varchar, app_seen_at = now(),
              apk_since = CASE WHEN $3::boolean THEN coalesce(apk_since, now()) ELSE apk_since END
        WHERE id = $1`,
      [user.id, client, client === 'apk'],
    );
    user.app_client = client;
    user.app_seen_at = new Date();
  } catch (error) {
    // si muhimu kwa ombi lenyewe
    console.error(`[auth] app_client: ${(error as Error).message}`);
  }
}

/** Lazima awe ameingia NA awe na moja ya roles hizi. */
export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply);
    if (!roles.includes(request.currentUser.role)) throw forbidden();
  };
}

export const ADMIN_ROLES: UserRole[] = ['ADMIN', 'SUPER_ADMIN'];

/** Tiketi ya sekunde 60 ya kufungua /api/stream (EventSource haiwezi kutuma header ya Authorization). */
export function issueStreamTicket(app: FastifyInstance, user: UserRow): string {
  return app.jwt.sign({ sub: user.id, role: user.role, tv: user.token_version, purpose: 'stream' }, { expiresIn: '60s' });
}

/** Hakiki tiketi ya stream: sahihi, ya kusudi la stream, na mtumiaji bado yuko hai (hajatoka wala kusimamishwa). */
export async function verifyStreamTicket(app: FastifyInstance, ticket: string): Promise<UserRow> {
  let payload: TokenPayload;
  try {
    payload = app.jwt.verify<TokenPayload>(ticket);
  } catch {
    throw unauthorized('Tiketi ya taarifa za papo hapo imeisha muda.');
  }
  if (payload.purpose !== 'stream') throw unauthorized('Tiketi si sahihi.');
  const user = await findUserById(db, payload.sub);
  if (!user || user.token_version !== payload.tv) throw unauthorized('Umetoka. Ingia tena.');
  if (user.status !== 'ACTIVE') throw forbidden('Akaunti hii imesimamishwa.');
  return user;
}
