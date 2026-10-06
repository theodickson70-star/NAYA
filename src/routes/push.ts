// /api/push — usajili wa Web Push; /api/notifications — arifa za mtumiaji.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { listNotifications, markNotificationsRead } from '../services/notify.js';
import { publicKey, removeSubscription, saveSubscription } from '../services/push.js';
import { badRequest, ok } from '../utils/http.js';

const subscriptionSchema = z.object({
  endpoint: z.url({ error: 'Usajili wa arifa si sahihi' }).max(2000).refine((u) => u.startsWith('https://'), 'Usajili wa arifa si sahihi'),
  keys: z.object({
    p256dh: z.string().min(20).max(200),
    auth: z.string().min(8).max(100),
  }),
});

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  const signedIn = { preHandler: authenticate };

  /** Ufunguo wa umma wa VAPID (null = arifa za Web Push hazijawashwa kwenye server). */
  app.get('/api/push/public-key', async () => ok({ publicKey: publicKey() }));

  app.post('/api/push/subscribe', signedIn, async (request) => {
    if (!publicKey()) throw badRequest('Arifa bado hazijawashwa kwenye server ya NAYA.');
    const sub = subscriptionSchema.parse(request.body);
    await saveSubscription(request.currentUser.id, sub, request.headers['user-agent']);
    return ok({ subscribed: true });
  });

  app.post('/api/push/unsubscribe', signedIn, async (request) => {
    const { endpoint } = z.object({ endpoint: z.string().max(2000) }).parse(request.body);
    await removeSubscription(request.currentUser.id, endpoint);
    return ok({ subscribed: false });
  });

  app.get('/api/notifications', signedIn, async (request) => ok(await listNotifications(request.currentUser.id)));
  app.post('/api/notifications/read', signedIn, async (request) => {
    await markNotificationsRead(request.currentUser.id);
    return ok({ read: true });
  });
}
