import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { openDatabase, type Db } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { ensureDataLayout } from './data-dir.js';
import { createJavaRuntimeService, type JavaRuntimeService } from './java/runtime-service.js';
import { recoverOrphanedRuns } from './runs/service.js';
import { createArtifactInstallService, type ArtifactInstallService } from './artifacts/install-service.js';
import {
  createServerRuntimeService,
  type ServerRuntimeService,
  type ServerRuntimeServiceOptions,
} from './process/manager.js';
import { artifactRoutes } from './routes/artifacts.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { javaRoutes } from './routes/java.js';
import { serverRoutes } from './routes/servers.js';
import { runtimeRoutes } from './routes/runtime.js';
import { setupRoutes } from './routes/setup.js';
import { wsRoutes } from './routes/ws.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: Config;
    javaRuntimeService: JavaRuntimeService;
    artifactInstallService: ArtifactInstallService;
    runtimeService: ServerRuntimeService;
  }
}

export interface BuildAppOptions {
  /** Test hook to replace filesystem and network bound Java discovery. */
  javaRuntimeService?: JavaRuntimeService;
  /** Test hook to replace network bound artifact installs. */
  artifactInstallService?: ArtifactInstallService;
  /** Test hook to tune process lifecycle timings. */
  runtimeServiceOptions?: Pick<
    ServerRuntimeServiceOptions,
    'readyTimeoutMs' | 'stopTimeoutMs' | 'logFlushIntervalMs' | 'metricsIntervalMs' | 'diskIntervalMs'
  >;
  /** Test hook to replace the process lifecycle service entirely. */
  runtimeService?: ServerRuntimeService;
}

export async function buildApp(
  config: Config,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  await ensureDataLayout(config);

  const app = Fastify({ logger: { level: config.logLevel } });

  const database = openDatabase(config.paths.database);
  runMigrations(database.db);

  // Reconcile database state if the backend restarted while runs were marked as running.
  const { recovered, stillRunning } = recoverOrphanedRuns(database.db);
  if (recovered > 0 || stillRunning > 0) {
    app.log.info({ recovered, stillRunning }, 'reconciled orphaned server runs');
  }

  app.decorate('db', database.db);
  app.decorate('config', config);
  app.decorate(
    'javaRuntimeService',
    options.javaRuntimeService ??
      createJavaRuntimeService({ runtimesDir: config.paths.runtimes }),
  );
  app.decorate(
    'artifactInstallService',
    options.artifactInstallService ?? createArtifactInstallService({ db: database.db, config }),
  );
  const runtimeService =
    options.runtimeService ??
    createServerRuntimeService({
      db: database.db,
      config,
      logger: app.log,
      ...options.runtimeServiceOptions,
    });
  app.decorate('runtimeService', runtimeService);
  app.addHook('onClose', async () => {
    await runtimeService.shutdown();
    database.close();
  });

  app.decorateRequest('user', null);
  await app.register(cookie);
  await app.register(cors, { origin: config.corsOrigins });
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 512 * 1024 * 1024, files: 1 } });

  await app.register(healthRoutes);
  await app.register(setupRoutes);
  await app.register(authRoutes);
  await app.register(serverRoutes);
  await app.register(runtimeRoutes);
  await app.register(javaRoutes);
  await app.register(artifactRoutes);
  await app.register(wsRoutes);

  // Serve the built frontend (SPA) in production.
  if (existsSync(config.frontendDir)) {
    await app.register(fastifyStatic, { root: config.frontendDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not Found' });
    });
  }

  return app;
}
