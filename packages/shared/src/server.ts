import { z } from 'zod';
import {
  jvmFlagsProfileSchema,
  logRetentionPolicySchema,
  serverCoreTypeSchema,
  serverStatusSchema,
} from './enums.js';

export const serverSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(64),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  coreType: serverCoreTypeSchema,
  mcVersion: z.string().nullable(),
  entrypointJar: z.string(),
  javaPath: z.string().nullable(),
  minRamMb: z.number().int().min(256),
  maxRamMb: z.number().int().min(256),
  jvmFlagsProfile: jvmFlagsProfileSchema,
  customJvmArgs: z.string(),
  port: z.number().int().min(1).max(65535),
  logRetentionPolicy: logRetentionPolicySchema,
  eulaAcceptedAt: z.string().datetime().nullable(),
  status: serverStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Server = z.infer<typeof serverSchema>;

export const createServerInputSchema = z
  .object({
    name: serverSchema.shape.name,
    coreType: serverCoreTypeSchema,
    mcVersion: z.string().optional(),
    port: serverSchema.shape.port.optional(),
    minRamMb: serverSchema.shape.minRamMb.default(1024),
    maxRamMb: serverSchema.shape.maxRamMb.default(2048),
    jvmFlagsProfile: jvmFlagsProfileSchema.default('default'),
    customJvmArgs: z.string().default(''),
    javaPath: z.string().nullable().optional(),
    logRetentionPolicy: logRetentionPolicySchema.default('7d'),
  })
  .refine((v) => v.minRamMb <= v.maxRamMb, {
    message: 'minRamMb must be <= maxRamMb',
    path: ['minRamMb'],
  });
export type CreateServerInput = z.infer<typeof createServerInputSchema>;
