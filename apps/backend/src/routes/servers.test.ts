import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';

const ADMIN = { email: 'admin@example.com', password: 'correct-horse-battery' };

interface TestApp {
  app: FastifyInstance;
  cookie: string;
  cleanup: () => Promise<void>;
}

async function startTestApp(): Promise<TestApp> {
  const dir = await mkdtemp(path.join(tmpdir(), 'locternos-servers-'));
  const config = loadConfig({
    LOCTERNOS_DATA_DIR: dir,
    LOCTERNOS_FRONTEND_DIR: path.join(dir, 'no-frontend'),
    LOG_LEVEL: 'silent',
  });
  const app = await buildApp(config);
  return {
    app,
    cookie: '',
    cleanup: async () => {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function sessionCookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === 'string' ? (first.split(';')[0] ?? '') : '';
}

interface ListedServer {
  id: string;
  name: string;
  slug: string;
  port: number;
}

async function listServers(ctx: TestApp): Promise<ListedServer[]> {
  const res = await ctx.app.inject({
    method: 'GET',
    url: '/api/servers',
    headers: { cookie: ctx.cookie },
  });
  return res.json<{ servers: ListedServer[] }>().servers;
}

describe('server crud API', () => {
  let ctx: TestApp;
  let cookie: string;

  before(async () => {
    ctx = await startTestApp();
    await ctx.app.inject({ method: 'POST', url: '/api/setup', payload: ADMIN });
    const login = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN });
    cookie = sessionCookieFrom(login);
    ctx.cookie = cookie;
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('rejects every server route without a session cookie', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/servers' });
    assert.equal(res.statusCode, 401);
  });

  it('creates a server with defaults', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/servers',
      headers: { cookie },
      payload: { name: 'Survival World', coreType: 'paper', mcVersion: '1.21.4' },
    });
    assert.equal(res.statusCode, 201);

    const server = res.json<{ server: Record<string, unknown> }>().server;
    assert.equal(server.name, 'Survival World');
    assert.equal(server.slug, 'survival-world');
    assert.equal(server.coreType, 'paper');
    assert.equal(server.status, 'stopped');
    assert.equal(server.minRamMb, 1024);
    assert.equal(server.maxRamMb, 2048);
    assert.equal(server.port, 25565);
    assert.equal(server.logRetentionPolicy, '7d');
    assert.equal(server.entrypointJar, '');
    assert.equal(server.eulaAcceptedAt, null);
  });

  it('rejects an invalid create payload', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/servers',
      headers: { cookie },
      payload: { name: '', coreType: 'not-a-core' },
    });
    assert.equal(res.statusCode, 400);
  });

  it('rejects a create payload where min ram exceeds max ram', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/servers',
      headers: { cookie },
      payload: { name: 'Bad Ram', coreType: 'vanilla', minRamMb: 4096, maxRamMb: 1024 },
    });
    assert.equal(res.statusCode, 400);
  });

  it('gives duplicate names a unique slug and a free port', async () => {
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/servers',
      headers: { cookie },
      payload: { name: 'Survival World', coreType: 'paper' },
    });
    assert.equal(first.statusCode, 201);

    const second = first.json<{ server: { slug: string; port: number } }>().server;
    assert.equal(second.slug, 'survival-world-2');
    assert.notEqual(second.port, 25565);
  });

  it('lists the created servers', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/servers', headers: { cookie } });
    assert.equal(res.statusCode, 200);

    const servers = res.json<{ servers: { name: string; slug: string }[] }>().servers;
    assert.equal(servers.length, 2);
    assert.deepEqual(servers.map((server) => server.slug).sort(), [
      'survival-world',
      'survival-world-2',
    ]);
  });

  it('reads a single server and reports unknown ids', async () => {
    const id = (await listServers(ctx)).find((server) => server.slug === 'survival-world')!.id;

    const found = await ctx.app.inject({
      method: 'GET',
      url: `/api/servers/${id}`,
      headers: { cookie },
    });
    assert.equal(found.statusCode, 200);
    assert.equal(found.json<{ server: { id: string } }>().server.id, id);

    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/api/servers/does-not-exist',
      headers: { cookie },
    });
    assert.equal(missing.statusCode, 404);
  });

  it('applies a partial update and refreshes updated_at', async () => {
    const server = (await listServers(ctx)).find((entry) => entry.slug === 'survival-world')!;

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/servers/${server.id}`,
      headers: { cookie },
      payload: { name: 'Renamed World', maxRamMb: 4096 },
    });
    assert.equal(res.statusCode, 200);

    const updated = res.json<{ server: { name: string; minRamMb: number; maxRamMb: number } }>()
      .server;
    assert.equal(updated.name, 'Renamed World');
    assert.equal(updated.maxRamMb, 4096);
    assert.equal(updated.minRamMb, 1024);
    assert.notEqual(updated, server);
  });

  it('rejects an update that collides with the port of another server', async () => {
    const servers = await listServers(ctx);
    const [first, second] = servers;
    assert.ok(first && second, 'expected two servers to compare ports');

    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/servers/${second.id}`,
      headers: { cookie },
      payload: { port: first.port },
    });
    assert.equal(res.statusCode, 409);
  });

  it('reports an unknown server on update and delete', async () => {
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/servers/does-not-exist',
      headers: { cookie },
      payload: { name: 'Ghost' },
    });
    assert.equal(patch.statusCode, 404);

    const remove = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/servers/does-not-exist',
      headers: { cookie },
    });
    assert.equal(remove.statusCode, 404);
  });

  it('deletes a server', async () => {
    const id = (await listServers(ctx)).find((server) => server.slug === 'survival-world')!.id;

    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/servers/${id}`,
      headers: { cookie },
    });
    assert.equal(res.statusCode, 204);

    const remaining = await listServers(ctx);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.slug, 'survival-world-2');
  });
});
