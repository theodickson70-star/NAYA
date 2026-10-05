// NAYA — Twende Pamoja. Kuwasha server: migrations kwanza, kisha API.
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { db } from './db/pool.js';
import { runMigrations } from './db/migrate.js';

const app = await buildApp();

try {
  await runMigrations((message) => app.log.info(message));
} catch (error) {
  // Bila schema sahihi API haiwezi kufanya kazi — simama wazi badala ya kuendelea vibaya.
  app.log.error((error as Error).message);
  process.exit(1);
}

await app.listen({ port: env.port, host: '0.0.0.0' });
app.log.info(`NAYA iko tayari kwenye port ${env.port}`);

const shutdown = async () => {
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
