import { z } from 'zod';

export const serverRunSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  pid: z.number().int().nullable(),
  startedAt: z.string().datetime(),
  stoppedAt: z.string().datetime().nullable(),
  exitCode: z.number().int().nullable(),
  stopReason: z.string().nullable(),
  peakRamMb: z.number().nullable(),
});
export type ServerRun = z.infer<typeof serverRunSchema>;
