// Kampuni ya malipo ("provider") — sehemu PEKEE ya NAYA inayozungumza na Selcom / AzamPay / n.k.
// Kuunganisha kampuni mpya = kuandika adapter moja inayotimiza PaymentProvider na kuisajili kwenye getProvider().
//
// Kanuni:
//  - Hakuna malipo yanayoandikwa "SUCCESS" bila uthibitisho halisi wa kampuni ya malipo (callback iliyothibitishwa
//    au swali la hali ya muamala). Jibu la "nimepokea ombi" ni PENDING tu.
//  - Funguo za siri zinasomwa kutoka mazingira (Railway → Variables) tu; kamwe hazichapishwi kwenye log.
import type { FastifyRequest } from 'fastify';
import { simulator } from './simulator.js';

export type MobileNetwork = 'MPESA' | 'MIXX' | 'AIRTEL' | 'HALOPESA';
export const MOBILE_NETWORKS: MobileNetwork[] = ['MPESA', 'MIXX', 'AIRTEL', 'HALOPESA'];

export interface PaymentRequest {
  reference: string; // yetu, ya kipekee
  amount: number; // TZS
  phone: string; // 2557XXXXXXXX
  network: MobileNetwork;
  description: string;
}

export type ProviderStatus = 'PENDING' | 'SUCCESS' | 'FAILED';

export interface ProviderResult {
  status: ProviderStatus;
  providerRef?: string | null;
  /** Sababu ya kushindwa, kwa maneno yanayoeleweka (Kiswahili kama inawezekana). */
  message?: string | null;
}

export interface CallbackResult extends ProviderResult {
  reference: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** Inaweza kutuma pesa kwa simu za madereva? */
  readonly canDisburse: boolean;
  /** Ombi la kulipa (USSD push): mteja anaingiza PIN kwenye simu yake. */
  collect(req: PaymentRequest): Promise<ProviderResult>;
  /** Kutuma pesa kwenda kwenye simu (B2C / disbursement). */
  disburse(req: PaymentRequest): Promise<ProviderResult>;
  /** Hali ya muamala kwa reference yetu (kwa kuhakiki tusipopata callback). */
  status(reference: string, direction: 'IN' | 'OUT'): Promise<ProviderResult>;
  /** Callback kutoka kampuni ya malipo — lazima ithibitishe saini/siri; ikishindwa → throw. */
  parseCallback(request: FastifyRequest): Promise<CallbackResult>;
}

/**
 * Kampuni ya malipo inayotumika sasa (PAYMENT_PROVIDER). null = malipo ya simu yamezimwa (kila kitu ni cha mkono kama zamani).
 * "simulator" ni ya MAJARIBIO tu — haiwezi kuwashwa production.
 */
export function getProvider(): PaymentProvider | null {
  const name = (process.env.PAYMENT_PROVIDER ?? '').trim().toLowerCase();
  if (!name || name === 'none') return null;
  if (name === 'simulator') {
    if ((process.env.NODE_ENV ?? '').trim() === 'production') return null; // kamwe malipo bandia production
    return simulator;
  }
  // Adapters za kampuni halisi zinaongezwa hapa (mf. if (name === 'selcom') return selcom;).
  return null;
}

/** Mtandao kutoka namba ya simu (2557XXXXXXXX) — kwa kuchagua mapema; mtumiaji anaweza kubadilisha. */
export function guessNetwork(phone: string): MobileNetwork | null {
  const p = phone.replace(/^255/, '0').slice(0, 3);
  if (['074', '075', '076'].includes(p)) return 'MPESA';
  if (['065', '067', '071', '077'].includes(p)) return 'MIXX';
  if (['068', '069', '078'].includes(p)) return 'AIRTEL';
  if (['061', '062'].includes(p)) return 'HALOPESA';
  return null;
}
