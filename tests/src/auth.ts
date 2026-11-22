// Kuingia: password (bcrypt), vikao (cookie httpOnly + hash kwenye DB), CSRF kwa kila fomu.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db, one } from './db.js';
import { AppError } from './errors.js';

export type SessionUser = {
  id: string;
  biashara_id: string;
  duka_id: string | null;
  jina: string;
  username: string;
  role: 'owner' | 'agent';
  lazima_abadilishe_password: boolean;
  biashara_jina: string;
  duka_jina: string | null;
};
export type Flash = { aina: 'sawa' | 'kosa' | 'tahadhari'; ujumbe: string };

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    sessionHash: string | null;
    csrf: string;
    flash: Flash | null;
    unread: number;
  }
}

export const COOKIE = 'pp_sid';
export const PRE_COOKIE = 'pp_pre';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('base64url');

export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const checkPassword = (p: string, h: string) => bcrypt.compare(p, h);

function cookieOpts(maxAgeSec: number) {
  return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: config.cookieSecure, maxAge: maxAgeSec };
}

export async function startSession(reply: FastifyReply, userId: string, req: FastifyRequest): Promise<void> {
  const t = token();
  await db.query(
    `INSERT INTO paypoint.vikao (token_hash, mtumiaji_id, csrf, ip, kifaa, inaisha)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6))`,
    [sha256(t), userId, token(), req.ip, (req.headers['user-agent'] ?? '').slice(0, 200), config.sessionDays],
  );
  reply.setCookie(COOKIE, t, cookieOpts(config.sessionDays * 86400));
}

export async function endSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.sessionHash) await db.query('DELETE FROM paypoint.vikao WHERE token_hash = $1', [req.sessionHash]);
  reply.clearCookie(COOKIE, { path: '/' });
}

export async function endAllSessions(userId: string): Promise<void> {
  await db.query('DELETE FROM paypoint.vikao WHERE mtumiaji_id = $1', [userId]);
}

/** Inasoma kikao kutoka cookie (kila ombi lisilo la faili za static). */
export async function loadSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  req.user = null;
  req.sessionHash = null;
  req.flash = null;
  req.csrf = '';
  const t = req.cookies[COOKIE];
  if (t) {
    const h = sha256(t);
    const row = await one<SessionUser & { csrf: string; ujumbe: Flash | null; renew: boolean }>(
      db,
      `SELECT u.id, u.biashara_id, u.duka_id, u.jina, u.username, u.role, u.lazima_abadilishe_password,
              b.jina AS biashara_jina, d.jina AS duka_jina, v.csrf, v.ujumbe,
              v.inaisha < now() + interval '6 days' AS renew
         FROM paypoint.vikao v
         JOIN paypoint.watumiaji u ON u.id = v.mtumiaji_id AND u.active
         JOIN paypoint.biashara b ON b.id = u.biashara_id
         LEFT JOIN paypoint.maduka d ON d.id = u.duka_id
        WHERE v.token_hash = $1 AND v.inaisha > now()`,
      [h],
    );
    if (row) {
      const { csrf, ujumbe, renew, ...user } = row;
      req.user = user;
      req.sessionHash = h;
      req.csrf = csrf;
      if (ujumbe) {
        req.flash = ujumbe;
        await db.query('UPDATE paypoint.vikao SET ujumbe = NULL WHERE token_hash = $1', [h]);
      }
      if (renew) {
        await db.query(
          `UPDATE paypoint.vikao SET inaisha = now() + make_interval(days => $2) WHERE token_hash = $1`,
          [h, config.sessionDays],
        );
        reply.setCookie(COOKIE, t, cookieOpts(config.sessionDays * 86400));
      }
    } else {
      reply.clearCookie(COOKIE, { path: '/' });
    }
  }
  if (!req.user) {
    // Kwa fomu za kuingia/kusajili (kabla ya kikao): CSRF kwa cookie ya muda
    let pre = req.cookies[PRE_COOKIE];
    if (!pre || pre.length < 40) {
      pre = token();
      reply.setCookie(PRE_COOKIE, pre, cookieOpts(3600 * 6));
    }
    req.csrf = pre;
  }
}

export function checkCsrf(req: FastifyRequest): void {
  const sent = String((req.body as Record<string, unknown> | undefined)?._csrf ?? '');
  const a = Buffer.from(sent);
  const b = Buffer.from(req.csrf);
  if (!req.csrf || a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('Fomu imeisha muda. Fungua ukurasa upya kisha ujaribu tena.', 403);
  }
}

export async function setFlash(req: FastifyRequest, aina: Flash['aina'], ujumbe: string): Promise<void> {
  if (!req.sessionHash) return;
  await db.query('UPDATE paypoint.vikao SET ujumbe = $2 WHERE token_hash = $1', [req.sessionHash, JSON.stringify({ aina, ujumbe })]);
}

/** Ruhusa za kurasa */
export function needUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new AppError('LOGIN', 401);
  return req.user;
}
export function needOwner(req: FastifyRequest): SessionUser {
  const u = needUser(req);
  if (u.role !== 'owner') throw new AppError('Ukurasa huu ni wa mmiliki pekee', 403);
  return u;
}
export function needAgent(req: FastifyRequest): SessionUser & { duka_id: string } {
  const u = needUser(req);
  if (u.role !== 'agent') throw new AppError('Miamala inafanywa na mfanyakazi wa duka', 403);
  if (!u.duka_id) throw new AppError('Hujapangiwa duka. Mwombe mmiliki akupangie duka kwanza.', 403);
  return u as SessionUser & { duka_id: string };
}
