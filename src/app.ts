// Kujenga NAYA API (bila kuiwasha) — server.ts na tests wanaitumia.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { registerJwt } from './middleware/auth.js';
import { registerErrorHandling } from './middleware/errors.js';
import { accountRoutes } from './routes/account.js';
import { adminDriverRoutes } from './routes/admin-drivers.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { driverRoutes } from './routes/drivers.js';
import { healthRoutes } from './routes/health.js';
import { placeRoutes } from './routes/places.js';
import { pushRoutes } from './routes/push.js';
import { rideRoutes } from './routes/rides.js';
import { safetyRoutes } from './routes/safety.js';
import { subscriptionRoutes } from './routes/subscriptions.js';
import { streamRoutes } from './routes/stream.js';

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
// Ramani (Leaflet) inatolewa na server hii hii — hakuna script ya CDN ya nje.
const LEAFLET_DIR = join(dirname(createRequire(import.meta.url).resolve('leaflet/package.json')), 'dist');

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            serializers: {
              // Tiketi ya realtime iko kwenye URL (EventSource haiwezi kutuma headers) — isiandikwe kwenye logs.
              req: (req) => ({
                method: req.method,
                url: req.url.replace(/([?&]ticket=)[^&]*/g, '$1[siri]'),
                host: req.host,
                remoteAddress: req.ip,
              }),
            },
          },
    trustProxy: true, // Railway iko nyuma ya proxy — IP halisi ya mtumiaji kwa rate limit
    bodyLimit: 1_000_000,
  });

  // Usalama: headers (helmet), CORS (kurasa za NAYA ziko kwenye anwani hii hii, hazihitaji CORS), rate limit.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        // blob: — ofisi na dereva wanaona picha za nyaraka zilizopakuliwa kwa token (si URL za wazi).
        // tile.openstreetmap.org — picha za ramani ya maeneo (ofisi).
        'img-src': ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
        'frame-src': ["'self'", 'blob:'],
      },
    },
  });
  await app.register(cors, { origin: env.corsOrigins.length > 0 ? env.corsOrigins : false });
  // Mitandao ya simu Tanzania huweka watu wengi nyuma ya IP moja (CGNAT). Kwa hiyo mtumiaji aliyeingia anahesabiwa
  // kwa akaunti yake (token iliyothibitishwa), si kwa IP; asiyeingia anahesabiwa kwa IP.
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const header = request.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        try {
          const payload = app.jwt.verify<{ sub?: string }>(header.slice(7));
          if (payload.sub) return `user:${payload.sub}`;
        } catch {
          // token mbaya → hesabu kwa IP
        }
      }
      return `ip:${request.ip}`;
    },
  });
  await registerJwt(app);
  registerErrorHandling(app);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(adminDriverRoutes);
  await app.register(accountRoutes);
  await app.register(driverRoutes);
  await app.register(placeRoutes);
  await app.register(rideRoutes);
  await app.register(streamRoutes);
  await app.register(pushRoutes);
  await app.register(subscriptionRoutes);
  await app.register(safetyRoutes);

  // Kurasa za NAYA: /app/ (app moja ya abiria na dereva) na /admin/ (ofisi).
  await app.register(fastifyStatic, { root: FRONTEND_DIR, prefix: '/', index: ['index.html'] });
  await app.register(fastifyStatic, { root: LEAFLET_DIR, prefix: '/vendor/leaflet/', decorateReply: false });
  app.get('/admin', async (_request, reply) => reply.redirect('/admin/'));
  app.get('/app', async (_request, reply) => reply.redirect('/app/'));
  app.get('/safari', async (_request, reply) => reply.redirect('/safari/'));
  // Mwanzo na anwani ya zamani ya app ya dereva → app moja ya NAYA.
  app.get('/', async (_request, reply) => reply.redirect('/app/'));
  app.get('/dereva', async (_request, reply) => reply.redirect('/app/'));
  app.get('/dereva/', async (_request, reply) => reply.redirect('/app/'));

  return app;
}
