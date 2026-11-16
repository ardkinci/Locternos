import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@locternos/shared';
import { VERSION } from '../version.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    version: VERSION,
    uptimeSeconds: Math.round(process.uptime()),
  }));
};
