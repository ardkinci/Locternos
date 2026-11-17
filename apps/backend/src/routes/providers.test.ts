import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { createProviderCatalogService } from '../providers/catalog-service.js';

const ADMIN = { email: 'admin@example.com', password: 'correct-horse-battery' };

interface TestContext {
  app: FastifyInstance;
  cookie: string;
  cleanup: () => Promise<void>;
}

function sessionCookieFrom(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  return typeof first === 'string' ? (first.split(';')[0] ?? '') : '';
}

async function startTestApp(): Promise<TestContext> {
  const dir = await mkdtemp(path.join(tmpdir(), 'locternos-providers-'));
  const config = loadConfig({
    LOCTERNOS_DATA_DIR: dir,
    LOCTERNOS_FRONTEND_DIR: path.join(dir, 'no-frontend'),
    LOG_LEVEL: 'silent',
  });

  const app = await buildApp(config, {
    providerCatalogService: createProviderCatalogService({
      fetchImpl: async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('version_manifest')) {
          return jsonResponse({
            versions: [
              { id: '1.21.4', type: 'release', url: 'https://example.test/1.21.4' },
              { id: '1.21.3', type: 'release', url: 'https://example.test/1.21.3' },
            ],
          });
        }
        if (url.endsWith('/projects/paper')) {
          return jsonResponse({
            project: { id: 'paper' },
            versions: { '1.21.4': ['1.21.4'], '1.20.6': ['1.20.6'] },
          });
        }
        if (url.includes('/builds')) {
          return jsonResponse([
            {
              id: 231,
              downloads: {
                'server:default': {
                  name: 'paper.jar',
                  url: 'https://fill-data.papermc.io/v1/objects/aaa/paper.jar',
                  checksums: { sha256: 'a'.repeat(64) },
                },
              },
            },
            {
              id: 230,
              downloads: {
                'server:default': {
                  name: 'paper.jar',
                  url: 'https://fill-data.papermc.io/v1/objects/bbb/paper.jar',
                  checksums: { sha256: 'b'.repeat(64) },
                },
              },
            },
          ]);
        }
        if (url.includes('/v2/versions/game')) {
          return jsonResponse([{ version: '1.21.4', stable: true }]);
        }
        if (url.includes('/v2/versions/loader')) {
          return jsonResponse([{ version: '0.16.9', stable: true }]);
        }
        throw new Error(`Unexpected request: ${url}`);
      },
    }),
  });

  return {
    app,
    cookie: '',
    cleanup: async () => {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('provider catalog API', () => {
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

  it('requires authentication', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/providers/paper/versions' });
    assert.equal(res.statusCode, 401);
  });

  it('lists vanilla versions', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/providers/vanilla/versions',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json<{ versions: { id: string; type: string }[] }>().versions[0], {
      id: '1.21.4',
      type: 'release',
    });
  });

  it('lists paper versions and builds', async () => {
    const versions = await ctx.app.inject({
      method: 'GET',
      url: '/api/providers/paper/versions',
      headers: { cookie: ctx.cookie },
    });
    assert.deepEqual(versions.json<{ versions: string[] }>().versions, ['1.21.4', '1.20.6']);

    const builds = await ctx.app.inject({
      method: 'GET',
      url: '/api/providers/paper/builds?version=1.21.4',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(builds.json<{ builds: { build: number }[] }>().builds[0]?.build, 231);

    const missingVersion = await ctx.app.inject({
      method: 'GET',
      url: '/api/providers/paper/builds',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(missingVersion.statusCode, 400);
  });

  it('lists fabric game and loader versions', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/providers/fabric/versions',
      headers: { cookie: ctx.cookie },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json<{ gameVersions: string[]; loaderVersions: string[] }>();
    assert.deepEqual(body.gameVersions, ['1.21.4']);
    assert.deepEqual(body.loaderVersions, ['0.16.9']);
  });
});
