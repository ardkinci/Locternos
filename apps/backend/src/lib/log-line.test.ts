import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isServerReadyLine, parseLogLine, splitLines } from './log-line.js';

const NOW = new Date('2026-03-04T10:00:00.000Z');

describe('parseLogLine', () => {
  it('parses vanilla server lines', () => {
    const parsed = parseLogLine('[10:15:30] [Server thread/INFO]: Starting minecraft server', 'stdout', NOW);
    assert.equal(parsed.level, 'INFO');
    assert.equal(parsed.thread, 'Server thread');
    assert.equal(parsed.message, 'Starting minecraft server');
    assert.equal(parsed.stream, 'stdout');
    const expected = new Date(NOW);
    expected.setHours(10, 15, 30, 0);
    assert.equal(parsed.timestamp, expected.toISOString());
  });

  it('parses warnings and errors on stderr', () => {
    const warn = parseLogLine('[10:15:30] [Server thread/WARN]: Can\'t keep up!', 'stderr', NOW);
    assert.equal(warn.level, 'WARN');
    assert.equal(warn.stream, 'stderr');

    const error = parseLogLine('[10:15:30] [main/ERROR]: Failed to load', 'stdout', NOW);
    assert.equal(error.level, 'ERROR');
  });

  it('strips a trailing logger segment', () => {
    const parsed = parseLogLine('[10:15:30] [Server thread/INFO] [Paper]: Loading plugins', 'stdout', NOW);
    assert.equal(parsed.message, 'Loading plugins');
    assert.equal(parsed.thread, 'Server thread');
  });

  it('parses craftbukkit style lines', () => {
    const parsed = parseLogLine('[10:15:30 WARN]: legacy warning', 'stdout', NOW);
    assert.equal(parsed.level, 'WARN');
    assert.equal(parsed.thread, null);
    assert.equal(parsed.message, 'legacy warning');
  });

  it('keeps JVM output readable', () => {
    const parsed = parseLogLine('OpenJDK 64-Bit Server VM warning: Options -Xverify:none', 'stderr', NOW);
    assert.equal(parsed.level, 'WARN');
    assert.equal(parsed.thread, null);
    assert.equal(parsed.message, 'OpenJDK 64-Bit Server VM warning: Options -Xverify:none');
    assert.equal(parsed.timestamp, NOW.toISOString());
  });

  it('parses full dates when present', () => {
    const parsed = parseLogLine('[2026-01-02 03:04:05] [main/INFO]: hello', 'stdout', NOW);
    const expected = new Date(2026, 0, 2, 3, 4, 5);
    assert.equal(parsed.timestamp, expected.toISOString());
  });

  it('detects the ready line', () => {
    assert.equal(isServerReadyLine('Done (3.215s)! For help, type "help"'), true);
    assert.equal(isServerReadyLine('Starting minecraft server'), false);
  });
});

describe('splitLines', () => {
  it('keeps partial trailing output for the next chunk', () => {
    const first = splitLines('alpha\nbeta\npart', '');
    assert.deepEqual(first.lines, ['alpha', 'beta']);
    assert.equal(first.pending, 'part');

    const second = splitLines('ial\ngamma\n', first.pending);
    assert.deepEqual(second.lines, ['partial', 'gamma']);
    assert.equal(second.pending, '');
  });
});
