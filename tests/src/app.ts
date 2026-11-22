import { join } from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fstatic from '@fastify/static';
import { checkCsrf, loadSession } from './auth.js';
import { config } from './config.js';
import { db } from './db.js';
import { AppError } from './errors.js';
import { errorPage } from './views/layout.js';
import { authRoutes } from './routes/auth.js';
import { homeRoutes } from './routes/home.js';
import { txRoutes } from './routes/tx.js';
import { customerRoutes } from './routes/customers.js';
import { staffRoutes } from './routes/staff.js';
import { floatRoutes } from './routes/float.js';
import { dukaRoutes } from './routes/maduka.js';
import { settingsRoutes } from './routes/settings.js';
import { reportRoutes } from './routes/reports.js';

const PUBLIC = new Set(['/ingia', '/sajili', '/afya']);

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 64 * 1024 });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.cookieSecure ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(formbody);
  await app.register(rateLimit, { global: false });
  await app.register(fstatic, {
    root: join(process.cwd(), 'public'),
    prefix: '/static/',
    maxAge: config.isProd ? '7d' : 0,
  });

  app.decorateRequest('user', null);
  app.decorateRequest('sessionHash', null);
  app.decorateRequest('csrf', '');
  app.decorateRequest('flash', null);
  app.decorateRequest('unread', 0);

  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/static/') || req.url === '/afya') return;
    await loadSession(req, reply);
    const path = req.url.split('?')[0];
    if (!req.user && !PUBLIC.has(path) && !path.startsWith('/sajili')) {
      return reply.redirect(req.method === 'GET' ? `/ingia${path !== '/' ? `?rudi=${encodeURIComponent(req.url)}` : ''}` : '/ingia');
    }
    if (req.user?.lazima_abadilishe_password && !['/akaunti', '/toka'].includes(path)) {
      return reply.redirect('/akaunti');
    }
    if (req.user?.role === 'owner' && req.method === 'GET') {
      const r = await db.query('SELECT COUNT(*)::int AS n FROM paypoint.arifa WHERE biashara_id = $1 AND NOT imesomwa', [req.user.biashara_id]);
      req.unread = r.rows[0].n;
    }
  });

  // Kila fomu (POST) lazima iwe na CSRF token sahihi
  app.addHook('preHandler', async (req) => {
    if (req.method === 'POST') checkCsrf(req);
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, req: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof AppError) {
      if (error.status === 401) return reply.redirect('/ingia');
      return reply.status(error.status).type('text/html').send(errorPage(req, error.status, error.message));
    }
    if (error.statusCode === 429) {
      return reply.status(429).type('text/html').send(errorPage(req, 429, 'Majaribio mengi mno. Subiri dakika chache kisha ujaribu tena.'));
    }
    req.log.error(error);
    console.error(`[hitilafu] ${req.method} ${req.url}: ${error.message}`);
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    return reply
      .status(status)
      .type('text/html')
      .send(errorPage(req, status, status === 500 ? 'Kuna hitilafu kwenye mfumo. Jaribu tena baadaye.' : 'Ombi si sahihi.'));
  });

  app.setNotFoundHandler((req, reply) => reply.status(404).type('text/html').send(errorPage(req, 404, 'Ukurasa huu haupo.')));

  app.get('/afya', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  // Majina ya kurasa kama kwenye prompt ya PayPoint
  app.get('/sajili_duka', async (_q, r) => r.redirect('/sajili'));
  app.get('/mteja', async (_q, r) => r.redirect('/wateja'));
  app.get('/mfanyakazi/ongeza', async (_q, r) => r.redirect('/wafanyakazi/ongeza'));

  await app.register(authRoutes);
  await app.register(homeRoutes);
  await app.register(txRoutes);
  await app.register(customerRoutes);
  await app.register(staffRoutes);
  await app.register(floatRoutes);
  await app.register(dukaRoutes);
  await app.register(settingsRoutes);
  await app.register(reportRoutes);
  return app;
}
