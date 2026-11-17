import { useCallback, useEffect, useState } from 'react';
import type { Server, ServerRuntimeState, User } from '@locternos/shared';
import { api, ApiError } from '../lib/api';
import type { WsClient } from '../lib/ws';
import { formatBytes, formatDuration, formatRam } from '../lib/format';
import { Modal, StatusBadge, buttonClass, dangerButtonClass, secondaryButtonClass } from './ui';
import { ConsolePanel } from './ConsolePanel';
import { ArtifactsPanel } from './ArtifactsPanel';
import { HistoryPanel } from './HistoryPanel';
import { SettingsPanel } from './SettingsPanel';

interface ServerViewProps {
  server: Server;
  runtime: ServerRuntimeState | null;
  user: User;
  ws: WsClient;
  onBack: () => void;
  onChanged: () => void;
}

type Tab = 'console' | 'artifacts' | 'history' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'console', label: 'Console' },
  { id: 'artifacts', label: 'Plugins / Mods' },
  { id: 'history', label: 'History & Logs' },
  { id: 'settings', label: 'Settings' },
];

/** Detail view of a single server: controls, metrics and the tabbed panels. */
export function ServerView({ server, runtime, user, ws, onBack, onChanged }: ServerViewProps) {
  const [tab, setTab] = useState<Tab>('console');
  const [state, setState] = useState<ServerRuntimeState | null>(runtime);
  const [error, setError] = useState<string | null>(null);
  const [eulaOpen, setEulaOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadRuntime = useCallback(async () => {
    const { runtime: current } = await api.getRuntime(server.id);
    return current;
  }, [server.id]);

  const refresh = useCallback(async () => {
    try {
      const current = await loadRuntime();
      setState(current);
    } catch {
      // Keep the last known state when the panel cannot reach the backend.
    }
  }, [loadRuntime]);

  useEffect(() => {
    let active = true;
    void loadRuntime()
      .then((current) => {
        if (active) setState(current);
      })
      .catch(() => {
        // Keep the last known state when the panel cannot reach the backend.
      });
    return () => {
      active = false;
    };
  }, [loadRuntime]);

  useEffect(() => {
    const off = ws.onMessage((message) => {
      if (message.type === 'runtime' && message.runtime.serverId === server.id) {
        setState(message.runtime);
      }
    });
    return off;
  }, [server.id, ws]);

  const status = state?.status ?? server.status;
  const running = status === 'running' || status === 'starting';
  const transitioning = status === 'starting' || status === 'stopping';

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'eula_required') {
        setEulaOpen(true);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function acceptEula() {
    await api.acceptEula(server.id, { accepted: true });
    setEulaOpen(false);
    await refresh();
    onChanged();
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button type="button" className={secondaryButtonClass} onClick={onBack}>
            ← Back
          </button>
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-bold">
              {server.name}
              <StatusBadge status={status} />
            </h1>
            <p className="text-xs text-slate-500">
              {server.coreType}
              {server.mcVersion ? ` · MC ${server.mcVersion}` : ''} · port {server.port} ·{' '}
              {formatRam(server.minRamMb)}–{formatRam(server.maxRamMb)} RAM
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {running ? (
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={busy}
              onClick={() => void run(() => api.stopServer(server.id))}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={() => void run(() => api.startServer(server.id))}
            >
              Start
            </button>
          )}
          <button
            type="button"
            className={secondaryButtonClass}
            disabled={busy || !running}
            onClick={() => void run(() => api.restartServer(server.id))}
          >
            Restart
          </button>
          <button
            type="button"
            className={dangerButtonClass}
            disabled={busy || !running}
            onClick={() => void run(() => api.killServer(server.id))}
          >
            Force kill
          </button>
        </div>
      </header>

      {error && (
        <p className="mt-4 rounded-md border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
          {error}
        </p>
      )}

      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="RAM" value={formatRam(state?.metrics.ramMb ?? null)} />
        <Metric
          label="CPU"
          value={
            state?.metrics.cpuPercent === null || state?.metrics.cpuPercent === undefined
              ? '—'
              : `${state.metrics.cpuPercent.toFixed(1)}%`
          }
        />
        <Metric label="Uptime" value={formatDuration(state?.metrics.uptimeSeconds ?? null)} />
        <Metric label="Disk" value={formatBytes(state?.metrics.diskBytes ?? null)} />
      </section>

      <nav className="mt-6 flex gap-1 border-b border-slate-800">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              tab === entry.id
                ? 'border-emerald-500 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <section className="mt-4">
        {tab === 'console' && (
          <ConsolePanel server={server} runtime={state} ws={ws} transitioning={transitioning} />
        )}
        {tab === 'artifacts' && <ArtifactsPanel server={server} onChanged={onChanged} />}
        {tab === 'history' && <HistoryPanel server={server} />}
        {tab === 'settings' && <SettingsPanel server={server} user={user} onChanged={onChanged} />}
      </section>

      {eulaOpen && (
        <Modal
          title="Minecraft EULA"
          onClose={() => setEulaOpen(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className={secondaryButtonClass}
                onClick={() => setEulaOpen(false)}
              >
                Cancel
              </button>
              <button type="button" className={buttonClass} onClick={() => void acceptEula()}>
                I accept the EULA
              </button>
            </div>
          }
        >
          <p className="text-sm text-slate-300">
            This server has not accepted the Minecraft EULA yet. Read the agreement at{' '}
            <a
              href="https://aka.ms/MinecraftEULA"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 underline"
            >
              aka.ms/MinecraftEULA
            </a>{' '}
            before continuing.
          </p>
        </Modal>
      )}
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-200">{value}</p>
    </div>
  );
}
