const DEFAULT_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface MojangJavaRequirement {
  mcVersion: string;
  majorVersion: number;
  component: string | null;
}

export interface MojangVersionClientOptions {
  fetchImpl?: typeof fetch;
  manifestUrl?: string;
  /** How long the version list stays cached before it is refetched. */
  cacheTtlMs?: number;
  timeoutMs?: number;
  now?: () => number;
}

/** Raised when Mojang's manifest cannot answer a version lookup. */
export class MojangManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MojangManifestError';
  }
}

interface ManifestVersion {
  id: string;
  url: string;
}

interface VersionDetails {
  javaVersion?: {
    component?: unknown;
    majorVersion?: unknown;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseManifest(raw: unknown): ManifestVersion[] {
  if (!isObject(raw) || !Array.isArray(raw.versions)) {
    throw new MojangManifestError('Unexpected Mojang version manifest shape');
  }

  const versions: ManifestVersion[] = [];
  for (const entry of raw.versions) {
    if (!isObject(entry)) continue;
    if (typeof entry.id !== 'string' || typeof entry.url !== 'string') continue;
    versions.push({ id: entry.id, url: entry.url });
  }
  return versions;
}

/**
 * Resolves the Java major version declared by Mojang for a Minecraft version.
 * Version details are immutable, so they are cached forever; the version list
 * itself is refetched after the configured TTL.
 */
export class MojangVersionClient {
  private readonly fetchImpl: typeof fetch;
  private readonly manifestUrl: string;
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  private manifest: { fetchedAt: number; versions: ManifestVersion[] } | null = null;
  private readonly details = new Map<string, MojangJavaRequirement>();

  constructor(options: MojangVersionClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.manifestUrl = options.manifestUrl ?? DEFAULT_MANIFEST_URL;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  async getRequiredJava(mcVersion: string): Promise<MojangJavaRequirement> {
    const cached = this.details.get(mcVersion);
    if (cached) return cached;

    const url = await this.versionUrl(mcVersion);
    const details = (await this.fetchJson(url)) as VersionDetails;
    const javaVersion = isObject(details) ? details.javaVersion : undefined;
    const majorVersion = isObject(javaVersion) ? javaVersion.majorVersion : undefined;

    if (typeof majorVersion !== 'number' || !Number.isInteger(majorVersion) || majorVersion <= 0) {
      throw new MojangManifestError(
        `Mojang manifest has no Java version for Minecraft ${mcVersion}`,
      );
    }

    const requirement: MojangJavaRequirement = {
      mcVersion,
      majorVersion,
      component:
        isObject(javaVersion) && typeof javaVersion.component === 'string'
          ? javaVersion.component
          : null,
    };
    this.details.set(mcVersion, requirement);
    return requirement;
  }

  private async versionUrl(mcVersion: string): Promise<string> {
    const versions = await this.versionList();
    const match = versions.find((version) => version.id === mcVersion);
    if (!match) {
      throw new MojangManifestError(`Unknown Minecraft version: ${mcVersion}`);
    }
    return match.url;
  }

  private async versionList(): Promise<ManifestVersion[]> {
    if (this.manifest && this.now() - this.manifest.fetchedAt < this.cacheTtlMs) {
      return this.manifest.versions;
    }

    const versions = parseManifest(await this.fetchJson(this.manifestUrl));
    this.manifest = { fetchedAt: this.now(), versions };
    return versions;
  }

  private async fetchJson(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      throw new MojangManifestError(
        `Failed to reach Mojang manifest: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    if (!response.ok) {
      throw new MojangManifestError(`Mojang manifest request failed with status ${response.status}`);
    }

    try {
      return await response.json();
    } catch {
      throw new MojangManifestError('Mojang manifest returned invalid JSON');
    }
  }
}
