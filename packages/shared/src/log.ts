import { z } from 'zod';
import { logLevelSchema } from './enums.js';

export const serverLogSchema = z.object({
  id: z.number().int(),
  runId: z.string(),
  serverId: z.string(),
  timestamp: z.string().datetime(),
  level: logLevelSchema,
  thread: z.string().nullable(),
  message: z.string(),
});
export type ServerLog = z.infer<typeof serverLogSchema>;
