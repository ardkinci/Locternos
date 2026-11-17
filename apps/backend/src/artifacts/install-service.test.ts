import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Config } from '../config.js';
import { loadConfig } from '../config.js';
import type { DatabaseHandle } from '../db/client.js';
import { openDatabase } from '../db/client.js';
import { runMigrations } from '../db/migrate.js';
import { ensureDataLayout } from '../data-dir.js';
import { createServer } from '../servers/service.js';
import { listAuditEvents } from '../audit/service.js';
import { createArtifactInstallService, artifactDirectory } from './install-service.js';
import type { Server } from '@locternos/shared';

const MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const JAR = Buffer.concat([MAGIC, Buffer.from('artifact-body')]);
const SHA1 = createHash('sha1').update(JAR).digest('hex');
const SHA256 = createHash('sha256').update(JAR).digest('hex');

function jarResponse(): Response {
  return new Response(JAR, { status: 200 });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type Handler = () => Response;

function routedFetch(routes: Record<string, Handler>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const handler = routes[String(input)];
    return handler ? handler() : new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

function vanillaRoutes(): Record<string, Handler> {
  return {
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json': () =>
      json({ versions: [{ id: '1.21.4', type: 'release', url: 'https://mojang.test/v.json' }] }),
    'https://mojang.test/v.json': () =>
      json({
        downloads: {
          server: { url: 'https://mojang.test/server.jar', sha1: SHA1, size: JAR.length },
        },
      }),
    'https://mojang.test/server.jar': jarResponse,
  };
}

function modrinthRoutes(): Record<string, Handler> {
  const versionFile = {
    url: 'https://cdn.modrinth.com/essentialsx.jar',
    filename: 'essentialsx.jar',
    size: JAR.length,
    hashes: { sha1: 'a'.repeat(40), sha512: 'b'.repeat(128) },
    primary: true,
  };
  const depFile = { ...versionFile, url: 'https://cdn.modrinth.com/lib.jar', filename: 'lib.jar' };
  return {
    'https://api.modrinth.com/v2/project/essentialsx': () =>
      json({
        id: 'P1',
        slug: 'essentialsx',
        title: 'EssentialsX',
        project_type: 'plugin',
        description: '',
      }),
    'https://api.modrinth.com/v2/project/lib': () =>
      json({ id: 'P2', slug: 'lib', title: 'Lib', project_type: 'plugin', description: '' }),
    'https://api.modrinth.com/v2/project/P2': () =>
      json({ id: 'P2', slug: 'lib', title: 'Lib', project_type: 'plugin', description: '' }),
    'https://api.modrinth.com/v2/project/P1/version?game_versions=%5B%221.21.4%22%5D&loaders=%5B%22paper%22%2C%22spigot%22%2C%22bukkit%22%5D':
      () =>
        json([
          {
            id: 'V1',
            project_id: 'P1',
            name: 'EssentialsX 1.0',
            version_number: '1.0',
            game_versions: ['1.21.4'],
            loaders: ['paper'],
            files: [versionFile],
            dependencies: [
              { dependency_type: 'required', project_id: 'P2', version_id: 'V2', file_name: null },
            ],
          },
        ]),
    'https://api.modrinth.com/v2/project/P2/version?game_versions=%5B%221.21.4%22%5D&loaders=%5B%22paper%22%2C%22spigot%22%2C%22bukkit%22%5D':
      () => json([]),
    'https://api.modrinth.com/v2/version/V2': () =>
      json({
        id: 'V2',
        project_id: 'P2',
        name: 'Lib 1.0',
        version_number: '1.0',
        game_versions: ['1.21.4'],
        loaders: ['paper'],
        files: [depFile],
        dependencies: [],
      }),
    'https://cdn.modrinth.com/essentialsx.jar': jarResponse,
    'https://cdn.modrinth.com/lib.jar': jarResponse,
  };
}

interface Harness {
  dir: string;
  config: Config;
  handle: DatabaseHandle;
  server: Server;
  service: ReturnType<typeof createArtifactInstallService>;
  cleanup: () => Promise<void>;
}

async function harness(fetchImpl: typeof fetch, coreType: Server['coreType'] = 'paper'): Promise<Harness> {
  const dir = await mkdtemp(path.join(tmpdir(), 'locternos-install-'));
  const config = loadConfig({
    LOCTERNOS_DATA_DIR: dir,
    LOCTERNOS_FRONTEND_DIR: path.join(dir, 'no-frontend'),
    LOG_LEVEL: 'silent',
  });
  await ensureDataLayout(config);
  const handle = openDatabase(config.paths.database);
  runMigrations(handle.db);

  const server = createServer(handle.db, {
    name: 'Install Test',
    coreType,
    mcVersion: '1.21.4',
    minRamMb: 1024,
    maxRamMb: 2048,
    jvmFlagsProfile: 'default',
    customJvmArgs: '',
    logRetentionPolicy: '7d',
  });

  return {
    dir,
    config,
    handle,
    server,
    service: createArtifactInstallService({ db: handle.db, config, fetchImpl }),
    cleanup: async () => {
      handle.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const cleanups: Array<() => Promise<void>> = [];
after(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

describe('artifact install service', () => {
  it('installs a vanilla core and updates the server entrypoint', async () => {
    const ctx = await harness(routedFetch(vanillaRoutes()), 'vanilla');
    cleanups.push(ctx.cleanup);

    const result = await ctx.service.installCore(
      ctx.server.id,
      { coreType: 'vanilla', version: '1.21.4' },
      null,
    );

    assert.equal(result.server.entrypointJar, 'server.jar');
    assert.equal(result.server.mcVersion, '1.21.4');
    assert.equal(result.artifact.kind, 'core');
    assert.equal(result.artifact.sourceType, 'provider');
    assert.equal(result.artifact.sha256, SHA256);
    await access(path.join(ctx.config.paths.servers, ctx.server.slug, 'server.jar'));

    const audits = listAuditEvents(ctx.handle.db, { serverId: ctx.server.id });
    assert.ok(audits.some((event) => event.action === 'core.installed'));
  });

  it('installs a custom core from a direct URL', async () => {
    const ctx = await harness(
      routedFetch({ 'https://example.test/custom.jar': jarResponse }),
      'custom',
    );
    cleanups.push(ctx.cleanup);

    const result = await ctx.service.installCore(
      ctx.server.id,
      { coreType: 'custom', downloadUrl: 'https://example.test/custom.jar' },
      null,
    );

    assert.equal(result.artifact.sourceType, 'direct_url');
    assert.equal(result.server.coreType, 'custom');
  });

  it('installs a plugin from a direct URL into plugins/', async () => {
    const ctx = await harness(routedFetch({ 'https://example.test/Cool.jar': jarResponse }), 'paper');
    cleanups.push(ctx.cleanup);

    const outcome = await ctx.service.installArtifact(
      ctx.server.id,
      { kind: 'plugin', sourceType: 'direct_url', sourceUrl: 'https://example.test/Cool.jar' },
      null,
    );

    assert.equal(outcome.status, 'installed');
    if (outcome.status !== 'installed') return;
    assert.equal(outcome.artifact.filename, 'Cool.jar');
    const files = await readdir(artifactDirectory(ctx.config, ctx.server, 'plugin'));
    assert.deepEqual(files, ['Cool.jar']);
  });

  it('installs a Modrinth plugin with its required dependency', async () => {
    const ctx = await harness(routedFetch(modrinthRoutes()), 'paper');
    cleanups.push(ctx.cleanup);

    const outcome = await ctx.service.installArtifact(
      ctx.server.id,
      {
        kind: 'plugin',
        sourceType: 'modrinth_page',
        modrinthUrl: 'https://modrinth.com/plugin/essentialsx',
      },
      null,
    );

    assert.equal(outcome.status, 'installed');
    if (outcome.status !== 'installed') return;
    assert.equal(outcome.artifact.projectId, 'P1');
    assert.equal(outcome.dependencies.length, 1);
    assert.equal(outcome.dependencies[0]?.projectId, 'P2');

    const files = await readdir(artifactDirectory(ctx.config, ctx.server, 'plugin'));
    assert.deepEqual(files.sort(), ['essentialsx.jar', 'lib.jar']);
  });

  it('returns fallback versions when Modrinth has no exact match', async () => {
    const routes = modrinthRoutes();
    routes[
      'https://api.modrinth.com/v2/project/P1/version?game_versions=%5B%221.21.4%22%5D&loaders=%5B%22paper%22%2C%22spigot%22%2C%22bukkit%22%5D'
    ] = () => json([]);
    const version = {
      id: 'V9',
      project_id: 'P1',
      name: 'EssentialsX 0.9',
      version_number: '0.9',
      game_versions: ['1.20.1'],
      loaders: ['paper'],
      files: [
        {
          url: 'https://cdn.modrinth.com/old.jar',
          filename: 'old.jar',
          size: JAR.length,
          hashes: { sha1: 'c'.repeat(40), sha512: 'd'.repeat(128) },
          primary: true,
        },
      ],
      dependencies: [],
    };
    routes[
      'https://api.modrinth.com/v2/project/P1/version?game_versions=%5B%221.21.4%22%5D&loaders=%5B%5D'
    ] = () => json([version]);

    const ctx = await harness(routedFetch(routes), 'paper');
    cleanups.push(ctx.cleanup);

    const outcome = await ctx.service.installArtifact(
      ctx.server.id,
      {
        kind: 'plugin',
        sourceType: 'modrinth_page',
        modrinthUrl: 'https://modrinth.com/plugin/essentialsx',
      },
      null,
    );

    assert.equal(outcome.status, 'needs_selection');
    if (outcome.status !== 'needs_selection') return;
    assert.equal(outcome.fallbackVersions[0]?.id, 'V9');
  });

  it('stores uploaded jars and can remove them again', async () => {
    const ctx = await harness(routedFetch({}), 'paper');
    cleanups.push(ctx.cleanup);

    const { artifact } = await ctx.service.installUpload(
      ctx.server.id,
      { kind: 'plugin', filename: 'Uploaded.jar', data: JAR },
      null,
    );
    assert.equal(artifact.sourceType, 'upload');

    const pluginDir = artifactDirectory(ctx.config, ctx.server, 'plugin');
    assert.deepEqual(await readdir(pluginDir), ['Uploaded.jar']);

    assert.equal(await ctx.service.remove(ctx.server.id, artifact.id, null), true);
    assert.deepEqual(await readdir(pluginDir), []);
    assert.equal(ctx.service.list(ctx.server.id).length, 0);

    const audits = listAuditEvents(ctx.handle.db, { serverId: ctx.server.id });
    assert.ok(audits.some((event) => event.action === 'artifact.removed'));
  });

  it('rejects installing a plugin on a Vanilla server', async () => {
    const ctx = await harness(routedFetch({}), 'vanilla');
    cleanups.push(ctx.cleanup);

    await assert.rejects(
      ctx.service.installArtifact(
        ctx.server.id,
        {
          kind: 'plugin',
          sourceType: 'modrinth_page',
          modrinthUrl: 'https://modrinth.com/plugin/essentialsx',
        },
        null,
      ),
      /does not support plugins/i,
    );
  });
});
