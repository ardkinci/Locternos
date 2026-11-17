import { readFile } from 'node:fs/promises';

/** Number of bytes in a Linux memory page. */
const PAGE_SIZE_BYTES = 4096;
/** Clock ticks per second used by /proc; effectively 100 on Linux. */
const CLOCK_TICKS_PER_SECOND = 100;

export interface ProcessSample {
  ramMb: number | null;
  cpuPercent: number | null;
}

export interface ProcessCpuState {
  sampledAt: number;
  cpuTicks: number;
}

export interface ProcessMetricsResult {
  sample: ProcessSample;
  state: ProcessCpuState | null;
}

interface ProcStat {
  ramMb: number;
  cpuTicks: number;
}

/**
 * Reads RSS and cumulative CPU ticks from `/proc/<pid>/stat`. Returns null when
 * the process is gone or the platform has no procfs.
 */
async function readProcStat(pid: number): Promise<ProcStat | null> {
  let raw: string;
  try {
    raw = await readFile(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return null;
  }

  // The comm field is wrapped in parentheses and may contain spaces, so parse
  // relative to the last closing parenthesis.
  const close = raw.lastIndexOf(')');
  if (close === -1) return null;
  const fields = raw
    .slice(close + 2)
    .trim()
    .split(/\s+/);
  // fields[0] is field 3 (state); utime/stime are fields 14/15, RSS field 24.
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  const rssPages = Number(fields[21]);
  if (!Number.isFinite(utime) || !Number.isFinite(stime) || !Number.isFinite(rssPages)) {
    return null;
  }

  return {
    ramMb: Math.ceil((rssPages * PAGE_SIZE_BYTES) / (1024 * 1024)),
    cpuTicks: utime + stime,
  };
}

/**
 * Samples a running process. `previous` is the state returned by the prior
 * call; CPU percentage is null until two samples exist.
 */
export async function readProcessMetrics(
  pid: number,
  previous: ProcessCpuState | null = null,
  now = Date.now(),
): Promise<ProcessMetricsResult> {
  const stat = await readProcStat(pid);
  if (!stat) return { sample: { ramMb: null, cpuPercent: null }, state: null };

  let cpuPercent: number | null = null;
  if (previous) {
    const elapsedSeconds = (now - previous.sampledAt) / 1000;
    if (elapsedSeconds > 0) {
      const ticks = stat.cpuTicks - previous.cpuTicks;
      cpuPercent = Math.max(0, (ticks / CLOCK_TICKS_PER_SECOND / elapsedSeconds) * 100);
    }
  }

  return {
    sample: { ramMb: stat.ramMb, cpuPercent },
    state: { sampledAt: now, cpuTicks: stat.cpuTicks },
  };
}
