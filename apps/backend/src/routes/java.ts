import type { FastifyPluginAsync } from 'fastify';
import {
  installJavaRuntimeInputSchema,
  type InstallJavaRuntimeResponse,
  type JavaRuntimeListResponse,
  type JavaRuntimeResponse,
  type JavaVersionRequirement,
} from '@locternos/shared';
import { recordAuditEvent } from '../audit/service.js';
import { currentUser, requireAuth } from '../auth/guard.js';
import { AdoptiumApiError, AdoptiumChecksumError } from '../java/adoptium.js';
import { MojangManifestError } from '../java/mojang.js';
import { JavaInstallError } from '../java/runtime-service.js';

interface RuntimeParams {
  id: string;
}

interface RuntimesQuery {
  refresh?: string;
}

interface RequirementQuery {
  mcVersion?: string;
}

interface ProbeQuery {
  path?: string;
}

export const javaRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/java/runtimes', { preHandler: requireAuth }, async (request) => {
    const { refresh } = request.query as RuntimesQuery;
    const runtimes = await app.javaRuntimeService.list({ refresh: refresh === 'true' });
    return { runtimes } satisfies JavaRuntimeListResponse;
  });

  app.get('/api/java/runtimes/probe', { preHandler: requireAuth }, async (request, reply) => {
    const javaPath = (request.query as ProbeQuery).path?.trim();
    if (!javaPath) {
      return reply.code(400).send({ error: 'path query parameter is required' });
    }

    const runtime = await app.javaRuntimeService.probe(javaPath);
    if (!runtime) {
      return reply.code(404).send({ error: 'No Java runtime found at the given path' });
    }
    return { runtime } satisfies JavaRuntimeResponse;
  });

  app.get('/api/java/requirement', { preHandler: requireAuth }, async (request, reply) => {    const mcVersion = (request.query as RequirementQuery).mcVersion?.trim();
    if (!mcVersion) {
      return reply.code(400).send({ error: 'mcVersion query parameter is required' });
    }

    try {
      const requirement = await app.javaRuntimeService.requirement(mcVersion);
      return requirement satisfies JavaVersionRequirement;
    } catch (error) {
      if (error instanceof MojangManifestError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post('/api/java/runtimes/install', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = installJavaRuntimeInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid install payload', issues: parsed.error.issues });
    }

    try {
      const { runtime, alreadyInstalled } = await app.javaRuntimeService.install(parsed.data);
      if (!alreadyInstalled) {
        recordAuditEvent(app.db, {
          action: 'java.runtime.installed',
          userId: currentUser(request).id,
          details: {
            runtimeId: runtime.id,
            vendor: runtime.vendor,
            version: runtime.version,
          },
        });
      }
      return reply
        .code(alreadyInstalled ? 200 : 201)
        .send({ runtime, alreadyInstalled } satisfies InstallJavaRuntimeResponse);
    } catch (error) {
      if (
        error instanceof AdoptiumApiError ||
        error instanceof AdoptiumChecksumError ||
        error instanceof JavaInstallError
      ) {
        return reply.code(502).send({ error: error.message });
      }
      throw error;
    }
  });

  app.delete('/api/java/runtimes/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as RuntimeParams;
    if (!(await app.javaRuntimeService.remove(id))) {
      return reply.code(404).send({ error: 'Managed Java runtime not found' });
    }

    recordAuditEvent(app.db, {
      action: 'java.runtime.removed',
      userId: currentUser(request).id,
      details: { runtimeId: id },
    });
    return reply.code(204).send();
  });
};
