// Usajili na kuingia kwa namba ya simu + password.
import bcrypt from 'bcryptjs';
import { db } from '../db/pool.js';
import { AppError, conflict, forbidden, isUniqueViolation, unauthorized } from '../utils/http.js';
import {
  bumpTokenVersion,
  findUserByPhone,
  insertUser,
  touchLastLogin,
  type UserRole,
  type UserRow,
} from './users.js';

const BCRYPT_ROUNDS = 12;
// Hash ya kudumu ya kulinganisha namba isiyosajiliwa — muda wa jibu unafanana, mtu asijue namba ipi ipo.
const DUMMY_HASH = bcrypt.hashSync('naya-dummy-password', BCRYPT_ROUNDS);

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_ROUNDS);

/** Mtu yeyote anajisajili kama mtumiaji wa NAYA; baadaye anachagua kuwa abiria au dereva (mode). */
export async function registerUser(input: { fullName: string; phone: string; password: string }): Promise<UserRow> {
  try {
    const user = await insertUser(db, {
      phone: input.phone,
      fullName: input.fullName,
      role: 'USER',
      passwordHash: await hashPassword(input.password),
    });
    return user!;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('Namba hii ya simu tayari imesajiliwa. Ingia badala yake.');
    throw error;
  }
}

/** Kuingia. Ujumbe ni ule ule kwa namba isiyopo au password mbaya. */
export async function login(input: { phone: string; password: string }, allowedRoles?: UserRole[]): Promise<UserRow> {
  const user = await findUserByPhone(db, input.phone);
  const valid = await bcrypt.compare(input.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) throw unauthorized('Namba ya simu au password si sahihi');
  if (user.status !== 'ACTIVE') throw forbidden('Akaunti hii imesimamishwa. Wasiliana na NAYA.');
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    throw new AppError(403, 'Akaunti hii haina ruhusa ya kuingia hapa');
  }
  await touchLastLogin(db, user.id);
  return user;
}

export async function logout(userId: string): Promise<void> {
  await bumpTokenVersion(db, userId);
}
