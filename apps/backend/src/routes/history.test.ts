import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { recordAuditEvent } from '../audit/service.js';

const ADMIN = { email: 'admin@example.com', password: 'correct-horse-battery' };

interface TestContext {
  app: FastifyInstance;
  cookie: string;
  serverId: string;
  runId: string;
  cleanup: () => Promise<void>;
}

function sessionCookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === 'string' ? (first.split(';')[0] ?? '') : '';
}

async function startTestApp(): Promise<TestContext> {
  const dir = await mkdtemp(path.join(tmpdir(), 'locternos-history-'));
  const config = loadConfig({
    LOCTERNOS_DATA_DIR: dir,
    LOCTERNOS_FRONTEND_DIR: path.join(dir, 'no-frontend'),
    LOG_LEVEL: 'silent',
  });
  const app = await buildApp(config);

  const cookie = sessionCookieFrom(
    await app.inject({ method: 'POST', url: '/api/setup', payload: ADMIN }).then(async () =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN }),
    ),
  );

  const created = await app.inject({
    method: 'POST',
    url: '/api/servers',
    headers: { cookie },
    payload: { name: 'History', coreType: 'vanilla', mcVersion: '1.21.4' },
  });
  const serverId = created.json<{ server: { id: string } }>().server.id;

  const runId = 'run-seed-1';
  app.db.$client
    .prepare(
      `INSERT INTO server_runs (id, server_id, pid, started_at, stopped_at, exit_code, stop_reason, peak_ram_mb)
       VALUES (?, ?, 1234, ?, ?, 0, 'stopped', 512)`,
    )
    .run(runId, serverId, '2026-01-01T10:00:00.000Z', '2026-01-01T10:05:00.000Z');

  const insertLog = app.db.$client.prepare(
    `INSERT INTO server_logs (run_id, server_id, timestamp, level, thread, message)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertLog.run(runId, serverId, '2026-01-01T10:01:00.000Z', 'INFO', 'Server thread', 'Server started');
  insertLog.run(runId, serverId, '2026-01-01T10:02:00.000Z', 'WARN', 'Server thread', 'Can\'t keep up');
  insertLog.run(runId, serverId, '2026-01-01T10:03:00.000Z', 'ERROR', 'main', 'Plugin exploded');

  recordAuditEvent(app.db, {
    action: 'server.started',
    serverId,
    details: { pid: 1234 },
  });

  return {
    app,
    cookie,
    serverId,
    runId,
    cleanup: async () => {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe('history API', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await startTestApp();
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('requires authentication and a known server', async () => {
    const unauth = await ctx.app.inject({ method: 'GET', url: `/api/servers/${ctx.serverId}/runs` });
    assert.equal(unauth.statusCode, 401);

    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/api/servers/unknown/runs',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(missing.statusCode, 404);
  });

  it('lists past runs', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/servers/${ctx.serverId}/runs`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.statusCode, 200);
    const runs = res.json<{ runs: { id: string; exitCode: number | null }[] }>().runs;
    assert.equal(runs[0]?.id, ctx.runId);
    assert.equal(runs[0]?.exitCode, 0);
  });

  it('returns recent logs and filters by level', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/servers/${ctx.serverId}/logs?level=ERROR`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.statusCode, 200);
    const logs = res.json<{ logs: { level: string; message: string }[] }>().logs;
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.message, 'Plugin exploded');
  });

  it('searches logs with FTS5', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/servers/${ctx.serverId}/logs?query=keep+up`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.statusCode, 200);
    const logs = res.json<{ logs: { message: string }[] }>().logs;
    assert.equal(logs.length, 1);
    assert.match(logs[0]?.message ?? '', /keep up/);
  });

  it('filters logs by run', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/servers/${ctx.serverId}/logs?runId=${ctx.runId}`,
      headers: { cookie: ctx.cookie },
    });
    const logs = res.json<{ logs: unknown[] }>().logs;
    assert.equal(logs.length, 3);
  });

  it('lists audit events', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/servers/${ctx.serverId}/audit`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.statusCode, 200);
    const events = res.json<{ events: { action: string }[] }>().events;
    assert.ok(events.some((event) => event.action === 'server.started'));
  });
});
