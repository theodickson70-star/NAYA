// SQL ya watumiaji (naya.users). Hakuna mantiki ya biashara hapa.
import { many, one } from '../db/pool.js';
export function toPublicUser(u) {
    return { id: u.id, phone: u.phone, fullName: u.full_name, role: u.role, status: u.status, createdAt: u.created_at };
}
export const findUserByPhone = (db, phone) => one(db, 'SELECT * FROM naya.users WHERE phone = $1', [phone]);
export const findUserById = (db, id) => one(db, 'SELECT * FROM naya.users WHERE id = $1', [id]);
export const insertUser = (db, u) => one(db, `INSERT INTO naya.users (phone, full_name, role, password_hash)
     VALUES ($1, $2, $3, $4) RETURNING *`, [u.phone, u.fullName, u.role, u.passwordHash]);
export const touchLastLogin = (db, id) => db.query('UPDATE naya.users SET last_login_at = now() WHERE id = $1', [id]);
/** Logout: token_version ikiongezeka, tokens zote zilizotolewa kabla ya hapo hazifanyi kazi tena. */
export const bumpTokenVersion = (db, id) => db.query('UPDATE naya.users SET token_version = token_version + 1, updated_at = now() WHERE id = $1', [id]);
export const countUsersByRole = (db) => many(db, 'SELECT role, count(*)::int AS total FROM naya.users GROUP BY role');
export const countNewUsersSince = (db, since) => one(db, 'SELECT count(*)::int AS total FROM naya.users WHERE created_at >= $1', [since]);
