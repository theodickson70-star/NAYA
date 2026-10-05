// Kujenga NAYA API (bila kuiwasha) — server.ts na tests wanaitumia.
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
import { adminDriverRoutes } from './routes/admin-drivers.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { driverRoutes } from './routes/drivers.js';
import { healthRoutes } from './routes/health.js';

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend');

export async function buildApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    trustProxy: true, // Railway iko nyuma ya proxy — IP halisi ya mtumiaji kwa rate limit
    bodyLimit: 1_000_000,
  });

  // Usalama: headers (helmet), CORS (kurasa za NAYA ziko kwenye anwani hii hii, hazihitaji CORS), rate limit.
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        // blob: — ofisi na dereva wanaona picha za nyaraka zilizopakuliwa kwa token (si URL za wazi).
        'img-src': ["'self'", 'data:', 'blob:'],
        'frame-src': ["'self'", 'blob:'],
      },
    },
  });
  await app.register(cors, { origin: env.corsOrigins.length > 0 ? env.corsOrigins : false });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await registerJwt(app);
  registerErrorHandling(app);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(adminDriverRoutes);
  await app.register(driverRoutes);

  // Kurasa za NAYA: / (mwanzo), /admin/ (ofisi), /dereva/ (app ya dereva). App ya mteja itaongezwa hapa.
  await app.register(fastifyStatic, { root: FRONTEND_DIR, prefix: '/', index: ['index.html'] });
  app.get('/admin', async (_request, reply) => reply.redirect('/admin/'));
  app.get('/dereva', async (_request, reply) => reply.redirect('/dereva/'));

  return app;
}
