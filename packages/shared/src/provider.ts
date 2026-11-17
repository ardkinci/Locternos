import { z } from 'zod';
import { artifactKindSchema, artifactSourceTypeSchema } from './enums.js';

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

/** A Minecraft version published in the Mojang version manifest. */
export const vanillaVersionSchema = z.object({
  id: z.string(),
  type: z.string(),
});
export type VanillaVersion = z.infer<typeof vanillaVersionSchema>;

export const vanillaVersionsResponseSchema = z.object({
  versions: z.array(vanillaVersionSchema),
});
export type VanillaVersionsResponse = z.infer<typeof vanillaVersionsResponseSchema>;

export const paperVersionsResponseSchema = z.object({
  versions: z.array(z.string()),
});
export type PaperVersionsResponse = z.infer<typeof paperVersionsResponseSchema>;

/** A published Paper build for a Minecraft version. */
export const paperBuildSchema = z.object({
  build: z.number().int().positive(),
  filename: z.string(),
  sha256: z.string(),
});
export type PaperBuild = z.infer<typeof paperBuildSchema>;

export const paperBuildsResponseSchema = z.object({
  builds: z.array(paperBuildSchema),
});
export type PaperBuildsResponse = z.infer<typeof paperBuildsResponseSchema>;

export const fabricVersionsResponseSchema = z.object({
  gameVersions: z.array(z.string()),
  loaderVersions: z.array(z.string()),
});
export type FabricVersionsResponse = z.infer<typeof fabricVersionsResponseSchema>;

export const modrinthDependencyInfoSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  versionId: z.string(),
  versionNumber: z.string(),
  filename: z.string(),
  dependencyType: z.enum(['required', 'optional', 'incompatible', 'embedded']),
});
export type ModrinthDependencyInfo = z.infer<typeof modrinthDependencyInfoSchema>;

export const installArtifactInputSchema = z
  .object({
    kind: artifactKindSchema, // plugin, mod or datapack
    sourceType: artifactSourceTypeSchema,
    sourceUrl: z.string().min(1).optional(),
    modrinthUrl: z.string().min(1).optional(),
    /** Chosen fallback version when the resolver could not auto-match. */
    versionId: z.string().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.sourceType === 'direct_url' && !value.sourceUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceUrl'],
        message: 'sourceUrl is required for direct_url installs',
      });
    }
    if (value.sourceType === 'modrinth_page' && !value.modrinthUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['modrinthUrl'],
        message: 'modrinthUrl is required for modrinth_page installs',
      });
    }
    if (value.sourceType !== 'direct_url' && value.sourceType !== 'modrinth_page') {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceType'],
        message: 'Only direct_url and modrinth_page installs are supported here',
      });
    }
  });
export type InstallArtifactInput = z.infer<typeof installArtifactInputSchema>;
