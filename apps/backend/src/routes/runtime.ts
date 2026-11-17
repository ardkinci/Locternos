import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  acceptEulaInputSchema,
  restartServerInputSchema,
  sendConsoleCommandInputSchema,
  stopServerInputSchema,
} from '@locternos/shared';
import { currentUser, requireAuth } from '../auth/guard.js';
import { RuntimeError } from '../process/manager.js';

interface ServerParams {
  id: string;
}

function sendRuntimeError(reply: FastifyReply, error: unknown) {
  if (error instanceof RuntimeError) {
    return reply.code(error.statusCode).send({ error: error.message, code: error.code });
  }
  throw error;
}

export const runtimeRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/servers/:id/runtime', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as ServerParams;
    try {
      return { runtime: await app.runtimeService.getRuntime(id) };
    } catch (error) {
      return sendRuntimeError(reply, error);
    }
  });

  app.get('/api/servers/:id/console', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as ServerParams;
    try {
      await app.runtimeService.getRuntime(id);
    } catch (error) {
      return sendRuntimeError(reply, error);
    }
    return { lines: app.runtimeService.getConsole(id) };
  });

  app.post('/api/servers/:id/eula', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = acceptEulaInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'The Minecraft EULA must be accepted explicitly (accepted: true)',
      });
    }

    const { id } = request.params as ServerParams;
    try {
      const eulaAcceptedAt = await app.runtimeService.acceptEula(id, currentUser(request).id);
      return { eulaAcceptedAt };
    } catch (error) {
      return sendRuntimeError(reply, error);
    }
  });

  app.post('/api/servers/:id/start', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as ServerParams;
    try {
      const runtime = await app.runtimeService.start(id, currentUser(request).id);
      return { runtime };
    } catch (error) {
      return sendRuntimeError(reply, error);
    }
  });

  app.post('/api/servers/:id/stop', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = stopServerInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid stop payload', issues: parsed.error.issues });
    }

    const { id } = request.params as ServerParams;
    try {
      const runtime = await app.runtimeService.stop(id, parsed.data, currentUser(request).id);
      return { runtime };
    } catch (error) {
      return sendRuntimeError(reply, error);
    }
  });

  app.post('/api/servers/:id/kill', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as ServerParams;
    try {
      const runtime = await app.runtimeService.kill(id, currentUser(request).id);
      return { runtime };
    } catch (error) {
      return sendRuntimeError(reply, error);
    }
  });

  app.post('/api/servers/:id/restart', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = restartServerInputSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid restart payload', issues: parsed.error.issues });
    }

    const { id } = request.params as ServerParams;
    try {
      const runtime = await app.runtimeService.restart(id, parsed.data, currentUser(request).id);
      return { runtime };
    } catch (error) {
      return sendRuntimeError(reply, error);
    }
  });

  app.post('/api/servers/:id/command', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = sendConsoleCommandInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid command payload', issues: parsed.error.issues });
    }

    const { id } = request.params as ServerParams;
    try {
      await app.runtimeService.sendCommand(id, parsed.data.command, currentUser(request).id);
      return reply.code(204).send();
    } catch (error) {
      return sendRuntimeError(reply, error);
    }
  });
};
