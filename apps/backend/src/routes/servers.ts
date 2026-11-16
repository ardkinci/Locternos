import type { FastifyPluginAsync } from 'fastify';
import {
  createServerInputSchema,
  updateServerInputSchema,
  type ServerListResponse,
  type ServerResponse,
} from '@locternos/shared';
import { requireAuth } from '../auth/guard.js';
import {
  createServer,
  deleteServer,
  getServer,
  listServers,
  PortInUseError,
  updateServer,
} from '../servers/service.js';

interface ServerParams {
  id: string;
}

export const serverRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/servers', { preHandler: requireAuth }, async (): Promise<ServerListResponse> => ({
    servers: listServers(app.db),
  }));

  app.post('/api/servers', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createServerInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid server payload', issues: parsed.error.issues });
    }

    const server = createServer(app.db, parsed.data);
    return reply.code(201).send({ server } satisfies ServerResponse);
  });

  app.get('/api/servers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as ServerParams;
    const server = getServer(app.db, id);
    if (!server) return reply.code(404).send({ error: 'Server not found' });
    return { server } satisfies ServerResponse;
  });

  app.patch('/api/servers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = updateServerInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid server payload', issues: parsed.error.issues });
    }

    const { id } = request.params as ServerParams;
    try {
      const server = updateServer(app.db, id, parsed.data);
      if (!server) return reply.code(404).send({ error: 'Server not found' });
      return { server } satisfies ServerResponse;
    } catch (error) {
      if (error instanceof PortInUseError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.delete('/api/servers/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as ServerParams;
    if (!deleteServer(app.db, id)) {
      return reply.code(404).send({ error: 'Server not found' });
    }
    return reply.code(204).send();
  });
};
