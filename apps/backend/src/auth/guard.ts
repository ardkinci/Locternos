import type { FastifyReply, FastifyRequest } from 'fastify';
import type { User } from '@locternos/shared';
import { findSessionUser } from './sessions.js';

export const SESSION_COOKIE = 'locternos_session';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireAuth` on protected routes; null otherwise. */
    user: User | null;
  }
}

/**
 * preHandler that rejects requests without a valid session cookie. The cookie
 * holds an opaque 256-bit random token, so it is not signed: the server simply
 * looks up its digest in the sessions table.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const token = request.cookies[SESSION_COOKIE];
  const user = token ? findSessionUser(request.server.db, token) : null;
  if (!user) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  request.user = user;
}

/** Returns the authenticated user. Only call after `requireAuth` has run. */
export function currentUser(request: FastifyRequest): User {
  if (!request.user) throw new Error('currentUser called on an unauthenticated request');
  return request.user;
}

export function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
    // Only mark the cookie Secure when the panel is actually served over HTTPS.
    secure: request.protocol === 'https',
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}
