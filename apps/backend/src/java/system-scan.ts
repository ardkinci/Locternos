import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { JavaRuntime } from '@locternos/shared';
import { parseJavaVersion } from './version.js';

const execFileAsync = promisify(execFile);
const JAVA_VERSION_TIMEOUT_MS = 10_000;

export interface SystemJavaScanOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** Runs the executable and returns its combined `stdout`/`stderr` banner. */
  runJava?: (javaPath: string) => Promise<string>;
  fileExists?: (candidate: string) => Promise<boolean>;
  listDirectories?: (dir: string) => Promise<string[]>;
}

/** Stable, non-guessable id derived from the executable path. */
export function systemRuntimeId(javaPath: string): string {
  const digest = createHash('sha1').update(path.normalize(javaPath)).digest('hex');
  return `system-${digest.slice(0, 12)}`;
}

function javaExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'java.exe' : 'java';
}

/** `JAVA_HOME` and every `PATH` entry that may hold a Java executable. */
export function explicitJavaCandidates(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  const executable = javaExecutableName(platform);
  const candidates: string[] = [];

  if (env.JAVA_HOME) {
    candidates.push(path.join(env.JAVA_HOME, 'bin', executable));
  }

  const pathSeparator = platform === 'win32' ? ';' : ':';
  for (const entry of (env.PATH ?? '').split(pathSeparator)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    candidates.push(path.join(trimmed, executable));
    candidates.push(path.join(trimmed, 'bin', executable));
  }

  return candidates;
}

/** Directories whose children are JDK/JRE home directories. */
export function commonJavaHomeRoots(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string[] {
  switch (platform) {
    case 'darwin':
      return [
        '/Library/Java/JavaVirtualMachines',
        '/System/Library/Java/JavaVirtualMachines',
        '/opt/homebrew/opt/openjdk',
      ];
    case 'win32': {
      const roots: string[] = [];
      const programFiles = env.ProgramFiles;
      if (programFiles) {
        roots.push(
          path.join(programFiles, 'Java'),
          path.join(programFiles, 'Eclipse Adoptium'),
          path.join(programFiles, 'Microsoft'),
          path.join(programFiles, 'Zulu'),
          path.join(programFiles, 'Amazon Corretto'),
          path.join(programFiles, 'BellSoft'),
        );
      }
      if (env['ProgramFiles(x86)']) {
        roots.push(path.join(env['ProgramFiles(x86)'], 'Java'));
      }
      if (env.LOCALAPPDATA) {
        roots.push(path.join(env.LOCALAPPDATA, 'Programs', 'Eclipse Adoptium'));
      }
      return roots;
    }
    default:
      return ['/usr/lib/jvm', '/usr/java', '/opt/java', '/opt/jdk', '/usr/local/java'];
  }
}

function javaHomeCandidates(root: string, child: string | null, platform: NodeJS.Platform): string[] {
  const executable = javaExecutableName(platform);
  const home = child ? path.join(root, child) : root;
  const candidates = [path.join(home, 'bin', executable)];
  // macOS bundles the actual home inside `*.jdk/Contents/Home`.
  if (platform === 'darwin') {
    candidates.push(path.join(home, 'Contents', 'Home', 'bin', executable));
  }
  return candidates;
}

async function defaultRunJava(javaPath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(javaPath, ['-version'], {
      timeout: JAVA_VERSION_TIMEOUT_MS,
      windowsHide: true,
    });
    return `${stdout}\n${stderr}`;
  } catch (error) {
    // `java -version` may exit non-zero on exotic builds; the banner is still useful.
    const failure = error as { stdout?: string; stderr?: string };
    return `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`;
  }
}

async function defaultFileExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function defaultListDirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Collects executable candidates from `JAVA_HOME`, `PATH` and common roots. */
export async function collectSystemJavaCandidates(
  options: SystemJavaScanOptions = {},
): Promise<string[]> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const fileExists = options.fileExists ?? defaultFileExists;
  const listDirectories = options.listDirectories ?? defaultListDirectories;

  const candidates = explicitJavaCandidates(env, platform);

  for (const root of commonJavaHomeRoots(env, platform)) {
    candidates.push(...javaHomeCandidates(root, null, platform));
    for (const child of await listDirectories(root)) {
      candidates.push(...javaHomeCandidates(root, child, platform));
    }
  }

  const seen = new Set<string>();
  const existing: string[] = [];
  for (const candidate of candidates) {
    const normalized = platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (await fileExists(candidate)) existing.push(candidate);
  }
  return existing;
}

/**
 * Validates a manually entered Java executable path and turns it into a
 * runtime description. Used for the per-server Java override, which may point
 * outside the directories the scanner walks.
 */
export async function probeJavaRuntime(
  javaPath: string,
  options: Pick<SystemJavaScanOptions, 'runJava' | 'fileExists'> = {},
): Promise<JavaRuntime | null> {
  if (!javaPath || !path.isAbsolute(javaPath)) return null;

  const fileExists = options.fileExists ?? defaultFileExists;
  const runJava = options.runJava ?? defaultRunJava;
  if (!(await fileExists(javaPath))) return null;

  const parsed = parseJavaVersion(await runJava(javaPath));
  if (!parsed) return null;

  return {
    id: systemRuntimeId(javaPath),
    path: path.normalize(javaPath),
    vendor: parsed.vendor,
    version: parsed.version,
    majorVersion: parsed.majorVersion,
    source: 'system',
    imageType: null,
    installedAt: null,
  };
}

/**
 * Discovers locally installed Java runtimes. Unreadable or malformed
 * installations are skipped instead of failing the whole scan.
 */
export async function scanSystemJavaRuntimes(
  options: SystemJavaScanOptions = {},
): Promise<JavaRuntime[]> {
  const runJava = options.runJava ?? defaultRunJava;
  const candidates = await collectSystemJavaCandidates(options);

  const runtimes: JavaRuntime[] = [];
  for (const javaPath of candidates) {
    const parsed = parseJavaVersion(await runJava(javaPath));
    if (!parsed) continue;
    runtimes.push({
      id: systemRuntimeId(javaPath),
      path: path.normalize(javaPath),
      vendor: parsed.vendor,
      version: parsed.version,
      majorVersion: parsed.majorVersion,
      source: 'system',
      imageType: null,
      installedAt: null,
    });
  }

  // Highest major version first, then path for deterministic output.
  return runtimes.sort(
    (a, b) => b.majorVersion - a.majorVersion || a.path.localeCompare(b.path, 'en'),
  );
}
