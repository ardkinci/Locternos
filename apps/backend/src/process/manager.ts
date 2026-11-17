import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { eq } from 'drizzle-orm';
import type {
  ConsoleLine,
  RuntimeErrorCode,
  Server,
  ServerMetrics,
  ServerRuntimeState,
  ServerStatus,
  WsServerMessage,
} from '@locternos/shared';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { serverRuns, servers } from '../db/schema.js';
import { recordAuditEvent } from '../audit/service.js';
import { appendServerLogs, type LogEntry } from '../logs/service.js';
import { finishServerRun, startServerRun } from '../runs/service.js';
import { getServer } from '../servers/service.js';
import { buildJvmArgs } from '../servers/jvm-args.js';
import {
  entrypointExists,
  initializeWorkspace,
  isEulaAccepted,
  serverDirectory,
  writeEulaAccepted,
} from '../servers/workspace.js';
import { isServerReadyLine, parseLogLine, splitLines } from '../lib/log-line.js';
import { readProcessMetrics, type ProcessCpuState } from '../lib/process-metrics.js';
import { directorySizeBytes } from '../lib/disk-usage.js';

const CONSOLE_BUFFER_LINES = 1000;
const LOG_QUEUE_LIMIT = 5000;

export interface RuntimeLogger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export class RuntimeError extends Error {
  constructor(
    message: string,
    readonly code: RuntimeErrorCode | 'not_found',
    readonly statusCode = 409,
  ) {
    super(message);
    this.name = 'RuntimeError';
  }
}

/** In-memory state of one live server process. */
interface ManagedServer {
  serverId: string;
  child: ChildProcessWithoutNullStreams;
  pid: number;
  runId: string;
  startedAt: number;
  spawned: boolean;
  status: ServerStatus;
  stopReason: string | null;
  pendingRestart: boolean;
  restartUserId: string | null;
  metricsState: ProcessCpuState | null;
  ramMb: number | null;
  cpuPercent: number | null;
  peakRamMb: number | null;
  diskBytes: number | null;
  logQueue: LogEntry[];
  logTimer: NodeJS.Timeout | null;
  consoleQueue: ConsoleLine[];
  consoleTimer: NodeJS.Timeout | null;
  readyTimer: NodeJS.Timeout | null;
  stopTimer: NodeJS.Timeout | null;
  metricsTimer: NodeJS.Timeout | null;
  diskTimer: NodeJS.Timeout | null;
  stdoutPending: string;
  stderrPending: string;
  finalized: boolean;
  exited: Promise<void>;
  resolveExited: () => void;
}

export type RuntimeListener = (message: WsServerMessage) => void;

export interface ServerRuntimeService {
  start(serverId: string, userId: string | null): Promise<ServerRuntimeState>;
  stop(
    serverId: string,
    options: { timeoutMs?: number },
    userId: string | null,
  ): Promise<ServerRuntimeState>;
  kill(serverId: string, userId: string | null): Promise<ServerRuntimeState>;
  restart(
    serverId: string,
    options: { timeoutMs?: number },
    userId: string | null,
  ): Promise<ServerRuntimeState>;
  sendCommand(serverId: string, command: string, userId: string | null): Promise<void>;
  acceptEula(serverId: string, userId: string | null): Promise<string>;
  getRuntime(serverId: string): Promise<ServerRuntimeState>;
  getConsole(serverId: string): ConsoleLine[];
  subscribe(serverId: string, listener: RuntimeListener): () => void;
  shutdown(): Promise<void>;
}

export interface ServerRuntimeServiceOptions {
  db: Db;
  config: Config;
  logger?: RuntimeLogger;
  now?: () => Date;
  spawnImpl?: typeof spawn;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
  logFlushIntervalMs?: number;
  metricsIntervalMs?: number;
  diskIntervalMs?: number;
}

export function createServerRuntimeService(
  options: ServerRuntimeServiceOptions,
): ServerRuntimeService {
  const { db, config } = options;
  const logger = options.logger ?? { info() {}, warn() {}, error() {} };
  const now = options.now ?? (() => new Date());
  const spawnProcess = options.spawnImpl ?? spawn;
  const readyTimeoutMs = options.readyTimeoutMs ?? 180_000;
  const defaultStopTimeoutMs = options.stopTimeoutMs ?? 30_000;
  const logFlushIntervalMs = options.logFlushIntervalMs ?? 500;
  const metricsIntervalMs = options.metricsIntervalMs ?? 2_000;
  const diskIntervalMs = options.diskIntervalMs ?? 15_000;

  const managed = new Map<string, ManagedServer>();
  const pendingStarts = new Set<string>();
  const consoleBuffers = new Map<string, ConsoleLine[]>();
  const subscribers = new Map<string, Set<RuntimeListener>>();
  let shuttingDown = false;

  function requireServer(serverId: string): Server {
    const server = getServer(db, serverId);
    if (!server) throw new RuntimeError('Server not found', 'not_found', 404);
    return server;
  }

  function buildState(
    server: Server,
    entry: ManagedServer | undefined,
    eulaAccepted?: boolean,
  ): ServerRuntimeState {
    const metrics: ServerMetrics = {
      ramMb: entry?.ramMb ?? null,
      cpuPercent: entry?.cpuPercent ?? null,
      uptimeSeconds: entry
        ? Math.max(0, Math.floor((now().getTime() - entry.startedAt) / 1000))
        : null,
      peakRamMb: entry?.peakRamMb ?? null,
      diskBytes: entry?.diskBytes ?? null,
    };

    return {
      serverId: server.id,
      status: entry?.status ?? server.status,
      pid: entry?.pid ?? null,
      runId: entry?.runId ?? null,
      startedAt: entry ? new Date(entry.startedAt).toISOString() : null,
      eulaAccepted: eulaAccepted ?? server.eulaAcceptedAt !== null,
      metrics,
    };
  }

  function emit(serverId: string, message: WsServerMessage): void {
    const listeners = subscribers.get(serverId);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(message);
      } catch {
        // A dead socket must not break other listeners.
      }
    }
  }

  function broadcastRuntime(serverId: string): void {
    const server = getServer(db, serverId);
    if (!server) return;
    emit(serverId, { type: 'runtime', runtime: buildState(server, managed.get(serverId)) });
  }

  async function diskUsage(server: Server, entry?: ManagedServer): Promise<number | null> {
    try {
      const bytes = await directorySizeBytes(serverDirectory(config, server));
      if (entry) entry.diskBytes = bytes;
      return bytes;
    } catch {
      return entry?.diskBytes ?? null;
    }
  }

  function touchStatus(serverId: string, status: ServerStatus): void {
    db.update(servers)
      .set({ status, updatedAt: now().toISOString() })
      .where(eq(servers.id, serverId))
      .run();
  }

  function scheduleLogFlush(entry: ManagedServer): void {
    if (entry.logTimer) return;
    entry.logTimer = setTimeout(() => {
      entry.logTimer = null;
      flushLogs(entry);
    }, logFlushIntervalMs);
    entry.logTimer.unref();
  }

  function flushLogs(entry: ManagedServer): void {
    if (entry.logQueue.length === 0) return;
    const entries = entry.logQueue.splice(0, entry.logQueue.length);
    const policy = getServer(db, entry.serverId)?.logRetentionPolicy ?? 'none';
    if (policy === 'none') return;
    try {
      appendServerLogs(db, entry.runId, entry.serverId, entries);
    } catch (error) {
      logger.error({ err: error, serverId: entry.serverId }, 'failed to persist console logs');
    }
  }

  function scheduleConsoleFlush(serverId: string, entry: ManagedServer): void {
    if (entry.consoleTimer) return;
    entry.consoleTimer = setTimeout(() => {
      entry.consoleTimer = null;
      flushConsole(serverId, entry);
    }, 50);
    entry.consoleTimer.unref();
  }

  function flushConsole(serverId: string, entry: ManagedServer): void {
    if (entry.consoleQueue.length === 0) return;
    const lines = entry.consoleQueue.splice(0, entry.consoleQueue.length);
    emit(serverId, { type: 'console', serverId, lines });
  }

  function recordLine(entry: ManagedServer, parsed: ConsoleLine): void {
    const buffer = consoleBuffers.get(entry.serverId) ?? [];
    buffer.push(parsed);
    if (buffer.length > CONSOLE_BUFFER_LINES) {
      buffer.splice(0, buffer.length - CONSOLE_BUFFER_LINES);
    }
    consoleBuffers.set(entry.serverId, buffer);

    entry.consoleQueue.push(parsed);
    scheduleConsoleFlush(entry.serverId, entry);

    entry.logQueue.push({
      timestamp: parsed.timestamp,
      level: parsed.level,
      thread: parsed.thread,
      message: parsed.message,
    });
    if (entry.logQueue.length > LOG_QUEUE_LIMIT) {
      entry.logQueue.splice(0, entry.logQueue.length - LOG_QUEUE_LIMIT);
    }
    scheduleLogFlush(entry);

    if (entry.status === 'starting' && isServerReadyLine(parsed.message)) {
      markRunning(entry);
    }
  }

  function handleChunk(entry: ManagedServer, stream: 'stdout' | 'stderr', chunk: Buffer): void {
    const pendingKey = stream === 'stdout' ? 'stdoutPending' : 'stderrPending';
    const { lines, pending } = splitLines(chunk.toString(), entry[pendingKey]);
    entry[pendingKey] = pending;
    for (const line of lines) {
      recordLine(entry, parseLogLine(line, stream, now()));
    }
  }

  function markRunning(entry: ManagedServer): void {
    if (entry.status !== 'starting') return;
    entry.status = 'running';
    if (entry.readyTimer) {
      clearTimeout(entry.readyTimer);
      entry.readyTimer = null;
    }
    touchStatus(entry.serverId, 'running');
    broadcastRuntime(entry.serverId);
  }

  function startMetrics(entry: ManagedServer): void {
    entry.metricsTimer = setInterval(() => void sampleMetrics(entry), metricsIntervalMs);
    entry.metricsTimer.unref();

    entry.diskTimer = setInterval(() => {
      const server = getServer(db, entry.serverId);
      if (!server) return;
      void diskUsage(server, entry).then(() => broadcastRuntime(entry.serverId));
    }, diskIntervalMs);
    entry.diskTimer.unref();
  }

  async function sampleMetrics(entry: ManagedServer): Promise<void> {
    if (entry.finalized) return;
    const result = await readProcessMetrics(entry.pid, entry.metricsState, now().getTime());
    if (entry.finalized) return;
    entry.metricsState = result.state;
    entry.ramMb = result.sample.ramMb;
    entry.cpuPercent = result.sample.cpuPercent;
    if (result.sample.ramMb !== null) {
      entry.peakRamMb = Math.max(entry.peakRamMb ?? 0, result.sample.ramMb);
    }
    broadcastRuntime(entry.serverId);
  }

  function clearTimer(timer: NodeJS.Timeout | null): void {
    if (timer) clearTimeout(timer);
  }

  function stopTimers(entry: ManagedServer): void {
    clearTimer(entry.readyTimer);
    clearTimer(entry.stopTimer);
    clearTimer(entry.metricsTimer);
    clearTimer(entry.diskTimer);
    clearTimer(entry.consoleTimer);
    clearTimer(entry.logTimer);
    entry.readyTimer = null;
    entry.stopTimer = null;
    entry.metricsTimer = null;
    entry.diskTimer = null;
    entry.consoleTimer = null;
    entry.logTimer = null;
  }

  async function finalize(
    entry: ManagedServer,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    if (entry.finalized) return;
    entry.finalized = true;
    stopTimers(entry);

    // Flush a trailing partial line that never received a newline.
    if (entry.stdoutPending.length > 0) {
      recordLine(entry, parseLogLine(entry.stdoutPending, 'stdout', now()));
      entry.stdoutPending = '';
    }
    if (entry.stderrPending.length > 0) {
      recordLine(entry, parseLogLine(entry.stderrPending, 'stderr', now()));
      entry.stderrPending = '';
    }
    flushLogs(entry);
    flushConsole(entry.serverId, entry);

    const requestedReason = entry.stopReason;
    const crashed = exitCode !== 0 && !requestedReason && entry.spawned;
    const stopReason = requestedReason ?? (crashed ? 'crashed' : 'exit');
    const status: ServerStatus = crashed ? 'crashed' : 'stopped';
    const timestamp = now();

    const server = getServer(db, entry.serverId);
    if (server) await diskUsage(server, entry);

    finishServerRun(db, entry.runId, {
      exitCode,
      stopReason: signal && !requestedReason ? `signal:${signal}` : stopReason,
      peakRamMb: entry.peakRamMb,
      at: timestamp,
    });
    touchStatus(entry.serverId, status);
    recordAuditEvent(
      db,
      {
        action: 'server.stopped',
        serverId: entry.serverId,
        details: { exitCode, signal, stopReason },
      },
      timestamp,
    );

    managed.delete(entry.serverId);
    broadcastRuntime(entry.serverId);
    entry.resolveExited();

    logger.info(
      { serverId: entry.serverId, exitCode, signal, stopReason },
      'server process exited',
    );

    if (entry.pendingRestart && !shuttingDown) {
      try {
        await start(entry.serverId, entry.restartUserId);
      } catch (error) {
        logger.error({ err: error, serverId: entry.serverId }, 'scheduled restart failed');
        emit(entry.serverId, {
          type: 'error',
          serverId: entry.serverId,
          message: error instanceof Error ? error.message : 'Restart failed',
        });
      }
    }
  }

  async function start(serverId: string, userId: string | null): Promise<ServerRuntimeState> {
    if (shuttingDown) {
      throw new RuntimeError('The panel is shutting down', 'invalid_state');
    }
    if (managed.has(serverId) || pendingStarts.has(serverId)) {
      throw new RuntimeError('Server is already running', 'already_running');
    }

    const server = requireServer(serverId);
    if (!server.eulaAcceptedAt) {
      throw new RuntimeError(
        'The Minecraft EULA must be accepted before starting this server',
        'eula_required',
      );
    }

    const serverDir = serverDirectory(config, server);
    if (!(await isEulaAccepted(serverDir))) {
      throw new RuntimeError(
        'eula.txt is missing or not accepted; accept the Minecraft EULA to continue',
        'eula_required',
      );
    }
    if (!(await entrypointExists(serverDir, server.entrypointJar))) {
      throw new RuntimeError(
        'No server core is installed; install a core jar before starting',
        'core_missing',
      );
    }

    pendingStarts.add(serverId);
    try {
      await initializeWorkspace(serverDir, {
        port: server.port,
        motd: `${server.name} — powered by Locternos`,
      });

      const run = startServerRun(db, serverId, null, now());
      const startedAt = now().getTime();
      touchStatus(serverId, 'starting');

      const args = buildJvmArgs({
        minRamMb: server.minRamMb,
        maxRamMb: server.maxRamMb,
        profile: server.jvmFlagsProfile,
        customJvmArgs: server.customJvmArgs,
        entrypointJar: server.entrypointJar,
      });

      const child = spawnProcess(server.javaPath ?? 'java', args, {
        cwd: serverDir,
        stdio: 'pipe',
      }) as ChildProcessWithoutNullStreams;

      let resolveExited = () => {};
      const exited = new Promise<void>((resolve) => {
        resolveExited = resolve;
      });

      const entry: ManagedServer = {
        serverId,
        child,
        pid: child.pid ?? 0,
        runId: run.id,
        startedAt,
        spawned: false,
        status: 'starting',
        stopReason: null,
        pendingRestart: false,
        restartUserId: userId,
        metricsState: null,
        ramMb: null,
        cpuPercent: null,
        peakRamMb: null,
        diskBytes: null,
        logQueue: [],
        logTimer: null,
        consoleQueue: [],
        consoleTimer: null,
        readyTimer: null,
        stopTimer: null,
        metricsTimer: null,
        diskTimer: null,
        stdoutPending: '',
        stderrPending: '',
        finalized: false,
        exited,
        resolveExited,
      };

      managed.set(serverId, entry);
      child.stdout.on('data', (chunk: Buffer) => handleChunk(entry, 'stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => handleChunk(entry, 'stderr', chunk));

      child.once('error', (error) => {
        if (!entry.spawned) entry.stopReason = 'spawn_failed';
        logger.error({ err: error, serverId }, 'server process error');
        void finalize(entry, null, null);
      });

      child.once('close', (code, signal) => {
        void finalize(entry, code, signal);
      });

      try {
        await new Promise<void>((resolve, reject) => {
          child.once('spawn', () => resolve());
          child.once('error', reject);
        });
      } catch (error) {
        throw new RuntimeError(
          `Failed to start server: ${error instanceof Error ? error.message : String(error)}`,
          'invalid_state',
        );
      }

      entry.spawned = true;

      // The process can exit before the first await resolves; avoid arming
      // timers or recording a start for a run that is already finished.
      if (entry.finalized) {
        return buildState(requireServer(serverId), undefined);
      }

      entry.pid = child.pid ?? entry.pid;
      if (entry.pid > 0) {
        db.update(serverRuns).set({ pid: entry.pid }).where(eq(serverRuns.id, run.id)).run();
      }

      entry.readyTimer = setTimeout(() => markRunning(entry), readyTimeoutMs);
      entry.readyTimer.unref();
      startMetrics(entry);
      await diskUsage(server, entry);

      recordAuditEvent(db, {
        action: 'server.started',
        serverId,
        userId,
        details: {
          pid: entry.pid,
          minRamMb: server.minRamMb,
          maxRamMb: server.maxRamMb,
          profile: server.jvmFlagsProfile,
        },
      });

      broadcastRuntime(serverId);
      return buildState(requireServer(serverId), entry);
    } finally {
      pendingStarts.delete(serverId);
    }
  }

  function requestStop(
    entry: ManagedServer,
    reason: string,
    timeoutMs: number,
  ): void {
    entry.status = 'stopping';
    entry.stopReason = reason;
    touchStatus(entry.serverId, 'stopping');
    broadcastRuntime(entry.serverId);

    try {
      entry.child.stdin.write('stop\n');
    } catch {
      // stdin may already be closed; the timeout below still applies.
    }

    clearTimer(entry.stopTimer);
    entry.stopTimer = setTimeout(() => {
      if (entry.finalized) return;
      entry.stopReason = `${reason}_timeout`;
      try {
        entry.child.kill('SIGKILL');
      } catch {
        // Process already exited.
      }
    }, timeoutMs);
    entry.stopTimer.unref();
  }

  function stop(
    serverId: string,
    stopOptions: { timeoutMs?: number },
    userId: string | null,
  ): Promise<ServerRuntimeState> {
    const entry = managed.get(serverId);
    if (!entry) {
      return Promise.reject(new RuntimeError('Server is not running', 'not_running'));
    }
    if (entry.status !== 'stopping') {
      recordAuditEvent(db, {
        action: 'server.stop_requested',
        serverId,
        userId,
        details: { timeoutMs: stopOptions.timeoutMs ?? defaultStopTimeoutMs },
      });
      requestStop(entry, 'stopped', stopOptions.timeoutMs ?? defaultStopTimeoutMs);
    }
    return Promise.resolve(buildState(requireServer(serverId), entry));
  }

  function kill(serverId: string, userId: string | null): Promise<ServerRuntimeState> {
    const entry = managed.get(serverId);
    if (!entry) {
      return Promise.reject(new RuntimeError('Server is not running', 'not_running'));
    }

    entry.status = 'stopping';
    entry.stopReason = 'force_killed';
    touchStatus(serverId, 'stopping');
    broadcastRuntime(serverId);

    recordAuditEvent(db, {
      action: 'server.force_killed',
      serverId,
      userId,
    });

    try {
      entry.child.kill('SIGKILL');
    } catch {
      // Process already exited; the close handler reconciles state.
    }

    return Promise.resolve(buildState(requireServer(serverId), entry));
  }

  function restart(
    serverId: string,
    restartOptions: { timeoutMs?: number },
    userId: string | null,
  ): Promise<ServerRuntimeState> {
    const entry = managed.get(serverId);
    if (!entry) {
      return start(serverId, userId);
    }

    entry.pendingRestart = true;
    entry.restartUserId = userId;
    recordAuditEvent(db, {
      action: 'server.restart_requested',
      serverId,
      userId,
      details: { timeoutMs: restartOptions.timeoutMs ?? defaultStopTimeoutMs },
    });
    if (entry.status !== 'stopping') {
      requestStop(entry, 'restart', restartOptions.timeoutMs ?? defaultStopTimeoutMs);
    }
    return Promise.resolve(buildState(requireServer(serverId), entry));
  }

  async function sendCommand(
    serverId: string,
    command: string,
    userId: string | null,
  ): Promise<void> {
    const entry = managed.get(serverId);
    if (!entry || entry.finalized || entry.status === 'stopping') {
      throw new RuntimeError('Server is not running', 'not_running');
    }

    entry.child.stdin.write(`${command}\n`);
    recordAuditEvent(db, {
      action: 'console.command',
      serverId,
      userId,
      details: { command },
    });
  }

  async function acceptEula(serverId: string, userId: string | null): Promise<string> {
    const server = requireServer(serverId);
    await writeEulaAccepted(serverDirectory(config, server));
    const timestamp = now().toISOString();
    db.update(servers)
      .set({ eulaAcceptedAt: timestamp, updatedAt: timestamp })
      .where(eq(servers.id, serverId))
      .run();

    recordAuditEvent(
      db,
      {
        action: 'eula.accepted',
        serverId,
        userId,
        details: { source: 'panel', url: 'https://aka.ms/MinecraftEULA' },
      },
      new Date(timestamp),
    );
    broadcastRuntime(serverId);
    return timestamp;
  }

  async function getRuntime(serverId: string): Promise<ServerRuntimeState> {
    const server = requireServer(serverId);
    const entry = managed.get(serverId);
    const eulaAccepted =
      server.eulaAcceptedAt !== null &&
      (await isEulaAccepted(serverDirectory(config, server)));
    const state = buildState(server, entry, eulaAccepted);

    if (!entry) {
      state.metrics.diskBytes = await diskUsage(server);
    }
    return state;
  }

  function getConsole(serverId: string): ConsoleLine[] {
    return [...(consoleBuffers.get(serverId) ?? [])];
  }

  function subscribe(serverId: string, listener: RuntimeListener): () => void {
    let listeners = subscribers.get(serverId);
    if (!listeners) {
      listeners = new Set();
      subscribers.set(serverId, listeners);
    }
    listeners.add(listener);

    return () => {
      const current = subscribers.get(serverId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) subscribers.delete(serverId);
    };
  }

  async function shutdown(): Promise<void> {
    shuttingDown = true;
    const entries = [...managed.values()];
    if (entries.length === 0) return;

    await Promise.all(
      entries.map(async (entry) => {
        if (entry.finalized) return;
        entry.stopReason = 'panel_shutdown';
        entry.status = 'stopping';
        try {
          entry.child.kill('SIGTERM');
        } catch {
          return;
        }

        const timeout = new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 10_000);
          timer.unref();
        });
        await Promise.race([entry.exited, timeout]);

        if (!entry.finalized) {
          try {
            entry.child.kill('SIGKILL');
          } catch {
            // Already gone.
          }
          await Promise.race([
            entry.exited,
            new Promise<void>((resolve) => {
              const timer = setTimeout(resolve, 2_000);
              timer.unref();
            }),
          ]);
        }
      }),
    );
  }

  return {
    start,
    stop,
    kill,
    restart,
    sendCommand,
    acceptEula,
    getRuntime,
    getConsole,
    subscribe,
    shutdown,
  };
}
