import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import type { AdoptiumRuntime, JavaRuntimeImageType } from '@locternos/shared';

const DEFAULT_API_BASE_URL = 'https://api.adoptium.net';
const DEFAULT_TIMEOUT_MS = 15_000;

export interface AdoptiumTarget {
  os: string;
  architecture: string;
  imageType: JavaRuntimeImageType;
}

export interface ResolveAdoptiumRuntimeOptions {
  featureVersion: number;
  imageType: JavaRuntimeImageType;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
  os?: string;
  architecture?: string;
  timeoutMs?: number;
}

/** Raised when Adoptium cannot satisfy a runtime request. */
export class AdoptiumApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdoptiumApiError';
  }
}

/** Raised when a downloaded archive does not match its published SHA-256. */
export class AdoptiumChecksumError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Downloaded runtime checksum mismatch (expected ${expected}, got ${actual})`);
    this.name = 'AdoptiumChecksumError';
  }
}

/** Maps a Node platform to the Adoptium `os` query value. */
export function adoptiumOs(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'mac';
  if (platform === 'win32') return 'windows';
  return 'linux';
}

/** Maps a Node architecture to the Adoptium `architecture` query value. */
export function adoptiumArchitecture(arch: string): string {
  switch (arch) {
    case 'x64':
      return 'x64';
    case 'arm64':
      return 'aarch64';
    case 'arm':
      return 'arm';
    case 'ia32':
      return 'x32';
    case 'ppc64':
    case 'ppc64le':
      return 'ppc64le';
    case 's390x':
      return 's390x';
    default:
      return arch;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asPositiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Picks the newest release binary matching the requested OS, architecture and
 * image type from an Adoptium `feature_releases` payload.
 */
export function selectAdoptiumRuntime(
  releases: unknown,
  target: AdoptiumTarget,
): AdoptiumRuntime | null {
  if (!Array.isArray(releases)) return null;

  for (const release of releases) {
    if (!isObject(release)) continue;
    const releaseName = asString(release.release_name);
    const binaries = release.binaries;
    if (!releaseName || !Array.isArray(binaries)) continue;

    const versionData = isObject(release.version_data) ? release.version_data : {};
    const version =
      asString(versionData.semver) ?? asString(versionData.release_name) ?? releaseName;
    const featureVersion = asPositiveInt(versionData.major);

    for (const binary of binaries) {
      if (!isObject(binary)) continue;
      if (
        binary.os !== target.os ||
        binary.architecture !== target.architecture ||
        binary.image_type !== target.imageType
      ) {
        continue;
      }

      const pkg = isObject(binary.package) ? binary.package : null;
      if (!pkg) continue;

      const downloadUrl = asString(pkg.link);
      const checksum = asString(pkg.checksum)?.toLowerCase() ?? null;
      const sizeBytes = asPositiveInt(pkg.size);
      if (!downloadUrl || !checksum || !/^[0-9a-f]{64}$/.test(checksum) || !sizeBytes) {
        continue;
      }

      return {
        featureVersion: featureVersion ?? 0,
        imageType: target.imageType,
        vendor: 'Eclipse Temurin',
        releaseName,
        version,
        os: target.os,
        architecture: target.architecture,
        downloadUrl,
        checksum,
        sizeBytes,
      };
    }
  }

  return null;
}

/**
 * Resolves the latest GA Temurin build for a feature version. Installation is
 * always an explicit action; this only inspects Adoptium metadata.
 */
export async function resolveAdoptiumRuntime(
  options: ResolveAdoptiumRuntimeOptions,
): Promise<AdoptiumRuntime> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  const target: AdoptiumTarget = {
    os: options.os ?? adoptiumOs(process.platform),
    architecture: options.architecture ?? adoptiumArchitecture(process.arch),
    imageType: options.imageType,
  };

  const url =
    `${baseUrl}/v3/assets/feature_releases/${options.featureVersion}/ga` +
    `?architecture=${encodeURIComponent(target.architecture)}` +
    `&image_type=${encodeURIComponent(target.imageType)}` +
    `&os=${encodeURIComponent(target.os)}` +
    '&vendor=eclipse&page=0&page_size=1';

  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new AdoptiumApiError(
      `Failed to reach Adoptium: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  if (!response.ok) {
    throw new AdoptiumApiError(`Adoptium request failed with status ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AdoptiumApiError('Adoptium returned invalid JSON');
  }

  const runtime = selectAdoptiumRuntime(payload, target);
  if (!runtime) {
    throw new AdoptiumApiError(
      `No Temurin ${target.imageType} build found for ${target.os}/${target.architecture}`,
    );
  }
  if (runtime.featureVersion === 0) {
    runtime.featureVersion = options.featureVersion;
  }
  return runtime;
}

export interface DownloadRuntimeOptions {
  url: string;
  destination: string;
  expectedSha256: string;
  expectedSizeBytes?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Streams a runtime archive to disk while hashing it, then verifies the
 * published SHA-256. Aborts instead of extracting an unverified archive.
 */
export async function downloadRuntimeArchive(
  options: DownloadRuntimeOptions,
): Promise<{ sha256: string; sizeBytes: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await fetchImpl(options.url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 10 * 60 * 1000),
    });
  } catch (error) {
    throw new AdoptiumApiError(
      `Failed to download runtime: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  if (!response.ok) {
    throw new AdoptiumApiError(`Runtime download failed with status ${response.status}`);
  }
  if (!response.body) {
    throw new AdoptiumApiError('Runtime download returned an empty body');
  }

  const hash = createHash('sha256');
  let sizeBytes = 0;
  const hasher = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      sizeBytes += chunk.length;
      callback(null, chunk);
    },
  });

  const body = response.body as unknown as NodeReadableStream<Uint8Array>;
  await pipeline(Readable.fromWeb(body), hasher, createWriteStream(options.destination));

  const sha256 = hash.digest('hex');
  if (sha256 !== options.expectedSha256.toLowerCase()) {
    throw new AdoptiumChecksumError(options.expectedSha256.toLowerCase(), sha256);
  }
  if (options.expectedSizeBytes !== undefined && sizeBytes !== options.expectedSizeBytes) {
    throw new AdoptiumApiError(
      `Runtime download size mismatch (expected ${options.expectedSizeBytes}, got ${sizeBytes})`,
    );
  }

  return { sha256, sizeBytes };
}
