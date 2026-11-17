import type { FastifyPluginAsync } from 'fastify';
import { requireAuth } from '../auth/guard.js';
import { FabricProviderError } from '../providers/fabric.js';
import { PaperProviderError } from '../providers/paper.js';
import { VanillaProviderError } from '../providers/vanilla.js';

interface PaperBuildsQuery {
  version?: string;
}

export const providerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/providers/vanilla/versions', { preHandler: requireAuth }, async (request, reply) => {
    try {
      return await app.providerCatalogService.vanillaVersions();
    } catch (error) {
      if (error instanceof VanillaProviderError) {
        return reply.code(502).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get('/api/providers/paper/versions', { preHandler: requireAuth }, async (request, reply) => {
    try {
      return await app.providerCatalogService.paperVersions();
    } catch (error) {
      if (error instanceof PaperProviderError) {
        return reply.code(502).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get('/api/providers/paper/builds', { preHandler: requireAuth }, async (request, reply) => {
    const { version } = request.query as PaperBuildsQuery;
    if (!version?.trim()) {
      return reply.code(400).send({ error: 'version query parameter is required' });
    }

    try {
      return await app.providerCatalogService.paperBuilds(version.trim());
    } catch (error) {
      if (error instanceof PaperProviderError) {
        return reply.code(502).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get('/api/providers/fabric/versions', { preHandler: requireAuth }, async (request, reply) => {
    try {
      return await app.providerCatalogService.fabricVersions();
    } catch (error) {
      if (error instanceof FabricProviderError) {
        return reply.code(502).send({ error: error.message });
      }
      throw error;
    }
  });
};
