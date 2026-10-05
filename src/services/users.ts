// SQL ya watumiaji (naya.users). Hakuna mantiki ya biashara hapa.
import { type Db, many, one } from '../db/pool.js';

export type UserRole = 'CUSTOMER' | 'DRIVER' | 'ADMIN' | 'SUPER_ADMIN';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';

export interface UserRow {
  id: string;
  phone: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
  password_hash: string;
  token_version: number;
  last_login_at: Date | null;
  created_at: Date;
}

/** Mtumiaji kama anavyoonekana nje ya server — kamwe bila password_hash wala token_version. */
export interface PublicUser {
  id: string;
  phone: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
}

export function toPublicUser(u: UserRow): PublicUser {
  return { id: u.id, phone: u.phone, fullName: u.full_name, role: u.role, status: u.status, createdAt: u.created_at };
}

export const findUserByPhone = (db: Db, phone: string) =>
  one<UserRow>(db, 'SELECT * FROM naya.users WHERE phone = $1', [phone]);

export const findUserById = (db: Db, id: string) => one<UserRow>(db, 'SELECT * FROM naya.users WHERE id = $1', [id]);

export const insertUser = (db: Db, u: { phone: string; fullName: string; role: UserRole; passwordHash: string }) =>
  one<UserRow>(
    db,
    `INSERT INTO naya.users (phone, full_name, role, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [u.phone, u.fullName, u.role, u.passwordHash],
  );

export const touchLastLogin = (db: Db, id: string) =>
  db.query('UPDATE naya.users SET last_login_at = now() WHERE id = $1', [id]);

/** Logout: token_version ikiongezeka, tokens zote zilizotolewa kabla ya hapo hazifanyi kazi tena. */
export const bumpTokenVersion = (db: Db, id: string) =>
  db.query('UPDATE naya.users SET token_version = token_version + 1, updated_at = now() WHERE id = $1', [id]);

export const countUsersByRole = (db: Db) =>
  many<{ role: UserRole; total: number }>(db, 'SELECT role, count(*)::int AS total FROM naya.users GROUP BY role');

export const countNewUsersSince = (db: Db, since: Date) =>
  one<{ total: number }>(db, 'SELECT count(*)::int AS total FROM naya.users WHERE created_at >= $1', [since]);
