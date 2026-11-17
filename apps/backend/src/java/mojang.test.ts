import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MojangManifestError, MojangVersionClient } from './mojang.js';

const MANIFEST_URL = 'https://example.test/manifest.json';
const VERSION_URL = 'https://example.test/version/1.21.4.json';

interface FakeFetch {
  fetchImpl: typeof fetch;
  calls: string[];
}

function fakeFetch(responses: Record<string, unknown>, status = 200): FakeFetch {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const body = responses[url];
    if (body === undefined) {
      return new Response('not found', { status: 404 });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function manifest(): unknown {
  return {
    versions: [{ id: '1.21.4', url: VERSION_URL }],
  };
}

describe('mojang java requirement', () => {
  it('reads the required major version from the version details', async () => {
    const fake = fakeFetch({
      [MANIFEST_URL]: manifest(),
      [VERSION_URL]: { javaVersion: { component: 'java-runtime-delta', majorVersion: 21 } },
    });
    const client = new MojangVersionClient({ fetchImpl: fake.fetchImpl, manifestUrl: MANIFEST_URL });

    assert.deepEqual(await client.getRequiredJava('1.21.4'), {
      mcVersion: '1.21.4',
      majorVersion: 21,
      component: 'java-runtime-delta',
    });
  });

  it('caches immutable version details', async () => {
    const fake = fakeFetch({
      [MANIFEST_URL]: manifest(),
      [VERSION_URL]: { javaVersion: { majorVersion: 21 } },
    });
    const client = new MojangVersionClient({ fetchImpl: fake.fetchImpl, manifestUrl: MANIFEST_URL });

    await client.getRequiredJava('1.21.4');
    await client.getRequiredJava('1.21.4');

    assert.deepEqual(fake.calls, [MANIFEST_URL, VERSION_URL]);
  });

  it('refetches the version list once the cache TTL expires', async () => {
    let now = 0;
    const secondUrl = 'https://example.test/version/1.21.3.json';
    const fake = fakeFetch({
      [MANIFEST_URL]: {
        versions: [
          { id: '1.21.4', url: VERSION_URL },
          { id: '1.21.3', url: secondUrl },
        ],
      },
      [VERSION_URL]: { javaVersion: { majorVersion: 21 } },
      [secondUrl]: { javaVersion: { majorVersion: 21 } },
    });
    const client = new MojangVersionClient({
      fetchImpl: fake.fetchImpl,
      manifestUrl: MANIFEST_URL,
      cacheTtlMs: 1000,
      now: () => now,
    });

    await client.getRequiredJava('1.21.4');
    now = 1500;
    await client.getRequiredJava('1.21.3');

    assert.equal(fake.calls.filter((url) => url === MANIFEST_URL).length, 2);
  });

  it('rejects unknown Minecraft versions', async () => {
    const fake = fakeFetch({ [MANIFEST_URL]: manifest() });
    const client = new MojangVersionClient({ fetchImpl: fake.fetchImpl, manifestUrl: MANIFEST_URL });

    await assert.rejects(client.getRequiredJava('9.9.9'), MojangManifestError);
  });

  it('rejects version details without a Java version', async () => {
    const fake = fakeFetch({
      [MANIFEST_URL]: manifest(),
      [VERSION_URL]: { id: '1.21.4' },
    });
    const client = new MojangVersionClient({ fetchImpl: fake.fetchImpl, manifestUrl: MANIFEST_URL });

    await assert.rejects(client.getRequiredJava('1.21.4'), MojangManifestError);
  });

  it('rejects failed manifest requests', async () => {
    const fake = fakeFetch({}, 500);
    const client = new MojangVersionClient({ fetchImpl: fake.fetchImpl, manifestUrl: MANIFEST_URL });

    await assert.rejects(client.getRequiredJava('1.21.4'), /status 404|status 500/);
  });
});
