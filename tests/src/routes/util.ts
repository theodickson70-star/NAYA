import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../errors.js';
import { parseAmount } from '../format.js';

export type Body = Record<string, string | string[] | undefined>;
export const body = (req: FastifyRequest) => (req.body ?? {}) as Body;
export const str = (b: Body, k: string) => {
  const v = b[k];
  return (Array.isArray(v) ? v[0] : v ?? '').toString().slice(0, 500);
};
export const arr = (b: Body, k: string) => {
  const v = b[k];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};
export const amount = (b: Body, k: string) => parseAmount(str(b, k));
export const query = (req: FastifyRequest) => (req.query ?? {}) as Record<string, string | undefined>;
export const send = (reply: FastifyReply, htmlStr: string, status = 200) => reply.status(status).type('text/html').send(htmlStr);
export const isUuid = (s: string | undefined) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const ymd = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

/** Endesha kazi ya fomu: kosa la mtumiaji (AppError) linarudishwa kama ujumbe kwenye fomu ileile */
export async function tryForm<T>(work: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await work() };
  } catch (e) {
    if (e instanceof AppError && e.status < 500 && e.status !== 401) return { ok: false, error: e.message };
    throw e;
  }
}
