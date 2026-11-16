import { z } from 'zod';

export const auditEventSchema = z.object({
  id: z.string(),
  serverId: z.string().nullable(),
  userId: z.string().nullable(),
  action: z.string(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
