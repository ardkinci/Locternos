import { randomBytes, randomUUID } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import type { User } from '@locternos/shared';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

type UserRow = typeof users.$inferSelect;

export function toPublicUser(row: UserRow): User {
  return { id: row.id, email: row.email, role: row.role, createdAt: row.createdAt };
}

export function countUsers(db: Db): number {
  return db.select({ value: count() }).from(users).get()?.value ?? 0;
}

/**
 * Creates the first Admin. Returns null if any account already exists.
 * The emptiness check and the insert run in one synchronous SQLite
 * transaction, so two concurrent setup requests cannot both succeed.
 */
export async function createFirstAdmin(
  db: Db,
  email: string,
  password: string,
): Promise<User | null> {
  const row: UserRow = {
    id: randomUUID(),
    email,
    passwordHash: await hashPassword(password),
    role: 'admin',
    createdAt: new Date().toISOString(),
  };

  return db.transaction((tx) => {
    const existing = tx.select({ value: count() }).from(users).get()?.value ?? 0;
    if (existing > 0) return null;
    tx.insert(users).values(row).run();
    return toPublicUser(row);
  });
}

// Lazily computed so the first failed login pays the same hashing cost as a
// real one. Without it, unknown emails would answer noticeably faster.
let decoyHash: Promise<string> | undefined;

/**
 * Returns the user for valid credentials, otherwise null. Always performs one
 * scrypt verification so response timing does not reveal which emails exist.
 */
export async function verifyCredentials(
  db: Db,
  email: string,
  password: string,
): Promise<User | null> {
  const row = db.select().from(users).where(eq(users.email, email)).get();
  if (!row) {
    decoyHash ??= hashPassword(randomBytes(16).toString('hex'));
    await verifyPassword(password, await decoyHash);
    return null;
  }
  return (await verifyPassword(password, row.passwordHash)) ? toPublicUser(row) : null;
}
