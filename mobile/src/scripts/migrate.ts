// npm run migrate — kuendesha migrations bila kuwasha server (server pia inaziendesha yenyewe inapowaka).
import { db } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

runMigrations()
  .then((applied) => console.log(applied.length ? `✓ Migrations ${applied.length} zimeendeshwa` : '✓ Database iko sawa — hakuna migration mpya'))
  .catch((error) => {
    console.error(`✗ ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
