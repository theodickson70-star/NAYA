// /api/drivers/me — mtumiaji aliye kwenye mode ya Dereva: chombo, nyaraka, kutuma kwa uthibitisho.
// Akaunti ni ile ile ya abiria (hakuna usajili wa pili); ombi la udereva linafunguliwa kupitia /api/account/mode.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../middleware/auth.js';
import {
  getDriverProfile,
  readDocument,
  saveDocument,
  submitForReview,
  updateVehicle,
} from '../services/drivers.js';
import { ALLOWED_MIME_TYPES, MAX_DOCUMENT_BYTES } from '../services/files.js';
import { badRequest, ok } from '../utils/http.js';
import { documentTypeParam, vehicleSchema } from '../validators/drivers.js';

export async function driverRoutes(app: FastifyInstance): Promise<void> {
  // Faili zinatumwa kama bytes tupu (body = picha/PDF yenyewe). Parser hii ipo ndani ya routes za dereva tu.
  app.addContentTypeParser([...ALLOWED_MIME_TYPES], { parseAs: 'buffer', bodyLimit: MAX_DOCUMENT_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  // Mtumiaji wa app; kama hajaomba kuwa dereva, huduma inajibu 404 yenye maelezo.
  const driverOnly = { preHandler: requireRole('USER') };

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

  app.post('/api/drivers/me/submit', driverOnly, async (request) => {
    z.object({
      acceptDriverTerms: z.literal(true, { error: 'Weka alama kukubali Masharti ya Dereva kwanza' }),
    }).parse(request.body ?? {});
    return ok(await submitForReview(request.currentUser.id));
  });
}
