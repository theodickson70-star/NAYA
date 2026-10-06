// Namba ya simu iliyothibitishwa inahitajika kabla ya kuagiza safari au kufanya kazi ya udereva
// (SMS zikiwa zimewashwa tu; bila SMS hakuna njia ya kuthibitisha, kwa hiyo hakuna kizuizi).
import { type Db, one } from '../db/pool.js';
import { forbidden } from '../utils/http.js';
import { smsEnabled } from './sms.js';

export async function assertPhoneVerified(client: Db, userId: string): Promise<void> {
  if (!smsEnabled()) return;
  const row = await one<{ phone_verified_at: Date | null }>(client, 'SELECT phone_verified_at FROM naya.users WHERE id = $1', [userId]);
  if (!row?.phone_verified_at) throw forbidden('Thibitisha namba yako ya simu kwanza (Akaunti → Thibitisha namba).');
}
