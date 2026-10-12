// NAYA — Twende Pamoja. Kuwasha server: migrations kwanza, kisha API.
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { db } from './db/pool.js';
import { runMigrations } from './db/migrate.js';
import { startListener, stopListener } from './realtime/hub.js';
import { dispatchPending } from './services/rides.js';
import { runSubscriptionChecks } from './services/subscriptions.js';
import { checkPendingPayments } from './services/payments/index.js';
import { getProvider, providerProblem } from './services/payments/provider.js';

const app = await buildApp();

try {
  await runMigrations((message) => app.log.info(message));
} catch (error) {
  // Bila schema sahihi API haiwezi kufanya kazi — simama wazi badala ya kuendelea vibaya.
  app.log.error((error as Error).message);
  process.exit(1);
}

await app.listen({ port: env.port, host: '0.0.0.0' });
// Taarifa za papo hapo kutoka servers nyingine (Postgres LISTEN/NOTIFY).
await startListener({ info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) });
app.log.info(`NAYA iko tayari kwenye port ${env.port}`);
{
  // Malipo ya simu: jina la kampuni tu (kamwe funguo). Tatizo la mipangilio linaonekana kwenye log ya Railway.
  const provider = getProvider();
  const problem = providerProblem();
  if (problem) app.log.warn(`[payments] ${problem}`);
  else app.log.info(`[payments] ${provider ? `kampuni ya malipo: ${provider.name}` : 'malipo ya simu yamezimwa (PAYMENT_PROVIDER haijawekwa)'}`);
}

// Kumpata dereva: kila sekunde 3 maombi yaliyopitwa na muda yanaenda kwa dereva anayefuata.
// (Row locks za database zinazuia server mbili kugongana, hata Railway ikiendesha nakala zaidi ya moja.)
let dispatching = false;
const dispatcher = setInterval(async () => {
  if (dispatching) return;
  dispatching = true;
  try {
    await dispatchPending();
  } catch (error) {
    app.log.error({ err: error }, 'dispatch imeshindwa');
  } finally {
    dispatching = false;
  }
}, 3000);

// Ada ya mwezi: ukumbusho, arifa ya kuisha, na kumrudisha offline dereva ambaye siku za kuvumiliwa zimeisha.
const checkSubscriptions = () =>
  runSubscriptionChecks().catch((error) => app.log.error({ err: error }, 'ukaguzi wa ada umeshindwa'));
const subscriptionTimer = setInterval(checkSubscriptions, 5 * 60_000);
void checkSubscriptions();

// Malipo ya simu: uliza hali ya miamala inayosubiri (kama callback ya kampuni ya malipo imechelewa au kupotea).
let checkingPayments = false;
const paymentTimer = setInterval(async () => {
  if (checkingPayments) return;
  checkingPayments = true;
  try {
    await checkPendingPayments();
  } catch (error) {
    app.log.error({ err: error }, 'ukaguzi wa malipo umeshindwa');
  } finally {
    checkingPayments = false;
  }
}, 60_000);

const shutdown = async () => {
  clearInterval(dispatcher);
  clearInterval(paymentTimer);
  clearInterval(subscriptionTimer);
  await stopListener();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
