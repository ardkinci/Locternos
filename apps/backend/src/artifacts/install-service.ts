import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import type {
  Artifact,
  ArtifactKind,
  InstallArtifactInput,
  InstallCoreInput,
  Server,
} from '@locternos/shared';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { servers } from '../db/schema.js';
import { recordAuditEvent } from '../audit/service.js';
import {
  deleteArtifact as deleteArtifactRow,
  listArtifacts,
  recordArtifact,
  getArtifact,
} from '../artifacts/service.js';
import {
  downloadJarFromUrl,
  saveJarBuffer,
  sha256File,
  type InstalledJar,
} from '../artifacts/installer.js';
import { getServer } from '../servers/service.js';
import { installVanillaServer } from '../providers/vanilla.js';
import { installPaperServer } from '../providers/paper.js';
import { installFabricServer } from '../providers/fabric.js';
import {
  modrinthLoadersForCore,
  resolveModrinthPage,
  resolveRequiredDependencies,
  type ModrinthProject,
  type ModrinthVersion,
} from '../providers/modrinth.js';

export class ServerNotFoundError extends Error {
  constructor() {
    super('Server not found');
    this.name = 'ServerNotFoundError';
  }
}

export class ArtifactInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactInstallError';
  }
}

export interface FallbackVersionInfo {
  id: string;
  name: string;
  versionNumber: string;
  gameVersions: string[];
  loaders: string[];
  filename: string;
  sizeBytes: number;
}

export type InstallArtifactOutcome =
  | {
      status: 'installed';
      artifact: Artifact;
      dependencies: Artifact[];
    }
  | {
      status: 'needs_selection';
      project: { id: string; slug: string; title: string; projectType: string };
      fallbackVersions: FallbackVersionInfo[];
    };

export interface UploadArtifactInput {
  kind: ArtifactKind;
  filename: string;
  data: Uint8Array;
}

export interface ArtifactInstallService {
  installCore(
    serverId: string,
    input: InstallCoreInput,
    userId: string | null,
  ): Promise<{ server: Server; artifact: Artifact }>;
  installArtifact(
    serverId: string,
    input: InstallArtifactInput,
    userId: string | null,
  ): Promise<InstallArtifactOutcome>;
  installUpload(
    serverId: string,
    input: UploadArtifactInput,
    userId: string | null,
  ): Promise<{ artifact: Artifact }>;
  list(serverId: string): Artifact[];
  remove(serverId: string, artifactId: string, userId: string | null): Promise<boolean>;
}

export interface ArtifactInstallServiceOptions {
  db: Db;
  config: Config;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

function serverDirectory(config: Config, server: Server): string {
  return path.join(config.paths.servers, server.slug);
}

/** Routes an artifact to the conventional directory for its kind. */
export function artifactDirectory(config: Config, server: Server, kind: ArtifactKind): string {
  const base = serverDirectory(config, server);
  switch (kind) {
    case 'core':
      return base;
    case 'plugin':
      return path.join(base, 'plugins');
    case 'mod':
      return path.join(base, 'mods');
    case 'datapack':
      return path.join(base, 'world', 'datapacks');
  }
}

function fallbackInfo(version: ModrinthVersion): FallbackVersionInfo {
  return {
    id: version.id,
    name: version.name,
    versionNumber: version.versionNumber,
    gameVersions: version.gameVersions,
    loaders: version.loaders,
    filename: version.primaryFile.filename,
    sizeBytes: version.primaryFile.size,
  };
}

function projectInfo(project: ModrinthProject) {
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    projectType: project.projectType,
  };
}

export function createArtifactInstallService(
  options: ArtifactInstallServiceOptions,
): ArtifactInstallService {
  const { db, config } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  function requireServer(serverId: string): Server {
    const server = getServer(db, serverId);
    if (!server) throw new ServerNotFoundError();
    return server;
  }

  async function installCore(
    serverId: string,
    input: InstallCoreInput,
    userId: string | null,
  ): Promise<{ server: Server; artifact: Artifact }> {
    const server = requireServer(serverId);
    const destination = path.join(serverDirectory(config, server), 'server.jar');
    await mkdir(path.dirname(destination), { recursive: true });
    const timestamp = now();

    let mcVersion: string | null = server.mcVersion;
    let sourceType: 'provider' | 'direct_url' = 'provider';
    let sourceUrl: string | null = null;
    let versionId: string | null = null;

    switch (input.coreType) {
      case 'vanilla': {
        await installVanillaServer(input.version, destination, fetchImpl);
        mcVersion = input.version;
        versionId = input.version;
        break;
      }
      case 'paper': {
        const result = await installPaperServer(input.version, input.build, destination, fetchImpl);
        mcVersion = input.version;
        versionId = String(result.build);
        break;
      }
      case 'fabric': {
        const result = await installFabricServer(
          input.mcVersion,
          input.loaderVersion,
          destination,
          fetchImpl,
        );
        mcVersion = input.mcVersion;
        versionId = result.loaderVersion;
        break;
      }
      case 'custom': {
        if (!input.downloadUrl) {
          throw new ArtifactInstallError('downloadUrl is required for custom cores');
        }
        await downloadJarFromUrl({
          url: input.downloadUrl,
          destinationDir: serverDirectory(config, server),
          filename: 'server.jar',
          fetchImpl,
        });
        sourceType = 'direct_url';
        sourceUrl = input.downloadUrl;
        break;
      }
    }

    const sha256 = await sha256File(destination);
    const updatedAt = timestamp.toISOString();
    db.update(servers)
      .set({ coreType: input.coreType, mcVersion, entrypointJar: 'server.jar', updatedAt })
      .where(eq(servers.id, serverId))
      .run();

    const artifact = recordArtifact(
      db,
      {
        serverId,
        kind: 'core',
        filename: 'server.jar',
        sourceType,
        sourceUrl,
        versionId,
        sha256,
      },
      timestamp,
    );

    recordAuditEvent(
      db,
      {
        action: 'core.installed',
        serverId,
        userId,
        details: { coreType: input.coreType, version: mcVersion, sha256 },
      },
      timestamp,
    );

    return { server: requireServer(serverId), artifact };
  }

  async function installArtifact(
    serverId: string,
    input: InstallArtifactInput,
    userId: string | null,
  ): Promise<InstallArtifactOutcome> {
    const server = requireServer(serverId);
    const destinationDir = artifactDirectory(config, server, input.kind);
    const timestamp = now();

    if (input.sourceType === 'direct_url') {
      if (!input.sourceUrl) throw new ArtifactInstallError('sourceUrl is required');
      const installed = await downloadJarFromUrl({
        url: input.sourceUrl,
        destinationDir,
        fetchImpl,
      });
      const artifact = recordInstalled(serverId, input.kind, 'direct_url', input.sourceUrl, installed, timestamp);
      recordInstallAudit(userId, serverId, input.kind, installed, null, timestamp);
      return { status: 'installed', artifact, dependencies: [] };
    }

    if (input.sourceType !== 'modrinth_page' || !input.modrinthUrl) {
      throw new ArtifactInstallError('modrinthUrl is required for Modrinth installs');
    }

    if (!server.mcVersion) {
      throw new ArtifactInstallError('Server has no Minecraft version; set one before installing');
    }

    const loaders = modrinthLoadersForCore(server.coreType);
    if (input.kind === 'plugin' && loaders.length === 0) {
      throw new ArtifactInstallError('This server core does not support plugins');
    }
    if (input.kind === 'mod' && !loaders.includes('fabric')) {
      throw new ArtifactInstallError('Only Fabric servers support mods right now');
    }

    const resolution = await resolveModrinthPage(input.modrinthUrl, {
      gameVersion: server.mcVersion,
      loaders,
      versionId: input.versionId,
      fetchImpl,
    });

    if (!resolution.version) {
      return {
        status: 'needs_selection',
        project: projectInfo(resolution.project),
        fallbackVersions: resolution.fallbackVersions.map(fallbackInfo),
      };
    }

    if (resolution.project.projectType !== input.kind) {
      throw new ArtifactInstallError(
        `Modrinth project is a ${resolution.project.projectType}, not a ${input.kind}`,
      );
    }

    const installed = await downloadJarFromUrl({
      url: resolution.version.primaryFile.url,
      destinationDir,
      filename: resolution.version.primaryFile.filename,
      fetchImpl,
    });
    if (installed.sizeBytes !== resolution.version.primaryFile.size) {
      throw new ArtifactInstallError('Downloaded Modrinth file size does not match metadata');
    }

    const artifact = recordInstalled(
      serverId,
      input.kind,
      'modrinth_page',
      input.modrinthUrl,
      installed,
      timestamp,
      {
        projectId: resolution.project.id,
        versionId: resolution.version.id,
      },
    );
    recordInstallAudit(userId, serverId, input.kind, installed, resolution.version.id, timestamp);

    const dependencies = await resolveRequiredDependencies(resolution.version, {
      gameVersion: server.mcVersion,
      loaders,
      fetchImpl,
    });

    const dependencyArtifacts: Artifact[] = [];
    for (const dependency of dependencies) {
      if (dependency.project.projectType !== input.kind) continue;
      const depInstalled = await downloadJarFromUrl({
        url: dependency.version.primaryFile.url,
        destinationDir,
        filename: dependency.version.primaryFile.filename,
        fetchImpl,
      });
      dependencyArtifacts.push(
        recordInstalled(
          serverId,
          input.kind,
          'modrinth_page',
          null,
          depInstalled,
          timestamp,
          { projectId: dependency.project.id, versionId: dependency.version.id },
        ),
      );
      recordInstallAudit(
        userId,
        serverId,
        input.kind,
        depInstalled,
        dependency.version.id,
        timestamp,
        true,
      );
    }

    return { status: 'installed', artifact, dependencies: dependencyArtifacts };
  }

  async function installUpload(
    serverId: string,
    input: UploadArtifactInput,
    userId: string | null,
  ): Promise<{ artifact: Artifact }> {
    const server = requireServer(serverId);
    const timestamp = now();

    const installed = await saveJarBuffer({
      data: input.data,
      filename: input.filename,
      destinationDir: artifactDirectory(config, server, input.kind),
    });

    if (input.kind === 'core') {
      db.update(servers)
        .set({ coreType: 'custom', entrypointJar: installed.filename, updatedAt: timestamp.toISOString() })
        .where(eq(servers.id, serverId))
        .run();
    }

    const artifact = recordInstalled(serverId, input.kind, 'upload', null, installed, timestamp);
    recordInstallAudit(userId, serverId, input.kind, installed, null, timestamp);
    return { artifact };
  }

  function recordInstalled(
    serverId: string,
    kind: ArtifactKind,
    sourceType: 'direct_url' | 'modrinth_page' | 'upload' | 'provider',
    sourceUrl: string | null,
    installed: InstalledJar,
    timestamp: Date,
    ids: { projectId?: string | null; versionId?: string | null } = {},
  ): Artifact {
    return recordArtifact(
      db,
      {
        serverId,
        kind,
        filename: installed.filename,
        sourceType,
        sourceUrl,
        projectId: ids.projectId ?? null,
        versionId: ids.versionId ?? null,
        sha256: installed.sha256,
      },
      timestamp,
    );
  }

  function recordInstallAudit(
    userId: string | null,
    serverId: string,
    kind: ArtifactKind,
    installed: InstalledJar,
    versionId: string | null,
    timestamp: Date,
    dependency = false,
  ): void {
    recordAuditEvent(
      db,
      {
        action: 'artifact.installed',
        serverId,
        userId,
        details: {
          kind,
          filename: installed.filename,
          sha256: installed.sha256,
          versionId,
          dependency,
        },
      },
      timestamp,
    );
  }

  async function remove(
    serverId: string,
    artifactId: string,
    userId: string | null,
  ): Promise<boolean> {
    const server = requireServer(serverId);
    const artifact = getArtifact(db, artifactId);
    if (!artifact || artifact.serverId !== serverId) return false;

    const filename = path.basename(artifact.filename);
    const filePath = path.join(artifactDirectory(config, server, artifact.kind), filename);
    await rm(filePath, { force: true });

    const removed = deleteArtifactRow(db, artifactId);
    if (removed) {
      recordAuditEvent(
        db,
        {
          action: 'artifact.removed',
          serverId,
          userId,
          details: { kind: artifact.kind, filename: artifact.filename },
        },
        now(),
      );
    }
    return removed;
  }

  return {
    installCore,
    installArtifact,
    installUpload,
    list: (serverId) => listArtifacts(db, serverId),
    remove,
  };
}
