import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import {
  slugifyServerName,
  type CreateServerInput,
  type Server,
  type UpdateServerInput,
} from '@locternos/shared';
import type { Db } from '../db/client.js';
import { servers } from '../db/schema.js';

export const DEFAULT_SERVER_PORT = 25565;
const MAX_PORT = 65535;

type ServerRow = typeof servers.$inferSelect;

/** Raised when a port is already used by another server. */
export class PortInUseError extends Error {
  constructor(readonly port: number) {
    super(`Port ${port} is already used by another server`);
    this.name = 'PortInUseError';
  }
}

function toServer(row: ServerRow): Server {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    coreType: row.coreType,
    mcVersion: row.mcVersion,
    entrypointJar: row.entrypointJar,
    javaPath: row.javaPath,
    minRamMb: row.minRamMb,
    maxRamMb: row.maxRamMb,
    jvmFlagsProfile: row.jvmFlagsProfile,
    customJvmArgs: row.customJvmArgs,
    port: row.port,
    logRetentionPolicy: row.logRetentionPolicy,
    eulaAcceptedAt: row.eulaAcceptedAt,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Picks a slug that is not taken yet. The slug names the server directory, so
 * it is resolved once at creation time and never changes afterwards.
 */
function uniqueSlug(db: Db, name: string): string {
  const base = slugifyServerName(name) || 'server';
  let candidate = base;
  let suffix = 2;
  while (db.select({ id: servers.id }).from(servers).where(eq(servers.slug, candidate)).get()) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/** Picks the preferred port when it is free, otherwise the next free one. */
function uniquePort(db: Db, preferred: number): number {
  const isTaken = (port: number) =>
    Boolean(db.select({ id: servers.id }).from(servers).where(eq(servers.port, port)).get());

  if (!isTaken(preferred)) return preferred;
  for (let port = DEFAULT_SERVER_PORT; port <= MAX_PORT; port += 1) {
    if (!isTaken(port)) return port;
  }
  throw new Error('No free port available for the new server');
}

/** True when the port belongs to a server other than the given one. */
function isPortTakenByOther(db: Db, port: number, serverId: string): boolean {
  const row = db.select({ id: servers.id }).from(servers).where(eq(servers.port, port)).get();
  return Boolean(row) && row!.id !== serverId;
}

export function listServers(db: Db): Server[] {
  const rows = db.select().from(servers).orderBy(asc(servers.createdAt)).all();
  return rows.map(toServer);
}

export function getServer(db: Db, id: string): Server | null {
  const row = db.select().from(servers).where(eq(servers.id, id)).get();
  return row ? toServer(row) : null;
}

export function createServer(db: Db, input: CreateServerInput, now = new Date()): Server {
  const timestamp = now.toISOString();
  const row: ServerRow = {
    id: randomUUID(),
    name: input.name,
    slug: uniqueSlug(db, input.name),
    coreType: input.coreType,
    mcVersion: input.mcVersion ?? null,
    entrypointJar: '',
    javaPath: input.javaPath ?? null,
    minRamMb: input.minRamMb,
    maxRamMb: input.maxRamMb,
    jvmFlagsProfile: input.jvmFlagsProfile,
    customJvmArgs: input.customJvmArgs,
    port: uniquePort(db, input.port ?? DEFAULT_SERVER_PORT),
    logRetentionPolicy: input.logRetentionPolicy,
    eulaAcceptedAt: null,
    status: 'stopped',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  db.insert(servers).values(row).run();
  return toServer(row);
}

export function updateServer(
  db: Db,
  id: string,
  input: UpdateServerInput,
  now = new Date(),
): Server | null {
  const existing = db.select().from(servers).where(eq(servers.id, id)).get();
  if (!existing) return null;

  if (input.port !== undefined && isPortTakenByOther(db, input.port, id)) {
    throw new PortInUseError(input.port);
  }

  const changes: Partial<ServerRow> = { updatedAt: now.toISOString() };
  if (input.name !== undefined) changes.name = input.name;
  if (input.mcVersion !== undefined) changes.mcVersion = input.mcVersion;
  if (input.javaPath !== undefined) changes.javaPath = input.javaPath;
  if (input.minRamMb !== undefined) changes.minRamMb = input.minRamMb;
  if (input.maxRamMb !== undefined) changes.maxRamMb = input.maxRamMb;
  if (input.jvmFlagsProfile !== undefined) changes.jvmFlagsProfile = input.jvmFlagsProfile;
  if (input.customJvmArgs !== undefined) changes.customJvmArgs = input.customJvmArgs;
  if (input.port !== undefined) changes.port = input.port;
  if (input.logRetentionPolicy !== undefined) changes.logRetentionPolicy = input.logRetentionPolicy;

  db.update(servers).set(changes).where(eq(servers.id, id)).run();
  return getServer(db, id);
}

export function deleteServer(db: Db, id: string): boolean {
  const existing = db.select({ id: servers.id }).from(servers).where(eq(servers.id, id)).get();
  if (!existing) return false;

  db.delete(servers).where(eq(servers.id, id)).run();
  return true;
}
