import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type { ConsoleLine, ServerRuntimeState, WsServerMessage } from '@locternos/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

const ADMIN = { email: 'admin@example.com', password: 'correct-horse-battery' };

const FAKE_JAVA = `#!/bin/sh
echo '[09:00:00] [Server thread/INFO]: Starting minecraft server version 1.20.1'
echo 'Done (0.1s)! For help, type "help"'
while IFS= read -r line; do
  echo "[09:00:01] [Server thread/INFO]: received $line"
  if [ "$line" = "stop" ]; then
    exit 0
  fi
done
`;

interface TestContext {
  app: FastifyInstance;
  cookie: string;
  dataDir: string;
  script: string;
  cleanup: () => Promise<void>;
}

async function startTestApp(): Promise<TestContext> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'locternos-runtime-'));
  const config = loadConfig({
    LOCTERNOS_DATA_DIR: dataDir,
    LOCTERNOS_FRONTEND_DIR: path.join(dataDir, 'no-frontend'),
    LOG_LEVEL: 'silent',
  });
  const app = await buildApp(config, {
    runtimeServiceOptions: {
      metricsIntervalMs: 50,
      diskIntervalMs: 200,
      logFlushIntervalMs: 20,
    },
  });
  const script = path.join(dataDir, 'fake-java.sh');
  await writeFile(script, FAKE_JAVA, 'utf8');
  await chmod(script, 0o755);

  return {
    app,
    cookie: '',
    dataDir,
    script,
    cleanup: async () => {
      await app.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

function sessionCookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === 'string' ? (first.split(';')[0] ?? '') : '';
}

interface CreatedServer {
  id: string;
  slug: string;
  status: string;
}

async function createServer(ctx: TestContext): Promise<CreatedServer> {
  const res = await ctx.app.inject({
    method: 'POST',
    url: '/api/servers',
    headers: { cookie: ctx.cookie },
    payload: {
      name: 'Lifecycle',
      coreType: 'vanilla',
      mcVersion: '1.20.1',
      minRamMb: 512,
      maxRamMb: 1024,
    },
  });
  assert.equal(res.statusCode, 201);
  const server = res.json<{ server: CreatedServer }>().server;

  const serverDir = path.join(ctx.dataDir, 'servers', server.slug);
  await mkdir(serverDir, { recursive: true });
  await writeFile(path.join(serverDir, 'server.jar'), '');
  ctx.app.db.$client
    .prepare('UPDATE servers SET entrypoint_jar = ? WHERE id = ?')
    .run('server.jar', server.id);
  const patch = await ctx.app.inject({
    method: 'PATCH',
    url: `/api/servers/${server.id}`,
    headers: { cookie: ctx.cookie },
    payload: { javaPath: ctx.script },
  });
  assert.equal(patch.statusCode, 200);
  return server;
}

async function getRuntime(ctx: TestContext, serverId: string): Promise<ServerRuntimeState> {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/servers/${serverId}/runtime`,
    headers: { cookie: ctx.cookie },
  });
  assert.equal(res.statusCode, 200);
  return res.json<{ runtime: ServerRuntimeState }>().runtime;
}

async function getConsole(ctx: TestContext, serverId: string): Promise<ConsoleLine[]> {
  const res = await ctx.app.inject({
    method: 'GET',
    url: `/api/servers/${serverId}/console`,
    headers: { cookie: ctx.cookie },
  });
  assert.equal(res.statusCode, 200);
  return res.json<{ lines: ConsoleLine[] }>().lines;
}

async function waitFor<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();
  while (!predicate(last)) {
    if (Date.now() > deadline) {
      assert.fail(`timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    last = await read();
  }
  return last;
}

describe('server runtime lifecycle', () => {
  let ctx: TestContext;

  before(async () => {
    ctx = await startTestApp();
    await ctx.app.inject({ method: 'POST', url: '/api/setup', payload: ADMIN });
    const login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN });
    ctx.cookie = sessionCookieFrom(login);
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('requires auth and a known server', async () => {
    const unauth = await ctx.app.inject({ method: 'GET', url: '/api/servers/x/runtime' });
    assert.equal(unauth.statusCode, 401);

    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/api/servers/does-not-exist/runtime',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(missing.statusCode, 404);
  });

  it('blocks start until the EULA is accepted explicitly', async () => {
    const server = await createServer(ctx);

    const refused = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/start`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json<{ code: string }>().code, 'eula_required');

    const implicit = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/eula`,
      headers: { cookie: ctx.cookie },
      payload: { accepted: false },
    });
    assert.equal(implicit.statusCode, 400);

    const accepted = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/eula`,
      headers: { cookie: ctx.cookie },
      payload: { accepted: true },
    });
    assert.equal(accepted.statusCode, 200);
    assert.ok(accepted.json<{ eulaAcceptedAt: string }>().eulaAcceptedAt);

    const eula = await readFile(path.join(ctx.dataDir, 'servers', server.slug, 'eula.txt'), 'utf8');
    assert.match(eula, /eula=true/);
  });

  it('starts, streams console output, accepts commands and stops gracefully', async () => {
    const server = await createServer(ctx);
    await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/eula`,
      headers: { cookie: ctx.cookie },
      payload: { accepted: true },
    });

    const started = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/start`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(started.statusCode, 200, started.body);
    assert.ok(
      ['starting', 'running'].includes(
        started.json<{ runtime: ServerRuntimeState }>().runtime.status,
      ),
    );

    const running = await waitFor(
      () => getRuntime(ctx, server.id),
      (runtime) => runtime.status === 'running',
      'server to become running',
    );
    assert.ok(running.pid && running.pid > 0);
    assert.ok(running.runId);

    const command = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/command`,
      headers: { cookie: ctx.cookie },
      payload: { command: 'say hello' },
    });
    assert.equal(command.statusCode, 204);

    await waitFor(
      () => getConsole(ctx, server.id),
      (lines) => lines.some((line) => line.message === 'received say hello'),
      'console echo of the command',
    );

    await waitFor(
      () => getRuntime(ctx, server.id),
      (runtime) => (runtime.metrics.peakRamMb ?? 0) > 0 && (runtime.metrics.diskBytes ?? 0) > 0,
      'process metrics sample',
    );

    const concurrent = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/start`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(concurrent.statusCode, 409);
    assert.equal(concurrent.json<{ code: string }>().code, 'already_running');

    const stopped = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/stop`,
      headers: { cookie: ctx.cookie },
      payload: {},
    });
    assert.equal(stopped.statusCode, 200);

    await waitFor(
      () => getRuntime(ctx, server.id),
      (runtime) => runtime.status === 'stopped',
      'graceful stop',
    );

    const run = ctx.app.db.$client
      .prepare('SELECT * FROM server_runs WHERE server_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(server.id) as {
      exit_code: number | null;
      stop_reason: string | null;
      stopped_at: string | null;
      peak_ram_mb: number | null;
    };
    assert.equal(run.stop_reason, 'stopped');
    assert.equal(run.exit_code, 0);
    assert.ok(run.stopped_at);
    assert.ok((run.peak_ram_mb ?? 0) > 0);

    const logs = ctx.app.db.$client
      .prepare('SELECT level, message FROM server_logs WHERE server_id = ? ORDER BY id ASC')
      .all(server.id) as { level: string; message: string }[];
    assert.ok(logs.some((line) => line.message === 'Done (0.1s)! For help, type "help"'));
    assert.ok(logs.every((line) => line.level === 'INFO'));
  });

  it('force kills a running server', async () => {
    const server = await createServer(ctx);
    await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/eula`,
      headers: { cookie: ctx.cookie },
      payload: { accepted: true },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/start`,
      headers: { cookie: ctx.cookie },
    });
    await waitFor(
      () => getRuntime(ctx, server.id),
      (runtime) => runtime.status === 'running',
      'server to become running',
    );

    const killed = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/kill`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(killed.statusCode, 200);

    await waitFor(
      () => getRuntime(ctx, server.id),
      (runtime) => runtime.status === 'stopped',
      'force kill',
    );

    const run = ctx.app.db.$client
      .prepare('SELECT * FROM server_runs WHERE server_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(server.id) as { stop_reason: string | null };
    assert.equal(run.stop_reason, 'force_killed');
  });

  it('restarts a running server with a fresh run', async () => {
    const server = await createServer(ctx);
    await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/eula`,
      headers: { cookie: ctx.cookie },
      payload: { accepted: true },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/start`,
      headers: { cookie: ctx.cookie },
    });
    const first = await waitFor(
      () => getRuntime(ctx, server.id),
      (runtime) => runtime.status === 'running',
      'initial run',
    );

    const restarted = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/restart`,
      headers: { cookie: ctx.cookie },
      payload: {},
    });
    assert.equal(restarted.statusCode, 200);

    const second = await waitFor(
      () => getRuntime(ctx, server.id),
      (runtime) =>
        runtime.status === 'running' && runtime.runId !== null && runtime.runId !== first.runId,
      'restart to produce a new run',
    );
    assert.notEqual(second.runId, first.runId);

    await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/stop`,
      headers: { cookie: ctx.cookie },
      payload: {},
    });
    await waitFor(
      () => getRuntime(ctx, server.id),
      (runtime) => runtime.status === 'stopped',
      'final stop',
    );
  });

  it('streams console output and runs commands over websocket', async () => {
    const server = await createServer(ctx);
    await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/eula`,
      headers: { cookie: ctx.cookie },
      payload: { accepted: true },
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/start`,
      headers: { cookie: ctx.cookie },
    });
    await waitFor(
      () => getRuntime(ctx, server.id),
      (runtime) => runtime.status === 'running',
      'server to become running',
    );

    const socket = await ctx.app.injectWS('/api/ws', { headers: { cookie: ctx.cookie } });
    const messages: WsServerMessage[] = [];
    socket.on('message', (raw) => {
      messages.push(JSON.parse(raw.toString()) as WsServerMessage);
    });

    try {
      const has = (predicate: (message: WsServerMessage) => boolean) =>
        waitFor(
          async () => messages,
          (list) => list.some(predicate),
          'websocket message',
        );

      socket.send(JSON.stringify({ type: 'subscribe', serverId: server.id }));

      await has(
        (message) =>
          message.type === 'runtime' &&
          message.runtime.serverId === server.id &&
          message.runtime.status === 'running',
      );
      await has(
        (message) =>
          message.type === 'console' &&
          message.serverId === server.id &&
          message.lines.some((line) => line.message.includes('Done (0.1s)')),
      );

      const echo = has(
        (message) =>
          message.type === 'console' &&
          message.serverId === server.id &&
          message.lines.some((line) => line.message === 'received ws-command'),
      );
      socket.send(JSON.stringify({ type: 'command', serverId: server.id, command: 'ws-command' }));
      await echo;
    } finally {
      // `injectWS` leaves a 30s close timer behind on a graceful close, so
      // terminate the in-memory socket instead.
      socket.terminate();
      await new Promise((resolve) => setTimeout(resolve, 10));
      await ctx.app.inject({
        method: 'POST',
        url: `/api/servers/${server.id}/stop`,
        headers: { cookie: ctx.cookie },
        payload: {},
      });
    }
  });

  it('blocks start when the core jar is missing', async () => {
    const server = await createServer(ctx);
    await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/eula`,
      headers: { cookie: ctx.cookie },
      payload: { accepted: true },
    });
    await rm(path.join(ctx.dataDir, 'servers', server.slug, 'server.jar'));

    const started = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${server.id}/start`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(started.statusCode, 409);
    assert.equal(started.json<{ code: string }>().code, 'core_missing');
  });
});
