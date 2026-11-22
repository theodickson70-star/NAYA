// Muunganisho na Supabase PostgreSQL. Majedwali yote ya PayPoint yako kwenye schema "paypoint".
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { config } from './config.js';

// BIGINT (fedha TSh) → number
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => parseFloat(v));

const url = new URL(config.databaseUrl);
url.searchParams.delete('sslmode');
const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname) || url.searchParams.has('host');

export const db = new pg.Pool({
  connectionString: url.toString(),
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});
db.on('error', (e) => console.error(`[db] ${e.message}`));

export type Db = pg.Pool | pg.PoolClient;

export async function one<T>(c: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  return ((await c.query(sql, params)).rows[0] as T | undefined) ?? null;
}
export async function many<T>(c: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await c.query(sql, params)).rows as T[];
}

export async function transaction<T>(work: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const r = await work(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Inaendesha migrations mpya za database/migrations (kila moja mara moja tu). */
export async function runMigrations(log: (m: string) => void = console.log): Promise<void> {
  const dir = join(process.cwd(), 'database', 'migrations');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const c = await db.connect();
  try {
    await c.query('SELECT pg_advisory_lock(424242)');
    await c.query('CREATE SCHEMA IF NOT EXISTS paypoint');
    await c.query(`CREATE TABLE IF NOT EXISTS paypoint.schema_migrations (
      jina text PRIMARY KEY, tarehe timestamptz NOT NULL DEFAULT now())`);
    for (const f of files) {
      if ((await c.query('SELECT 1 FROM paypoint.schema_migrations WHERE jina = $1', [f])).rowCount) continue;
      const sql = await readFile(join(dir, f), 'utf8');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO paypoint.schema_migrations (jina) VALUES ($1)', [f]);
        await c.query('COMMIT');
        log(`[migrate] ${f} imewekwa`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Migration ${f} imeshindwa: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    c.release();
  }
}
