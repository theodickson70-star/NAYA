import { buildApp } from './app.js';
import { config } from './config.js';
import { db, runMigrations } from './db.js';

async function main() {
  await runMigrations();
  const app = await buildApp({ logger: false });
  await app.listen({ port: config.port, host: config.host });
  console.log(`[paypoint] iko tayari kwenye port ${config.port}`);
  // Futa vikao vilivyoisha mara moja kwa siku
  const cleanup = setInterval(() => {
    db.query('DELETE FROM paypoint.vikao WHERE inaisha < now()').catch(() => {});
  }, 24 * 3600 * 1000);
  const stop = async () => {
    clearInterval(cleanup);
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  console.error(`[paypoint] imeshindwa kuanza: ${(e as Error).message}`);
  process.exit(1);
});
