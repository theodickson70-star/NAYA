// Akaunti moja ya NAYA: mtumiaji yule yule anaweza kuwa abiria na dereva, na anabadili "mode".
// Kubadili mode HAKUTENGENEZI akaunti mpya — ni safu moja ya naya.users (active_mode).
import { db, transaction } from '../db/pool.js';
import { notFound } from '../utils/http.js';
import { driverStatusOf, ensureDriverProfile } from './drivers.js';
import { findUserById, toPublicUser, type AppMode, type UserRow } from './users.js';

export async function getAccount(user: UserRow) {
  const driverStatus = await driverStatusOf(db, user.id);
  return {
    user: toPublicUser(user),
    activeMode: user.active_mode,
    /** null = hajaomba kuwa dereva; vinginevyo hali ya ombi lake (INCOMPLETE, PENDING, APPROVED, REJECTED, SUSPENDED). */
    driverStatus,
    /** Dereva aliyethibitishwa tu ndiye atapokea safari (phases za safari). */
    canDrive: driverStatus === 'APPROVED',
  };
}

/** Kuchagua au kubadili mode. Kuchagua Dereva kwa mara ya kwanza = "Kuwa dereva" (ombi linafunguliwa). */
export async function setMode(userId: string, mode: AppMode) {
  await transaction(async (client) => {
    if (mode === 'DRIVER') await ensureDriverProfile(client, userId);
    await client.query('UPDATE naya.users SET active_mode = $2, updated_at = now() WHERE id = $1', [userId, mode]);
  });
  const user = await findUserById(db, userId);
  if (!user) throw notFound('Akaunti haikupatikana');
  return getAccount(user);
}
