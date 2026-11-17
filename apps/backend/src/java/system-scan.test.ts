import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectSystemJavaCandidates,
  commonJavaHomeRoots,
  explicitJavaCandidates,
  probeJavaRuntime,
  scanSystemJavaRuntimes,
  systemRuntimeId,
} from './system-scan.js';

describe('system java discovery', () => {
  it('builds candidates from JAVA_HOME and PATH entries', () => {
    const candidates = explicitJavaCandidates(
      {
        JAVA_HOME: '/opt/jdk-21',
        PATH: `/usr/bin${path.delimiter}/opt/jdk-17/bin`,
      },
      'linux',
    );

    assert.ok(candidates.includes(path.join('/opt/jdk-21', 'bin', 'java')));
    assert.ok(candidates.includes(path.join('/usr/bin', 'java')));
    assert.ok(candidates.includes(path.join('/opt/jdk-17/bin', 'java')));
    assert.ok(candidates.includes(path.join('/opt/jdk-17/bin', 'bin', 'java')));
  });

  it('targets java.exe and Windows install roots on win32', () => {
    const candidates = explicitJavaCandidates({ JAVA_HOME: 'C:\\Java\\21' }, 'win32');
    assert.ok(candidates.includes(path.join('C:\\Java\\21', 'bin', 'java.exe')));

    const roots = commonJavaHomeRoots(
      { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      'win32',
    );
    assert.ok(
      roots.includes(path.join('C:\\Program Files', 'Eclipse Adoptium')),
      'expected Temurin install root',
    );
    assert.ok(
      roots.includes(path.join('C:\\Users\\me\\AppData\\Local', 'Programs', 'Eclipse Adoptium')),
    );
  });

  it('deduplicates candidates and keeps only existing executables', async () => {
    const existing = new Set([path.join('/jdk', 'bin', 'java')]);

    const candidates = await collectSystemJavaCandidates({
      platform: 'linux',
      env: { JAVA_HOME: '/jdk', PATH: `/jdk/bin${path.delimiter}/jdk` },
      fileExists: async (candidate) => existing.has(path.normalize(candidate)),
      listDirectories: async () => [],
    });

    assert.deepEqual(candidates, [path.join('/jdk', 'bin', 'java')]);
  });

  it('scans common JDK homes and sorts by major version', async () => {
    const runtimes = await scanSystemJavaRuntimes({
      platform: 'linux',
      env: { PATH: '' },
      fileExists: async () => true,
      listDirectories: async (dir) => (dir === '/usr/lib/jvm' ? ['java-17', 'java-21'] : []),
      runJava: async (javaPath) => {
        if (javaPath.includes('java-21')) return 'openjdk version "21.0.5" 2024-10-15 LTS';
        if (javaPath.includes('java-17')) return 'openjdk version "17.0.12" 2024-07-16';
        return 'not a java banner';
      },
    });

    assert.deepEqual(
      runtimes.map((runtime) => runtime.majorVersion),
      [21, 17],
    );
    assert.equal(runtimes[0]?.source, 'system');
    assert.equal(runtimes[0]?.vendor, 'OpenJDK');
    assert.equal(runtimes[0]?.imageType, null);
    assert.equal(runtimes[0]?.installedAt, null);
    assert.equal(runtimes[0]?.id, systemRuntimeId(runtimes[0]!.path));
  });

  it('skips installations whose banner cannot be parsed', async () => {
    const runtimes = await scanSystemJavaRuntimes({
      platform: 'linux',
      env: { JAVA_HOME: '/broken' },
      fileExists: async () => true,
      listDirectories: async () => [],
      runJava: async () => 'Segmentation fault',
    });

    assert.deepEqual(runtimes, []);
  });

  it('probes a manual java override path', async () => {
    const runtime = await probeJavaRuntime('/opt/custom/bin/java', {
      fileExists: async () => true,
      runJava: async () => 'openjdk version "21.0.5" 2024-10-15 LTS',
    });

    assert.equal(runtime?.path, path.normalize('/opt/custom/bin/java'));
    assert.equal(runtime?.majorVersion, 21);
    assert.equal(runtime?.id, systemRuntimeId('/opt/custom/bin/java'));
  });

  it('rejects non-absolute, missing or unparseable overrides', async () => {
    assert.equal(await probeJavaRuntime('bin/java', { fileExists: async () => true }), null);
    assert.equal(
      await probeJavaRuntime('/missing/java', {
        fileExists: async () => false,
        runJava: async () => 'openjdk version "21.0.5"',
      }),
      null,
    );
    assert.equal(
      await probeJavaRuntime('/opt/java', {
        fileExists: async () => true,
        runJava: async () => 'not java',
      }),
      null,
    );
  });
});
