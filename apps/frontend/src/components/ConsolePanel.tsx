import { useEffect, useRef, useState } from 'react';
import type { ConsoleLine, Server, ServerRuntimeState } from '@locternos/shared';
import { api } from '../lib/api';
import type { WsClient } from '../lib/ws';
import { formatClock } from '../lib/format';
import { inputClass, secondaryButtonClass } from './ui';

interface ConsolePanelProps {
  server: Server;
  runtime: ServerRuntimeState | null;
  ws: WsClient;
  transitioning: boolean;
}

const MAX_LINES = 1000;

/** Live terminal output with command input, backed by the WebSocket stream. */
export function ConsolePanel({ server, runtime, ws, transitioning }: ConsolePanelProps) {
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [command, setCommand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    void api
      .getConsole(server.id)
      .then(({ lines: history }) => {
        if (active) setLines(history);
      })
      .catch(() => {
        // The live stream still works when the buffer cannot be read.
      });

    return () => {
      active = false;
    };
  }, [server.id]);

  useEffect(() => {
    ws.subscribe(server.id);
    const off = ws.onMessage((message) => {
      if (message.type !== 'console' || message.serverId !== server.id) return;
      setLines((current) => {
        const next = [...current, ...message.lines];
        return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
      });
    });

    return () => {
      off();
      ws.unsubscribe(server.id);
    };
  }, [server.id, ws]);

  useEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [lines, follow]);

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = command.trim();
    if (!value) return;
    setError(null);
    setCommand('');
    try {
      await api.sendCommand(server.id, { command: value });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const disabled = !runtime || transitioning || runtime.status === 'stopped';

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
        <div
          className="h-80 overflow-y-auto font-mono text-xs leading-5"
          onScroll={() => {
            const element = bottomRef.current?.parentElement;
            if (!element) return;
            const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
            setFollow(atBottom);
          }}
        >
          {lines.length === 0 && (
            <p className="text-slate-600">No console output yet. Start the server to see logs.</p>
          )}
          {lines.map((line, index) => (
            <div key={`${line.timestamp}-${index}`} className="flex gap-2 whitespace-pre-wrap">
              <span className="shrink-0 text-slate-600">{formatClock(line.timestamp)}</span>
              <span className={levelClass(line.level)}>{line.message}</span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form className="mt-3 flex gap-2" onSubmit={send}>
          <input
            className={`${inputClass} font-mono`}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder={disabled ? 'Start the server to send commands' : 'Type a console command…'}
            disabled={disabled}
          />
          <button type="submit" className={secondaryButtonClass} disabled={disabled}>
            Send
          </button>
        </form>
        {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-500">
        <input
          type="checkbox"
          checked={follow}
          onChange={(event) => setFollow(event.target.checked)}
          className="accent-emerald-500"
        />
        Follow new output
      </label>
    </div>
  );
}

function levelClass(level: ConsoleLine['level']): string {
  switch (level) {
    case 'WARN':
      return 'text-amber-300';
    case 'ERROR':
      return 'text-rose-400';
    case 'FATAL':
      return 'text-fuchsia-400';
    default:
      return 'text-slate-200';
  }
}
