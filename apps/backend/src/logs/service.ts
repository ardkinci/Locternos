import { desc, eq } from 'drizzle-orm';
import type { LogLevel, ServerLog } from '@locternos/shared';
import type { Db } from '../db/client.js';
import { serverLogs } from '../db/schema.js';

type LogRow = typeof serverLogs.$inferSelect;

function toServerLog(row: LogRow): ServerLog {
  return {
    id: row.id,
    runId: row.runId,
    serverId: row.serverId,
    timestamp: row.timestamp,
    level: row.level as ServerLog['level'],
    thread: row.thread,
    message: row.message,
  };
}

export interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  thread: string | null;
  message: string;
}

/**
 * Batch insert log lines. Each log line is associated with both the current
 * run and the server for filtering and retention cleanup.
 */
export function appendServerLogs(
  db: Db,
  runId: string,
  serverId: string,
  entries: LogEntry[],
): number {
  if (entries.length === 0) return 0;

  const rows = entries.map((entry): Omit<LogRow, 'id'> => ({
    runId,
    serverId,
    timestamp: entry.timestamp,
    level: entry.level,
    thread: entry.thread,
    message: entry.message,
  }));

  db.insert(serverLogs).values(rows).run();
  return rows.length;
}

/** List logs for a server, most recent first. */
export function listServerLogs(db: Db, serverId: string, limit: number = 1000): ServerLog[] {
  const rows = db
    .select()
    .from(serverLogs)
    .where(eq(serverLogs.serverId, serverId))
    .orderBy(desc(serverLogs.timestamp))
    .limit(limit)
    .all();
  return rows.map(toServerLog);
}

/** List all logs from a specific run. */
export function listServerLogsByRun(db: Db, runId: string, limit: number = 10000): ServerLog[] {
  const rows = db
    .select()
    .from(serverLogs)
    .where(eq(serverLogs.runId, runId))
    .orderBy(desc(serverLogs.timestamp))
    .limit(limit)
    .all();
  return rows.map(toServerLog);
}

export interface LogQueryOptions {
  /** Free-text search; when omitted the most recent lines are returned. */
  query?: string;
  runId?: string;
  level?: LogLevel;
  limit?: number;
}

/**
 * Combines the recent-log listing with the FTS5 keyword search so the panel
 * can use one endpoint for both "latest output" and "search history".
 */
export function queryServerLogs(
  db: Db,
  serverId: string,
  options: LogQueryOptions = {},
): ServerLog[] {
  const { query, runId, level, limit = 500 } = options;

  const logs = query?.trim()
    ? searchServerLogs(db, query.trim(), { serverId, runId, limit: limit * 4 })
    : listServerLogs(db, serverId, limit * 4);

  return logs
    .filter((log) => (runId ? log.runId === runId : true))
    .filter((log) => (level ? log.level === level : true))
    .slice(0, limit);
}

/**
 * Search logs by keyword using FTS5. The `server_logs_fts` virtual table is
 * kept in sync via triggers and searched with an FTS MATCH clause.
 *
 * Returns the matching logs ordered by recency.
 */
export function searchServerLogs(
  db: Db,
  query: string,
  options: {
    serverId?: string;
    runId?: string;
    limit?: number;
  } = {},
): ServerLog[] {
  const { serverId, runId, limit = 1000 } = options;

  // Build FTS MATCH query safely: SQLite requires exact match syntax.
  // Simple query: each term must appear. For complex queries users can use FTS syntax.
  const matchQuery = query.split(/\s+/).filter(Boolean).join(' AND ');

  // We query via raw SQL since drizzle doesn't have good FTS5 integration.
  // We fetch the best-match rowid from FTS, then join back to get full columns.
  let sql = `
    SELECT l.id, l.run_id, l.server_id, l.timestamp, l.level, l.thread, l.message
    FROM server_logs l
    JOIN server_logs_fts fts ON fts.rowid = l.id
    WHERE fts.message MATCH ?
  `;
  const params: (string | number)[] = [matchQuery];

  if (serverId) {
    sql += ` AND l.server_id = ?`;
    params.push(serverId);
  }
  if (runId) {
    sql += ` AND l.run_id = ?`;
    params.push(runId);
  }

  sql += ` ORDER BY l.timestamp DESC LIMIT ?`;
  params.push(limit);

  const rows = db.$client.prepare(sql).all(...params) as LogRow[];
  return rows.map(toServerLog);
}
