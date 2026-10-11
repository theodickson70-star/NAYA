// Kuhifadhi faili za nyaraka. Kwa sasa ndani ya Supabase Postgres (table naya.document_files) — inadumu
// hata Railway ikideploy upya. Sehemu nyingine za mfumo zinaona "storage" + "storage_key" tu, kwa hiyo
// kuhamia Supabase Storage baadaye ni kubadilisha faili hili peke yake.
import { createHash } from 'node:crypto';
import { type Db, one } from '../db/pool.js';
import { badRequest } from '../utils/http.js';

export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024; // MB 3 (app inapunguza picha kabla ya kutuma)

export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

/** Aina halisi ya faili kutoka kwenye bytes zake za mwanzo — hatuamini jina wala content-type peke yake. */
export function detectMime(content: Buffer): AllowedMime | null {
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return 'image/jpeg';
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (content.length >= 12 && content.toString('latin1', 0, 4) === 'RIFF' && content.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (content.length >= 5 && content.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export interface StoredFile {
  storage: 'db';
  storageKey: string;
  mimeType: AllowedMime;
  sizeBytes: number;
  sha256: string;
}

export async function storeFile(client: Db, content: Buffer, declaredMime: string | undefined): Promise<StoredFile> {
  if (content.length === 0) throw badRequest('Faili ni tupu');
  if (content.length > MAX_DOCUMENT_BYTES) throw badRequest('Faili ni kubwa mno (mwisho MB 3)');
  const mimeType = detectMime(content);
  if (!mimeType) throw badRequest('Aina ya faili hairuhusiwi. Tuma picha (JPG, PNG, WEBP) au PDF.');
  if (declaredMime && declaredMime.split(';')[0]!.trim() !== mimeType) {
    throw badRequest('Faili halilingani na aina yake. Jaribu kuchagua faili tena.');
  }
  const row = await one<{ id: string }>(client, 'INSERT INTO naya.document_files (content) VALUES ($1) RETURNING id', [content]);
  return {
    storage: 'db',
    storageKey: row!.id,
    mimeType,
    sizeBytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

export async function readFile(client: Db, storage: string, storageKey: string): Promise<Buffer | null> {
  if (storage !== 'db') return null;
  const row = await one<{ content: Buffer }>(client, 'SELECT content FROM naya.document_files WHERE id = $1', [storageKey]);
  return row?.content ?? null;
}

export async function deleteFile(client: Db, storage: string, storageKey: string): Promise<void> {
  if (storage === 'db') await client.query('DELETE FROM naya.document_files WHERE id = $1', [storageKey]);
}
