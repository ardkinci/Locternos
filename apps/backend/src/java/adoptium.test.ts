import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AdoptiumApiError,
  AdoptiumChecksumError,
  adoptiumArchitecture,
  adoptiumOs,
  downloadRuntimeArchive,
  resolveAdoptiumRuntime,
  selectAdoptiumRuntime,
} from './adoptium.js';

const ARCHIVE = 'fake-temurin-archive-bytes';
const ARCHIVE_SHA = createHash('sha256').update(ARCHIVE).digest('hex');

function releaseFixture(overrides: { checksum?: string } = {}) {
  return [
    {
      release_name: 'jdk-21.0.5+11',
      version_data: { semver: '21.0.5+11', major: 21 },
      binaries: [
        {
          os: 'windows',
          architecture: 'x64',
          image_type: 'jdk',
          package: { link: 'https://example.test/win.zip', checksum: ARCHIVE_SHA, size: ARCHIVE.length },
        },
        {
          os: 'linux',
          architecture: 'x64',
          image_type: 'jdk',
          package: {
            link: 'https://example.test/linux.tar.gz',
            checksum: overrides.checksum ?? ARCHIVE_SHA,
            size: ARCHIVE.length,
          },
        },
        {
          os: 'linux',
          architecture: 'x64',
          image_type: 'jre',
          package: { link: 'https://example.test/linux-jre.tar.gz', checksum: ARCHIVE_SHA, size: ARCHIVE.length },
        },
      ],
    },
  ];
}

describe('adoptium runtime client', () => {
  const tempDirs: string[] = [];

  after(async () => {
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('maps Node platforms and architectures to Adoptium values', () => {
    assert.equal(adoptiumOs('darwin'), 'mac');
    assert.equal(adoptiumOs('win32'), 'windows');
    assert.equal(adoptiumOs('linux'), 'linux');
    assert.equal(adoptiumArchitecture('arm64'), 'aarch64');
    assert.equal(adoptiumArchitecture('x64'), 'x64');
    assert.equal(adoptiumArchitecture('ia32'), 'x32');
  });

  it('selects the binary matching os, architecture and image type', () => {
    const runtime = selectAdoptiumRuntime(releaseFixture(), {
      os: 'linux',
      architecture: 'x64',
      imageType: 'jdk',
    });

    assert.ok(runtime);
    assert.equal(runtime.downloadUrl, 'https://example.test/linux.tar.gz');
    assert.equal(runtime.version, '21.0.5+11');
    assert.equal(runtime.featureVersion, 21);
    assert.equal(runtime.vendor, 'Eclipse Temurin');
    assert.equal(runtime.checksum, ARCHIVE_SHA);
  });

  it('ignores packages with a malformed checksum', () => {
    const runtime = selectAdoptiumRuntime(releaseFixture({ checksum: 'not-a-checksum' }), {
      os: 'linux',
      architecture: 'x64',
      imageType: 'jdk',
    });
    assert.equal(runtime, null);
  });

  it('returns null for an unsupported target', () => {
    const runtime = selectAdoptiumRuntime(releaseFixture(), {
      os: 'linux',
      architecture: 'aarch64',
      imageType: 'jdk',
    });
    assert.equal(runtime, null);
  });

  it('resolves a runtime through the Adoptium API', async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response(JSON.stringify(releaseFixture()), { status: 200 });
    }) as typeof fetch;

    const runtime = await resolveAdoptiumRuntime({
      featureVersion: 21,
      imageType: 'jdk',
      os: 'linux',
      architecture: 'x64',
      apiBaseUrl: 'https://adoptium.test/',
      fetchImpl,
    });

    assert.equal(runtime.featureVersion, 21);
    assert.equal(requested.length, 1);
    assert.match(requested[0] ?? '', /feature_releases\/21\/ga/);
    assert.match(requested[0] ?? '', /image_type=jdk/);
    assert.match(requested[0] ?? '', /os=linux/);
  });

  it('reports when the API has no matching build', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify([]), { status: 200 })) as typeof fetch;

    await assert.rejects(
      resolveAdoptiumRuntime({
        featureVersion: 21,
        imageType: 'jdk',
        os: 'linux',
        architecture: 'x64',
        fetchImpl,
      }),
      AdoptiumApiError,
    );
  });

  it('downloads and verifies the archive checksum', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'locternos-adoptium-'));
    tempDirs.push(dir);
    const destination = path.join(dir, 'runtime.tar.gz');

    const fetchImpl = (async () =>
      new Response(ARCHIVE, { status: 200 })) as typeof fetch;
    const result = await downloadRuntimeArchive({
      url: 'https://example.test/runtime.tar.gz',
      destination,
      expectedSha256: ARCHIVE_SHA,
      expectedSizeBytes: ARCHIVE.length,
      fetchImpl,
    });

    assert.equal(result.sha256, ARCHIVE_SHA);
    assert.equal(result.sizeBytes, ARCHIVE.length);
    assert.equal(await readFile(destination, 'utf8'), ARCHIVE);
  });

  it('rejects an archive whose checksum does not match', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'locternos-adoptium-'));
    tempDirs.push(dir);

    const fetchImpl = (async () => new Response(ARCHIVE, { status: 200 })) as typeof fetch;
    await assert.rejects(
      downloadRuntimeArchive({
        url: 'https://example.test/runtime.tar.gz',
        destination: path.join(dir, 'runtime.tar.gz'),
        expectedSha256: '0'.repeat(64),
        fetchImpl,
      }),
      AdoptiumChecksumError,
    );
  });
});
