// Kutengeneza (au kusasisha) SUPER_ADMIN wa kwanza wa NAYA.
// Matumizi:  npm run create-admin -- 0712345678 "Jina Kamili" "PasswordNdefu123"
import { db } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';
import { hashPassword } from '../services/auth.js';
import { normalizeTzPhone } from '../utils/phone.js';

const [rawPhone, fullName, password] = process.argv.slice(2);

async function main(): Promise<void> {
  const phone = rawPhone ? normalizeTzPhone(rawPhone) : null;
  if (!phone || !fullName || !password) {
    throw new Error('Matumizi: npm run create-admin -- 0712345678 "Jina Kamili" "PasswordNdefu123"');
  }
  if (password.length < 8) throw new Error('Password iwe na angalau herufi 8');

  await runMigrations();
  const result = await db.query(
    `INSERT INTO naya.users (phone, full_name, role, password_hash)
     VALUES ($1, $2, 'SUPER_ADMIN', $3)
     ON CONFLICT (phone) DO UPDATE
       SET full_name = EXCLUDED.full_name, role = 'SUPER_ADMIN', status = 'ACTIVE',
           password_hash = EXCLUDED.password_hash, token_version = naya.users.token_version + 1, updated_at = now()
     RETURNING (xmax = 0) AS created`,
    [phone, fullName, await hashPassword(password)],
  );
  console.log(result.rows[0].created ? `✓ Super admin ametengenezwa: ${fullName} (${phone})` : `✓ ${phone} sasa ni super admin (password imebadilishwa)`);
}

main()
  .catch((error) => {
    console.error(`✗ ${(error as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
