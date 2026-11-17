import { z } from 'zod';
import { artifactKindSchema, artifactSourceTypeSchema } from './enums.js';
import { serverSchema } from './server.js';

export const artifactSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  kind: artifactKindSchema,
  filename: z.string(),
  sourceType: artifactSourceTypeSchema,
  sourceUrl: z.string().nullable(),
  projectId: z.string().nullable(),
  versionId: z.string().nullable(),
  sha256: z.string().length(64),
  installedAt: z.string().datetime(),
  enabled: z.boolean(),
});
export type Artifact = z.infer<typeof artifactSchema>;

export const setArtifactEnabledInputSchema = z.object({
  enabled: z.boolean(),
});
export type SetArtifactEnabledInput = z.infer<typeof setArtifactEnabledInputSchema>;

export const setArtifactEnabledResponseSchema = z.object({
  artifact: artifactSchema,
});
export type SetArtifactEnabledResponse = z.infer<typeof setArtifactEnabledResponseSchema>;

export const artifactListResponseSchema = z.object({
  artifacts: z.array(artifactSchema),
});
export type ArtifactListResponse = z.infer<typeof artifactListResponseSchema>;

/** A Modrinth version the resolver could not auto-match. */
export const fallbackVersionSchema = z.object({
  id: z.string(),
  name: z.string(),
  versionNumber: z.string(),
  gameVersions: z.array(z.string()),
  loaders: z.array(z.string()),
  filename: z.string(),
  sizeBytes: z.number().int(),
});
export type FallbackVersion = z.infer<typeof fallbackVersionSchema>;

export const modrinthProjectInfoSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  projectType: z.string(),
});
export type ModrinthProjectInfo = z.infer<typeof modrinthProjectInfoSchema>;

/**
 * Outcome of an artifact install: either the artifact (and its required
 * dependencies) were installed, or the user has to pick a version.
 */
export const installArtifactOutcomeSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('installed'),
    artifact: artifactSchema,
    dependencies: z.array(artifactSchema),
  }),
  z.object({
    status: z.literal('needs_selection'),
    project: modrinthProjectInfoSchema,
    fallbackVersions: z.array(fallbackVersionSchema),
  }),
]);
export type InstallArtifactOutcome = z.infer<typeof installArtifactOutcomeSchema>;

export const installCoreResponseSchema = z.object({
  server: serverSchema,
  artifact: artifactSchema,
});
export type InstallCoreResponse = z.infer<typeof installCoreResponseSchema>;
