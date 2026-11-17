import { z } from 'zod';
import { consoleLineSchema, serverRuntimeStateSchema } from './runtime.js';

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
  z.object({ type: z.literal('runtime'), runtime: serverRuntimeStateSchema }),
  z.object({
    type: z.literal('console'),
    serverId: z.string(),
    lines: z.array(consoleLineSchema),
  }),
  z.object({
    type: z.literal('error'),
    serverId: z.string().nullable(),
    message: z.string(),
  }),
]);
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;

/** Messages sent from WebSocket clients to the backend. */
export const wsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
  z.object({ type: z.literal('subscribe'), serverId: z.string().min(1) }),
  z.object({ type: z.literal('unsubscribe'), serverId: z.string().min(1) }),
  z.object({
    type: z.literal('command'),
    serverId: z.string().min(1),
    command: z.string().trim().min(1).max(2048),
  }),
]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;
