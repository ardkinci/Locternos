import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface Config {
  host: string;
  port: number;
  logLevel: string;
  /** Allowed CORS origins (the Vite dev server by default). */
  corsOrigins: string[];
  /** Built frontend assets served in production. */
  frontendDir: string;
  dataDir: string;
  paths: {
    database: string;
    servers: string;
    runtimes: string;
    backups: string;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.LOCTERNOS_DATA_DIR ?? path.join(repoRoot, 'data'));
  return {
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3000),
    logLevel: env.LOG_LEVEL ?? 'info',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()),
    frontendDir: path.resolve(
      env.LOCTERNOS_FRONTEND_DIR ?? path.join(repoRoot, 'apps/frontend/dist'),
    ),
    dataDir,
    paths: {
      database: path.join(dataDir, 'locternos.db'),
      servers: path.join(dataDir, 'servers'),
      runtimes: path.join(dataDir, 'runtimes'),
      backups: path.join(dataDir, 'backups'),
    },
  };
}
