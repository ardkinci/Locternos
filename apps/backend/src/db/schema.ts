import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import {
  jvmFlagsProfileSchema,
  logLevelSchema,
  logRetentionPolicySchema,
  serverCoreTypeSchema,
  serverStatusSchema,
  userRoleSchema,
  type JvmFlagsProfile,
  type LogLevel,
  type LogRetentionPolicy,
  type ServerCoreType,
  type ServerStatus,
  type UserRole,
} from '@locternos/shared';

// Zod's `.options` is typed as a plain array; drizzle needs a non-empty tuple.
const userRoles = userRoleSchema.options as [UserRole, ...UserRole[]];
const serverCoreTypes = serverCoreTypeSchema.options as [ServerCoreType, ...ServerCoreType[]];
const serverStatuses = serverStatusSchema.options as [ServerStatus, ...ServerStatus[]];
const jvmFlagsProfiles = jvmFlagsProfileSchema.options as [JvmFlagsProfile, ...JvmFlagsProfile[]];
const logRetentionPolicies = logRetentionPolicySchema.options as [
  LogRetentionPolicy,
  ...LogRetentionPolicy[],
];
const logLevels = logLevelSchema.options as [LogLevel, ...LogLevel[]];

/** Panel accounts. Phase 1 only has the single Admin created on first run. */
export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: userRoles }).notNull().default('admin'),
  createdAt: text('created_at').notNull(),
});

/**
 * Login sessions. `id` is the SHA-256 of the bearer token: the raw token only
 * lives in the client's cookie, so a leaked database cannot be replayed.
 */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

/**
 * A managed Minecraft server. `slug` is unique because it doubles as the
 * server's directory name under `data/servers/`.
 */
export const servers = sqliteTable('servers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  coreType: text('core_type', { enum: serverCoreTypes }).notNull(),
  mcVersion: text('mc_version'),
  entrypointJar: text('entrypoint_jar').notNull().default(''),
  javaPath: text('java_path'),
  minRamMb: integer('min_ram_mb').notNull(),
  maxRamMb: integer('max_ram_mb').notNull(),
  jvmFlagsProfile: text('jvm_flags_profile', { enum: jvmFlagsProfiles })
    .notNull()
    .default('default'),
  customJvmArgs: text('custom_jvm_args').notNull().default(''),
  port: integer('port').notNull(),
  logRetentionPolicy: text('log_retention_policy', { enum: logRetentionPolicies })
    .notNull()
    .default('7d'),
  eulaAcceptedAt: text('eula_accepted_at'),
  status: text('status', { enum: serverStatuses }).notNull().default('stopped'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/**
 * One process lifetime of a server. `stoppedAt` stays null while the run is
 * open, which makes closed runs distinguishable without inspecting `exitCode`.
 */
export const serverRuns = sqliteTable(
  'server_runs',
  {
    id: text('id').primaryKey(),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    pid: integer('pid'),
    startedAt: text('started_at').notNull(),
    stoppedAt: text('stopped_at'),
    exitCode: integer('exit_code'),
    stopReason: text('stop_reason'),
    peakRamMb: integer('peak_ram_mb'),
  },
  (table) => [index('server_runs_server_started_idx').on(table.serverId, table.startedAt)],
);

/**
 * Parsed console output. The `server_logs_fts` FTS5 virtual table mirrors
 * `message` through triggers created in the migration, so keyword search stays
 * fast without a second write path.
 */
export const serverLogs = sqliteTable(
  'server_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: text('run_id')
      .notNull()
      .references(() => serverRuns.id, { onDelete: 'cascade' }),
    serverId: text('server_id')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    timestamp: text('timestamp').notNull(),
    level: text('level', { enum: logLevels }).notNull(),
    thread: text('thread'),
    message: text('message').notNull(),
  },
  (table) => [
    index('server_logs_server_timestamp_idx').on(table.serverId, table.timestamp),
    index('server_logs_run_idx').on(table.runId),
  ],
);
