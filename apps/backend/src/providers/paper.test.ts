import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchPaperBuilds,
  fetchPaperVersions,
  installPaperServer,
  PaperProviderError,
  paperDownloadUrl,
  resolvePaperBuild,
} from './paper.js';

const JAR = 'paper-jar-fixture';
const SHA256 = createHash('sha256').update(JAR).digest('hex');
const API = 'https://fill.papermc.io/v3/projects/paper';
const VERSION_URL = `${API}/versions/1.21.4/builds`;
const DOWNLOAD_URL = 'https://fill-data.papermc.io/v1/objects/abc/paper-1.21.4-42.jar';

function fakeFetch(routes: Record<string, unknown>, jar = JAR): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === DOWNLOAD_URL) return new Response(jar, { status: 200 });

    const body = routes[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

function routes(): Record<string, unknown> {
  return {
    [API]: { project: { id: 'paper' }, versions: { '1.21.4': ['1.21.4'], '1.21.3': ['1.21.3'] } },
    [VERSION_URL]: [
      {
        id: 41,
        channel: 'STABLE',
        downloads: {
          'server:default': {
            name: 'paper-1.21.4-41.jar',
            url: 'https://fill-data.papermc.io/v1/objects/def/paper-1.21.4-41.jar',
            checksums: { sha256: 'a'.repeat(64) },
          },
        },
      },
      {
        id: 42,
        channel: 'STABLE',
        downloads: {
          'server:default': {
            name: 'paper-1.21.4-42.jar',
            url: DOWNLOAD_URL,
            checksums: { sha256: SHA256 },
          },
        },
      },
    ],
  };
}

describe('paper provider', () => {
  const tempDirs: string[] = [];

  after(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  });

  async function destination(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'locternos-paper-'));
    tempDirs.push(dir);
    return path.join(dir, 'server.jar');
  }

  it('lists published Paper versions', async () => {
    assert.deepEqual(await fetchPaperVersions(fakeFetch(routes())), ['1.21.4', '1.21.3']);
  });

  it('lists builds newest first and skips malformed downloads', async () => {
    const builds = await fetchPaperBuilds('1.21.4', fakeFetch(routes()));
    assert.deepEqual(
      builds.map((build) => build.build),
      [42, 41],
    );
  });

  it('resolves the latest build by default and a requested build explicitly', async () => {
    assert.equal((await resolvePaperBuild('1.21.4', undefined, fakeFetch(routes()))).build, 42);
    assert.equal((await resolvePaperBuild('1.21.4', 41, fakeFetch(routes()))).build, 41);
  });

  it('rejects unknown versions and builds', async () => {
    await assert.rejects(resolvePaperBuild('9.9.9', undefined, fakeFetch(routes())), PaperProviderError);
    await assert.rejects(resolvePaperBuild('1.21.4', 999, fakeFetch(routes())), PaperProviderError);
  });

  it('uses the download URL published with the build', () => {
    assert.equal(
      paperDownloadUrl('1.21.4', {
        build: 42,
        filename: 'paper-1.21.4-42.jar',
        sha256: SHA256,
        url: DOWNLOAD_URL,
      }),
      DOWNLOAD_URL,
    );
  });

  it('downloads and verifies the Paper build', async () => {
    const target = await destination();
    const result = await installPaperServer('1.21.4', undefined, target, fakeFetch(routes()));

    assert.equal(result.build, 42);
    assert.equal(result.sha256, SHA256);
    assert.equal(await readFile(target, 'utf8'), JAR);
  });

  it('rejects a build whose SHA-256 does not match', async () => {
    const target = await destination();
    await assert.rejects(
      installPaperServer('1.21.4', 42, target, fakeFetch(routes(), 'tampered')),
      /sha256 mismatch/i,
    );
  });
});
