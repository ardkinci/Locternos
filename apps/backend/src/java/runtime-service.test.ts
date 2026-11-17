import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AdoptiumRuntime, JavaRuntime } from '@locternos/shared';
import {
  createJavaRuntimeService,
  isManagedRuntimeId,
  JavaInstallError,
  managedRuntimeId,
} from './runtime-service.js';

const ARCHIVE = 'archive-bytes';
const ARCHIVE_SHA = createHash('sha256').update(ARCHIVE).digest('hex');

const SYSTEM_RUNTIME: JavaRuntime = {
  id: 'system-abc123',
  path: '/usr/lib/jvm/java-21/bin/java',
  vendor: 'Eclipse Temurin',
  version: '21.0.5',
  majorVersion: 21,
  source: 'system',
  imageType: null,
  installedAt: null,
};

function adoptiumRuntime(): AdoptiumRuntime {
  return {
    featureVersion: 21,
    imageType: 'jdk',
    vendor: 'Eclipse Temurin',
    releaseName: 'jdk-21.0.5+11',
    version: '21.0.5+11',
    os: 'linux',
    architecture: 'x64',
    downloadUrl: 'https://example.test/runtime.tar.gz',
    checksum: ARCHIVE_SHA,
    sizeBytes: ARCHIVE.length,
  };
}

interface Harness {
  dir: string;
  runtimesDir: string;
  service: ReturnType<typeof createJavaRuntimeService>;
  resolveCalls: number;
  cleanup: () => Promise<void>;
}

async function harness(
  options: { extractCreatesBinary?: boolean; systemRuntimes?: JavaRuntime[] } = {},
): Promise<Harness> {
  const dir = await mkdtemp(path.join(tmpdir(), 'locternos-java-'));
  const runtimesDir = path.join(dir, 'runtimes');
  const state = { resolveCalls: 0 };

  const service = createJavaRuntimeService({
    runtimesDir,
    scanSystem: async () => options.systemRuntimes ?? [SYSTEM_RUNTIME],
    resolveAdoptium: async () => {
      state.resolveCalls += 1;
      return adoptiumRuntime();
    },
    downloadArchive: async ({ destination, expectedSha256 }) => {
      await writeFile(destination, ARCHIVE);
      return { sha256: expectedSha256, sizeBytes: ARCHIVE.length };
    },
    extractArchive: async (_archivePath, destination) => {
      const home = path.join(destination, 'jdk-21.0.5+11');
      await mkdir(path.join(home, 'bin'), { recursive: true });
      if (options.extractCreatesBinary !== false) {
        await writeFile(path.join(home, 'bin', 'java'), '');
      }
    },
    mojang: { getRequiredJava: async (mcVersion: string) => ({ mcVersion, majorVersion: 21, component: null }) },
    now: () => new Date('2026-01-02T03:04:05.000Z'),
  });

  return {
    dir,
    runtimesDir,
    service,
    get resolveCalls() {
      return state.resolveCalls;
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

describe('java runtime service', () => {
  it('lists system runtimes without rescanning inside the cache window', async () => {
    const ctx = await harness();
    cleanups.push(ctx.cleanup);

    const first = await ctx.service.list();
    const second = await ctx.service.list();
    assert.deepEqual(first.map((runtime) => runtime.id), ['system-abc123']);
    assert.deepEqual(second, first);
  });

  it('installs a managed runtime and records metadata', async () => {
    const ctx = await harness();
    cleanups.push(ctx.cleanup);

    const result = await ctx.service.install({ featureVersion: 21, imageType: 'jdk' });
    assert.equal(result.alreadyInstalled, false);
    assert.equal(result.runtime.id, 'temurin-21-jdk');
    assert.equal(result.runtime.source, 'managed');
    assert.equal(result.runtime.majorVersion, 21);
    assert.equal(result.runtime.installedAt, '2026-01-02T03:04:05.000Z');
    assert.match(result.runtime.path, /jdk-21\.0\.5\+11[/\\]bin[/\\]java$/);

    const metadata = JSON.parse(
      await readFile(path.join(ctx.runtimesDir, 'temurin-21-jdk', 'runtime.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(metadata.featureVersion, 21);
    assert.equal(metadata.imageType, 'jdk');
    assert.equal(metadata.sha256, ARCHIVE_SHA);
    assert.equal(metadata.javaBinary, 'jdk-21.0.5+11/bin/java');

    const managed = await ctx.service.listManaged();
    assert.equal(managed.length, 1);
    assert.equal(managed[0]?.id, 'temurin-21-jdk');
  });

  it('reuses an already installed runtime without resolving again', async () => {
    const ctx = await harness();
    cleanups.push(ctx.cleanup);

    await ctx.service.install({ featureVersion: 21, imageType: 'jdk' });
    const second = await ctx.service.install({ featureVersion: 21, imageType: 'jdk' });

    assert.equal(second.alreadyInstalled, true);
    assert.equal(ctx.resolveCalls, 1);
  });

  it('fails and cleans up when the archive has no java executable', async () => {
    const ctx = await harness({ extractCreatesBinary: false });
    cleanups.push(ctx.cleanup);

    await assert.rejects(
      ctx.service.install({ featureVersion: 21, imageType: 'jdk' }),
      JavaInstallError,
    );
    assert.deepEqual(await ctx.service.listManaged(), []);
  });

  it('only removes managed runtime ids', async () => {
    const ctx = await harness();
    cleanups.push(ctx.cleanup);

    await ctx.service.install({ featureVersion: 21, imageType: 'jdk' });
    assert.equal(await ctx.service.remove('system-abc123'), false);
    assert.equal(await ctx.service.remove('../escape'), false);
    assert.equal(await ctx.service.remove('temurin-21-jdk'), true);
    assert.equal(await ctx.service.remove('temurin-21-jdk'), false);
    assert.deepEqual(await ctx.service.listManaged(), []);
  });

  it('reports a satisfied requirement from a newer system runtime', async () => {
    const ctx = await harness();
    cleanups.push(ctx.cleanup);

    const requirement = await ctx.service.requirement('1.21.4');
    assert.deepEqual(requirement, {
      mcVersion: '1.21.4',
      requiredMajorVersion: 21,
      satisfied: true,
      matchingRuntimeIds: ['system-abc123'],
    });
  });

  it('reports an unsatisfied requirement when no runtime is new enough', async () => {
    const older: JavaRuntime = { ...SYSTEM_RUNTIME, id: 'system-old', majorVersion: 8 };
    const ctx = await harness({ systemRuntimes: [older] });
    cleanups.push(ctx.cleanup);

    const requirement = await ctx.service.requirement('1.21.4');
    assert.equal(requirement.satisfied, false);
    assert.deepEqual(requirement.matchingRuntimeIds, []);
  });

  it('validates managed ids', () => {
    assert.equal(managedRuntimeId(21, 'jdk'), 'temurin-21-jdk');
    assert.equal(isManagedRuntimeId('temurin-21-jdk'), true);
    assert.equal(isManagedRuntimeId('temurin-8-jre'), true);
    assert.equal(isManagedRuntimeId('system-abc123'), false);
    assert.equal(isManagedRuntimeId('../temurin-21-jdk'), false);
  });
});
