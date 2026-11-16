import type { FastifyPluginAsync } from 'fastify';
import { wsClientMessageSchema, type WsServerMessage } from '@locternos/shared';
import { VERSION } from '../version.js';

export const wsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/ws', { websocket: true }, (socket) => {
    const send = (msg: WsServerMessage) => socket.send(JSON.stringify(msg));
    send({ type: 'hello', version: VERSION });

    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const result = wsClientMessageSchema.safeParse(parsed);
      if (result.success && result.data.type === 'ping') send({ type: 'pong' });
    });
  });
};
