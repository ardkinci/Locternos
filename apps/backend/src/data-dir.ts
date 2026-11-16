import { mkdir } from 'node:fs/promises';
import type { Config } from './config.js';

/** Ensures the runtime `data/` directory layout exists. */
export async function ensureDataLayout(config: Config): Promise<void> {
  await Promise.all(
    [config.dataDir, config.paths.servers, config.paths.runtimes, config.paths.backups].map((dir) =>
      mkdir(dir, { recursive: true }),
    ),
  );
}
