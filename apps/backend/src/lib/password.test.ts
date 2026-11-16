import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('verifies the original password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery');

    assert.equal(await verifyPassword('correct horse battery', hash), true);
    assert.equal(await verifyPassword('wrong password', hash), false);
  });

  it('uses a fresh salt for every hash of the same password', async () => {
    const first = await hashPassword('same-password');
    const second = await hashPassword('same-password');

    assert.notEqual(first, second);
    assert.equal(await verifyPassword('same-password', first), true);
    assert.equal(await verifyPassword('same-password', second), true);
  });

  it('stores the scheme and cost parameters inside the hash', async () => {
    const hash = await hashPassword('params');

    assert.match(hash, /^scrypt\$65536\$8\$1\$/);
    assert.equal(hash.split('$').length, 6);
  });

  it('returns false for malformed stored hashes instead of throwing', async () => {
    assert.equal(await verifyPassword('x', ''), false);
    assert.equal(await verifyPassword('x', 'bcrypt$10$abc'), false);
    assert.equal(await verifyPassword('x', 'scrypt$0$8$1$AAAA$AAAA'), false);
    assert.equal(await verifyPassword('x', 'scrypt$65536$8$1$$'), false);
  });
});
