import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { recordAuditEvent, listAuditEvents } from '../audit/service.js';
import { recordArtifact, listArtifacts, deleteArtifact } from '../artifacts/service.js';
import { appendServerLogs, listServerLogs, listServerLogsByRun, searchServerLogs } from '../logs/service.js';
import {
  startServerRun,
  finishServerRun,
  listServerRuns,
  getServerRun,
  recoverOrphanedRuns,
} from '../runs/service.js';
import { cleanupExpiredHistory } from '../retention/cleaner.js';
import { createServer } from '../servers/service.js';

interface TestApp {
  app: any; // FastifyInstance
  db: any;
  cleanup: () => Promise<void>;
}

async function startTestApp(): Promise<TestApp> {
  const dir = await mkdtemp(path.join(tmpdir(), 'locternos-db-'));
  const config = loadConfig({
    LOCTERNOS_DATA_DIR: dir,
    LOCTERNOS_FRONTEND_DIR: path.join(dir, 'no-frontend'),
    LOG_LEVEL: 'silent',
  });
  const app = await buildApp(config);
  return {
    app,
    db: app.db,
    cleanup: async () => {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe('database layer services', () => {
  let ctx: TestApp;
  let serverId: string;

  before(async () => {
    ctx = await startTestApp();
    // Create a test server to associate with runs, logs, artifacts.
    const server = createServer(ctx.db, {
      name: 'Test Server',
      coreType: 'vanilla',
      minRamMb: 1024,
      maxRamMb: 2048,
      jvmFlagsProfile: 'default',
      customJvmArgs: '',
      logRetentionPolicy: '7d',
    });
    serverId = server.id;
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('server runs', () => {
    it('starts a new run', () => {
      const run = startServerRun(ctx.db, serverId, 12345, new Date('2026-11-17T10:00:00Z'));
      assert.ok(run.id);
      assert.equal(run.serverId, serverId);
      assert.equal(run.pid, 12345);
      assert.equal(run.startedAt, '2026-11-17T10:00:00.000Z');
      assert.equal(run.stoppedAt, null);
      assert.equal(run.exitCode, null);
    });

    it('finishes a run with exit details', () => {
      const run = startServerRun(ctx.db, serverId, 12346, new Date('2026-11-17T10:00:00Z'));
      const finished = finishServerRun(ctx.db, run.id, {
        exitCode: 0,
        stopReason: 'user_stop',
        peakRamMb: 1536,
        at: new Date('2026-11-17T10:05:00Z'),
      });
      assert.ok(finished);
      assert.equal(finished.exitCode, 0);
      assert.equal(finished.stopReason, 'user_stop');
      assert.equal(finished.peakRamMb, 1536);
      assert.equal(finished.stoppedAt, '2026-11-17T10:05:00.000Z');
    });

    it('lists runs for a server', () => {
      startServerRun(ctx.db, serverId, 12347, new Date('2026-11-17T10:00:00Z'));
      startServerRun(ctx.db, serverId, 12348, new Date('2026-11-17T10:10:00Z'));
      const runs = listServerRuns(ctx.db, serverId);
      assert.ok(runs.length >= 2);
    });

    it('gets a single run by id', () => {
      const run = startServerRun(ctx.db, serverId, 12349, new Date('2026-11-17T10:00:00Z'));
      const fetched = getServerRun(ctx.db, run.id);
      assert.ok(fetched);
      assert.equal(fetched.id, run.id);
      assert.equal(fetched.pid, 12349);
    });

    it('recovers orphaned runs with dead processes', () => {
      const recoveryServer = createServer(ctx.db, {
        name: 'Recovery Test Server',
        coreType: 'vanilla',
        minRamMb: 1024,
        maxRamMb: 2048,
        jvmFlagsProfile: 'default',
        customJvmArgs: '',
        logRetentionPolicy: '7d',
      });

      const run1 = startServerRun(ctx.db, recoveryServer.id, 999999, new Date('2026-11-17T10:00:00Z'));
      const run2 = startServerRun(ctx.db, recoveryServer.id, null, new Date('2026-11-17T10:05:00Z'));

      const result = recoverOrphanedRuns(ctx.db, {
        isAlive: () => false, // all processes are dead
        at: new Date('2026-11-17T10:10:00Z'),
      });

      // Should recover at least the 2 we just created for this test.
      assert.ok(result.recovered >= 2);
      const recovered1 = getServerRun(ctx.db, run1.id);
      const recovered2 = getServerRun(ctx.db, run2.id);
      assert.equal(recovered1?.stopReason, 'panel_offline');
      assert.equal(recovered2?.stopReason, 'panel_offline');
    });
  });

  describe('server logs', () => {
    it('appends log entries', () => {
      const run = startServerRun(ctx.db, serverId, 12350, new Date('2026-11-17T10:00:00Z'));
      const count = appendServerLogs(ctx.db, run.id, serverId, [
        {
          timestamp: '2026-11-17T10:00:01.000Z',
          level: 'INFO',
          thread: 'Server thread',
          message: 'Starting Minecraft server on port 25565',
        },
        {
          timestamp: '2026-11-17T10:00:02.000Z',
          level: 'WARN',
          thread: 'Server thread',
          message: 'Java version is outdated',
        },
      ]);
      assert.equal(count, 2);
    });

    it('lists logs for a server', () => {
      const run = startServerRun(ctx.db, serverId, 12351, new Date('2026-11-17T10:00:00Z'));
      appendServerLogs(ctx.db, run.id, serverId, [
        {
          timestamp: '2026-11-17T10:00:01.000Z',
          level: 'INFO',
          thread: 'Server thread',
          message: 'Server started',
        },
      ]);
      const logs = listServerLogs(ctx.db, serverId, 100);
      assert.ok(logs.length >= 1);
      assert.ok(logs.some((log) => log.message === 'Server started'));
    });

    it('lists logs by run', () => {
      const run = startServerRun(ctx.db, serverId, 12352, new Date('2026-11-17T10:00:00Z'));
      appendServerLogs(ctx.db, run.id, serverId, [
        {
          timestamp: '2026-11-17T10:00:01.000Z',
          level: 'INFO',
          thread: 'Server thread',
          message: 'Run-specific log',
        },
      ]);
      const logs = listServerLogsByRun(ctx.db, run.id);
      assert.equal(logs.length, 1);
      assert.equal(logs[0]?.message, 'Run-specific log');
    });

    it('searches logs via FTS', () => {
      const run = startServerRun(ctx.db, serverId, 12353, new Date('2026-11-17T10:00:00Z'));
      appendServerLogs(ctx.db, run.id, serverId, [
        {
          timestamp: '2026-11-17T10:00:01.000Z',
          level: 'INFO',
          thread: 'Server thread',
          message: 'Player Alice joined the game',
        },
        {
          timestamp: '2026-11-17T10:00:02.000Z',
          level: 'INFO',
          thread: 'Server thread',
          message: 'Player Bob left the game',
        },
      ]);
      const results = searchServerLogs(ctx.db, 'Player Alice', { serverId, limit: 10 });
      assert.equal(results.length, 1);
      assert.ok(results[0]?.message.includes('Alice'));
    });
  });

  describe('artifacts', () => {
    it('records an artifact', () => {
      const artifact = recordArtifact(ctx.db, {
        serverId,
        kind: 'plugin',
        filename: 'EssentialsX-2.20.1.jar',
        sourceType: 'modrinth_page',
        sourceUrl: 'https://modrinth.com/plugin/essentialsx',
        projectId: 'essentialsx',
        versionId: 'v2.20.1',
        sha256: 'a'.repeat(64),
      });
      assert.ok(artifact.id);
      assert.equal(artifact.kind, 'plugin');
      assert.equal(artifact.filename, 'EssentialsX-2.20.1.jar');
    });

    it('lists artifacts for a server', () => {
      recordArtifact(ctx.db, {
        serverId,
        kind: 'plugin',
        filename: 'plugin1.jar',
        sourceType: 'direct_url',
        sha256: 'b'.repeat(64),
      });
      recordArtifact(ctx.db, {
        serverId,
        kind: 'mod',
        filename: 'mod1.jar',
        sourceType: 'direct_url',
        sha256: 'c'.repeat(64),
      });
      const artifacts = listArtifacts(ctx.db, serverId);
      assert.ok(artifacts.length >= 2);
      assert.ok(artifacts.some((a) => a.kind === 'plugin'));
      assert.ok(artifacts.some((a) => a.kind === 'mod'));
    });

    it('deletes an artifact', () => {
      const artifact = recordArtifact(ctx.db, {
        serverId,
        kind: 'plugin',
        filename: 'deleteme.jar',
        sourceType: 'direct_url',
        sha256: 'd'.repeat(64),
      });
      assert.ok(deleteArtifact(ctx.db, artifact.id));
      assert.ok(!deleteArtifact(ctx.db, 'nonexistent'));
    });
  });

  describe('audit events', () => {
    it('records an audit event', () => {
      const event = recordAuditEvent(ctx.db, {
        action: 'server_created',
        serverId,
        details: { serverName: 'Test Server' },
      });
      assert.ok(event.id);
      assert.equal(event.action, 'server_created');
      assert.deepEqual(event.details, { serverName: 'Test Server' });
    });

    it('lists audit events for a server', () => {
      recordAuditEvent(ctx.db, {
        action: 'eula_accepted',
        serverId,
      });
      recordAuditEvent(ctx.db, {
        action: 'plugin_installed',
        serverId,
        details: { plugin: 'EssentialsX' },
      });
      const events = listAuditEvents(ctx.db, { serverId });
      assert.ok(events.length >= 2);
      assert.ok(events.some((e) => e.action === 'eula_accepted'));
    });
  });

  describe('retention cleanup', () => {
    it('deletes expired logs', () => {
      // Simulate a run from 10 days ago (beyond the 7d policy).
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const run = startServerRun(ctx.db, serverId, 12354, tenDaysAgo);
      appendServerLogs(ctx.db, run.id, serverId, [
        {
          timestamp: tenDaysAgo.toISOString(),
          level: 'INFO',
          thread: 'Server thread',
          message: 'Old log entry',
        },
      ]);
      finishServerRun(ctx.db, run.id, { exitCode: 0, at: tenDaysAgo });

      const result = cleanupExpiredHistory(ctx.db, new Date());
      assert.ok(result.logsDeleted > 0);
      assert.ok(result.runsDeleted > 0);
    });

    it('respects never cleanup for forever policy', () => {
      // Create a server with 'forever' policy, verify logs are retained.
      const foreverServer = createServer(ctx.db, {
        name: 'Forever Server',
        coreType: 'vanilla',
        minRamMb: 1024,
        maxRamMb: 2048,
        jvmFlagsProfile: 'default',
        customJvmArgs: '',
        logRetentionPolicy: 'forever',
      });

      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      const run = startServerRun(ctx.db, foreverServer.id, 12355, tenDaysAgo);
      appendServerLogs(ctx.db, run.id, foreverServer.id, [
        {
          timestamp: tenDaysAgo.toISOString(),
          level: 'INFO',
          thread: 'Server thread',
          message: 'Forever log',
        },
      ]);
      finishServerRun(ctx.db, run.id, { exitCode: 0, at: tenDaysAgo });

      const result = cleanupExpiredHistory(ctx.db, new Date());
      // Logs for forever server should not be deleted.
      const logs = listServerLogsByRun(ctx.db, run.id);
      assert.ok(logs.some((log) => log.message === 'Forever log'));
    });
  });
});
