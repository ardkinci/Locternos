import { z } from 'zod';
import { logLevelSchema, serverStatusSchema } from './enums.js';

/** Which OS stream a console line arrived on. */
export const consoleStreamSchema = z.enum(['stdout', 'stderr']);
export type ConsoleStream = z.infer<typeof consoleStreamSchema>;

/**
 * A single parsed console line. `thread` is null for lines that do not follow
 * the modern Minecraft log layout (for example JVM startup output).
 */
export const consoleLineSchema = z.object({
  timestamp: z.string().datetime(),
  level: logLevelSchema,
  thread: z.string().nullable(),
  message: z.string(),
  stream: consoleStreamSchema,
});
export type ConsoleLine = z.infer<typeof consoleLineSchema>;

export const serverMetricsSchema = z.object({
  /** Resident set size of the server process in megabytes. */
  ramMb: z.number().nullable(),
  /** CPU usage percentage since the previous sample. */
  cpuPercent: z.number().nullable(),
  uptimeSeconds: z.number().nullable(),
  peakRamMb: z.number().nullable(),
  /** Read-only size of the server directory in bytes. */
  diskBytes: z.number().nullable(),
});
export type ServerMetrics = z.infer<typeof serverMetricsSchema>;

export const serverRuntimeStateSchema = z.object({
  serverId: z.string(),
  status: serverStatusSchema,
  pid: z.number().int().nullable(),
  runId: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  /** True when the EULA is accepted both in the database and in `eula.txt`. */
  eulaAccepted: z.boolean(),
  metrics: serverMetricsSchema,
});
export type ServerRuntimeState = z.infer<typeof serverRuntimeStateSchema>;

export const serverRuntimeResponseSchema = z.object({
  runtime: serverRuntimeStateSchema,
});
export type ServerRuntimeResponse = z.infer<typeof serverRuntimeResponseSchema>;

export const serverConsoleResponseSchema = z.object({
  lines: z.array(consoleLineSchema),
});
export type ServerConsoleResponse = z.infer<typeof serverConsoleResponseSchema>;

export const acceptEulaInputSchema = z.object({
  accepted: z.literal(true),
});
export type AcceptEulaInput = z.infer<typeof acceptEulaInputSchema>;

export const acceptEulaResponseSchema = z.object({
  eulaAcceptedAt: z.string().datetime(),
});
export type AcceptEulaResponse = z.infer<typeof acceptEulaResponseSchema>;

export const sendConsoleCommandInputSchema = z.object({
  command: z.string().trim().min(1).max(2048),
});
export type SendConsoleCommandInput = z.infer<typeof sendConsoleCommandInputSchema>;

export const stopServerInputSchema = z.object({
  /** Grace period before the process is force killed. */
  timeoutMs: z.number().int().min(0).max(120_000).optional(),
});
export type StopServerInput = z.infer<typeof stopServerInputSchema>;

export const restartServerInputSchema = z.object({
  timeoutMs: z.number().int().min(0).max(120_000).optional(),
});
export type RestartServerInput = z.infer<typeof restartServerInputSchema>;

/** Discriminator values used by the `code` field of runtime error replies. */
export const runtimeErrorCodeSchema = z.enum([
  'eula_required',
  'core_missing',
  'not_running',
  'already_running',
  'transition_in_progress',
  'invalid_state',
]);
export type RuntimeErrorCode = z.infer<typeof runtimeErrorCodeSchema>;
