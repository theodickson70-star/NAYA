// /api/account — akaunti ya mtumiaji wa app ya NAYA na mode yake (Abiria ↔ Dereva).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { issueToken, requireRole } from '../middleware/auth.js';
import { changePassword } from '../services/auth.js';
import { passwordSchema } from '../validators/auth.js';
import { getAccount, setMode } from '../services/account.js';
import { acceptCurrentTerms } from '../services/terms.js';
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

  /** Kukubali masharti ya sasa (watumiaji wa zamani au toleo jipya). driver=true → pia masharti ya dereva. */
  app.post('/api/account/terms', userOnly, async (request) => {
    const { accept, driver } = z
      .object({
        accept: z.literal(true, { error: 'Weka alama kukubali masharti' }),
        driver: z.boolean().default(false),
      })
      .parse(request.body);
    void accept;
    return ok(await acceptCurrentTerms(request.currentUser.id, driver));
  });

  /** Kubadilisha password: vifaa vingine vyote vinatolewa; kifaa hiki kinapata token mpya. */
  app.post('/api/account/password', { ...userOnly, config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request) => {
    const input = z
      .object({ currentPassword: z.string({ error: 'Weka password ya sasa' }).min(1, 'Weka password ya sasa').max(128), newPassword: passwordSchema })
      .parse(request.body);
    const user = await changePassword(request.currentUser.id, input.currentPassword, input.newPassword);
    return ok({ token: issueToken(app, user) });
  });
}
