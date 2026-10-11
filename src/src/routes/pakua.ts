// Ukurasa wa kupakua app ya NAYA (APK). Link kuu ya NAYA ("/") inaleta hapa.
//   GET /pakua/        → ukurasa (frontend/pakua)
//   GET /pakua/apk     → tunahesabu kupakua, kisha tunampeleka kwenye APK ya toleo jipya zaidi
//   GET /pakua/qr.svg  → QR code ya ukurasa huu (kwa wanaofungua kwenye kompyuta)
//   GET /api/pakua     → ukubwa wa APK na kima cha chini cha Android (kwa kitufe)
import type { FastifyInstance, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { env } from '../config/env.js';
import { db, one } from '../db/pool.js';
import { ok } from '../utils/http.js';

/** Toleo jipya zaidi la APK kwenye GitHub Releases (repo ya NAYA ni public). ANDROID_APK_URL ikiwekwa, inatumika hiyo. */
export const DEFAULT_APK_URL = 'https://github.com/theodickson70-star/NAYA/releases/latest/download/NAYA.apk';
export const apkUrl = () => env.androidApkUrl ?? DEFAULT_APK_URL;

const platformOf = (request: FastifyRequest): 'android' | 'ios' | 'other' => {
  const ua = String(request.headers['user-agent'] ?? '');
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'other';
};

let sizeCache: { at: number; bytes: number | null } = { at: 0, bytes: null };
async function apkSize(): Promise<number | null> {
  if (Date.now() - sizeCache.at < 6 * 3600_000) return sizeCache.bytes;
  sizeCache = { at: Date.now(), bytes: sizeCache.bytes };
  try {
    const res = await fetch(apkUrl(), { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) });
    const n = Number(res.headers.get('content-length'));
    if (res.ok && n > 0) sizeCache.bytes = n;
  } catch {
    // GitHub haifikiki sasa hivi — kitufe kinaonyeshwa bila ukubwa
  }
  return sizeCache.bytes;
}

export async function downloadStats() {
  const row = await one<{ today: number; week: number; total: number }>(
    db,
    `SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Africa/Dar_es_Salaam') AT TIME ZONE 'Africa/Dar_es_Salaam')::int AS today,
            count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week,
            count(*)::int AS total
       FROM naya.app_downloads WHERE platform = 'android'`,
  );
  return row ?? { today: 0, week: 0, total: 0 };
}

export async function pakuaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/pakua', async (_request, reply) => reply.redirect('/pakua/'));

  app.get('/api/pakua', async () => {
    const bytes = await apkSize();
    return ok({ apk: '/pakua/apk', sizeMb: bytes ? Math.round((bytes / 1048576) * 10) / 10 : null, minAndroid: '7.0' });
  });

  app.get('/pakua/apk', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (request, reply) => {
    try {
      await db.query('INSERT INTO naya.app_downloads (platform) VALUES ($1)', [platformOf(request)]);
    } catch (error) {
      request.log.warn({ err: error }, 'kuhesabu upakuaji kumeshindwa');
    }
    return reply.header('cache-control', 'no-store').redirect(apkUrl(), 302);
  });

  app.get('/pakua/qr.svg', async (request, reply) => {
    const host = String(request.headers['x-forwarded-host'] ?? request.headers.host ?? 'localhost');
    const proto = String(request.headers['x-forwarded-proto'] ?? request.protocol ?? 'https').split(',')[0];
    const svg = await QRCode.toString(`${proto}://${host}/pakua/`, { type: 'svg', margin: 1, color: { dark: '#06301C', light: '#FFFFFF' } });
    return reply.header('content-type', 'image/svg+xml').header('cache-control', 'public, max-age=3600').send(svg);
  });
}
