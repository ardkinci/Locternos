import type { ConsoleStream, LogLevel } from '@locternos/shared';

export interface ParsedLogLine {
  timestamp: string;
  level: LogLevel;
  thread: string | null;
  message: string;
  stream: ConsoleStream;
}

const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const TIME_ONLY = /^(\d{2}):(\d{2}):(\d{2})/;

/** Vanilla/Paper: `[12:34:56] [Server thread/INFO]: message` */
const BRACKETED = /^\[([^\]]+)\]\s+\[([^/\]]+)\/([A-Z]+)\](?::\s?|\s+)(.*)$/;
/** CraftBukkit style: `[12:34:56 INFO]: message` */
const INLINE = /^\[([^\]]+?)\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\](?::\s?|\s+)(.*)$/;
/** Paper logger suffix: `[12:34:56] [Server thread/INFO] [Paper]: message` */
const LOGGER_SUFFIX = /^(?:\s+)?\[([^\]]+)\]:\s?(.*)$/;

function toLevel(raw: string): LogLevel {
  switch (raw.toUpperCase()) {
    case 'WARN':
    case 'WARNING':
      return 'WARN';
    case 'ERROR':
    case 'SEVERE':
      return 'ERROR';
    case 'FATAL':
      return 'FATAL';
    default:
      return 'INFO';
  }
}

/**
 * Resolves a log timestamp to a full ISO string. Minecraft only prints the
 * time of day, so the calendar date comes from the moment the line was read.
 */
function resolveTimestamp(raw: string, now: Date): string {
  const full = FULL_DATE.exec(raw);
  if (full) {
    const [, year, month, day, hours, minutes, seconds] = full;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
    );
    return Number.isNaN(parsed.getTime()) ? now.toISOString() : parsed.toISOString();
  }

  const time = TIME_ONLY.exec(raw);
  if (time) {
    const [, hours, minutes, seconds] = time;
    const parsed = new Date(now);
    parsed.setHours(Number(hours), Number(minutes), Number(seconds), 0);
    return Number.isNaN(parsed.getTime()) ? now.toISOString() : parsed.toISOString();
  }

  return now.toISOString();
}

/**
 * Parses a raw console line into its structured parts. Lines that do not match
 * a known layout (JVM banners, stack traces, plugin output) keep the full text
 * as the message and default to INFO with no thread.
 */
export function parseLogLine(
  raw: string,
  stream: ConsoleStream = 'stdout',
  now = new Date(),
): ParsedLogLine {
  const line = raw.replace(/\r$/, '');

  const bracketed = BRACKETED.exec(line);
  if (bracketed) {
    const [, stamp, thread, level, rest] = bracketed;
    const logger = LOGGER_SUFFIX.exec(rest ?? '');
    return {
      timestamp: resolveTimestamp(stamp ?? '', now),
      level: toLevel(level ?? 'INFO'),
      thread: thread?.trim() || null,
      message: (logger ? (logger[2] ?? '') : (rest ?? '')).trimEnd(),
      stream,
    };
  }

  const inline = INLINE.exec(line);
  if (inline) {
    const [, stamp, level, rest] = inline;
    return {
      timestamp: resolveTimestamp((stamp ?? '').replace(/\s+$/, ''), now),
      level: toLevel(level ?? 'INFO'),
      thread: null,
      message: (rest ?? '').trimEnd(),
      stream,
    };
  }

  return {
    timestamp: now.toISOString(),
    level: toLevel(inferLevel(line)),
    thread: null,
    message: line.trimEnd(),
    stream,
  };
}

/**
 * Best-effort level detection for unparseable lines (for example a plugin
 * writing `ERROR: ...` without a log prefix).
 */
function inferLevel(line: string): string {
  const match = /\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|SEVERE)\b/i.exec(line);
  return match?.[1] ?? 'INFO';
}

/** True when the vanilla/Paper boot sequence reported that it finished loading. */
export function isServerReadyLine(message: string): boolean {
  return /\bDone \([^)]*\)! For help, type "help"/.test(message);
}

/**
 * Splits an arbitrary stdout/stderr chunk into complete lines, keeping the
 * trailing partial line for the next chunk.
 */
export function splitLines(chunk: string, pending: string): { lines: string[]; pending: string } {
  const combined = pending + chunk;
  const parts = combined.split('\n');
  const nextPending = parts.pop() ?? '';
  return { lines: parts, pending: nextPending };
}
