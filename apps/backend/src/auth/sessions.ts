import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { User } from '@locternos/shared';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { toPublicUser } from './users.js';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

/** Creates a session and returns the raw token, which is never stored. */
export function createSession(db: Db, userId: string, now = new Date()): CreatedSession {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  db.insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
    .run();
  return { token, expiresAt };
}

/** Returns the session owner, or null if the token is unknown or expired. */
export function findSessionUser(db: Db, token: string, now = new Date()): User | null {
  const row = db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, now.toISOString())))
    .get();
  return row ? toPublicUser(row.user) : null;
}

export function deleteSession(db: Db, token: string): void {
  db.delete(sessions)
    .where(eq(sessions.id, hashToken(token)))
    .run();
}

/** Removes sessions past their expiry. Called opportunistically on login. */
export function deleteExpiredSessions(db: Db, now = new Date()): void {
  db.delete(sessions).where(lt(sessions.expiresAt, now.toISOString())).run();
}
