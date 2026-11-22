// JWT + roles. Kila request iliyolindwa inahakiki token NA hali ya sasa ya mtumiaji kwenye database,
// ili kusimamishwa (SUSPENDED) au logout vianze kufanya kazi papo hapo.
import fastifyJwt from '@fastify/jwt';
import { env } from '../config/env.js';
import { db } from '../db/pool.js';
import { findUserById } from '../services/users.js';
import { forbidden, unauthorized } from '../utils/http.js';
export async function registerJwt(app) {
    await app.register(fastifyJwt, { secret: env.jwtSecret, sign: { expiresIn: env.jwtExpiresIn } });
    app.decorateRequest('currentUser', null);
}
export function issueToken(app, user) {
    return app.jwt.sign({ sub: user.id, role: user.role, tv: user.token_version });
}
/** Lazima awe ameingia. */
export async function authenticate(request, _reply) {
    let payload;
    try {
        payload = await request.jwtVerify();
    }
    catch {
        throw unauthorized('Muda wa kuingia umeisha au token si sahihi. Ingia tena.');
    }
    const user = await findUserById(db, payload.sub);
    if (!user || user.token_version !== payload.tv)
        throw unauthorized('Umetoka. Ingia tena.');
    if (user.status !== 'ACTIVE')
        throw forbidden('Akaunti hii imesimamishwa. Wasiliana na NAYA.');
    request.currentUser = user;
}
/** Lazima awe ameingia NA awe na moja ya roles hizi. */
export function requireRole(...roles) {
    return async (request, reply) => {
        await authenticate(request, reply);
        if (!roles.includes(request.currentUser.role))
            throw forbidden();
    };
}
export const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];
