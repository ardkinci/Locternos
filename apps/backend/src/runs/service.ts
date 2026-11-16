import { randomUUID } from 'node:crypto';
import { desc, eq, isNull } from 'drizzle-orm';
import type { ServerRun } from '@locternos/shared';
import type { Db } from '../db/client.js';
import { serverRuns, servers } from '../db/schema.js';

type RunRow = typeof serverRuns.$inferSelect;

function toServerRun(row: RunRow): ServerRun {
  return {
    id: row.id,
    serverId: row.serverId,
    pid: row.pid,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt,
    exitCode: row.exitCode,
    stopReason: row.stopReason,
    peakRamMb: row.peakRamMb,
  };
}

/** Start a new server run. */
export function startServerRun(db: Db, serverId: string, pid: number | null = null, now = new Date()): ServerRun {
  const id = randomUUID();
  const timestamp = now.toISOString();

  const row: RunRow = {
    id,
    serverId,
    pid,
    startedAt: timestamp,
    stoppedAt: null,
    exitCode: null,
    stopReason: null,
    peakRamMb: null,
  };

  db.insert(serverRuns).values(row).run();
  return toServerRun(row);
}

export interface FinishRunInput {
  exitCode?: number | null;
  stopReason?: string | null;
  peakRamMb?: number | null;
  at?: Date;
}

/** Mark a run as stopped and optionally record exit details. */
export function finishServerRun(db: Db, runId: string, input: FinishRunInput = {}): ServerRun | null {
  const existing = db.select().from(serverRuns).where(eq(serverRuns.id, runId)).get();
  if (!existing) return null;

  const timestamp = (input.at ?? new Date()).toISOString();
  const changes: Partial<RunRow> = { stoppedAt: timestamp };
  if (input.exitCode !== undefined) changes.exitCode = input.exitCode;
  if (input.stopReason !== undefined) changes.stopReason = input.stopReason;
  if (input.peakRamMb !== undefined) changes.peakRamMb = input.peakRamMb;

  db.update(serverRuns).set(changes).where(eq(serverRuns.id, runId)).run();
  const updated = db.select().from(serverRuns).where(eq(serverRuns.id, runId)).get();
  return updated ? toServerRun(updated) : null;
}

/** List all runs for a server, most recent first. */
export function listServerRuns(db: Db, serverId: string): ServerRun[] {
  const rows = db
    .select()
    .from(serverRuns)
    .where(eq(serverRuns.serverId, serverId))
    .orderBy(desc(serverRuns.startedAt), desc(serverRuns.id))
    .all();
  return rows.map(toServerRun);
}

/** Fetch a single run by ID. */
export function getServerRun(db: Db, runId: string): ServerRun | null {
  const row = db.select().from(serverRuns).where(eq(serverRuns.id, runId)).get();
  return row ? toServerRun(row) : null;
}

export interface RecoveryOptions {
  /**
   * Test hook: check if a process is alive. Defaults to checking if the PID
   * is still running via `process.kill(pid, 0)`.
   */
  isAlive?: (pid: number) => boolean;
  at?: Date;
}

/**
 * Reconcile server run states if the backend restarted while runs were
 * still marked as "open" in the database. Unclosed runs with dead processes
 * are marked as stopped with `stopReason: 'panel_offline'`.
 */
export function recoverOrphanedRuns(
  db: Db,
  { isAlive = defaultIsProcessAlive, at = new Date() }: RecoveryOptions = {},
): { recovered: number; stillRunning: number } {
  const unclosed = db
    .select()
    .from(serverRuns)
    .where(isNull(serverRuns.stoppedAt))
    .all();

  let recovered = 0;
  let stillRunning = 0;

  for (const run of unclosed) {
    if (run.pid !== null && isAlive(run.pid)) {
      stillRunning += 1;
    } else {
      finishServerRun(db, run.id, {
        stopReason: 'panel_offline',
        at,
      });
      recovered += 1;
    }
  }

  // Also reconcile server statuses: if a server is marked running/starting/stopping
  // but its latest run is now stopped, mark the server as stopped.
  const serversToReconcile = db
    .select({ id: servers.id, status: servers.status })
    .from(servers)
    .all();

  for (const server of serversToReconcile) {
    if (!['running', 'starting', 'stopping'].includes(server.status)) {
      continue;
    }

    const latestRun = db
      .select()
      .from(serverRuns)
      .where(eq(serverRuns.serverId, server.id))
      .orderBy(desc(serverRuns.startedAt))
      .get();

    if (!latestRun || latestRun.stoppedAt !== null) {
      db.update(servers).set({ status: 'stopped' }).where(eq(servers.id, server.id)).run();
    }
  }

  return { recovered, stillRunning };
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    // kill(pid, 0) sends a signal 0 (no-op) to test if the process exists.
    // Throws if the process is dead.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
