import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt cost parameters (N=2^16, r=8, p=1 is ~64 MiB per hash).
// They are stored inside each hash so they can be raised later without
// invalidating existing passwords.
const DEFAULT_PARAMS = { N: 65536, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const SCHEME = 'scrypt';

function deriveKey(
  password: string,
  salt: Buffer,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  const options: ScryptOptions = {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 128 * 1024 * 1024,
  };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** Hashes a password into `scrypt$N$r$p$salt$hash` (salt and hash are base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const { N, r, p } = DEFAULT_PARAMS;
  const key = await deriveKey(password, salt, DEFAULT_PARAMS);
  return [SCHEME, N, r, p, salt.toString('base64'), key.toString('base64')].join('$');
}

/** Returns false for wrong passwords and for malformed stored hashes. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== SCHEME) return false;

  const [, rawN, rawR, rawP, saltB64, hashB64] = parts;
  const params = { N: Number(rawN), r: Number(rawR), p: Number(rawP) };
  if (![params.N, params.r, params.p].every((v) => Number.isInteger(v) && v > 0)) return false;

  const salt = Buffer.from(saltB64 ?? '', 'base64');
  const expected = Buffer.from(hashB64 ?? '', 'base64');
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;

  const actual = await deriveKey(password, salt, params);
  return timingSafeEqual(actual, expected);
}
