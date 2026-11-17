import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Artifact, ArtifactKind, ArtifactSourceType } from '@locternos/shared';
import type { Db } from '../db/client.js';
import { artifacts } from '../db/schema.js';

type ArtifactRow = typeof artifacts.$inferSelect;

function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    serverId: row.serverId,
    kind: row.kind as ArtifactKind,
    filename: row.filename,
    sourceType: row.sourceType as ArtifactSourceType,
    sourceUrl: row.sourceUrl,
    projectId: row.projectId,
    versionId: row.versionId,
    sha256: row.sha256,
    installedAt: row.installedAt,
    enabled: row.enabled,
  };
}

export interface RecordArtifactInput {
  serverId: string;
  kind: ArtifactKind;
  filename: string;
  sourceType: ArtifactSourceType;
  sourceUrl?: string | null;
  projectId?: string | null;
  versionId?: string | null;
  sha256: string;
}

/** Record a newly installed core, plugin, or mod. */
export function recordArtifact(
  db: Db,
  input: RecordArtifactInput,
  now = new Date(),
): Artifact {
  const id = randomUUID();
  const timestamp = now.toISOString();

  const row: ArtifactRow = {
    id,
    serverId: input.serverId,
    kind: input.kind,
    filename: input.filename,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl ?? null,
    projectId: input.projectId ?? null,
    versionId: input.versionId ?? null,
    sha256: input.sha256,
    installedAt: timestamp,
    enabled: true,
  };

  db.insert(artifacts).values(row).run();
  return toArtifact(row);
}

/** List all installed artifacts for a server. */
export function listArtifacts(db: Db, serverId: string): Artifact[] {
  const rows = db.select().from(artifacts).where(eq(artifacts.serverId, serverId)).all();
  return rows.map(toArtifact);
}

/** Fetch a single artifact by ID. */
export function getArtifact(db: Db, id: string): Artifact | null {
  const row = db.select().from(artifacts).where(eq(artifacts.id, id)).get();
  return row ? toArtifact(row) : null;
}

/** Update the enabled state of an artifact. Returns the updated artifact. */
export function setArtifactEnabled(db: Db, id: string, enabled: boolean): Artifact | null {
  const existing = db.select().from(artifacts).where(eq(artifacts.id, id)).get();
  if (!existing) return null;

  db.update(artifacts).set({ enabled }).where(eq(artifacts.id, id)).run();
  return toArtifact({ ...existing, enabled });
}

/** Delete an artifact. Returns true if it existed. */
export function deleteArtifact(db: Db, id: string): boolean {
  const existing = db.select({ id: artifacts.id }).from(artifacts).where(eq(artifacts.id, id)).get();
  if (!existing) return false;

  db.delete(artifacts).where(eq(artifacts.id, id)).run();
  return true;
}
