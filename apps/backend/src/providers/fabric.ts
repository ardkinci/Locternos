import { downloadToFile } from '../lib/download.js';

const FABRIC_META = 'https://meta.fabricmc.net';
const FABRIC_MAVEN = 'https://maven.fabricmc.net/net/fabricmc/fabric-installer';
const METADATA_TIMEOUT_MS = 15_000;

export class FabricProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FabricProviderError';
  }
}

export interface FabricInstaller {
  version: string;
  url: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) });
  } catch (error) {
    throw new FabricProviderError(
      `Failed to reach Fabric Meta: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
  if (!response.ok) {
    throw new FabricProviderError(`Fabric Meta request failed with status ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new FabricProviderError('Fabric Meta returned invalid JSON');
  }
}

function stableVersions(entries: unknown, label: string): string[] {
  if (!Array.isArray(entries)) {
    throw new FabricProviderError(`Invalid Fabric ${label} response`);
  }
  const versions: string[] = [];
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.version !== 'string') continue;
    // Fabric marks stable builds explicitly; prefer those but keep the rest.
    if (entry.stable === false) continue;
    versions.push(entry.version);
  }
  return versions;
}

/** Stable Minecraft versions Fabric supports, newest first. */
export async function fetchFabricGameVersions(
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  return stableVersions(await fetchJson(`${FABRIC_META}/v2/versions/game`, fetchImpl), 'game');
}

/** Stable Fabric loader versions, newest first. */
export async function fetchFabricLoaderVersions(
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  return stableVersions(await fetchJson(`${FABRIC_META}/v2/versions/loader`, fetchImpl), 'loader');
}

/** Installer releases, newest first, with their Maven download URLs. */
export async function fetchFabricInstallers(
  fetchImpl: typeof fetch = fetch,
): Promise<FabricInstaller[]> {
  const data = await fetchJson(`${FABRIC_META}/v2/versions/installer`, fetchImpl);
  if (!Array.isArray(data)) {
    throw new FabricProviderError('Invalid Fabric installer response');
  }

  const installers: FabricInstaller[] = [];
  for (const entry of data) {
    if (!isObject(entry) || typeof entry.version !== 'string') continue;
    installers.push({
      version: entry.version,
      url: `${FABRIC_MAVEN}/${entry.version}/fabric-installer-${entry.version}.jar`,
    });
  }
  return installers;
}

/** Resolves the loader version, defaulting to the latest stable one. */
export async function resolveFabricLoader(
  gameVersion: string,
  loaderVersion: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const games = await fetchFabricGameVersions(fetchImpl);
  if (!games.includes(gameVersion)) {
    throw new FabricProviderError(`Fabric does not support Minecraft ${gameVersion}`);
  }

  if (loaderVersion) return loaderVersion;

  const loaders = await fetchFabricLoaderVersions(fetchImpl);
  const latest = loaders[0];
  if (!latest) throw new FabricProviderError('Fabric has no stable loader versions');
  return latest;
}

export function fabricServerJarUrl(gameVersion: string, loaderVersion: string): string {
  return (
    `${FABRIC_META}/v2/versions/loader/${encodeURIComponent(gameVersion)}` +
    `/${encodeURIComponent(loaderVersion)}/server/jar`
  );
}

/**
 * Downloads the Fabric server launcher JAR, which resolves libraries and the
 * vanilla server on first launch. Loader and game versions are validated first.
 */
export async function installFabricServer(
  gameVersion: string,
  loaderVersion: string | undefined,
  destinationPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sha256: string; sizeBytes: number; loaderVersion: string }> {
  const resolvedLoader = await resolveFabricLoader(gameVersion, loaderVersion, fetchImpl);
  const { hash, sizeBytes } = await downloadToFile({
    url: fabricServerJarUrl(gameVersion, resolvedLoader),
    destination: destinationPath,
    algorithm: 'sha256',
    fetchImpl,
  });
  return { sha256: hash, sizeBytes, loaderVersion: resolvedLoader };
}
