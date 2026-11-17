import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchVanillaVersions,
  installVanillaServer,
  VanillaProviderError,
} from './vanilla.js';

const JAR = 'vanilla-jar-fixture';
const SHA1 = createHash('sha1').update(JAR).digest('hex');
const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

interface FetchCall {
  url: string;
}

function fakeFetch(
  routes: Record<string, unknown>,
  calls: FetchCall[] = [],
  jarBody = JAR,
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push({ url });
    if (url.endsWith('server.jar')) return new Response(jarBody, { status: 200 });

    const body = routes[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const versionUrl = 'https://example.test/version/1.21.4.json';

function manifest(): unknown {
  return {
    versions: [
      { id: '1.21.4', type: 'release', url: versionUrl },
      { id: 'broken' },
    ],
  };
}

function details(): unknown {
  return {
    downloads: {
      server: { url: 'https://example.test/server.jar', sha1: SHA1, size: JAR.length },
    },
  };
}

describe('vanilla provider', () => {
  const tempDirs: string[] = [];

  after(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  });

  async function destination(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'locternos-vanilla-'));
    tempDirs.push(dir);
    return path.join(dir, 'server.jar');
  }

  it('lists valid versions and skips malformed entries', async () => {
    const versions = await fetchVanillaVersions(fakeFetch({ [MANIFEST_URL]: manifest() }));
    assert.deepEqual(versions, [{ id: '1.21.4', type: 'release', url: versionUrl }]);
  });

  it('downloads and verifies the official server jar', async () => {
    const calls: FetchCall[] = [];
    const target = await destination();
    const result = await installVanillaServer(
      '1.21.4',
      target,
      fakeFetch({ [MANIFEST_URL]: manifest(), [versionUrl]: details() }, calls),
    );

    assert.equal(result.sha1, SHA1);
    assert.equal(result.sizeBytes, JAR.length);
    assert.equal(await readFile(target, 'utf8'), JAR);
    assert.deepEqual(
      calls.map((call) => call.url),
      [MANIFEST_URL, versionUrl, 'https://example.test/server.jar'],
    );
  });

  it('rejects unknown versions', async () => {
    const target = await destination();
    await assert.rejects(
      installVanillaServer('9.9.9', target, fakeFetch({ [MANIFEST_URL]: manifest() })),
      VanillaProviderError,
    );
  });

  it('rejects versions without a server download', async () => {
    const target = await destination();
    await assert.rejects(
      installVanillaServer(
        '1.21.4',
        target,
        fakeFetch({ [MANIFEST_URL]: manifest(), [versionUrl]: { downloads: {} } }),
      ),
      VanillaProviderError,
    );
  });

  it('rejects a jar whose SHA-1 does not match', async () => {
    const target = await destination();
    await assert.rejects(
      installVanillaServer(
        '1.21.4',
        target,
        fakeFetch({ [MANIFEST_URL]: manifest(), [versionUrl]: details() }, [], 'tampered'),
      ),
      /SHA-1 mismatch|sha1 mismatch/i,
    );
  });
});
