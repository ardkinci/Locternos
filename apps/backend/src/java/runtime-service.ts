import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  InstallJavaRuntimeInput,
  JavaRuntime,
  JavaRuntimeImageType,
  JavaVersionRequirement,
} from '@locternos/shared';
import {
  downloadRuntimeArchive,
  resolveAdoptiumRuntime,
  type ResolveAdoptiumRuntimeOptions,
} from './adoptium.js';
import { MojangVersionClient, type MojangJavaRequirement } from './mojang.js';
import { scanSystemJavaRuntimes, probeJavaRuntime } from './system-scan.js';

const execFileAsync = promisify(execFile);
const METADATA_FILE = 'runtime.json';
const METADATA_SCHEMA_VERSION = 1;
const DEFAULT_SYSTEM_CACHE_TTL_MS = 30_000;
const EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;

/** Raised when a managed runtime cannot be installed or is malformed. */
export class JavaInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JavaInstallError';
  }
}

export interface ManagedRuntimeMetadata {
  schemaVersion: number;
  id: string;
  featureVersion: number;
  imageType: JavaRuntimeImageType;
  vendor: string;
  version: string;
  os: string;
  architecture: string;
  /** Path of the executable, relative to the runtime directory. */
  javaBinary: string;
  sha256: string;
  installedAt: string;
}

export interface JavaRuntimeServiceOptions {
  runtimesDir: string;
  systemCacheTtlMs?: number;
  scanSystem?: () => Promise<JavaRuntime[]>;
  probeJava?: typeof probeJavaRuntime;
  resolveAdoptium?: typeof resolveAdoptiumRuntime;
  downloadArchive?: typeof downloadRuntimeArchive;
  extractArchive?: (archivePath: string, destination: string) => Promise<void>;
  mojang?: Pick<MojangVersionClient, 'getRequiredJava'>;
  fetchImpl?: typeof fetch;
  os?: string;
  architecture?: string;
  now?: () => Date;
}

export interface InstallRuntimeResult {
  runtime: JavaRuntime;
  alreadyInstalled: boolean;
}

export interface JavaRuntimeService {
  list(options?: { refresh?: boolean }): Promise<JavaRuntime[]>;
  listManaged(): Promise<JavaRuntime[]>;
  install(input: InstallJavaRuntimeInput): Promise<InstallRuntimeResult>;
  remove(id: string): Promise<boolean>;
  probe(javaPath: string): Promise<JavaRuntime | null>;
  requirement(mcVersion: string): Promise<JavaVersionRequirement>;
}

export function managedRuntimeId(
  featureVersion: number,
  imageType: JavaRuntimeImageType,
): string {
  return `temurin-${featureVersion}-${imageType}`;
}

const MANAGED_ID_PATTERN = /^temurin-\d{1,2}-(?:jdk|jre)$/;

/** Only ids produced by `managedRuntimeId` may be addressed by the API. */
export function isManagedRuntimeId(id: string): boolean {
  return MANAGED_ID_PATTERN.test(id);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

/** `tar` handles both .tar.gz and .zip on Windows (bsdtar) and macOS. */
async function defaultExtractArchive(archivePath: string, destination: string): Promise<void> {
  try {
    await execFileAsync('tar', ['-xf', archivePath, '-C', destination], {
      timeout: EXTRACT_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    throw new JavaInstallError(
      `Failed to extract runtime archive: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}

/** Finds `bin/java` (or `bin/java.exe`) up to three levels deep. */
async function findJavaBinary(root: string): Promise<string | null> {
  const executableNames = process.platform === 'win32' ? ['java.exe', 'java'] : ['java', 'java.exe'];
  let level = [root];

  for (let depth = 0; depth < 3; depth += 1) {
    const nextLevel: string[] = [];
    for (const dir of level) {
      for (const executable of executableNames) {
        const candidate = path.join(dir, 'bin', executable);
        if (await fileExists(candidate)) return candidate;
      }
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) nextLevel.push(path.join(dir, entry.name));
        }
      } catch {
        // Ignore unreadable subtrees.
      }
    }
    level = nextLevel;
  }
  return null;
}

function parseMetadata(raw: unknown): ManagedRuntimeMetadata | null {
  if (!isObject(raw)) return null;
  const imageType = raw.imageType;
  const installedAt = raw.installedAt;
  if (
    raw.schemaVersion !== METADATA_SCHEMA_VERSION ||
    typeof raw.id !== 'string' ||
    !isManagedRuntimeId(raw.id) ||
    typeof raw.featureVersion !== 'number' ||
    !Number.isInteger(raw.featureVersion) ||
    raw.featureVersion <= 0 ||
    (imageType !== 'jdk' && imageType !== 'jre') ||
    typeof raw.vendor !== 'string' ||
    typeof raw.version !== 'string' ||
    typeof raw.os !== 'string' ||
    typeof raw.architecture !== 'string' ||
    typeof raw.javaBinary !== 'string' ||
    typeof raw.sha256 !== 'string' ||
    typeof installedAt !== 'string'
  ) {
    return null;
  }

  return {
    schemaVersion: METADATA_SCHEMA_VERSION,
    id: raw.id,
    featureVersion: raw.featureVersion,
    imageType,
    vendor: raw.vendor,
    version: raw.version,
    os: raw.os,
    architecture: raw.architecture,
    javaBinary: raw.javaBinary,
    sha256: raw.sha256,
    installedAt,
  };
}

/** Reads and validates one managed runtime directory. */
async function readManagedRuntime(dir: string): Promise<JavaRuntime | null> {
  let metadata: ManagedRuntimeMetadata | null;
  try {
    metadata = parseMetadata(JSON.parse(await readFile(path.join(dir, METADATA_FILE), 'utf8')));
  } catch {
    return null;
  }
  if (!metadata || path.basename(dir) !== metadata.id) return null;

  if (path.isAbsolute(metadata.javaBinary)) return null;
  const binaryPath = path.resolve(dir, metadata.javaBinary);
  if (!isInside(dir, binaryPath) || !(await fileExists(binaryPath))) return null;

  return {
    id: metadata.id,
    path: binaryPath,
    vendor: metadata.vendor,
    version: metadata.version,
    majorVersion: metadata.featureVersion,
    source: 'managed',
    imageType: metadata.imageType,
    installedAt: metadata.installedAt,
  };
}

/**
 * Creates the Java runtime service. System installations are cached briefly so
 * repeated API calls do not spawn `java -version` for every JDK on the host.
 */
export function createJavaRuntimeService(options: JavaRuntimeServiceOptions): JavaRuntimeService {
  const runtimesDir = options.runtimesDir;
  const scanSystem = options.scanSystem ?? (() => scanSystemJavaRuntimes());
  const probeJava = options.probeJava ?? probeJavaRuntime;
  const resolveAdoptium = options.resolveAdoptium ?? resolveAdoptiumRuntime;
  const downloadArchive = options.downloadArchive ?? downloadRuntimeArchive;
  const extractArchive = options.extractArchive ?? defaultExtractArchive;
  const mojang = options.mojang ?? new MojangVersionClient();
  const now = options.now ?? (() => new Date());
  const systemCacheTtlMs = options.systemCacheTtlMs ?? DEFAULT_SYSTEM_CACHE_TTL_MS;

  let systemCache: { fetchedAt: number; runtimes: JavaRuntime[] } | null = null;

  async function listSystem(refresh = false): Promise<JavaRuntime[]> {
    if (!refresh && systemCache && Date.now() - systemCache.fetchedAt < systemCacheTtlMs) {
      return systemCache.runtimes;
    }
    const runtimes = await scanSystem();
    systemCache = { fetchedAt: Date.now(), runtimes };
    return runtimes;
  }

  async function listManaged(): Promise<JavaRuntime[]> {
    await mkdir(runtimesDir, { recursive: true });
    const entries = await readdir(runtimesDir, { withFileTypes: true });
    const runtimes: JavaRuntime[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const runtime = await readManagedRuntime(path.join(runtimesDir, entry.name));
      if (runtime) runtimes.push(runtime);
    }
    return runtimes.sort(
      (a, b) => b.majorVersion - a.majorVersion || a.id.localeCompare(b.id, 'en'),
    );
  }

  async function install(input: InstallJavaRuntimeInput): Promise<InstallRuntimeResult> {
    const id = managedRuntimeId(input.featureVersion, input.imageType);
    const targetDir = path.join(runtimesDir, id);

    const existing = await readManagedRuntime(targetDir);
    if (existing) return { runtime: existing, alreadyInstalled: true };

    // A partially installed directory would block the final rename.
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(runtimesDir, { recursive: true });

    const tempDir = path.join(runtimesDir, `.tmp-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      const adoptiumOptions: ResolveAdoptiumRuntimeOptions = {
        featureVersion: input.featureVersion,
        imageType: input.imageType,
        fetchImpl: options.fetchImpl,
        os: options.os,
        architecture: options.architecture,
      };
      const remote = await resolveAdoptium(adoptiumOptions);

      const archivePath = path.join(tempDir, 'runtime-archive');
      const downloaded = await downloadArchive({
        url: remote.downloadUrl,
        destination: archivePath,
        expectedSha256: remote.checksum,
        expectedSizeBytes: remote.sizeBytes,
        fetchImpl: options.fetchImpl,
      });

      const extractDir = path.join(tempDir, 'extract');
      await mkdir(extractDir, { recursive: true });
      await extractArchive(archivePath, extractDir);

      await rename(extractDir, targetDir);

      const javaBinary = await findJavaBinary(targetDir);
      if (!javaBinary) {
        throw new JavaInstallError('Downloaded runtime contains no bin/java executable');
      }

      const installedAt = now().toISOString();
      const metadata: ManagedRuntimeMetadata = {
        schemaVersion: METADATA_SCHEMA_VERSION,
        id,
        featureVersion: input.featureVersion,
        imageType: input.imageType,
        vendor: remote.vendor,
        version: remote.version,
        os: remote.os,
        architecture: remote.architecture,
        javaBinary: path.relative(targetDir, javaBinary).split(path.sep).join('/'),
        sha256: downloaded.sha256,
        installedAt,
      };
      await writeFile(path.join(targetDir, METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`);

      return {
        alreadyInstalled: false,
        runtime: {
          id,
          path: javaBinary,
          vendor: metadata.vendor,
          version: metadata.version,
          majorVersion: metadata.featureVersion,
          source: 'managed',
          imageType: metadata.imageType,
          installedAt,
        },
      };
    } catch (error) {
      await rm(targetDir, { recursive: true, force: true });
      throw error;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  async function remove(id: string): Promise<boolean> {
    if (!isManagedRuntimeId(id)) return false;
    const targetDir = path.join(runtimesDir, id);
    if (!isInside(runtimesDir, targetDir)) return false;

    try {
      if (!(await stat(targetDir)).isDirectory()) return false;
    } catch {
      return false;
    }

    await rm(targetDir, { recursive: true, force: true });
    return true;
  }

  async function requirement(mcVersion: string): Promise<JavaVersionRequirement> {
    const { majorVersion }: MojangJavaRequirement = await mojang.getRequiredJava(mcVersion);
    const runtimes = [...(await listSystem()), ...(await listManaged())];
    const matching = runtimes.filter((runtime) => runtime.majorVersion >= majorVersion);
    return {
      mcVersion,
      requiredMajorVersion: majorVersion,
      satisfied: matching.length > 0,
      matchingRuntimeIds: matching.map((runtime) => runtime.id),
    };
  }

  return {
    async list(listOptions = {}) {
      const [system, managed] = await Promise.all([
        listSystem(listOptions.refresh),
        listManaged(),
      ]);
      return [...managed, ...system];
    },
    listManaged,
    install,
    remove,
    probe: probeJava,
    requirement,
  };
}
