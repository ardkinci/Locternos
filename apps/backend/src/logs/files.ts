import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import type { LogFile } from '@locternos/shared';

/** Extensions accepted for raw log downloads. */
const DOWNLOADABLE_EXTENSIONS = ['.log', '.log.gz', '.txt.gz'];

/** Directory holding the raw log files of a server. */
export function logDirectory(serverRoot: string): string {
  return path.join(serverRoot, 'logs');
}

/** List the raw log files of a server, newest first. */
export async function listLogFiles(serverRoot: string): Promise<LogFile[]> {
  const directory = logDirectory(serverRoot);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: LogFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isDownloadableLogName(entry.name)) continue;
    const info = await stat(path.join(directory, entry.name));
    files.push({
      name: entry.name,
      sizeBytes: info.size,
      modifiedAt: info.mtime.toISOString(),
    });
  }

  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** Resolve a downloadable log file inside the server log directory. */
export function resolveLogFile(serverRoot: string, name: string): string | null {
  if (!isDownloadableLogName(name)) return null;
  const directory = logDirectory(serverRoot);
  const resolved = path.resolve(directory, name);
  if (path.dirname(resolved) !== path.resolve(directory)) return null;
  return resolved;
}

/** Open a readable stream for a resolved log file. */
export function openLogFile(filePath: string) {
  return createReadStream(filePath);
}

/** Only plain log names are downloadable to keep the path traversal safe. */
function isDownloadableLogName(name: string): boolean {
  if (name !== path.basename(name)) return false;
  if (name.startsWith('.')) return false;
  return DOWNLOADABLE_EXTENSIONS.some((extension) => name.endsWith(extension));
}
