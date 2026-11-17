import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

/**
 * Drizzle's `drizzle()` instance exposes the underlying better-sqlite3 handle
 * as `$client` at runtime, but the public type omits it. Intersecting it here
 * keeps raw FTS/retention queries type-safe for the few places that need them.
 */
export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export interface DatabaseHandle {
  db: Db;
  close: () => void;
}

/**
 * Opens the SQLite database with the pragmas Locternos relies on:
 * WAL for concurrent readers during log writes, enforced foreign keys,
 * and a busy timeout so short lock contention does not fail requests.
 */
export function openDatabase(file: string): DatabaseHandle {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  return {
    db: drizzle(sqlite, { schema }),
    close: () => sqlite.close(),
  };
}
