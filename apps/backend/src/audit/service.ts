import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
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

  let query = db.select().from(auditEvents);

  if (serverId !== undefined) {
    query = query.where(eq(auditEvents.serverId, serverId)) as any;
  } else if (userId !== undefined) {
    query = query.where(eq(auditEvents.userId, userId)) as any;
  }

  const rows = (query.orderBy(desc(auditEvents.createdAt)).limit(limit) as any).all();
  return rows.map(toAuditEvent);
}

/** Fetch a single audit event by ID. */
export function getAuditEvent(db: Db, id: string): AuditEvent | null {
  const row = db.select().from(auditEvents).where(eq(auditEvents.id, id)).get();
  return row ? toAuditEvent(row) : null;
}
