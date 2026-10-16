// Kampuni BANDIA ya malipo — kwa majaribio (tests na e2e) TU. getProvider() inaikataa production.
//   collect  → PENDING; inakamilishwa na /api/payments/simulator/:reference (kama mteja ameingiza PIN au amekataa).
//   disburse → SUCCESS papo hapo; namba inayoishia 0000 → FAILED ("namba haipo"); SIM_PAYOUT_BALANCE=0 → FAILED (salio).
//   lookupName → jina la majaribio (namba ...8888 → haipo; ...9999 → huduma haipatikani). SIM_NAMES='2557…=JINA;…' kubadilisha.
//   createControlNumber → namba ya majaribio; inakamilishwa na /api/payments/simulator/:reference kama deposit.
import type { FastifyRequest } from 'fastify';
import { type CallbackResult, guessNetwork, type PaymentProvider, type PaymentRequest, type ProviderResult } from './provider.js';

const state = new Map<string, ProviderResult>();
let counter = 0;
const ref = () => `SIM${Date.now().toString(36).toUpperCase()}${(counter++).toString(36).toUpperCase()}`;

export const simulator: PaymentProvider = {
  name: 'simulator',
  canDisburse: true,
  async collect(req: PaymentRequest) {
    if (req.phone.endsWith('0000')) return { status: 'FAILED', message: 'Namba hii haina akaunti ya pesa ya simu.' };
    const r: ProviderResult = { status: 'PENDING', providerRef: ref() };
    state.set(req.reference, r);
    return r;
  },
  async disburse(req: PaymentRequest) {
    if (process.env.SIM_PAYOUT_BALANCE === '0') return { status: 'FAILED', message: 'Salio la NAYA la kutuma pesa halitoshi.' };
    if (req.phone.endsWith('0000')) return { status: 'FAILED', message: 'Namba hii haina akaunti ya pesa ya simu.' };
    const r: ProviderResult = { status: 'SUCCESS', providerRef: ref() };
    state.set(req.reference, r);
    return r;
  },
  async previewFee(amount: number) {
    return Math.ceil(amount * 0.02); // ada ya bandia ya kutuma: 2%
  },
  async lookupName(phone: string) {
    if (phone.endsWith('9999')) throw new Error('simulator: lookup haipatikani');
    if (phone.endsWith('8888')) return { found: false };
    const custom = (process.env.SIM_NAMES ?? '')
      .split(';')
      .map((x) => x.split('='))
      .find(([p]) => p?.trim() === phone)?.[1]
      ?.trim();
    return { found: true, name: custom || `MTEJA MAJARIBIO ${phone.slice(-4)}`, network: guessNetwork(phone) };
  },
  async createControlNumber(req) {
    const providerRef = ref();
    state.set(req.reference, { status: 'PENDING', providerRef });
    return { controlNumber: `99${Date.now().toString().slice(-10)}`, providerRef };
  },
  async status(reference: string) {
    return state.get(reference) ?? { status: 'PENDING' };
  },
  async parseCallback(request: FastifyRequest): Promise<CallbackResult> {
    const body = (request.body ?? {}) as { reference?: string; success?: boolean; message?: string };
    if (typeof body.reference !== 'string') throw new Error('callback haina reference');
    const prev = state.get(body.reference);
    const r: CallbackResult = {
      reference: body.reference,
      status: body.success ? 'SUCCESS' : 'FAILED',
      providerRef: prev?.providerRef ?? ref(),
      message: body.success ? null : body.message ?? 'Mteja amekataa au hakuingiza PIN.',
    };
    state.set(body.reference, r);
    return r;
  },
};
