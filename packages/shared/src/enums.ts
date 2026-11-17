import { z } from 'zod';

export const serverCoreTypeSchema = z.enum(['vanilla', 'paper', 'fabric', 'custom']);
export type ServerCoreType = z.infer<typeof serverCoreTypeSchema>;

export const serverStatusSchema = z.enum(['stopped', 'starting', 'running', 'stopping', 'crashed']);
export type ServerStatus = z.infer<typeof serverStatusSchema>;

export const jvmFlagsProfileSchema = z.enum(['default', 'aikars', 'zgc']);
export type JvmFlagsProfile = z.infer<typeof jvmFlagsProfileSchema>;

export const logRetentionPolicySchema = z.enum([
  'none',
  '24h',
  '7d',
  '30d',
  '90d',
  '365d',
  'forever',
]);
export type LogRetentionPolicy = z.infer<typeof logRetentionPolicySchema>;

export const logLevelSchema = z.enum(['INFO', 'WARN', 'ERROR', 'FATAL']);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const artifactKindSchema = z.enum(['core', 'plugin', 'mod', 'datapack']);
export type ArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactSourceTypeSchema = z.enum([
  'provider',
  'modrinth_page',
  'direct_url',
  'upload',
]);
export type ArtifactSourceType = z.infer<typeof artifactSourceTypeSchema>;

export const userRoleSchema = z.enum(['admin']);
export type UserRole = z.infer<typeof userRoleSchema>;
