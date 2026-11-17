import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import type {
  Artifact,
  InstallArtifactInput,
  InstallCoreInput,
  Server,
} from '@locternos/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type {
  ArtifactInstallService,
  InstallArtifactOutcome,
  UploadArtifactInput,
} from '../artifacts/install-service.js';
import { ServerNotFoundError } from '../artifacts/install-service.js';

const ADMIN = { email: 'admin@example.com', password: 'correct-horse-battery' };

const SERVER: Server = {
  id: 'srv-1',
  name: 'Route Test',
  slug: 'route-test',
  coreType: 'paper',
  mcVersion: '1.21.4',
  entrypointJar: 'server.jar',
  javaPath: null,
  minRamMb: 1024,
  maxRamMb: 2048,
  jvmFlagsProfile: 'default',
  customJvmArgs: '',
  port: 25565,
  logRetentionPolicy: '7d',
  eulaAcceptedAt: null,
  status: 'stopped',
  createdAt: '2026-01-02T03:04:05.000Z',
  updatedAt: '2026-01-02T03:04:05.000Z',
};

const ARTIFACT: Artifact = {
  id: 'art-1',
  serverId: 'srv-1',
  kind: 'plugin',
  filename: 'EssentialsX.jar',
  sourceType: 'modrinth_page',
  sourceUrl: 'https://modrinth.com/plugin/essentialsx',
  projectId: 'P1',
  versionId: 'V1',
  sha256: '0'.repeat(64),
  installedAt: '2026-01-02T03:04:05.000Z',
  enabled: true,
};

interface FakeService extends ArtifactInstallService {
  coreCalls: Array<{ serverId: string; input: InstallCoreInput; userId: string | null }>;
  artifactCalls: Array<{ serverId: string; input: InstallArtifactInput; userId: string | null }>;
  uploadCalls: Array<{ serverId: string; input: UploadArtifactInput; userId: string | null }>;
  removeCalls: Array<{ serverId: string; artifactId: string; userId: string | null }>;
  enabledCalls: Array<{
    serverId: string;
    artifactId: string;
    enabled: boolean;
    userId: string | null;
  }>;
}

interface FakeOptions {
  missingServer?: boolean;
  outcome?: InstallArtifactOutcome;
}

function fakeService(options: FakeOptions = {}): FakeService {
  const coreCalls: FakeService['coreCalls'] = [];
  const artifactCalls: FakeService['artifactCalls'] = [];
  const uploadCalls: FakeService['uploadCalls'] = [];
  const removeCalls: FakeService['removeCalls'] = [];
  const enabledCalls: FakeService['enabledCalls'] = [];

  function assertServer(serverId: string): void {
    if (options.missingServer || serverId !== SERVER.id) throw new ServerNotFoundError();
  }

  return {
    coreCalls,
    artifactCalls,
    uploadCalls,
    removeCalls,
    enabledCalls,
    async installCore(serverId, input, userId) {
      assertServer(serverId);
      coreCalls.push({ serverId, input, userId });
      return { server: { ...SERVER, coreType: input.coreType }, artifact: { ...ARTIFACT, kind: 'core' } };
    },
    async installArtifact(serverId, input, userId) {
      assertServer(serverId);
      artifactCalls.push({ serverId, input, userId });
      return options.outcome ?? { status: 'installed', artifact: ARTIFACT, dependencies: [] };
    },
    async installUpload(serverId, input, userId) {
      assertServer(serverId);
      uploadCalls.push({ serverId, input, userId });
      return { artifact: { ...ARTIFACT, filename: input.filename, sourceType: 'upload' } };
    },
    list(serverId) {
      assertServer(serverId);
      return [ARTIFACT];
    },
    async preview(serverId, input) {
      assertServer(serverId);
      return {
        project: { id: 'P1', slug: 'essentialsx', title: 'EssentialsX', projectType: input.kind },
        versionId: 'V1',
        dependencies: [
          {
            projectId: 'P2',
            versionId: 'V2',
            filename: 'LuckPerms.jar',
            title: 'LuckPerms',
          },
        ],
      };
    },
    async setEnabled(serverId, artifactId, enabled, userId) {
      assertServer(serverId);
      enabledCalls.push({ serverId, artifactId, enabled, userId });
      return artifactId === ARTIFACT.id ? { ...ARTIFACT, enabled } : null;
    },
    async remove(serverId, artifactId, userId) {
      assertServer(serverId);
      removeCalls.push({ serverId, artifactId, userId });
      return artifactId === ARTIFACT.id;
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
  const dir = await mkdtemp(path.join(tmpdir(), 'locternos-artifact-routes-'));
  const config = loadConfig({
    LOCTERNOS_DATA_DIR: dir,
    LOCTERNOS_FRONTEND_DIR: path.join(dir, 'no-frontend'),
    LOG_LEVEL: 'silent',
  });
  const service = fakeService(options);
  const app = await buildApp(config, { artifactInstallService: service });

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

function multipartBody(): { body: Buffer; contentType: string } {
  const boundary = '----locternos-test-boundary';
  const parts = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="file"; filename="Local.jar"',
    'Content-Type: application/java-archive',
    '',
    'PK\u0003\u0004payload',
    `--${boundary}--`,
    '',
  ];
  return {
    body: Buffer.from(parts.join('\r\n'), 'binary'),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('artifact API', () => {
  let ctx: TestApp;

  before(async () => {
    ctx = await startTestApp();
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('requires authentication for every artifact route', async () => {
    const routes = [
      { method: 'GET' as const, url: `/api/servers/${SERVER.id}/artifacts` },
      { method: 'POST' as const, url: `/api/servers/${SERVER.id}/core` },
      { method: 'POST' as const, url: `/api/servers/${SERVER.id}/artifacts` },
      { method: 'POST' as const, url: `/api/servers/${SERVER.id}/artifacts/upload?kind=plugin` },
      { method: 'DELETE' as const, url: `/api/servers/${SERVER.id}/artifacts/${ARTIFACT.id}` },
    ];
    for (const route of routes) {
      const res = await ctx.app.inject(route);
      assert.equal(res.statusCode, 401, `${route.method} ${route.url}`);
    }
  });

  it('lists installed artifacts for a server', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/servers/${SERVER.id}/artifacts`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { artifacts: [ARTIFACT] });
  });

  it('returns 404 when the server does not exist', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/servers/missing/artifacts',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.statusCode, 404);
  });

  it('validates and installs a server core', async () => {
    const invalid = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${SERVER.id}/core`,
      headers: { cookie: ctx.cookie },
      payload: { coreType: 'paper' },
    });
    assert.equal(invalid.statusCode, 400);

    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${SERVER.id}/core`,
      headers: { cookie: ctx.cookie },
      payload: { coreType: 'paper', version: '1.21.4', build: 100 },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(ctx.service.coreCalls.at(-1)?.input.coreType, 'paper');
    assert.ok(ctx.service.coreCalls.at(-1)?.userId);
  });

  it('installs an artifact from a direct URL', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${SERVER.id}/artifacts`,
      headers: { cookie: ctx.cookie },
      payload: {
        kind: 'plugin',
        sourceType: 'direct_url',
        sourceUrl: 'https://example.com/Plugin.jar',
      },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(ctx.service.artifactCalls.at(-1)?.input.kind, 'plugin');
  });

  it('returns 409 when Modrinth needs a fallback version choice', async () => {
    const app = await startTestApp({
      outcome: {
        status: 'needs_selection',
        project: { id: 'P1', slug: 'essentialsx', title: 'EssentialsX', projectType: 'plugin' },
        fallbackVersions: [
          {
            id: 'V9',
            name: 'EssentialsX 0.9',
            versionNumber: '0.9',
            gameVersions: ['1.20.1'],
            loaders: ['paper'],
            filename: 'old.jar',
            sizeBytes: 120,
          },
        ],
      },
    });
    try {
      const res = await app.app.inject({
        method: 'POST',
        url: `/api/servers/${SERVER.id}/artifacts`,
        headers: { cookie: app.cookie },
        payload: {
          kind: 'plugin',
          sourceType: 'modrinth_page',
          modrinthUrl: 'https://modrinth.com/plugin/essentialsx',
        },
      });
      assert.equal(res.statusCode, 409);
      assert.equal(res.json<{ status: string }>().status, 'needs_selection');
    } finally {
      await app.cleanup();
    }
  });

  it('accepts a multipart jar upload with a kind query parameter', async () => {
    const { body, contentType } = multipartBody();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${SERVER.id}/artifacts/upload?kind=plugin`,
      headers: { cookie: ctx.cookie, 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 201);
    const call = ctx.service.uploadCalls.at(-1);
    assert.equal(call?.input.kind, 'plugin');
    assert.equal(call?.input.filename, 'Local.jar');
  });

  it('rejects uploads with an invalid kind', async () => {
    const { body, contentType } = multipartBody();
    const res = await ctx.app.inject({
      method: 'POST',
      url: `/api/servers/${SERVER.id}/artifacts/upload?kind=world`,
      headers: { cookie: ctx.cookie, 'content-type': contentType },
      payload: body,
    });
    assert.equal(res.statusCode, 400);
  });

  it('enables and disables an artifact', async () => {
    const disabled = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/servers/${SERVER.id}/artifacts/${ARTIFACT.id}`,
      headers: { cookie: ctx.cookie },
      payload: { enabled: false },
    });
    assert.equal(disabled.statusCode, 200);
    assert.equal(disabled.json<{ artifact: { enabled: boolean } }>().artifact.enabled, false);
    assert.equal(ctx.service.enabledCalls.at(-1)?.enabled, false);

    const missing = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/servers/${SERVER.id}/artifacts/does-not-exist`,
      headers: { cookie: ctx.cookie },
      payload: { enabled: true },
    });
    assert.equal(missing.statusCode, 404);
  });

  it('rejects an invalid artifact toggle payload', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/servers/${SERVER.id}/artifacts/${ARTIFACT.id}`,
      headers: { cookie: ctx.cookie },
      payload: { enabled: 'yes' },
    });
    assert.equal(res.statusCode, 400);
  });

  it('previews the required dependencies of a Modrinth project', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/servers/${SERVER.id}/artifacts/preview?kind=plugin&url=${encodeURIComponent(
        'https://modrinth.com/plugin/essentialsx',
      )}`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.statusCode, 200);
    const preview = res.json<{ dependencies: { title: string }[] }>();
    assert.equal(preview.dependencies[0]?.title, 'LuckPerms');
  });

  it('rejects a preview without a valid kind', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/servers/${SERVER.id}/artifacts/preview?kind=core&url=https://modrinth.com/plugin/x`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.statusCode, 400);
  });

  it('removes an artifact and reports missing ids', async () => {
    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/servers/${SERVER.id}/artifacts/${ARTIFACT.id}`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(removed.statusCode, 204);

    const missing = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/servers/${SERVER.id}/artifacts/unknown`,
      headers: { cookie: ctx.cookie },
    });
    assert.equal(missing.statusCode, 404);
  });
});
