import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  artifactKindSchema,
  installArtifactInputSchema,
  installCoreInputSchema,
  setArtifactEnabledInputSchema,
} from '@locternos/shared';
import { currentUser, requireAuth } from '../auth/guard.js';
import { ChecksumMismatchError, DownloadError } from '../lib/download.js';
import { JarValidationError } from '../artifacts/installer.js';
import {
  ArtifactInstallError,
  ServerNotFoundError,
  type InstallArtifactOutcome,
} from '../artifacts/install-service.js';
import { VanillaProviderError } from '../providers/vanilla.js';
import { PaperProviderError } from '../providers/paper.js';
import { FabricProviderError } from '../providers/fabric.js';
import { ModrinthError } from '../providers/modrinth.js';

interface ServerParams {
  id: string;
}

interface ArtifactParams {
  id: string;
  artifactId: string;
}

interface UploadQuery {
  kind?: string;
}

function sendDomainError(reply: FastifyReply, error: unknown) {
  if (error instanceof ServerNotFoundError) {
    return reply.code(404).send({ error: error.message });
  }
  if (error instanceof JarValidationError || error instanceof ArtifactInstallError) {
    return reply.code(400).send({ error: error.message });
  }
  if (
    error instanceof VanillaProviderError ||
    error instanceof PaperProviderError ||
    error instanceof FabricProviderError ||
    error instanceof ModrinthError ||
    error instanceof DownloadError ||
    error instanceof ChecksumMismatchError
  ) {
    return reply.code(502).send({ error: error.message });
  }
  throw error;
}

export const artifactRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/servers/:id/artifacts', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as ServerParams;
    try {
      return { artifacts: app.artifactInstallService.list(id) };
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.post('/api/servers/:id/core', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = installCoreInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid core install payload', issues: parsed.error.issues });
    }

    const { id } = request.params as ServerParams;
    try {
      const result = await app.artifactInstallService.installCore(
        id,
        parsed.data,
        currentUser(request).id,
      );
      return reply.code(201).send({ server: result.server, artifact: result.artifact });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.post('/api/servers/:id/artifacts', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = installArtifactInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid artifact payload', issues: parsed.error.issues });
    }

    const { id } = request.params as ServerParams;
    try {
      const outcome: InstallArtifactOutcome = await app.artifactInstallService.installArtifact(
        id,
        parsed.data,
        currentUser(request).id,
      );
      if (outcome.status === 'needs_selection') {
        return reply.code(409).send(outcome);
      }
      return reply.code(201).send(outcome);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.post('/api/servers/:id/artifacts/upload', { preHandler: requireAuth }, async (request, reply) => {
    const kind = artifactKindSchema.safeParse((request.query as UploadQuery).kind);
    if (!kind.success) {
      return reply.code(400).send({ error: 'kind query parameter must be core|plugin|mod|datapack' });
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: 'A file field is required' });
    }

    const data = await file.toBuffer();
    if (file.file.truncated) {
      return reply.code(413).send({ error: 'Uploaded file exceeds the size limit' });
    }

    const { id } = request.params as ServerParams;
    try {
      const result = await app.artifactInstallService.installUpload(
        id,
        { kind: kind.data, filename: file.filename, data },
        currentUser(request).id,
      );
      return reply.code(201).send(result);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  app.patch(
    '/api/servers/:id/artifacts/:artifactId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = setArtifactEnabledInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid artifact payload', issues: parsed.error.issues });
      }

      const { id, artifactId } = request.params as ArtifactParams;
      try {
        const artifact = await app.artifactInstallService.setEnabled(
          id,
          artifactId,
          parsed.data.enabled,
          currentUser(request).id,
        );
        if (!artifact) {
          return reply.code(404).send({ error: 'Artifact not found' });
        }
        return { artifact };
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );

  app.delete(
    '/api/servers/:id/artifacts/:artifactId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id, artifactId } = request.params as ArtifactParams;
      try {
        if (!(await app.artifactInstallService.remove(id, artifactId, currentUser(request).id))) {
          return reply.code(404).send({ error: 'Artifact not found' });
        }
        return reply.code(204).send();
      } catch (error) {
        return sendDomainError(reply, error);
      }
    },
  );
};
