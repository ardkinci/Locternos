import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type {
  InstallJavaRuntimeInput,
  JavaRuntime,
  JavaVersionRequirement,
} from '@locternos/shared';
import { buildApp } from '../app.js';
import { listAuditEvents } from '../audit/service.js';
import { loadConfig } from '../config.js';
import { AdoptiumApiError } from '../java/adoptium.js';
import type { InstallRuntimeResult, JavaRuntimeService } from '../java/runtime-service.js';

const ADMIN = { email: 'admin@example.com', password: 'correct-horse-battery' };

const RUNTIME: JavaRuntime = {
  id: 'temurin-21-jdk',
  path: '/data/runtimes/temurin-21-jdk/jdk-21/bin/java',
  vendor: 'Eclipse Temurin',
  version: '21.0.5+11',
  majorVersion: 21,
  source: 'managed',
  imageType: 'jdk',
  installedAt: '2026-01-02T03:04:05.000Z',
};

interface FakeService extends JavaRuntimeService {
  listCalls: Array<{ refresh?: boolean }>;
  installCalls: InstallJavaRuntimeInput[];
  removeCalls: string[];
}

interface FakeOptions {
  runtimes?: JavaRuntime[];
  requirement?: JavaVersionRequirement;
  installResult?: InstallRuntimeResult;
  installError?: Error;
  removeResult?: boolean;
}

function fakeService(options: FakeOptions = {}): FakeService {
  const listCalls: Array<{ refresh?: boolean }> = [];
  const installCalls: InstallJavaRuntimeInput[] = [];
  const removeCalls: string[] = [];
  const runtimes = options.runtimes ?? [RUNTIME];

  return {
    listCalls,
    installCalls,
    removeCalls,
    async list(listOptions = {}) {
      listCalls.push(listOptions);
      return runtimes;
    },
    async listManaged() {
      return runtimes.filter((runtime) => runtime.source === 'managed');
    },
    async install(input) {
      installCalls.push(input);
      if (options.installError) throw options.installError;
      return (
        options.installResult ?? {
          runtime: RUNTIME,
          alreadyInstalled: false,
        }
      );
    },
    async remove(id) {
      removeCalls.push(id);
      return options.removeResult ?? true;
    },
    async requirement(mcVersion) {
      return (
        options.requirement ?? {
          mcVersion,
          requiredMajorVersion: 21,
          satisfied: true,
          matchingRuntimeIds: [RUNTIME.id],
        }
      );
    },
  };
}

interface TestApp {
  app: FastifyInstance;
  service: FakeService;
  cookie: string;
  cleanup: () => Promise<void>;
}

async function startTestApp(options: FakeOptions = {}): Promise<TestApp> {
  const dir = await mkdtemp(path.join(tmpdir(), 'locternos-java-routes-'));
  const config = loadConfig({
    LOCTERNOS_DATA_DIR: dir,
    LOCTERNOS_FRONTEND_DIR: path.join(dir, 'no-frontend'),
    LOG_LEVEL: 'silent',
  });
  const service = fakeService(options);
  const app = await buildApp(config, { javaRuntimeService: service });

  await app.inject({ method: 'POST', url: '/api/setup', payload: ADMIN });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: ADMIN });
  const raw = login.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  const cookie = typeof first === 'string' ? (first.split(';')[0] ?? '') : '';

  return {
    app,
    service,
    cookie,
    cleanup: async () => {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe('java runtime API', () => {
  let ctx: TestApp;

  before(async () => {
    ctx = await startTestApp();
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('requires authentication for every java route', async () => {
    const routes = [
      { method: 'GET' as const, url: '/api/java/runtimes' },
      { method: 'GET' as const, url: '/api/java/requirement?mcVersion=1.21.4' },
      { method: 'POST' as const, url: '/api/java/runtimes/install' },
      { method: 'DELETE' as const, url: '/api/java/runtimes/temurin-21-jdk' },
    ];
    for (const route of routes) {
      const res = await ctx.app.inject(route);
      assert.equal(res.statusCode, 401, `${route.method} ${route.url}`);
    }
  });

  it('lists runtimes and forwards the refresh flag', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/java/runtimes?refresh=true',
      headers: { cookie: ctx.cookie },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json<{ runtimes: JavaRuntime[] }>();
    assert.deepEqual(body.runtimes, [RUNTIME]);
    assert.deepEqual(ctx.service.listCalls.at(-1), { refresh: true });
  });

  it('requires mcVersion for requirement lookups', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/java/requirement',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.statusCode, 400);
  });

  it('returns the java requirement for a Minecraft version', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/java/requirement?mcVersion=1.21.4',
      headers: { cookie: ctx.cookie },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      mcVersion: '1.21.4',
      requiredMajorVersion: 21,
      satisfied: true,
      matchingRuntimeIds: [RUNTIME.id],
    });
  });

  it('rejects an invalid install payload', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/java/runtimes/install',
      headers: { cookie: ctx.cookie },
      payload: { featureVersion: -1, imageType: 'not-an-image' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(ctx.service.installCalls.length, 0);
  });

  it('installs a runtime and records a single audit event', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/java/runtimes/install',
      headers: { cookie: ctx.cookie },
      payload: { featureVersion: 21, imageType: 'jdk' },
    });

    assert.equal(res.statusCode, 201);
    const body = res.json<InstallRuntimeResult>();
    assert.equal(body.alreadyInstalled, false);
    assert.deepEqual(ctx.service.installCalls.at(-1), { featureVersion: 21, imageType: 'jdk' });

    const events = listAuditEvents(ctx.app.db, { limit: 20 });
    const installs = events.filter((event) => event.action === 'java.runtime.installed');
    assert.equal(installs.length, 1);
    assert.equal(installs[0]?.details.runtimeId, RUNTIME.id);
  });

  it('does not duplicate audit events for an existing runtime', async () => {
    const app = await startTestApp({
      installResult: { runtime: RUNTIME, alreadyInstalled: true },
    });
    try {
      const res = await app.app.inject({
        method: 'POST',
        url: '/api/java/runtimes/install',
        headers: { cookie: app.cookie },
        payload: { featureVersion: 21, imageType: 'jdk' },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json<InstallRuntimeResult>().alreadyInstalled, true);

      const events = listAuditEvents(app.app.db, { limit: 20 });
      assert.equal(events.filter((event) => event.action === 'java.runtime.installed').length, 0);
    } finally {
      await app.cleanup();
    }
  });

  it('maps download failures to a bad gateway response', async () => {
    const app = await startTestApp({ installError: new AdoptiumApiError('download failed') });
    try {
      const res = await app.app.inject({
        method: 'POST',
        url: '/api/java/runtimes/install',
        headers: { cookie: app.cookie },
        payload: { featureVersion: 21, imageType: 'jdk' },
      });
      assert.equal(res.statusCode, 502);
      assert.deepEqual(res.json(), { error: 'download failed' });
    } finally {
      await app.cleanup();
    }
  });

  it('removes a managed runtime and records an audit event', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/java/runtimes/temurin-21-jdk',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.statusCode, 204);
    assert.deepEqual(ctx.service.removeCalls.at(-1), 'temurin-21-jdk');

    const events = listAuditEvents(ctx.app.db, { limit: 20 });
    assert.equal(events.filter((event) => event.action === 'java.runtime.removed').length, 1);
  });

  it('reports unknown managed runtimes on delete', async () => {
    const app = await startTestApp({ removeResult: false });
    try {
      const res = await app.app.inject({
        method: 'DELETE',
        url: '/api/java/runtimes/temurin-21-jdk',
        headers: { cookie: app.cookie },
      });
      assert.equal(res.statusCode, 404);
    } finally {
      await app.cleanup();
    }
  });
});
