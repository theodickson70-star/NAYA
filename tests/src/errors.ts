/** Kosa linaloweza kuonyeshwa kwa mtumiaji (ujumbe wa Kiswahili). */
export class AppError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
export const notFound = (what = 'Ukurasa') => new AppError(`${what} haupo`, 404);
export const forbidden = () => new AppError('Huna ruhusa ya kufanya hili', 403);
