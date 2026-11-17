import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fabricServerJarUrl,
  fetchFabricGameVersions,
  fetchFabricInstallers,
  FabricProviderError,
  installFabricServer,
  resolveFabricLoader,
} from './fabric.js';

const JAR = 'fabric-server-launcher-fixture';
const SHA256 = createHash('sha256').update(JAR).digest('hex');
const META = 'https://meta.fabricmc.net';

function fakeFetch(routes: Record<string, unknown>, jar = JAR): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/server/jar')) return new Response(jar, { status: 200 });

    const body = routes[url];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

function routes(): Record<string, unknown> {
  return {
    [`${META}/v2/versions/game`]: [
      { version: '1.21.4', stable: true },
      { version: '24w01a', stable: false },
    ],
    [`${META}/v2/versions/loader`]: [
      { version: '0.16.9', stable: true },
      { version: '0.16.8', stable: true },
    ],
    [`${META}/v2/versions/installer`]: [{ version: '1.0.1', stable: true }],
  };
}

describe('fabric provider', () => {
  const tempDirs: string[] = [];

  after(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  });

  async function destination(): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'locternos-fabric-'));
    tempDirs.push(dir);
    return path.join(dir, 'server.jar');
  }

  it('lists stable game versions and skips unstable snapshots', async () => {
    assert.deepEqual(await fetchFabricGameVersions(fakeFetch(routes())), ['1.21.4']);
  });

  it('builds installer URLs from the Fabric Maven', async () => {
    const installers = await fetchFabricInstallers(fakeFetch(routes()));
    assert.deepEqual(installers, [
      {
        version: '1.0.1',
        url: 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar',
      },
    ]);
  });

  it('defaults to the latest stable loader and honours an explicit one', async () => {
    assert.equal(await resolveFabricLoader('1.21.4', undefined, fakeFetch(routes())), '0.16.9');
    assert.equal(await resolveFabricLoader('1.21.4', '0.16.8', fakeFetch(routes())), '0.16.8');
  });

  it('rejects unsupported game versions', async () => {
    await assert.rejects(
      resolveFabricLoader('9.9.9', undefined, fakeFetch(routes())),
      FabricProviderError,
    );
  });

  it('builds the server launcher URL', () => {
    assert.equal(
      fabricServerJarUrl('1.21.4', '0.16.9'),
      `${META}/v2/versions/loader/1.21.4/0.16.9/server/jar`,
    );
  });

  it('downloads the server launcher and returns its digest', async () => {
    const target = await destination();
    const result = await installFabricServer('1.21.4', undefined, target, fakeFetch(routes()));

    assert.equal(result.loaderVersion, '0.16.9');
    assert.equal(result.sha256, SHA256);
    assert.equal(await readFile(target, 'utf8'), JAR);
  });
});
