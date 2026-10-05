// Urambo Ride API — hatua 1: server inawaka na inaongea na Supabase.
import Fastify from 'fastify';
import { config } from './config.js';
import { dashboardHtml } from './dashboard.js';
import { checkDatabase, db } from './db.js';

const app = Fastify({ logger: true });

// Dashboard ndogo: hali ya API na Supabase.
app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(dashboardHtml));

app.get('/health', async (_request, reply) => {
  const database = await checkDatabase();
  const ok = database === 'ok';
  if (!ok) app.log.error(`[health] database: ${database}`);
  return reply.status(ok ? 200 : 503).send({ ok, database: ok ? 'ok' : 'error', time: new Date().toISOString() });
});

await app.listen({ port: config.port, host: '0.0.0.0' });

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
