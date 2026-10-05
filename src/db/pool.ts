// Muunganisho na Supabase PostgreSQL. Majedwali yote ya NAYA yako kwenye schema "naya".
import pg from 'pg';
import { env } from '../config/env.js';

// BIGINT (fedha, TZS) → number.
pg.types.setTypeParser(20, (value) => parseInt(value, 10));

// Supabase inahitaji SSL. "sslmode" ndani ya URL ingezima chaguo letu la SSL, kwa hiyo tunaiondoa
// na kuweka SSL hapa (encrypted; cheti cha Supabase hakihakikiwi dhidi ya CA).
const url = new URL(env.databaseUrl);
url.searchParams.delete('sslmode');
const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);

export const db = new pg.Pool({
  connectionString: url.toString(),
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// Muunganisho ukikatika, tunaandika log badala ya server nzima kuzima.
db.on('error', (error) => console.error(`[db] ${error.message}`));

export type Db = pg.Pool | pg.PoolClient;

/** Safu moja au null. */
export async function one<T>(client: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await client.query(sql, params);
  return (result.rows[0] as T | undefined) ?? null;
}

/** Safu zote. */
export async function many<T>(client: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await client.query(sql, params);
  return result.rows as T[];
}

/** Kazi ndani ya transaction moja: kosa lolote linarudisha kila kitu nyuma. */
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Database inajibu? Inarudisha 'ok' au ujumbe wa kosa (bila password). */
export async function checkDatabase(): Promise<'ok' | string> {
  try {
    await db.query('SELECT 1');
    return 'ok';
  } catch (error) {
    return (error as Error).message;
  }
}
