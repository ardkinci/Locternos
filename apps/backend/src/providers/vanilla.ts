import { downloadToFile } from '../lib/download.js';

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const METADATA_TIMEOUT_MS = 15_000;

export class VanillaProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VanillaProviderError';
  }
}

export interface VanillaVersion {
  id: string;
  type: string;
  url: string;
}

export interface VanillaServerJar {
  url: string;
  sha1: string;
  sizeBytes: number | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) });
  } catch (error) {
    throw new VanillaProviderError(
      `Failed to reach Mojang: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
  if (!response.ok) {
    throw new VanillaProviderError(`Mojang request failed with status ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new VanillaProviderError('Mojang returned invalid JSON');
  }
}

/** Lists all Minecraft versions Mojang still publishes download metadata for. */
export async function fetchVanillaVersions(fetchImpl: typeof fetch = fetch): Promise<VanillaVersion[]> {
  const manifest = await fetchJson(MANIFEST_URL, fetchImpl);
  if (!isObject(manifest) || !Array.isArray(manifest.versions)) {
    throw new VanillaProviderError('Invalid Mojang version manifest format');
  }

  const versions: VanillaVersion[] = [];
  for (const entry of manifest.versions) {
    if (!isObject(entry)) continue;
    if (typeof entry.id !== 'string' || typeof entry.url !== 'string') continue;
    versions.push({
      id: entry.id,
      type: typeof entry.type === 'string' ? entry.type : 'unknown',
      url: entry.url,
    });
  }
  return versions;
}

/** Resolves the official `server.jar` URL, SHA-1 and size for a version. */
export async function resolveVanillaServerJar(
  versionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VanillaServerJar> {
  const versions = await fetchVanillaVersions(fetchImpl);
  const match = versions.find((version) => version.id === versionId);
  if (!match) {
    throw new VanillaProviderError(`Unknown Minecraft version: ${versionId}`);
  }

  const details = await fetchJson(match.url, fetchImpl);
  const downloads = isObject(details) && isObject(details.downloads) ? details.downloads : undefined;
  const server = downloads && isObject(downloads.server) ? downloads.server : undefined;
  if (!server || typeof server.url !== 'string' || typeof server.sha1 !== 'string') {
    throw new VanillaProviderError(`No server JAR is available for Minecraft ${versionId}`);
  }

  return {
    url: server.url,
    sha1: server.sha1,
    sizeBytes: typeof server.size === 'number' ? server.size : null,
  };
}

/**
 * Downloads the official Vanilla server JAR and verifies Mojang's SHA-1 before
 * the caller is allowed to use it.
 */
export async function installVanillaServer(
  versionId: string,
  destinationPath: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sha1: string; sizeBytes: number }> {
  const server = await resolveVanillaServerJar(versionId, fetchImpl);
  const { hash, sizeBytes } = await downloadToFile({
    url: server.url,
    destination: destinationPath,
    algorithm: 'sha1',
    expectedHex: server.sha1,
    expectedSizeBytes: server.sizeBytes ?? undefined,
    fetchImpl,
  });
  return { sha1: hash, sizeBytes };
}
