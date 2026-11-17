import { z } from 'zod';
import { serverCoreTypeSchema, artifactKindSchema, artifactSourceTypeSchema } from './enums.js';

export const installCoreInputSchema = z.discriminatedUnion('coreType', [
  z.object({
    coreType: z.literal('vanilla'),
    version: z.string().min(1),
  }),
  z.object({
    coreType: z.literal('paper'),
    version: z.string().min(1),
    build: z.number().int().positive().optional(),
  }),
  z.object({
    coreType: z.literal('fabric'),
    mcVersion: z.string().min(1),
    loaderVersion: z.string().min(1).optional(),
  }),
  z.object({
    coreType: z.literal('custom'),
    downloadUrl: z.string().min(1).optional(),
  }),
]);
export type InstallCoreInput = z.infer<typeof installCoreInputSchema>;

export const modrinthDependencyInfoSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  versionId: z.string(),
  versionNumber: z.string(),
  filename: z.string(),
  dependencyType: z.enum(['required', 'optional', 'incompatible', 'embedded']),
});
export type ModrinthDependencyInfo = z.infer<typeof modrinthDependencyInfoSchema>;

export const installArtifactInputSchema = z.object({
  kind: artifactKindSchema, // plugin or mod
  sourceType: artifactSourceTypeSchema,
  sourceUrl: z.string().min(1).optional(),
  modrinthUrl: z.string().min(1).optional(),
});
export type InstallArtifactInput = z.infer<typeof installArtifactInputSchema>;
