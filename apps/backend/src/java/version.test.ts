import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { majorVersionFromString, parseJavaVersion } from './version.js';

describe('java version parsing', () => {
  it('derives the major version from modern version strings', () => {
    assert.equal(majorVersionFromString('21.0.5'), 21);
    assert.equal(majorVersionFromString('17.0.12+7'), 17);
    assert.equal(majorVersionFromString('26-ea'), 26);
  });

  it('derives the real major version from legacy 1.x strings', () => {
    assert.equal(majorVersionFromString('1.8.0_392'), 8);
    assert.equal(majorVersionFromString('1.7.0_80'), 7);
  });

  it('rejects strings without a leading version number', () => {
    assert.equal(majorVersionFromString('unknown'), null);
    assert.equal(majorVersionFromString(''), null);
  });

  it('parses an OpenJDK 21 banner', () => {
    const banner = [
      'openjdk version "21.0.5" 2024-10-15 LTS',
      'OpenJDK Runtime Environment Temurin-21.0.5+11 (build 21.0.5+11-LTS)',
      'OpenJDK 64-Bit Server VM Temurin-21.0.5+11 (build 21.0.5+11-LTS, mixed mode)',
    ].join('\n');

    assert.deepEqual(parseJavaVersion(banner), {
      version: '21.0.5',
      majorVersion: 21,
      vendor: 'Eclipse Temurin',
    });
  });

  it('parses a legacy Java 8 banner', () => {
    const banner = [
      'java version "1.8.0_392"',
      'Java(TM) SE Runtime Environment (build 1.8.0_392-b08)',
      'Java HotSpot(TM) 64-Bit Server VM (build 25.392-b08, mixed mode)',
    ].join('\n');

    assert.deepEqual(parseJavaVersion(banner), {
      version: '1.8.0_392',
      majorVersion: 8,
      vendor: null,
    });
  });

  it('reports unknown vendors without failing the parse', () => {
    const parsed = parseJavaVersion('openjdk version "11.0.24" 2024-07-16\nOpenJDK Runtime');
    assert.equal(parsed?.majorVersion, 11);
    assert.equal(parsed?.vendor, 'OpenJDK');
  });

  it('returns null when the output has no version banner', () => {
    assert.equal(parseJavaVersion('command not found'), null);
  });
});
