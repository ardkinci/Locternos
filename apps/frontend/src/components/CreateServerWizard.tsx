import { useEffect, useMemo, useState } from 'react';
import type {
  JavaRuntime,
  JavaVersionRequirement,
  LogRetentionPolicy,
  Server,
  ServerCoreType,
} from '@locternos/shared';
import { api } from '../lib/api';
import { Field, Modal, buttonClass, inputClass, secondaryButtonClass } from './ui';

interface CreateServerWizardProps {
  onClose: () => void;
  onCreated: (server: Server) => void;
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

const CORE_OPTIONS: { value: ServerCoreType; label: string }[] = [
  { value: 'vanilla', label: 'Vanilla' },
  { value: 'paper', label: 'Paper' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'custom', label: 'Custom JAR' },
];

const MIN_RAM_MB = 512;
const MAX_RAM_MB = 16384;

/** Creates a server, installs the selected core and prepares the EULA state. */
export function CreateServerWizard({ onClose, onCreated }: CreateServerWizardProps) {
  const [name, setName] = useState('');
  const [coreType, setCoreType] = useState<ServerCoreType>('vanilla');
  const [vanillaVersions, setVanillaVersions] = useState<string[]>([]);
  const [paperVersions, setPaperVersions] = useState<string[]>([]);
  const [paperBuilds, setPaperBuilds] = useState<number[]>([]);
  const [fabricGameVersions, setFabricGameVersions] = useState<string[]>([]);
  const [fabricLoaderVersions, setFabricLoaderVersions] = useState<string[]>([]);
  const [version, setVersion] = useState('');
  const [loaderVersion, setLoaderVersion] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [port, setPort] = useState(25565);
  const [maxRamMb, setMaxRamMb] = useState(2048);
  const [minRamMb, setMinRamMb] = useState(1024);
  const [retention, setRetention] = useState<LogRetentionPolicy>('7d');
  const [jvmProfile, setJvmProfile] = useState<'default' | 'aikars' | 'zgc'>('default');
  const [customJvmArgs, setCustomJvmArgs] = useState('');
  const [requirement, setRequirement] = useState<JavaVersionRequirement | null>(null);
  const [javaPath, setJavaPath] = useState<string | null>(null);
  const [javaBusy, setJavaBusy] = useState(false);
  const [eulaAccepted, setEulaAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mcVersion = useMemo(() => {
    if (coreType === 'vanilla') return version;
    if (coreType === 'paper') return version;
    if (coreType === 'fabric') return version;
    return null;
  }, [coreType, version]);

  useEffect(() => {
    let active = true;

    if (coreType === 'vanilla') {
      void api
        .vanillaVersions()
        .then(({ versions }) => {
          if (!active) return;
          const releases = versions
            .filter((entry) => entry.type === 'release')
            .map((entry) => entry.id);
          setVanillaVersions(releases);
          setVersion(releases[0] ?? '');
        })
        .catch((err: unknown) => {
          if (active) setError(err instanceof Error ? err.message : String(err));
        });
    } else if (coreType === 'paper') {
      void api
        .paperVersions()
        .then(({ versions }) => {
          if (!active) return;
          setPaperVersions(versions);
          setVersion(versions[0] ?? '');
        })
        .catch((err: unknown) => {
          if (active) setError(err instanceof Error ? err.message : String(err));
        });
    } else if (coreType === 'fabric') {
      void api
        .fabricVersions()
        .then(({ gameVersions, loaderVersions }) => {
          if (!active) return;
          setFabricGameVersions(gameVersions);
          setFabricLoaderVersions(loaderVersions);
          setVersion(gameVersions[0] ?? '');
          setLoaderVersion(loaderVersions[0] ?? '');
        })
        .catch((err: unknown) => {
          if (active) setError(err instanceof Error ? err.message : String(err));
        });
    }

    return () => {
      active = false;
    };
  }, [coreType]);

  // Load the published builds for the selected Paper version.
  useEffect(() => {
    if (coreType !== 'paper' || !version) return;
    let active = true;

    void api
      .paperBuilds(version)
      .then(({ builds }) => {
        if (!active) return;
        setPaperBuilds(builds.map((build) => build.build));
      })
      .catch(() => {
        if (active) setPaperBuilds([]);
      });

    return () => {
      active = false;
    };
  }, [coreType, version]);

  // Ask the panel which Java major version the selected Minecraft release needs.
  useEffect(() => {
    let active = true;

    if (!mcVersion) {
      void Promise.resolve().then(() => {
        if (active) setRequirement(null);
      });
      return () => {
        active = false;
      };
    }

    void api
      .javaRequirement(mcVersion)
      .then((result) => {
        if (active) setRequirement(result);
      })
      .catch(() => {
        if (active) setRequirement(null);
      });

    return () => {
      active = false;
    };
  }, [mcVersion]);

  async function installJava() {
    if (!requirement) return;
    setJavaBusy(true);
    setError(null);
    try {
      const { runtime } = await api.installJavaRuntime(requirement.requiredMajorVersion, 'jdk');
      const { runtimes } = await api.listJavaRuntimes();
      const best = pickRuntime(runtimes, requirement.requiredMajorVersion);
      setJavaPath(best?.path ?? runtime.path);
      const refreshed = await api.javaRequirement(mcVersion ?? '');
      setRequirement(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setJavaBusy(false);
    }
  }

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError('Give the server a name.');
      return;
    }
    if (coreType !== 'custom' && !version) {
      setError('Pick a Minecraft version.');
      return;
    }
    if (coreType === 'custom' && !customUrl.trim() && !customFile) {
      setError('Upload a JAR or paste a direct download URL.');
      return;
    }
    if (requirement && !requirement.satisfied && !javaPath) {
      setError(`Java ${requirement.requiredMajorVersion} is required for this server version.`);
      return;
    }

    setBusy(true);
    try {
      const { server } = await api.createServer({
        name: name.trim(),
        coreType,
        mcVersion: mcVersion ?? undefined,
        port,
        minRamMb,
        maxRamMb,
        jvmFlagsProfile: jvmProfile,
        customJvmArgs,
        javaPath,
        logRetentionPolicy: retention,
      });

      if (coreType === 'custom' && customFile) {
        await api.uploadArtifact(server.id, 'core', customFile);
      } else {
        await api.installCore(server.id, coreInput());
      }

      if (eulaAccepted) {
        await api.acceptEula(server.id, { accepted: true });
      }

      onCreated(server);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function coreInput() {
    switch (coreType) {
      case 'vanilla':
        return { coreType: 'vanilla' as const, version };
      case 'paper':
        return {
          coreType: 'paper' as const,
          version,
          build: paperBuilds[0],
        };
      case 'fabric':
        return {
          coreType: 'fabric' as const,
          mcVersion: version,
          loaderVersion: loaderVersion || undefined,
        };
      case 'custom':
        return { coreType: 'custom' as const, downloadUrl: customUrl.trim() || undefined };
    }
  }

  return (
    <Modal
      title="Create a server"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? 'Creating…' : 'Create server'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="My survival server"
          />
        </Field>

        <Field label="Server core">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CORE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setCoreType(option.value)}
                className={`rounded-md border px-3 py-2 text-sm transition ${
                  coreType === option.value
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                    : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>

        {coreType === 'vanilla' && (
          <Field label="Minecraft version">
            <select
              className={inputClass}
              value={version}
              onChange={(event) => setVersion(event.target.value)}
            >
              {vanillaVersions.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </Field>
        )}

        {coreType === 'paper' && (
          <>
            <Field label="Minecraft version">
              <select
                className={inputClass}
                value={version}
                onChange={(event) => setVersion(event.target.value)}
              >
                {paperVersions.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Paper build" hint="The latest published build is used by default.">
              <select
                className={inputClass}
                value={paperBuilds[0] ?? ''}
                onChange={(event) => {
                  const build = Number(event.target.value);
                  setPaperBuilds((current) => [
                    build,
                    ...current.filter((entry) => entry !== build),
                  ]);
                }}
              >
                {paperBuilds.map((build) => (
                  <option key={build} value={build}>
                    build {build}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        {coreType === 'fabric' && (
          <>
            <Field label="Minecraft version">
              <select
                className={inputClass}
                value={version}
                onChange={(event) => setVersion(event.target.value)}
              >
                {fabricGameVersions.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Fabric loader">
              <select
                className={inputClass}
                value={loaderVersion}
                onChange={(event) => setLoaderVersion(event.target.value)}
              >
                {fabricLoaderVersions.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        {coreType === 'custom' && (
          <>
            <Field label="Direct JAR download URL">
              <input
                className={inputClass}
                value={customUrl}
                onChange={(event) => setCustomUrl(event.target.value)}
                placeholder="https://example.com/server.jar"
              />
            </Field>
            <Field label="…or upload a JAR file">
              <input
                type="file"
                accept=".jar"
                className="text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-100"
                onChange={(event) => setCustomFile(event.target.files?.[0] ?? null)}
              />
            </Field>
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Port">
            <input
              type="number"
              min={1}
              max={65535}
              className={inputClass}
              value={port}
              onChange={(event) => setPort(Number(event.target.value))}
            />
          </Field>
          <Field label="Log retention">
            <select
              className={inputClass}
              value={retention}
              onChange={(event) => setRetention(event.target.value as LogRetentionPolicy)}
            >
              {RETENTION_OPTIONS.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={`Maximum RAM: ${maxRamMb} MB`}>
          <input
            type="range"
            min={MIN_RAM_MB}
            max={MAX_RAM_MB}
            step={512}
            value={maxRamMb}
            onChange={(event) => {
              const next = Number(event.target.value);
              setMaxRamMb(next);
              setMinRamMb(Math.max(MIN_RAM_MB, Math.floor(next / 2)));
            }}
            className="w-full accent-emerald-500"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum RAM (MB)">
            <input
              type="number"
              min={MIN_RAM_MB}
              max={maxRamMb}
              step={256}
              className={inputClass}
              value={minRamMb}
              onChange={(event) => setMinRamMb(Number(event.target.value))}
            />
          </Field>
          <Field label="JVM profile">
            <select
              className={inputClass}
              value={jvmProfile}
              onChange={(event) => setJvmProfile(event.target.value as typeof jvmProfile)}
            >
              <option value="default">default</option>
              <option value="aikars">Aikar&apos;s flags</option>
              <option value="zgc">ZGC</option>
            </select>
          </Field>
        </div>

        <Field label="Custom JVM arguments">
          <input
            className={inputClass}
            value={customJvmArgs}
            onChange={(event) => setCustomJvmArgs(event.target.value)}
            placeholder="-XX:+UseStringDeduplication"
          />
        </Field>

        {requirement && (
          <div className="rounded-md border border-slate-800 px-3 py-2 text-sm">
            <p className="text-slate-300">
              Minecraft {requirement.mcVersion} needs Java {requirement.requiredMajorVersion}.
            </p>
            {requirement.satisfied ? (
              <p className="mt-1 text-emerald-400">A matching Java runtime is available.</p>
            ) : (
              <div className="mt-2 flex items-center gap-3">
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => void installJava()}
                  disabled={javaBusy}
                >
                  {javaBusy
                    ? 'Installing…'
                    : `Download and install Java ${requirement.requiredMajorVersion}`}
                </button>
                {javaPath && <span className="text-xs text-slate-500">Using {javaPath}</span>}
              </div>
            )}
          </div>
        )}

        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={eulaAccepted}
            onChange={(event) => setEulaAccepted(event.target.checked)}
            className="mt-1 accent-emerald-500"
          />
          <span>
            I accept the{' '}
            <a
              href="https://aka.ms/MinecraftEULA"
              target="_blank"
              rel="noreferrer"
              className="text-emerald-400 underline"
            >
              Minecraft EULA
            </a>
            . The panel never accepts it on your behalf.
          </span>
        </label>

        {error && <p className="text-sm text-rose-400">{error}</p>}
      </div>
    </Modal>
  );
}

/** Picks the newest runtime that satisfies the required major version. */
function pickRuntime(runtimes: JavaRuntime[], requiredMajorVersion: number): JavaRuntime | null {
  const matching = runtimes
    .filter((runtime) => runtime.majorVersion >= requiredMajorVersion)
    .sort((a, b) => b.majorVersion - a.majorVersion);
  return matching[0] ?? null;
}
