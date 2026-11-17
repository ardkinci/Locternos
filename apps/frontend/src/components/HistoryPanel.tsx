import { useCallback, useEffect, useState } from 'react';
import type { AuditEvent, LogFile, LogLevel, Server, ServerLog, ServerRun } from '@locternos/shared';
import { api } from '../lib/api';
import { formatBytes, formatDuration, formatTimestamp } from '../lib/format';
import { inputClass, secondaryButtonClass } from './ui';

interface HistoryPanelProps {
  server: Server;
}

const LEVELS: LogLevel[] = ['INFO', 'WARN', 'ERROR', 'FATAL'];

/** Past runs, searchable logs and the audit timeline of a server. */
export function HistoryPanel({ server }: HistoryPanelProps) {
  const [runs, setRuns] = useState<ServerRun[]>([]);
  const [logs, setLogs] = useState<ServerLog[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState<LogLevel | ''>('');
  const [runId, setRunId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [runList, logList, auditList, fileList] = await Promise.all([
      api.listRuns(server.id),
      api.listLogs(server.id, {
        query: query.trim() || undefined,
        level: level || undefined,
        runId: runId || undefined,
        limit: 300,
      }),
      api.listAuditEvents(server.id),
      api.listLogFiles(server.id),
    ]);
    return {
      runs: runList.runs,
      logs: logList.logs,
      events: auditList.events,
      files: fileList.files,
    };
  }, [server.id, query, level, runId]);

  useEffect(() => {
    let active = true;
    void load()
      .then((result) => {
        if (!active) return;
        setRuns(result.runs);
        setLogs(result.logs);
        setEvents(result.events);
        setFiles(result.files);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [load]);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-lg font-semibold">Runs</h2>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No runs recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-1 pr-3">Started</th>
                  <th className="py-1 pr-3">Duration</th>
                  <th className="py-1 pr-3">Exit code</th>
                  <th className="py-1 pr-3">Peak RAM</th>
                  <th className="py-1 pr-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {runs.map((run) => (
                  <tr key={run.id} className="text-slate-300">
                    <td className="py-1 pr-3">{formatTimestamp(run.startedAt)}</td>
                    <td className="py-1 pr-3">
                      {run.stoppedAt
                        ? formatDuration(
                            (new Date(run.stoppedAt).getTime() -
                              new Date(run.startedAt).getTime()) /
                              1000,
                          )
                        : '—'}
                    </td>
                    <td className="py-1 pr-3">{run.exitCode === null ? '—' : run.exitCode}</td>
                    <td className="py-1 pr-3">
                      {run.peakRamMb === null ? '—' : `${run.peakRamMb} MB`}
                    </td>
                    <td className="py-1 pr-3">
                      <span
                        className={
                          run.stopReason === 'crashed' ? 'text-rose-400' : 'text-slate-400'
                        }
                      >
                        {run.stopReason ?? 'running'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">Logs</h2>
          <input
            className={`${inputClass} w-56`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search keyword"
          />
          <select
            className={`${inputClass} w-32`}
            value={level}
            onChange={(event) => setLevel(event.target.value as LogLevel | '')}
          >
            <option value="">All levels</option>
            {LEVELS.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
          <select
            className={`${inputClass} w-40`}
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
          >
            <option value="">All runs</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {formatTimestamp(run.startedAt)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => {
              setBusy(true);
              setError(null);
              void load()
                .then((result) => {
                  setRuns(result.runs);
                  setLogs(result.logs);
                  setEvents(result.events);
                  setFiles(result.files);
                })
                .catch((err: unknown) => {
                  setError(err instanceof Error ? err.message : String(err));
                })
                .finally(() => setBusy(false));
            }}
            disabled={busy}
          >
            {busy ? 'Loading…' : 'Apply'}
          </button>
        </div>

        {error && <p className="mt-3 text-sm text-rose-400">{error}</p>}

        <div className="mt-3 max-h-80 overflow-y-auto rounded-md border border-slate-800 bg-slate-950 p-3 font-mono text-xs">
          {logs.length === 0 ? (
            <p className="text-slate-600">No log lines match the current filters.</p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="flex gap-2 whitespace-pre-wrap py-0.5">
                <span className="shrink-0 text-slate-600">{formatTimestamp(log.timestamp)}</span>
                <span className={levelClass(log.level)}>{log.message}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-lg font-semibold">Raw log files</h2>
        {files.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No raw log files on disk.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-800">
            {files.map((file) => (
              <li key={file.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="truncate text-slate-300">{file.name}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {formatBytes(file.sizeBytes)} · {formatTimestamp(file.modifiedAt)}
                </span>
                <a
                  className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                  href={api.logFileUrl(server.id, file.name)}
                  download={file.name}
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-lg font-semibold">Audit timeline</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No audit events yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {events.map((event) => (
              <li key={event.id} className="flex items-baseline gap-3 text-sm">
                <span className="shrink-0 text-xs text-slate-500">
                  {formatTimestamp(event.createdAt)}
                </span>
                <span className="text-slate-300">{event.action}</span>
                <span className="truncate text-xs text-slate-600">
                  {JSON.stringify(event.details)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function levelClass(level: LogLevel): string {
  switch (level) {
    case 'WARN':
      return 'text-amber-300';
    case 'ERROR':
      return 'text-rose-400';
    case 'FATAL':
      return 'text-fuchsia-400';
    default:
      return 'text-slate-300';
  }
}
