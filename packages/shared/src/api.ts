import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** Messages sent from the backend to WebSocket clients. */
export const wsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), version: z.string() }),
  z.object({ type: z.literal('pong') }),
]);
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;

/** Messages sent from WebSocket clients to the backend. */
export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;
