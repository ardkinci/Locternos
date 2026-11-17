import { z } from 'zod';

export const javaRuntimeImageTypeSchema = z.enum(['jdk', 'jre']);
export type JavaRuntimeImageType = z.infer<typeof javaRuntimeImageTypeSchema>;

export const javaRuntimeSourceSchema = z.enum(['system', 'managed']);
export type JavaRuntimeSource = z.infer<typeof javaRuntimeSourceSchema>;

/**
 * A Java installation the panel can start servers with. `path` always points
 * at the executable (not the home directory) so it can be launched directly.
 */
export const javaRuntimeSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  vendor: z.string().nullable(),
  version: z.string().min(1),
  majorVersion: z.number().int().positive(),
  source: javaRuntimeSourceSchema,
  imageType: javaRuntimeImageTypeSchema.nullable(),
  installedAt: z.string().datetime().nullable(),
});
export type JavaRuntime = z.infer<typeof javaRuntimeSchema>;

export const javaRuntimeListResponseSchema = z.object({
  runtimes: z.array(javaRuntimeSchema),
});
export type JavaRuntimeListResponse = z.infer<typeof javaRuntimeListResponseSchema>;

export const javaRuntimeResponseSchema = z.object({
  runtime: javaRuntimeSchema,
});
export type JavaRuntimeResponse = z.infer<typeof javaRuntimeResponseSchema>;

/**
 * The Java major version a Minecraft version was built for, together with
 * whether any locally known runtime can run it. Runtimes with an equal or
 * newer major version count as satisfying the requirement.
 */
export const javaVersionRequirementSchema = z.object({
  mcVersion: z.string().min(1),
  requiredMajorVersion: z.number().int().positive(),
  satisfied: z.boolean(),
  matchingRuntimeIds: z.array(z.string()),
});
export type JavaVersionRequirement = z.infer<typeof javaVersionRequirementSchema>;

/** Explicit, user-confirmed request to download an Adoptium Temurin runtime. */
export const installJavaRuntimeInputSchema = z.object({
  featureVersion: z.number().int().min(8).max(99),
  imageType: javaRuntimeImageTypeSchema.default('jdk'),
});
export type InstallJavaRuntimeInput = z.infer<typeof installJavaRuntimeInputSchema>;

/** A downloadable Adoptium binary selected for the current OS/architecture. */
export const adoptiumRuntimeSchema = z.object({
  featureVersion: z.number().int().positive(),
  imageType: javaRuntimeImageTypeSchema,
  vendor: z.string().min(1),
  releaseName: z.string().min(1),
  version: z.string().min(1),
  os: z.string().min(1),
  architecture: z.string().min(1),
  downloadUrl: z.string().min(1),
  checksum: z.string().length(64),
  sizeBytes: z.number().int().positive(),
});
export type AdoptiumRuntime = z.infer<typeof adoptiumRuntimeSchema>;
