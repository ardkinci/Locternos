import type { FastifyPluginAsync } from 'fastify';
import { wsClientMessageSchema, type WsServerMessage } from '@locternos/shared';
import { currentUser, requireAuth } from '../auth/guard.js';
import { RuntimeError } from '../process/manager.js';
import { VERSION } from '../version.js';

export const wsRoutes: FastifyPluginAsync = async (app) => {
  // The session cookie is checked during the HTTP upgrade request, so
  // unauthenticated clients never get a WebSocket.
  app.get('/api/ws', { websocket: true, preHandler: requireAuth }, (socket, request) => {
    const user = currentUser(request);
    const send = (msg: WsServerMessage) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(msg));
    };
    const unsubscribers = new Map<string, () => void>();

    const unsubscribe = (serverId: string) => {
      const remove = unsubscribers.get(serverId);
      if (!remove) return;
      remove();
      unsubscribers.delete(serverId);
    };

    send({ type: 'hello', version: VERSION });

    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const result = wsClientMessageSchema.safeParse(parsed);
      if (!result.success) {
        send({ type: 'error', serverId: null, message: 'Invalid WebSocket message' });
        return;
      }

      const message = result.data;
      switch (message.type) {
        case 'ping':
          send({ type: 'pong' });
          return;
        case 'subscribe': {
          void (async () => {
            try {
              unsubscribe(message.serverId);
              const remove = app.runtimeService.subscribe(message.serverId, send);
              unsubscribers.set(message.serverId, remove);
              const runtime = await app.runtimeService.getRuntime(message.serverId);
              send({ type: 'runtime', runtime });
              const lines = app.runtimeService.getConsole(message.serverId);
              if (lines.length > 0) {
                send({ type: 'console', serverId: message.serverId, lines });
              }
            } catch (error) {
              send({ type: 'error', serverId: message.serverId, message: errorMessage(error) });
            }
          })();
          return;
        }
        case 'unsubscribe':
          unsubscribe(message.serverId);
          return;
        case 'command':
          void (async () => {
            try {
              await app.runtimeService.sendCommand(message.serverId, message.command, user.id);
            } catch (error) {
              send({ type: 'error', serverId: message.serverId, message: errorMessage(error) });
            }
          })();
          return;
      }
    });

    socket.on('close', () => {
      for (const remove of unsubscribers.values()) remove();
      unsubscribers.clear();
    });
  });
};

function errorMessage(error: unknown): string {
  if (error instanceof RuntimeError) return error.message;
  return 'Unexpected server error';
}
