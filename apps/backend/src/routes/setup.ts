import type { FastifyPluginAsync } from 'fastify';
import { setupRequestSchema, type SessionResponse, type SetupStatus } from '@locternos/shared';
import { setSessionCookie } from '../auth/guard.js';
import { createSession } from '../auth/sessions.js';
import { countUsers, createFirstAdmin } from '../auth/users.js';

const SETUP_DONE = 'Setup has already been completed';

export const setupRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/setup/status', async (): Promise<SetupStatus> => ({
    setupRequired: countUsers(app.db) === 0,
  }));

  app.post('/api/setup', async (request, reply) => {
    const parsed = setupRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid setup request', issues: parsed.error.issues });
    }

    // Cheap pre-check so rejected requests skip the scrypt work. The
    // transactional check inside createFirstAdmin still guards the race.
    if (countUsers(app.db) > 0) {
      return reply.code(409).send({ error: SETUP_DONE });
    }

    const user = await createFirstAdmin(app.db, parsed.data.email, parsed.data.password);
    if (!user) {
      return reply.code(409).send({ error: SETUP_DONE });
    }

    // The newly created Admin is signed in straight away.
    const session = createSession(app.db, user.id);
    setSessionCookie(request, reply, session.token, session.expiresAt);
    return reply.code(201).send({ user } satisfies SessionResponse);
  });
};
