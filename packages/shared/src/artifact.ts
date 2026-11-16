import { z } from 'zod';
import { artifactKindSchema, artifactSourceTypeSchema } from './enums.js';

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
});
export type Artifact = z.infer<typeof artifactSchema>;
