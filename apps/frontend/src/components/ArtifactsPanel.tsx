import { useCallback, useEffect, useState } from 'react';
import type { Artifact, ArtifactKind, FallbackVersion, Server } from '@locternos/shared';
import { api } from '../lib/api';
import { formatTimestamp } from '../lib/format';
import { Field, inputClass, secondaryButtonClass } from './ui';

interface ArtifactsPanelProps {
  server: Server;
  onChanged: () => void;
}

type InstallMode = 'modrinth' | 'direct' | 'upload';

const KIND_OPTIONS: { value: ArtifactKind; label: string }[] = [
  { value: 'plugin', label: 'Plugin' },
  { value: 'mod', label: 'Mod' },
  { value: 'datapack', label: 'Datapack' },
];

/** Install, list and remove plugins, mods and datapacks. */
export function ArtifactsPanel({ server, onChanged }: ArtifactsPanelProps) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [kind, setKind] = useState<ArtifactKind>('plugin');
  const [mode, setMode] = useState<InstallMode>('modrinth');
  const [modrinthUrl, setModrinthUrl] = useState('');
  const [directUrl, setDirectUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fallbacks, setFallbacks] = useState<FallbackVersion[]>([]);
  const [pendingProject, setPendingProject] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { artifacts: installed } = await api.listArtifacts(server.id);
    return installed;
  }, [server.id]);

  useEffect(() => {
    let active = true;
    void load()
      .then((installed) => {
        if (active) setArtifacts(installed);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [load]);

  async function install() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'upload') {
        if (!file) {
          setError('Choose a JAR file first.');
          return;
        }
        await api.uploadArtifact(server.id, kind, file);
        setNotice('Upload complete.');
      } else if (mode === 'direct') {
        if (!directUrl.trim()) {
          setError('Enter a direct download URL.');
          return;
        }
        await api.installArtifact(server.id, {
          kind,
          sourceType: 'direct_url',
          sourceUrl: directUrl.trim(),
        });
        setNotice('Artifact installed.');
      } else {
        if (!modrinthUrl.trim()) {
          setError('Enter a Modrinth page URL.');
          return;
        }
        const outcome = await api.installArtifact(server.id, {
          kind,
          sourceType: 'modrinth_page',
          modrinthUrl: modrinthUrl.trim(),
        });
        if (outcome.status === 'needs_selection') {
          setPendingProject(outcome.project.title);
          setFallbacks(outcome.fallbackVersions);
          setNotice('No exact version matched; pick a compatible version below.');
        } else {
          setNotice(
            `Installed ${outcome.artifact.filename}${
              outcome.dependencies.length > 0
                ? ` with ${outcome.dependencies.length} dependencies`
                : ''
            }.`,
          );
        }
      }
      const installed = await load();
      setArtifacts(installed);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function installFallback(version: FallbackVersion) {
    setError(null);
    setBusy(true);
    try {
      const outcome = await api.installArtifact(server.id, {
        kind,
        sourceType: 'modrinth_page',
        modrinthUrl: modrinthUrl.trim(),
        versionId: version.id,
      });
      if (outcome.status === 'installed') {
        setNotice(`Installed ${outcome.artifact.filename}.`);
        setFallbacks([]);
        setPendingProject(null);
        const installed = await load();
        setArtifacts(installed);
        onChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggle(artifact: Artifact) {
    setError(null);
    setBusy(true);
    try {
      await api.setArtifactEnabled(server.id, artifact.id, !artifact.enabled);
      const installed = await load();
      setArtifacts(installed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(artifact: Artifact) {
    setError(null);
    setBusy(true);
    try {
      await api.removeArtifact(server.id, artifact.id);
      const installed = await load();
      setArtifacts(installed);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-lg font-semibold">Install an artifact</h2>

        <div className="mt-3 space-y-3">
          <Field label="Type">
            <select
              className={inputClass}
              value={kind}
              onChange={(event) => setKind(event.target.value as ArtifactKind)}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Source">
            <select
              className={inputClass}
              value={mode}
              onChange={(event) => setMode(event.target.value as InstallMode)}
            >
              <option value="modrinth">Modrinth page URL</option>
              <option value="direct">Direct JAR URL</option>
              <option value="upload">Local JAR upload</option>
            </select>
          </Field>

          {mode === 'modrinth' && (
            <Field label="Modrinth URL" hint="For example https://modrinth.com/plugin/luckperms">
              <input
                className={inputClass}
                value={modrinthUrl}
                onChange={(event) => setModrinthUrl(event.target.value)}
              />
            </Field>
          )}

          {mode === 'direct' && (
            <Field label="Direct JAR URL">
              <input
                className={inputClass}
                value={directUrl}
                onChange={(event) => setDirectUrl(event.target.value)}
                placeholder="https://cdn.modrinth.com/data/....jar"
              />
            </Field>
          )}

          {mode === 'upload' && (
            <Field label="JAR file">
              <input
                type="file"
                accept=".jar"
                className="text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-100"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </Field>
          )}

          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => void install()}
            disabled={busy}
          >
            {busy ? 'Working…' : 'Install'}
          </button>

          {notice && <p className="text-sm text-emerald-400">{notice}</p>}
          {error && <p className="text-sm text-rose-400">{error}</p>}

          {fallbacks.length > 0 && (
            <div className="rounded-md border border-slate-800 p-3">
              <p className="text-sm text-slate-300">Compatible versions for {pendingProject}:</p>
              <ul className="mt-2 space-y-1">
                {fallbacks.map((version) => (
                  <li key={version.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-slate-400">
                      {version.versionNumber}
                      <span className="ml-2 text-xs text-slate-600">
                        {version.gameVersions.slice(0, 3).join(', ')}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      disabled={busy}
                      onClick={() => void installFallback(version)}
                    >
                      Install
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-lg font-semibold">Installed artifacts</h2>
        {artifacts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Nothing installed yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-800">
            {artifacts.map((artifact) => (
              <li key={artifact.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-slate-200">{artifact.filename}</p>
                  <p className="text-xs text-slate-500">
                    {artifact.kind} · {artifact.sourceType} ·{' '}
                    {formatTimestamp(artifact.installedAt)}
                    {artifact.kind !== 'core' && !artifact.enabled ? ' · disabled' : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {artifact.kind !== 'core' && (
                    <button
                      type="button"
                      className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                      disabled={busy}
                      onClick={() => void toggle(artifact)}
                    >
                      {artifact.enabled ? 'Disable' : 'Enable'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded-md border border-rose-800 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950"
                    disabled={busy}
                    onClick={() => void remove(artifact)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
