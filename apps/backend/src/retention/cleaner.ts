import type { LogRetentionPolicy } from '@locternos/shared';
import type { Db } from '../db/client.js';
import { servers } from '../db/schema.js';

/** Time intervals in milliseconds. */
const RETENTION_INTERVALS: Record<LogRetentionPolicy, number | null> = {
  none: 0, // delete all immediately
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
  '365d': 365 * 24 * 60 * 60 * 1000,
  forever: null, // never delete
};

/**
 * Clean up expired logs and old run history according to per-server
 * retention policies. Called on startup and periodically during operation.
 */
export function cleanupExpiredHistory(db: Db, now = new Date()): { logsDeleted: number; runsDeleted: number } {
  let logsDeleted = 0;
  let runsDeleted = 0;

  // Fetch all servers and their retention policies.
  const allServers = db.select({ id: servers.id, logRetentionPolicy: servers.logRetentionPolicy }).from(servers).all();

  for (const server of allServers) {
    const policy = server.logRetentionPolicy as LogRetentionPolicy;
    const interval = RETENTION_INTERVALS[policy];

    if (interval === null) {
      // 'forever' policy: skip cleanup
      continue;
    }

    // Calculate cutoff time (logs/runs before this timestamp are deleted).
    const cutoffMs = interval === 0 ? now.getTime() : now.getTime() - interval;
    const cutoffIso = new Date(cutoffMs).toISOString();

    // Delete logs older than cutoff.
    const logsResult = db.$client
      .prepare(
        `
      DELETE FROM server_logs
      WHERE server_id = ? AND timestamp < ?
    `,
      )
      .run(server.id, cutoffIso);
    logsDeleted += logsResult.changes;

    // Delete completed runs older than cutoff (only if stoppedAt is not null).
    const runsResult = db.$client
      .prepare(
        `
      DELETE FROM server_runs
      WHERE server_id = ? AND stopped_at IS NOT NULL AND started_at < ?
    `,
      )
      .run(server.id, cutoffIso);
    runsDeleted += runsResult.changes;
  }

  return { logsDeleted, runsDeleted };
}
