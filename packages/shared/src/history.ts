import { z } from 'zod';
import { auditEventSchema } from './audit.js';
import { serverLogSchema } from './log.js';
import { serverRunSchema } from './run.js';

export const serverRunListResponseSchema = z.object({
  runs: z.array(serverRunSchema),
});
export type ServerRunListResponse = z.infer<typeof serverRunListResponseSchema>;

export const serverLogListResponseSchema = z.object({
  logs: z.array(serverLogSchema),
});
export type ServerLogListResponse = z.infer<typeof serverLogListResponseSchema>;

export const auditEventListResponseSchema = z.object({
  events: z.array(auditEventSchema),
});
export type AuditEventListResponse = z.infer<typeof auditEventListResponseSchema>;

/** Filters accepted by the historical log search endpoint. */
export const logSearchQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  runId: z.string().min(1).optional(),
  level: z.enum(['INFO', 'WARN', 'ERROR', 'FATAL']).optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(500),
});

/** Search parameters as sent by the panel. */
export interface LogSearchQuery {
  query?: string;
  runId?: string;
  level?: 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  limit?: number;
}

/** A raw log file stored in the server log directory. */
export const logFileSchema = z.object({
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.string().datetime(),
});
export type LogFile = z.infer<typeof logFileSchema>;

export const logFileListResponseSchema = z.object({
  files: z.array(logFileSchema),
});
export type LogFileListResponse = z.infer<typeof logFileListResponseSchema>;
