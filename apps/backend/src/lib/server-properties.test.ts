import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseServerProperties,
  serializeServerProperties,
  updateServerProperty,
} from './server-properties.js';

describe('server-properties parser', () => {
  it('preserves comments, blank lines and unknown keys', () => {
    const input = [
      '# Main settings',
      'motd=Locternos',
      '',
      'custom.unknown=true',
      '! legacy',
      'spawn-protection:16',
    ].join('\n');

    const parsed = parseServerProperties(input);
    assert.equal(parsed.lines.length, 6);

    const roundtrip = serializeServerProperties(parsed);
    assert.equal(roundtrip, input);
  });

  it('supports escaped separators in keys', () => {
    const input = 'query\\:port=25565';
    const parsed = parseServerProperties(input);

    const line = parsed.lines[0];
    assert.equal(line?.type, 'property');
    if (line?.type !== 'property') return;

    assert.equal(line.key, 'query:port');
    assert.equal(line.value, '25565');
    assert.equal(serializeServerProperties(parsed), input);
  });

  it('updates existing property and appends missing one', () => {
    const parsed = parseServerProperties('motd=Hello');
    const updated = updateServerProperty(parsed, 'motd', 'Welcome');
    const extended = updateServerProperty(updated, 'max-players', '20');

    assert.equal(serializeServerProperties(extended), 'motd=Welcome\nmax-players=20');
  });

  it('escapes spaces in keys and leading spaces in values', () => {
    const withKey = updateServerProperty(parseServerProperties('motd=x'), 'my key', 'v');
    const withValue = updateServerProperty(parseServerProperties('motd=x'), 'motd', ' hello');

    assert.equal(serializeServerProperties(withKey), 'motd=x\nmy\\ key=v');
    assert.equal(serializeServerProperties(withValue), 'motd=\\ hello');

    const reparsedKey = parseServerProperties(serializeServerProperties(withKey)).lines[1];
    const reparsedValue = parseServerProperties(serializeServerProperties(withValue)).lines[0];
    assert.equal(reparsedKey?.type, 'property');
    assert.equal(reparsedValue?.type, 'property');
    if (reparsedKey?.type !== 'property' || reparsedValue?.type !== 'property') return;
    assert.equal(reparsedKey.key, 'my key');
    assert.equal(reparsedValue.value, ' hello');
  });

  it('joins continuation lines with trailing backslash', () => {
    const parsed = parseServerProperties('motd=Hello\\\n world');
    const line = parsed.lines[0];

    assert.equal(line?.type, 'property');
    if (line?.type !== 'property') return;

    assert.equal(line.value, 'Hello world');
  });
});
