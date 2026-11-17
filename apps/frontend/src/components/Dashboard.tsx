import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HealthResponse, Server, ServerRuntimeState, User } from '@locternos/shared';
import { api, ApiError } from '../lib/api';
import { WsClient } from '../lib/ws';
import { formatRam } from '../lib/format';
import { StatusBadge, buttonClass, secondaryButtonClass } from './ui';
import { CreateServerWizard } from './CreateServerWizard';
import { ServerView } from './ServerView';

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

interface ServerEntry {
  server: Server;
  runtime: ServerRuntimeState | null;
}

/** Signed-in home page: the list of local servers and their live state. */
export function Dashboard({ user, onLogout }: DashboardProps) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [entries, setEntries] = useState<ServerEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyServerId, setBusyServerId] = useState<string | null>(null);

  const ws = useMemo(() => new WsClient(), []);

  const loadServers = useCallback(async () => {
    const { servers } = await api.listServers();
    return Promise.all(
      servers.map(async (server) => {
        try {
          const { runtime } = await api.getRuntime(server.id);
          return { server, runtime };
        } catch {
          return { server, runtime: null };
        }
      }),
    );
  }, []);

  const refresh = useCallback(async () => {
    try {
      const loaded = await loadServers();
      setEntries(loaded);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadServers]);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    const offStatus = ws.onStatus(setWsConnected);
    ws.connect();
    let active = true;
    void loadServers()
      .then((loaded) => {
        if (active) setEntries(loaded);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      offStatus();
      ws.close();
    };
  }, [loadServers, ws]);

  // Live runtime updates keep the dashboard metrics and status badges fresh.
  useEffect(() => {
    const off = ws.onMessage((message) => {
      if (message.type !== 'runtime') return;
      const runtime = message.runtime;
      setEntries((current) =>
        current.map((entry) =>
          entry.server.id === runtime.serverId ? { ...entry, runtime } : entry,
        ),
      );
    });
    return off;
  }, [ws]);

  const selected = entries.find((entry) => entry.server.id === selectedId) ?? null;

  async function quickAction(entry: ServerEntry, action: 'start' | 'stop') {
    setBusyServerId(entry.server.id);
    setError(null);
    try {
      if (action === 'start') {
        await api.startServer(entry.server.id);
      } else {
        await api.stopServer(entry.server.id);
      }
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'eula_required') {
        setSelectedId(entry.server.id);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusyServerId(null);
    }
  }

  if (selected) {
    return (
      <ServerView
        server={selected.server}
        runtime={selected.runtime}
        user={user}
        ws={ws}
        onBack={() => {
          setSelectedId(null);
          void refresh();
        }}
        onChanged={() => void refresh()}
      />
    );
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Locternos</h1>
          <p className="text-sm text-slate-400">Self-hosted Minecraft server control panel.</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-400">{user.email}</span>
          <span className={wsConnected ? 'text-emerald-400' : 'text-amber-400'}>
            {wsConnected ? 'live' : 'offline'}
          </span>
          <button type="button" className={secondaryButtonClass} onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">Servers</h2>
          <button type="button" className={buttonClass} onClick={() => setWizardOpen(true)}>
            Create server
          </button>
        </div>

        {error && (
          <p className="mt-4 rounded-md border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        )}

        {loading && <p className="mt-4 text-sm text-slate-400">Loading servers…</p>}

        {!loading && entries.length === 0 && (
          <p className="mt-4 rounded-md border border-slate-800 px-3 py-6 text-center text-sm text-slate-400">
            No servers yet. Create one to get started.
          </p>
        )}

        <ul className="mt-4 grid gap-3 md:grid-cols-2">
          {entries.map((entry) => {
            const status = entry.runtime?.status ?? entry.server.status;
            const busy = busyServerId === entry.server.id;
            const running = status === 'running' || status === 'starting';
            return (
              <li
                key={entry.server.id}
                className="rounded-lg border border-slate-800 bg-slate-900/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <button
                      type="button"
                      className="text-left text-lg font-semibold hover:text-emerald-300"
                      onClick={() => setSelectedId(entry.server.id)}
                    >
                      {entry.server.name}
                    </button>
                    <p className="text-xs text-slate-500">
                      {entry.server.coreType}
                      {entry.server.mcVersion ? ` · MC ${entry.server.mcVersion}` : ''} · port{' '}
                      {entry.server.port}
                    </p>
                  </div>
                  <StatusBadge status={status} />
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-400">
                  <div>
                    <dt className="text-slate-500">RAM</dt>
                    <dd>
                      {formatRam(entry.server.minRamMb)} / {formatRam(entry.server.maxRamMb)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Live RAM</dt>
                    <dd>{formatRam(entry.runtime?.metrics.ramMb ?? null)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">CPU</dt>
                    <dd>
                      {entry.runtime?.metrics.cpuPercent === null ||
                      entry.runtime?.metrics.cpuPercent === undefined
                        ? '—'
                        : `${entry.runtime.metrics.cpuPercent.toFixed(1)}%`}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex gap-2">
                  {running ? (
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      disabled={busy}
                      onClick={() => void quickAction(entry, 'stop')}
                    >
                      Stop
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      disabled={busy}
                      onClick={() => void quickAction(entry, 'start')}
                    >
                      Start
                    </button>
                  )}
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => setSelectedId(entry.server.id)}
                  >
                    Manage
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {health && <p className="mt-8 text-xs text-slate-600">Panel API v{health.version}</p>}

      {wizardOpen && (
        <CreateServerWizard
          onClose={() => setWizardOpen(false)}
          onCreated={(server) => {
            setWizardOpen(false);
            void refresh().then(() => setSelectedId(server.id));
          }}
        />
      )}
    </main>
  );
}
