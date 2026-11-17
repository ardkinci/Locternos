import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import type { AuditEvent } from '@locternos/shared';
import type { Db } from '../db/client.js';
import { auditEvents } from '../db/schema.js';

type AuditRow = typeof auditEvents.$inferSelect;

function toAuditEvent(row: AuditRow): AuditEvent {
  return {
    id: row.id,
    serverId: row.serverId,
    userId: row.userId,
    action: row.action,
    details: JSON.parse(row.details) as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}

export interface RecordAuditEventInput {
  action: string;
  details?: Record<string, unknown>;
  serverId?: string | null;
  userId?: string | null;
}

/** Record an audit event (configuration change, install, etc.). */
export function recordAuditEvent(
  db: Db,
  input: RecordAuditEventInput,
  now = new Date(),
): AuditEvent {
  const id = randomUUID();
  const timestamp = now.toISOString();

  const row: AuditRow = {
    id,
    serverId: input.serverId ?? null,
    userId: input.userId ?? null,
    action: input.action,
    details: JSON.stringify(input.details ?? {}),
    createdAt: timestamp,
  };

  db.insert(auditEvents).values(row).run();
  return toAuditEvent(row);
}

/** List audit events, optionally filtered by server or user. */
export function listAuditEvents(
  db: Db,
  options: {
    serverId?: string | null;
    userId?: string | null;
    limit?: number;
  } = {},
): AuditEvent[] {
  const { serverId, userId, limit = 1000 } = options;

  const conditions: SQL[] = [];
  if (serverId === null) {
    conditions.push(isNull(auditEvents.serverId));
  } else if (serverId !== undefined) {
    conditions.push(eq(auditEvents.serverId, serverId));
  }
  if (userId === null) {
    conditions.push(isNull(auditEvents.userId));
  } else if (userId !== undefined) {
    conditions.push(eq(auditEvents.userId, userId));
  }

  const rows = db
    .select()
    .from(auditEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditEvents.createdAt))
    .limit(limit)
    .all();
  return rows.map(toAuditEvent);
}

/** Fetch a single audit event by ID. */
export function getAuditEvent(db: Db, id: string): AuditEvent | null {
  const row = db.select().from(auditEvents).where(eq(auditEvents.id, id)).get();
  return row ? toAuditEvent(row) : null;
}
