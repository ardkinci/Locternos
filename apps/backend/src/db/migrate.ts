import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client.js';

// Works from both `src/db` (tsx) and `dist/db` (compiled): both sit two levels
// below the backend package root, where the `drizzle/` folder lives.
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

/** Applies all pending migrations. Safe to call on every startup. */
export function runMigrations(db: Db): void {
  migrate(db, { migrationsFolder });
}
