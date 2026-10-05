// Muundo mmoja wa majibu ya API:
//   mafanikio: { "success": true, "data": ... }
//   kosa:      { "success": false, "message": "Maelezo ya kosa" }

export const ok = <T>(data: T) => ({ success: true as const, data });

/** Kosa linalotarajiwa — ujumbe wake unaonyeshwa kwa mtumiaji. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string) => new AppError(400, message);
export const unauthorized = (message = 'Tafadhali ingia kwanza') => new AppError(401, message);
export const forbidden = (message = 'Huna ruhusa ya kufanya hili') => new AppError(403, message);
export const notFound = (message = 'Haikupatikana') => new AppError(404, message);
export const conflict = (message: string) => new AppError(409, message);

/** Kosa la PostgreSQL la "unique violation" (mf. namba ya simu tayari imesajiliwa). */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string })?.code === '23505';
}
