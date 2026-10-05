// Muunganisho na Supabase PostgreSQL.
import pg from 'pg';
import { config } from './config.js';

// Supabase inahitaji SSL. "sslmode" ndani ya URL ingezima chaguo letu la SSL, kwa hiyo tunaiondoa
// na kuweka SSL hapa (encrypted; cheti cha Supabase hakihakikiwi dhidi ya CA).
const url = new URL(config.databaseUrl);
url.searchParams.delete('sslmode');
const isLocal = ['localhost', '127.0.0.1'].includes(url.hostname);

export const db = new pg.Pool({
  connectionString: url.toString(),
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10_000,
});

// Muunganisho ukikatika, tunaandika log badala ya server nzima kuzima.
db.on('error', (error) => console.error(`[db] ${error.message}`));

/** Database inajibu? Inarudisha 'ok' au ujumbe wa kosa (bila password). */
export async function checkDatabase(): Promise<'ok' | string> {
  try {
    await db.query('SELECT 1');
    return 'ok';
  } catch (error) {
    return (error as Error).message;
  }
}
