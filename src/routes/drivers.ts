// /api/drivers — dereva mwenyewe: usajili, chombo, nyaraka, kutuma kwa uthibitisho.
import type { FastifyInstance } from 'fastify';
import { issueToken, requireRole } from '../middleware/auth.js';
import {
  getDriverProfile,
  readDocument,
  registerDriver,
  saveDocument,
  submitForReview,
  updateVehicle,
} from '../services/drivers.js';
import { ALLOWED_MIME_TYPES, MAX_DOCUMENT_BYTES } from '../services/files.js';
import { toPublicUser } from '../services/users.js';
import { badRequest, ok } from '../utils/http.js';
import { registerSchema } from '../validators/auth.js';
import { documentTypeParam, vehicleSchema } from '../validators/drivers.js';

export async function driverRoutes(app: FastifyInstance): Promise<void> {
  // Faili zinatumwa kama bytes tupu (body = picha/PDF yenyewe). Parser hii ipo ndani ya routes za dereva tu.
  app.addContentTypeParser([...ALLOWED_MIME_TYPES], { parseAs: 'buffer', bodyLimit: MAX_DOCUMENT_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  const driverOnly = { preHandler: requireRole('DRIVER') };

  app.post('/api/drivers/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const user = await registerDriver(input);
    request.log.info({ userId: user.id }, 'dereva mpya amejisajili');
    return reply.status(201).send(ok({ token: issueToken(app, user), user: toPublicUser(user) }));
  });

  app.get('/api/drivers/me', driverOnly, async (request) => ok(await getDriverProfile(request.currentUser.id)));

  app.put('/api/drivers/me/vehicle', driverOnly, async (request) => {
    const input = vehicleSchema.parse(request.body);
    return ok(await updateVehicle(request.currentUser.id, input));
  });

  app.put(
    '/api/drivers/me/documents/:type',
    { ...driverOnly, bodyLimit: MAX_DOCUMENT_BYTES, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      const { type } = documentTypeParam.parse(request.params);
      if (!Buffer.isBuffer(request.body)) throw badRequest('Tuma faili la picha (JPG, PNG, WEBP) au PDF.');
      return ok(await saveDocument(request.currentUser.id, type, request.body, request.headers['content-type']));
    },
  );

  app.get('/api/drivers/me/documents/:type/file', driverOnly, async (request, reply) => {
    const { type } = documentTypeParam.parse(request.params);
    const file = await readDocument(request.currentUser.id, type);
    return reply
      .header('content-type', file.mimeType)
      .header('cache-control', 'private, no-store')
      .header('content-disposition', 'inline')
      .send(file.content);
  });

  app.post('/api/drivers/me/submit', driverOnly, async (request) => ok(await submitForReview(request.currentUser.id)));
}
