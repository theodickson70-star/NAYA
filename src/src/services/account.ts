// Akaunti moja ya NAYA: mtumiaji yule yule anaweza kuwa abiria na dereva, na anabadili "mode".
// Kubadili mode HAKUTENGENEZI akaunti mpya — ni safu moja ya naya.users (active_mode).
import { db, transaction } from '../db/pool.js';
import { notFound } from '../utils/http.js';
import { driverStatusOf, ensureDriverProfile } from './drivers.js';
import { assertCanSwitchMode, dispatchRide } from './rides.js';
import { env } from '../config/env.js';
import { smsEnabled } from './sms.js';
import { unreadSupportCount } from './support.js';
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
    phoneVerified: !!user.phone_verified_at,
    /** SMS zikiwa zimewashwa, mtumiaji mpya anathibitisha namba kabla ya kuendelea. */
    verificationRequired: smsEnabled() && !user.phone_verified_at,
    smsEnabled: smsEnabled(),
    /** Link ya kupakua app ya Android (APK) — kwa madereva wanaotaka kengele ya maombi. */
    androidApkUrl: env.androidApkUrl ?? null,
    /** Majibu ya ofisi (Msaada) ambayo mtumiaji bado hajasoma. */
    supportUnread: await unreadSupportCount(user.id),
  };
}

/** Kuchagua au kubadili mode. Kuchagua Dereva kwa mara ya kwanza = "Kuwa dereva" (ombi linafunguliwa). */
export async function setMode(userId: string, mode: AppMode) {
  // Hakuna safari inayoendelea upande unaoachwa; ukiacha udereva, unakuwa offline.
  const releasedRide = await transaction(async (client) => {
    const released = await assertCanSwitchMode(client, userId, mode);
    if (mode === 'DRIVER') await ensureDriverProfile(client, userId);
    await client.query('UPDATE naya.users SET active_mode = $2, updated_at = now() WHERE id = $1', [userId, mode]);
    return released;
  });
  if (releasedRide) await dispatchRide(releasedRide);
  const user = await findUserById(db, userId);
  if (!user) throw notFound('Akaunti haikupatikana');
  return getAccount(user);
}
