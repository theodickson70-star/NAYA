// Wasifu wa mtumiaji (0.15.0):
//   GET  /api/account/profile               → jina, simu, picha?, mtu wa dharura, takwimu
//   PUT  /api/account/profile               → { fullName }
//   PUT  /api/account/emergency             → { name, phone } | POST /api/account/emergency/delete
//   PUT  /api/account/photo  (body = picha)  · POST /api/account/photo/delete · GET /api/account/photo
//   GET  /api/driver/rides/:id/passenger-photo  → dereva aliyepewa ombi / dereva wa safari tu
//   GET  /api/admin/users/:id/photo             → ofisi
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ADMIN_ROLES, requireRole } from '../middleware/auth.js';
import { MAX_DOCUMENT_BYTES } from '../services/files.js';
import {
  deletePhoto,
  getProfile,
  passengerPhotoForDriver,
  readUserPhoto,
  savePhoto,
  setEmergencyContact,
  updateProfile,
} from '../services/profile.js';
import { badRequest, ok } from '../utils/http.js';

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const idParam = z.object({ id: z.uuid({ error: 'Haikupatikana' }) });

const profileSchema = z.object({
  fullName: z.string({ error: 'Weka jina kamili' }).trim().min(3, 'Jina liwe na angalau herufi 3').max(120, 'Jina ni refu mno'),
});
const emergencySchema = z.object({
  name: z.string({ error: 'Weka jina la mtu wa dharura' }).trim().min(2, 'Weka jina la mtu wa dharura').max(80, 'Jina ni refu mno'),
  phone: z.string({ error: 'Weka namba ya simu' }).trim().min(9, 'Weka namba ya simu').max(20),
});

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  // Picha inatumwa kama bytes tupu (body = picha yenyewe), kama nyaraka za dereva.
  app.addContentTypeParser(PHOTO_TYPES, { parseAs: 'buffer', bodyLimit: MAX_DOCUMENT_BYTES }, (_req, body, done) => done(null, body));

  const user = { preHandler: requireRole('USER') };
  const adminOnly = { preHandler: requireRole(...ADMIN_ROLES) };
  const uid = (request: { currentUser: { id: string } }) => request.currentUser.id;
  const sendPhoto = (reply: import('fastify').FastifyReply, file: { content: Buffer; mimeType: string }) =>
    reply.header('content-type', file.mimeType).header('cache-control', 'private, max-age=300').header('content-disposition', 'inline').send(file.content);

  app.get('/api/account/profile', user, async (request) => ok(await getProfile(uid(request))));
  app.put('/api/account/profile', user, async (request) => ok(await updateProfile(uid(request), profileSchema.parse(request.body))));
  app.put('/api/account/emergency', user, async (request) => ok(await setEmergencyContact(uid(request), emergencySchema.parse(request.body))));
  app.post('/api/account/emergency/delete', user, async (request) => ok(await setEmergencyContact(uid(request), null)));

  app.put('/api/account/photo', { ...user, bodyLimit: MAX_DOCUMENT_BYTES, config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (request) => {
    if (!Buffer.isBuffer(request.body)) throw badRequest('Chagua picha (JPG, PNG au WEBP).');
    return ok(await savePhoto(uid(request), request.body, request.headers['content-type']));
  });
  app.post('/api/account/photo/delete', user, async (request) => ok(await deletePhoto(uid(request))));
  app.get('/api/account/photo', user, async (request, reply) => sendPhoto(reply, await readUserPhoto(uid(request))));

  app.get('/api/driver/rides/:id/passenger-photo', user, async (request, reply) =>
    sendPhoto(reply, await passengerPhotoForDriver(uid(request), idParam.parse(request.params).id)),
  );
  app.get('/api/admin/users/:id/photo', adminOnly, async (request, reply) => sendPhoto(reply, await readUserPhoto(idParam.parse(request.params).id)));
}
