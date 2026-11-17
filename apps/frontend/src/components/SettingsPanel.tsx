import { useEffect, useState } from 'react';
import type { JavaRuntime, LogRetentionPolicy, Server, User } from '@locternos/shared';
import { api } from '../lib/api';
import { Field, inputClass, secondaryButtonClass } from './ui';

interface SettingsPanelProps {
  server: Server;
  user: User;
  onChanged: () => void;
}

const RETENTION_OPTIONS: LogRetentionPolicy[] = [
  'none',
  '24h',
  '7d',
  '30d',
  '90d',
  '365d',
  'forever',
];

/** Per-server settings: resources, Java runtime, retention and metadata. */
export function SettingsPanel({ server, user, onChanged }: SettingsPanelProps) {
  const [name, setName] = useState(server.name);
  const [port, setPort] = useState(server.port);
  const [minRamMb, setMinRamMb] = useState(server.minRamMb);
  const [maxRamMb, setMaxRamMb] = useState(server.maxRamMb);
  const [jvmProfile, setJvmProfile] = useState(server.jvmFlagsProfile);
  const [customJvmArgs, setCustomJvmArgs] = useState(server.customJvmArgs);
  const [retention, setRetention] = useState<LogRetentionPolicy>(server.logRetentionPolicy);
  const [javaPath, setJavaPath] = useState(server.javaPath ?? '');
  const [runtimes, setRuntimes] = useState<JavaRuntime[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .listJavaRuntimes()
      .then((response) => setRuntimes(response.runtimes))
      .catch(() => setRuntimes([]));
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await api.updateServer(server.id, {
        name: name.trim() || server.name,
        port,
        minRamMb,
        maxRamMb,
        jvmFlagsProfile: jvmProfile,
        customJvmArgs,
        javaPath: javaPath.trim() ? javaPath.trim() : null,
        logRetentionPolicy: retention,
      });
      setStatus('Settings saved.');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete ${server.name}? This removes the server from the panel.`)) return;
    setBusy(true);
    try {
      await api.deleteServer(server.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-lg font-semibold">Configuration</h2>
        <div className="mt-3 space-y-3">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field label="Port" hint="A restart is required for port changes to apply.">
            <input
              type="number"
              min={1}
              max={65535}
              className={inputClass}
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Minimum RAM (MB)">
              <input
                type="number"
                min={256}
                step={256}
                className={inputClass}
                value={minRamMb}
                onChange={(e) => setMinRamMb(Number(e.target.value))}
              />
            </Field>
            <Field label="Maximum RAM (MB)">
              <input
                type="number"
                min={256}
                step={256}
                className={inputClass}
                value={maxRamMb}
                onChange={(e) => setMaxRamMb(Number(e.target.value))}
              />
            </Field>
          </div>

          <Field label="JVM profile">
            <select
              className={inputClass}
              value={jvmProfile}
              onChange={(e) => setJvmProfile(e.target.value as typeof jvmProfile)}
            >
              <option value="default">default</option>
              <option value="aikars">Aikar&apos;s flags</option>
              <option value="zgc">ZGC</option>
            </select>
          </Field>

          <Field label="Custom JVM arguments">
            <input
              className={inputClass}
              value={customJvmArgs}
              onChange={(e) => setCustomJvmArgs(e.target.value)}
            />
          </Field>

          <Field label="Log retention">
            <select
              className={inputClass}
              value={retention}
              onChange={(e) => setRetention(e.target.value as LogRetentionPolicy)}
            >
              {RETENTION_OPTIONS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Java runtime" hint="Leave empty to use java from PATH.">
            <select
              className={inputClass}
              value={javaPath}
              onChange={(e) => setJavaPath(e.target.value)}
            >
              <option value="">System default</option>
              {runtimes.map((runtime) => (
                <option key={runtime.id} value={runtime.path}>
                  {runtime.vendor ?? 'Java'} {runtime.version} ({runtime.source})
                </option>
              ))}
            </select>
          </Field>

          <div className="flex gap-2">
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => void save()}
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          </div>

          {status && <p className="text-sm text-emerald-400">{status}</p>}
          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-lg font-semibold">Details</h2>
        <dl className="mt-3 space-y-1 text-sm text-slate-400">
          <div>
            <dt className="inline text-slate-500">Core: </dt>
            <dd className="inline">
              {server.coreType}
              {server.mcVersion ? ` · MC ${server.mcVersion}` : ''}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Entrypoint: </dt>
            <dd className="inline">{server.entrypointJar || 'not installed'}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">EULA: </dt>
            <dd className="inline">
              {server.eulaAcceptedAt ? `accepted ${server.eulaAcceptedAt}` : 'not accepted'}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-500">Owner: </dt>
            <dd className="inline">{user.email}</dd>
          </div>
        </dl>

        <button
          type="button"
          className="mt-6 rounded-md border border-rose-800 px-3 py-2 text-sm text-rose-300 hover:bg-rose-950"
          onClick={() => void remove()}
          disabled={busy}
        >
          Delete server
        </button>
      </section>
    </div>
  );
}
