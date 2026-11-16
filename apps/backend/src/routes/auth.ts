import type { FastifyPluginAsync } from 'fastify';
import { loginRequestSchema, type SessionResponse } from '@locternos/shared';
import {
  clearSessionCookie,
  currentUser,
  requireAuth,
  SESSION_COOKIE,
  setSessionCookie,
} from '../auth/guard.js';
import { createSession, deleteExpiredSessions, deleteSession } from '../auth/sessions.js';
import { verifyCredentials } from '../auth/users.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid login request' });
    }

    const user = await verifyCredentials(app.db, parsed.data.email, parsed.data.password);
    if (!user) {
      // Same message for unknown email and wrong password.
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    deleteExpiredSessions(app.db);
    const session = createSession(app.db, user.id);
    setSessionCookie(request, reply, session.token, session.expiresAt);
    return { user } satisfies SessionResponse;
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) deleteSession(app.db, token);
    clearSessionCookie(reply);
    return reply.code(204).send();
  });

  app.get(
    '/api/auth/me',
    { preHandler: requireAuth },
    async (request): Promise<SessionResponse> => ({ user: currentUser(request) }),
  );
};
