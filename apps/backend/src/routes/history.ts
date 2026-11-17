import type { FastifyPluginAsync } from 'fastify';
import {
  logSearchQuerySchema,
  type AuditEventListResponse,
  type ServerLogListResponse,
  type ServerRunListResponse,
} from '@locternos/shared';
import { requireAuth } from '../auth/guard.js';
import { listAuditEvents } from '../audit/service.js';
import { queryServerLogs } from '../logs/service.js';
import { listServerRuns } from '../runs/service.js';
import { getServer } from '../servers/service.js';

interface ServerParams {
  id: string;
}

interface RunsQuery {
  limit?: string;
}

export const historyRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/servers/:id/runs', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as ServerParams;
    if (!getServer(app.db, id)) {
      return reply.code(404).send({ error: 'Server not found' });
    }

    const { limit } = request.query as RunsQuery;
    const parsedLimit = Number(limit ?? 100);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 500)
      : 100;

    return { runs: listServerRuns(app.db, id).slice(0, safeLimit) } satisfies ServerRunListResponse;
  });

  app.get('/api/servers/:id/logs', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as ServerParams;
    if (!getServer(app.db, id)) {
      return reply.code(404).send({ error: 'Server not found' });
    }

    const parsed = logSearchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid log query', issues: parsed.error.issues });
    }

    const logs = queryServerLogs(app.db, id, parsed.data);
    return { logs } satisfies ServerLogListResponse;
  });

  app.get('/api/servers/:id/audit', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as ServerParams;
    if (!getServer(app.db, id)) {
      return reply.code(404).send({ error: 'Server not found' });
    }

    const events = listAuditEvents(app.db, { serverId: id, limit: 500 });
    return { events } satisfies AuditEventListResponse;
  });
};
