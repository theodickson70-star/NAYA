// Makosa yote yanarudi kwa muundo mmoja: { success: false, message }.
// Makosa ya ndani (500) yanaandikwa kamili kwenye log ya server, lakini mtumiaji anapata ujumbe wa jumla tu
// — kamwe stack trace, SQL wala siri.
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../utils/http.js';

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode === 401) request.log.warn({ url: request.url.split('?')[0] }, 'auth imeshindwa');
      return reply.status(error.statusCode).send({ success: false, message: error.message });
    }
    if (error instanceof ZodError) {
      const message = error.issues.map((i) => i.message).join('. ');
      return reply.status(400).send({ success: false, message });
    }
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if (statusCode === 429) {
      return reply.status(429).send({ success: false, message: 'Maombi mengi mno. Subiri kidogo kisha ujaribu tena.' });
    }
    if (statusCode === 413) {
      return reply.status(413).send({ success: false, message: 'Faili ni kubwa mno (mwisho MB 3)' });
    }
    if (statusCode === 415) {
      return reply
        .status(415)
        .send({ success: false, message: 'Aina ya faili hairuhusiwi. Tuma picha (JPG, PNG, WEBP) au PDF.' });
    }
    if (statusCode < 500) {
      return reply.status(statusCode).send({ success: false, message: 'Ombi si sahihi' });
    }
    request.log.error(error);
    return reply.status(500).send({ success: false, message: 'Hitilafu ya mfumo. Jaribu tena baadaye.' });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ success: false, message: `Njia ${request.method} ${request.url.split('?')[0]} haipo` }),
  );
}
