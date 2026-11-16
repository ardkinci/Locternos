import { useEffect, useState } from 'react';
import type { HealthResponse, User } from '@locternos/shared';
import { api } from '../lib/api';
import { WsClient } from '../lib/ws';

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

/** Signed-in home page. Mounted only after authentication, so the WebSocket
 *  is never opened without a session cookie. */
export function Dashboard({ user, onLogout }: DashboardProps) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    const ws = new WsClient();
    const offStatus = ws.onStatus(setWsConnected);
    ws.connect();
    return () => {
      offStatus();
      ws.close();
    };
  }, []);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Locternos</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-400">{user.email}</span>
          <button
            type="button"
            className="rounded-md border border-slate-700 px-3 py-1 hover:bg-slate-800"
            onClick={onLogout}
          >
            Sign out
          </button>
        </div>
      </header>
      <p className="mt-2 text-slate-400">Self-hosted Minecraft server control panel.</p>
      <dl className="mt-6 space-y-1 text-sm">
        <div>
          API:{' '}
          {health ? (
            <span className="text-emerald-400">ok (v{health.version})</span>
          ) : (
            <span className="text-amber-400">{error ?? 'connecting…'}</span>
          )}
        </div>
        <div>
          WebSocket:{' '}
          <span className={wsConnected ? 'text-emerald-400' : 'text-amber-400'}>
            {wsConnected ? 'connected' : 'disconnected'}
          </span>
        </div>
      </dl>
    </main>
  );
}
