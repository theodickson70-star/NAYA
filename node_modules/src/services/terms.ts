// Masharti ya huduma (abiria + dereva) na sera ya faragha.
// Maandishi yenyewe yako frontend/masharti/index.html. Yakibadilika kwa namna muhimu, ongeza TERMS_VERSION
// (na DRIVER_TERMS_VERSION kwa masharti ya dereva): watumiaji wote wataombwa kukubali toleo jipya wakifungua app.
import type { Db } from '../db/pool.js';
import { db, one } from '../db/pool.js';
import { writeAudit } from './audit.js';

export const TERMS_VERSION = '2026-10-07';
export const DRIVER_TERMS_VERSION = '2026-10-07';

export async function termsState(client: Db, userId: string) {
  const row = await one<{ terms_version: string | null; terms_accepted_at: Date | null; driver_terms_version: string | null; is_driver: boolean }>(
    client,
    `SELECT u.terms_version, u.terms_accepted_at, d.driver_terms_version, (d.user_id IS NOT NULL) AS is_driver
       FROM naya.users u LEFT JOIN naya.drivers d ON d.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  return {
    version: TERMS_VERSION,
    accepted: row?.terms_version === TERMS_VERSION,
    acceptedAt: row?.terms_accepted_at ?? null,
    /** null = si dereva (hahitaji masharti ya dereva). */
    driverAccepted: row?.is_driver ? row.driver_terms_version === DRIVER_TERMS_VERSION : null,
  };
}

export async function acceptTerms(client: Db, userId: string) {
  await client.query('UPDATE naya.users SET terms_version = $2, terms_accepted_at = now() WHERE id = $1', [userId, TERMS_VERSION]);
}

export async function acceptDriverTerms(client: Db, userId: string) {
  await client.query('UPDATE naya.drivers SET driver_terms_version = $2, driver_terms_accepted_at = now() WHERE user_id = $1', [
    userId,
    DRIVER_TERMS_VERSION,
  ]);
}

/** Mtumiaji aliyekuwepo kabla ya masharti (au toleo jipya): anakubali kwenye app. */
export async function acceptCurrentTerms(userId: string, driver: boolean) {
  await acceptTerms(db, userId);
  if (driver) await acceptDriverTerms(db, userId);
  await writeAudit(db, {
    actorId: userId,
    action: 'terms.accepted',
    targetType: 'user',
    targetId: userId,
    details: { version: TERMS_VERSION, driverVersion: driver ? DRIVER_TERMS_VERSION : null },
  });
  return termsState(db, userId);
}
