// "Mfumo huru" (0.16.2) — kwa kipindi ambacho NAYA ina madereva wachache.
//
// Ukiwashwa (chaguo-msingi), dereva aliyeidhinishwa na yuko online anapokea maombi bila vikwazo:
//   - ada ya mwezi haitozwi (anaweza kwenda online na kupewa safari hata kama ada/siku za bure zimeisha);
//   - simu "iliyolala" (app imefungwa, skrini imezimwa) bado inapewa maombi;
//   - mfumo haumweki offline (kukosa kujibu maombi, simu kutoonekana, ada kuisha) — ni yeye tu anayeenda offline;
//   - maombi yanaenda kwa madereva WOTE walio karibu kwa pamoja; wa kwanza kukubali anapata safari.
// Vinavyobaki (si vikwazo bali usalama/akili ya kawaida): kuidhinishwa na ofisi, akaunti hai, chombo sahihi
// (bodaboda/bajaji), GPS, kuwa ndani ya km 10, na kutokuwa kwenye safari nyingine.
import { type Db, db, one, transaction } from '../db/pool.js';
import { writeAudit } from './audit.js';
import { FEE_WAIVED_GRACE_DAYS, getSettings } from './subscriptions.js';

export interface DispatchSettings {
  openMode: boolean;
}

const DEFAULTS: DispatchSettings = { openMode: true };
/** Mfumo huru: dereva anapewa maombi hata simu ikiwa haijaonekana kwa muda huu. */
export const OPEN_STALE_SECONDS = 24 * 3600;

export async function getDispatchSettings(client: Db = db): Promise<DispatchSettings> {
  const row = await one<{ value: Partial<DispatchSettings> }>(client, `SELECT value FROM naya.settings WHERE key = 'dispatch'`);
  return { ...DEFAULTS, ...(row?.value ?? {}) };
}

export async function saveDispatchSettings(adminId: string, input: DispatchSettings) {
  await transaction(async (client) => {
    const before = await getDispatchSettings(client);
    await client.query(
      `INSERT INTO naya.settings (key, value, updated_by, updated_at) VALUES ('dispatch', $1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [JSON.stringify(input), adminId],
    );
    await writeAudit(client, { actorId: adminId, action: 'settings.dispatch', targetType: 'settings', targetId: null, details: { before, after: input } });
  });
  return getDispatchSettings();
}

/**
 * Sheria zinazotumika SASA kwa kutuma maombi:
 *   open        — mfumo huru umewashwa
 *   graceDays   — kwa SUBSCRIPTION_OK_SQL (mfumo huru: FEE_WAIVED_GRACE_DAYS = ada haiangaliwi)
 *   staleSeconds — kwa FRESH_SQL (mfumo huru: saa 24)
 */
export async function dispatchRules(client: Db = db, browserStaleSeconds = 120) {
  const [{ openMode }, { graceDays }] = await Promise.all([getDispatchSettings(client), getSettings(client)]);
  return {
    open: openMode,
    graceDays: openMode ? FEE_WAIVED_GRACE_DAYS : graceDays,
    staleSeconds: openMode ? OPEN_STALE_SECONDS : browserStaleSeconds,
  };
}
