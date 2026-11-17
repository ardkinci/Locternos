import { downloadToFile } from '../lib/download.js';

const PAPER_API = 'https://api.papermc.io/v2/projects/paper';
const METADATA_TIMEOUT_MS = 15_000;

export class PaperProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaperProviderError';
  }
}

export interface PaperBuild {
  build: number;
  filename: string;
  sha256: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) });
  } catch (error) {
    throw new PaperProviderError(
      `Failed to reach PaperMC: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
  if (!response.ok) {
    throw new PaperProviderError(`PaperMC request failed with status ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new PaperProviderError('PaperMC returned invalid JSON');
  }
}

/** Lists Minecraft versions Paper publishes builds for, newest first. */
export async function fetchPaperVersions(fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const data = await fetchJson(PAPER_API, fetchImpl);
  if (!isObject(data) || !Array.isArray(data.versions)) {
    throw new PaperProviderError('Invalid PaperMC versions response');
  }
  return data.versions.filter((version): version is string => typeof version === 'string');
}

/** Lists usable builds for a Paper version, newest first. */
export async function fetchPaperBuilds(
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PaperBuild[]> {
  const url = `${PAPER_API}/versions/${encodeURIComponent(version)}/builds`;
  const data = await fetchJson(url, fetchImpl);
  if (!isObject(data) || !Array.isArray(data.builds)) {
    throw new PaperProviderError(`Invalid PaperMC builds response for ${version}`);
  }

  const builds: PaperBuild[] = [];
  for (const entry of data.builds) {
    if (!isObject(entry) || typeof entry.build !== 'number') continue;
    const application =
      isObject(entry.downloads) && isObject(entry.downloads.application)
        ? entry.downloads.application
        : null;
    if (
      !application ||
      typeof application.name !== 'string' ||
      typeof application.sha256 !== 'string'
    ) {
      continue;
    }
    builds.push({ build: entry.build, filename: application.name, sha256: application.sha256 });
  }
  return builds.sort((a, b) => b.build - a.build);
}

/** Picks the requested build, or the latest one when no build is given. */
export async function resolvePaperBuild(
  version: string,
  build: number | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<PaperBuild> {
  const versions = await fetchPaperVersions(fetchImpl);
  if (!versions.includes(version)) {
    throw new PaperProviderError(`Unknown Paper version: ${version}`);
  }

  const builds = await fetchPaperBuilds(version, fetchImpl);
  if (builds.length === 0) {
    throw new PaperProviderError(`Paper ${version} has no published builds`);
  }

  if (build === undefined) return builds[0]!;

  const match = builds.find((entry) => entry.build === build);
  if (!match) {
    throw new PaperProviderError(`Paper ${version} has no build ${build}`);
  }
  return match;
}

export function paperDownloadUrl(version: string, build: PaperBuild): string {
  return (
    `${PAPER_API}/versions/${encodeURIComponent(version)}/builds/${build.build}` +
    `/downloads/${encodeURIComponent(build.filename)}`
  );
}

/** Downloads a Paper build and verifies PaperMC's SHA-256. */
export async function installPaperServer(
  version: string,
  build: number | undefined,
  destinationPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sha256: string; sizeBytes: number; build: number }> {
  const resolved = await resolvePaperBuild(version, build, fetchImpl);
  const { hash, sizeBytes } = await downloadToFile({
    url: paperDownloadUrl(version, resolved),
    destination: destinationPath,
    algorithm: 'sha256',
    expectedHex: resolved.sha256,
    fetchImpl,
  });
  return { sha256: hash, sizeBytes, build: resolved.build };
}
