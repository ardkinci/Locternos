import {
  wsServerMessageSchema,
  type WsClientMessage,
  type WsServerMessage,
} from '@locternos/shared';

type Listener = (msg: WsServerMessage) => void;
type StatusListener = (connected: boolean) => void;

/** WebSocket client with automatic reconnect (exponential backoff). */
export class WsClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  connect(): void {
    this.closed = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${proto}://${location.host}/api/ws`);
    this.socket = socket;

    socket.onopen = () => {
      this.retry = 0;
      this.statusListeners.forEach((l) => l(true));
    };
    socket.onmessage = (ev) => {
      try {
        const msg = wsServerMessageSchema.parse(JSON.parse(String(ev.data)));
        this.listeners.forEach((l) => l(msg));
      } catch {
        // ignore malformed messages
      }
    };
    socket.onclose = () => {
      this.statusListeners.forEach((l) => l(false));
      if (this.closed) return;
      const delay = Math.min(1000 * 2 ** this.retry++, 15000);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }

  send(msg: WsClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
  }
}
