import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildJvmArgs, splitCustomArgs } from './jvm-args.js';

describe('splitCustomArgs', () => {
  it('splits plain arguments', () => {
    assert.deepEqual(splitCustomArgs('-Dfoo=bar -Dbaz=qux'), ['-Dfoo=bar', '-Dbaz=qux']);
  });

  it('keeps quoted values together', () => {
    assert.deepEqual(splitCustomArgs('-Dpath="/srv/my server" -Dname=\'a b\''), [
      '-Dpath=/srv/my server',
      '-Dname=a b',
    ]);
  });

  it('handles escaped spaces and empty input', () => {
    assert.deepEqual(splitCustomArgs('-Dpath=/srv/my\\ server'), ['-Dpath=/srv/my server']);
    assert.deepEqual(splitCustomArgs('   '), []);
  });
});

describe('buildJvmArgs', () => {
  const base = {
    minRamMb: 1024,
    maxRamMb: 4096,
    profile: 'default' as const,
    customJvmArgs: '',
    entrypointJar: 'server.jar',
  };

  it('places RAM limits first and appends jar plus nogui', () => {
    assert.deepEqual(buildJvmArgs(base), ['-Xms1024M', '-Xmx4096M', '-jar', 'server.jar', 'nogui']);
  });

  it('adds Aikar flags for the aikars profile', () => {
    const args = buildJvmArgs({ ...base, profile: 'aikars' });
    assert.ok(args.includes('-XX:+UseG1GC'));
    assert.ok(args.includes('-XX:MaxGCPauseMillis=200'));
    assert.equal(args.at(-1), 'nogui');
  });

  it('adds ZGC flags for the zgc profile', () => {
    const args = buildJvmArgs({ ...base, profile: 'zgc' });
    assert.ok(args.includes('-XX:+UseZGC'));
  });

  it('keeps custom args before the jar', () => {
    const args = buildJvmArgs({ ...base, customJvmArgs: '-Dfoo=bar' });
    assert.ok(args.indexOf('-Dfoo=bar') < args.indexOf('-jar'));
  });
});
