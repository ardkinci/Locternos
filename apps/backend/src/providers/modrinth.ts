const MODRINTH_API = 'https://api.modrinth.com/v2';
const METADATA_TIMEOUT_MS = 15_000;

export type ModrinthProjectType = 'plugin' | 'mod' | 'datapack';
export type ModrinthDependencyType = 'required' | 'optional' | 'incompatible' | 'embedded';

export class ModrinthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModrinthError';
  }
}

export interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  projectType: ModrinthProjectType;
  description: string;
}

export interface ModrinthFile {
  url: string;
  filename: string;
  size: number;
  sha1: string;
  sha512: string;
}

export interface ModrinthDependency {
  versionId: string | null;
  projectId: string | null;
  fileName: string | null;
  dependencyType: ModrinthDependencyType;
}

export interface ModrinthVersion {
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  gameVersions: string[];
  loaders: string[];
  primaryFile: ModrinthFile;
  dependencies: ModrinthDependency[];
}

export interface ParsedModrinthUrl {
  projectType: ModrinthProjectType;
  slug: string;
  versionId: string | null;
}

export interface ModrinthResolution {
  project: ModrinthProject;
  version: ModrinthVersion | null;
  exactMatch: boolean;
  /** Installable alternatives offered when no exact game/loader match exists. */
  fallbackVersions: ModrinthVersion[];
}

export interface ModrinthDependencyResolution {
  project: ModrinthProject;
  version: ModrinthVersion;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
      // Modrinth asks clients to identify themselves.
      headers: { 'user-agent': 'Locternos/1.0 (self-hosted Minecraft panel)' },
    });
  } catch (error) {
    throw new ModrinthError(
      `Failed to reach Modrinth: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
  if (response.status === 404) {
    throw new ModrinthError('Modrinth project or version not found');
  }
  if (!response.ok) {
    throw new ModrinthError(`Modrinth request failed with status ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new ModrinthError('Modrinth returned invalid JSON');
  }
}

/** Parses `modrinth.com/{plugin|mod|datapack}/<slug>[/version/<id>]` URLs. */
export function parseModrinthUrl(rawUrl: string): ParsedModrinthUrl | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'modrinth.com' && host !== 'www.modrinth.com') return null;

  const [type, slug, maybeVersionKey, versionId] = url.pathname.split('/').filter(Boolean);
  if (type !== 'plugin' && type !== 'mod' && type !== 'datapack') return null;
  if (!slug || !/^[A-Za-z0-9._-]+$/.test(slug)) return null;
  if (maybeVersionKey !== undefined) {
    if (maybeVersionKey !== 'version' || !versionId || !/^[A-Za-z0-9._-]+$/.test(versionId)) {
      return null;
    }
  }

  return {
    projectType: type,
    slug,
    versionId: versionId ?? null,
  };
}

function parseProject(raw: unknown): ModrinthProject | null {
  if (!isObject(raw)) return null;
  const type = raw.project_type;
  if (
    typeof raw.id !== 'string' ||
    typeof raw.slug !== 'string' ||
    typeof raw.title !== 'string' ||
    (type !== 'plugin' && type !== 'mod' && type !== 'datapack')
  ) {
    return null;
  }
  return {
    id: raw.id,
    slug: raw.slug,
    title: raw.title,
    projectType: type,
    description: typeof raw.description === 'string' ? raw.description : '',
  };
}

function parseFile(raw: unknown): ModrinthFile | null {
  if (!isObject(raw)) return null;
  if (
    typeof raw.url !== 'string' ||
    typeof raw.filename !== 'string' ||
    typeof raw.size !== 'number' ||
    typeof raw.sha1 !== 'string' ||
    typeof raw.sha512 !== 'string'
  ) {
    return null;
  }
  return {
    url: raw.url,
    filename: raw.filename,
    size: raw.size,
    sha1: raw.sha1,
    sha512: raw.sha512,
  };
}

function parseDependency(raw: unknown): ModrinthDependency | null {
  if (!isObject(raw)) return null;
  const type = raw.dependency_type;
  if (type !== 'required' && type !== 'optional' && type !== 'incompatible' && type !== 'embedded') {
    return null;
  }
  return {
    versionId: typeof raw.version_id === 'string' ? raw.version_id : null,
    projectId: typeof raw.project_id === 'string' ? raw.project_id : null,
    fileName: typeof raw.file_name === 'string' ? raw.file_name : null,
    dependencyType: type,
  };
}

function parseVersion(raw: unknown): ModrinthVersion | null {
  if (!isObject(raw)) return null;
  if (
    typeof raw.id !== 'string' ||
    typeof raw.project_id !== 'string' ||
    typeof raw.version_number !== 'string' ||
    !Array.isArray(raw.files)
  ) {
    return null;
  }

  const files: ModrinthFile[] = [];
  let primary: ModrinthFile | undefined;
  for (const rawFile of raw.files) {
    const file = parseFile(rawFile);
    if (!file) continue;
    files.push(file);
    if (!primary && isObject(rawFile) && rawFile.primary === true) primary = file;
  }
  primary ??= files[0];
  if (!primary) return null;

  const dependencies = Array.isArray(raw.dependencies)
    ? raw.dependencies
        .map(parseDependency)
        .filter((dep): dep is ModrinthDependency => dep !== null)
    : [];

  return {
    id: raw.id,
    projectId: raw.project_id,
    name: typeof raw.name === 'string' ? raw.name : raw.version_number,
    versionNumber: raw.version_number,
    gameVersions: stringArray(raw.game_versions),
    loaders: stringArray(raw.loaders),
    primaryFile: primary,
    dependencies,
  };
}

export async function fetchModrinthProject(
  slugOrId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ModrinthProject> {
  const project = parseProject(
    await fetchJson(`${MODRINTH_API}/project/${encodeURIComponent(slugOrId)}`, fetchImpl),
  );
  if (!project) throw new ModrinthError('Invalid Modrinth project response');
  return project;
}

export async function fetchModrinthVersion(
  versionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ModrinthVersion> {
  const version = parseVersion(
    await fetchJson(`${MODRINTH_API}/version/${encodeURIComponent(versionId)}`, fetchImpl),
  );
  if (!version) throw new ModrinthError('Invalid Modrinth version response');
  return version;
}

export interface ModrinthVersionFilter {
  gameVersion: string;
  loaders: string[];
}

export async function fetchModrinthVersions(
  projectSlugOrId: string,
  filter: ModrinthVersionFilter,
  fetchImpl: typeof fetch = fetch,
): Promise<ModrinthVersion[]> {
  const query =
    `?game_versions=${encodeURIComponent(JSON.stringify([filter.gameVersion]))}` +
    `&loaders=${encodeURIComponent(JSON.stringify(filter.loaders))}`;
  const data = await fetchJson(
    `${MODRINTH_API}/project/${encodeURIComponent(projectSlugOrId)}/version${query}`,
    fetchImpl,
  );
  if (!Array.isArray(data)) throw new ModrinthError('Invalid Modrinth versions response');
  return data.map(parseVersion).filter((version): version is ModrinthVersion => version !== null);
}

export interface ResolveModrinthOptions extends ModrinthVersionFilter {
  fetchImpl?: typeof fetch;
}

/**
 * Resolves a Modrinth page URL against the server's game version and loaders.
 * When no exact match exists, installable fallback versions are returned so the
 * UI can let the user pick one.
 */
export async function resolveModrinthPage(
  rawUrl: string,
  options: ResolveModrinthOptions,
): Promise<ModrinthResolution> {
  const parsed = parseModrinthUrl(rawUrl);
  if (!parsed) throw new ModrinthError('Unsupported Modrinth URL');

  const fetchImpl = options.fetchImpl ?? fetch;
  const project = await fetchModrinthProject(parsed.slug, fetchImpl);

  if (parsed.versionId) {
    const version = await fetchModrinthVersion(parsed.versionId, fetchImpl);
    if (version.projectId !== project.id) {
      throw new ModrinthError('The requested version does not belong to this project');
    }
    const exactMatch =
      version.gameVersions.includes(options.gameVersion) &&
      version.loaders.some((loader) => options.loaders.includes(loader));
    return {
      project,
      version,
      exactMatch,
      fallbackVersions: exactMatch ? [] : await fetchModrinthVersions(project.id, options, fetchImpl),
    };
  }

  const matches = await fetchModrinthVersions(project.id, options, fetchImpl);
  if (matches.length > 0) {
    return { project, version: matches[0]!, exactMatch: true, fallbackVersions: [] };
  }

  const fallback = await fetchModrinthVersions(
    project.id,
    { gameVersion: options.gameVersion, loaders: [] },
    fetchImpl,
  );
  return { project, version: null, exactMatch: false, fallbackVersions: fallback };
}

/**
 * Resolves the `required` dependency tree for a version, skipping cycles and
 * already-seen projects. Optional, embedded and incompatible deps are not
 * auto-installed.
 */
export async function resolveRequiredDependencies(
  version: ModrinthVersion,
  options: ResolveModrinthOptions,
): Promise<ModrinthDependencyResolution[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolved: ModrinthDependencyResolution[] = [];
  const seenProjects = new Set<string>([version.projectId]);
  const queue: ModrinthDependency[] = version.dependencies.filter(
    (dependency) => dependency.dependencyType === 'required' && dependency.projectId !== null,
  );
  const visitedVersions = new Set<string>();

  while (queue.length > 0) {
    const dependency = queue.shift()!;
    const projectId = dependency.projectId;
    if (!projectId || seenProjects.has(projectId)) continue;
    seenProjects.add(projectId);

    let depVersion: ModrinthVersion | null;
    if (dependency.versionId && !visitedVersions.has(dependency.versionId)) {
      depVersion = await fetchModrinthVersion(dependency.versionId, fetchImpl);
      visitedVersions.add(dependency.versionId);
    } else {
      const matches = await fetchModrinthVersions(projectId, options, fetchImpl);
      depVersion = matches[0] ?? null;
    }

    if (!depVersion) {
      throw new ModrinthError(
        `Required dependency ${projectId} has no build for Minecraft ${options.gameVersion}`,
      );
    }

    const project = await fetchModrinthProject(projectId, fetchImpl);
    resolved.push({ project, version: depVersion });

    for (const transitive of depVersion.dependencies) {
      if (transitive.dependencyType === 'required' && transitive.projectId) {
        queue.push(transitive);
      }
    }
  }

  return resolved;
}

/** Maps a server core to the Modrinth loader filters used for resolution. */
export function modrinthLoadersForCore(coreType: 'vanilla' | 'paper' | 'fabric' | 'custom'): string[] {
  switch (coreType) {
    case 'paper':
      return ['paper', 'spigot', 'bukkit'];
    case 'fabric':
      return ['fabric'];
    default:
      return [];
  }
}
