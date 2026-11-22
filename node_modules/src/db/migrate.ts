// Migrations: faili za SQL kwenye database/migrations, zinaendeshwa kwa mpangilio wa jina, kila moja MARA MOJA.
// Kila faili ni transaction moja (likishindwa, hakuna kinachobaki nusu). Lock inazuia server mbili
// kuendesha migrations kwa wakati mmoja. Inafanya kazi pia kupitia Supabase pooler.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './pool.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'database', 'migrations');
const LOCK_ID = 7_412_001; // namba yoyote ya kudumu ya NAYA

export async function runMigrations(log: (message: string) => void = console.log): Promise<string[]> {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied: string[] = [];

  for (const file of files) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_ID]);
      await client.query('CREATE SCHEMA IF NOT EXISTS naya');
      await client.query(
        `CREATE TABLE IF NOT EXISTS naya.schema_migrations (
           name TEXT PRIMARY KEY,
           applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`,
      );
      const done = await client.query('SELECT 1 FROM naya.schema_migrations WHERE name = $1', [file]);
      if (done.rowCount === 0) {
        await client.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
        await client.query('INSERT INTO naya.schema_migrations (name) VALUES ($1)', [file]);
        applied.push(file);
        log(`[migrate] ${file} ✓`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${file} imeshindwa: ${(error as Error).message}`);
    } finally {
      client.release();
    }
  }
  return applied;
}
