// /api/account — akaunti ya mtumiaji wa app ya NAYA na mode yake (Abiria ↔ Dereva).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import { getAccount, setMode } from '../services/account.js';
import { ok } from '../utils/http.js';

const modeSchema = z.object({
  mode: z.enum(['PASSENGER', 'DRIVER'], { error: 'Chagua: Abiria au Dereva' }),
});

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  const userOnly = { preHandler: requireRole('USER') };

  app.get('/api/account', userOnly, async (request) => ok(await getAccount(request.currentUser)));

  app.put('/api/account/mode', userOnly, async (request) => {
    const { mode } = modeSchema.parse(request.body);
    const account = await setMode(request.currentUser.id, mode);
    request.log.info({ userId: request.currentUser.id, mode }, 'mode imebadilishwa');
    return ok(account);
  });
}
