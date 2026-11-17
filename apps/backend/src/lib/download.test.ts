import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChecksumMismatchError, DownloadError, downloadToFile } from './download.js';

const CONTENT = 'download-fixture-bytes';
const SHA1 = createHash('sha1').update(CONTENT).digest('hex');
const SHA256 = createHash('sha256').update(CONTENT).digest('hex');

describe('downloadToFile', () => {
  const tempDirs: string[] = [];

  after(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  });

  async function destination(name = 'file.bin'): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), 'locternos-download-'));
    tempDirs.push(dir);
    return path.join(dir, name);
  }

  function stubFetch(body: string | null, status = 200): typeof fetch {
    return (async () =>
      new Response(body, { status })) as unknown as typeof fetch;
  }

  it('streams the file and returns a verified SHA-1 digest', async () => {
    const target = await destination();
    const result = await downloadToFile({
      url: 'https://example.test/server.jar',
      destination: target,
      algorithm: 'sha1',
      expectedHex: SHA1.toUpperCase(),
      expectedSizeBytes: CONTENT.length,
      fetchImpl: stubFetch(CONTENT),
    });

    assert.deepEqual(result, { hash: SHA1, sizeBytes: CONTENT.length });
    assert.equal(await readFile(target, 'utf8'), CONTENT);
  });

  it('supports SHA-256 verification', async () => {
    const target = await destination();
    const result = await downloadToFile({
      url: 'https://example.test/server.jar',
      destination: target,
      algorithm: 'sha256',
      expectedHex: SHA256,
      fetchImpl: stubFetch(CONTENT),
    });
    assert.equal(result.hash, SHA256);
  });

  it('rejects a digest mismatch', async () => {
    const target = await destination();
    await assert.rejects(
      downloadToFile({
        url: 'https://example.test/server.jar',
        destination: target,
        algorithm: 'sha256',
        expectedHex: '0'.repeat(64),
        fetchImpl: stubFetch(CONTENT),
      }),
      ChecksumMismatchError,
    );
  });

  it('rejects a size mismatch', async () => {
    const target = await destination();
    await assert.rejects(
      downloadToFile({
        url: 'https://example.test/server.jar',
        destination: target,
        algorithm: 'sha1',
        expectedSizeBytes: CONTENT.length + 1,
        fetchImpl: stubFetch(CONTENT),
      }),
      DownloadError,
    );
  });

  it('rejects HTTP errors and empty bodies', async () => {
    const target = await destination();
    await assert.rejects(
      downloadToFile({
        url: 'https://example.test/server.jar',
        destination: target,
        algorithm: 'sha1',
        fetchImpl: stubFetch(null, 500),
      }),
      DownloadError,
    );
  });
});
