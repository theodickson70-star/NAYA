// GET /health — Railway inaitumia kuhakikisha NAYA iko hai. 200 = sawa, 503 = database haipatikani.
import type { FastifyInstance } from 'fastify';
import { checkDatabase } from '../db/pool.js';
import { VERSION } from '../version.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { config: { rateLimit: false } }, async (_request, reply) => {
    const database = await checkDatabase();
    const ok = database === 'ok';
    if (!ok) app.log.error(`[health] database: ${database}`);
    return reply.status(ok ? 200 : 503).send({
      success: ok,
      status: ok ? 'ok' : 'down',
      database: ok ? 'ok' : 'error',
      version: VERSION,
      time: new Date().toISOString(),
    });
  });
}
