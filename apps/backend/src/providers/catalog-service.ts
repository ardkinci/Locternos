import type {
  FabricVersionsResponse,
  PaperBuild,
  PaperBuildsResponse,
  PaperVersionsResponse,
  VanillaVersion,
  VanillaVersionsResponse,
} from '@locternos/shared';
import {
  fetchFabricGameVersions,
  fetchFabricLoaderVersions,
} from '../providers/fabric.js';
import { fetchPaperBuilds, fetchPaperVersions } from '../providers/paper.js';
import { fetchVanillaVersions } from '../providers/vanilla.js';

export interface ProviderCatalogService {
  vanillaVersions(): Promise<VanillaVersionsResponse>;
  paperVersions(): Promise<PaperVersionsResponse>;
  paperBuilds(version: string): Promise<PaperBuildsResponse>;
  fabricVersions(): Promise<FabricVersionsResponse>;
}

export interface ProviderCatalogServiceOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Exposes the provider catalogs the create-server wizard needs. The catalog
 * calls are read-only, so they are not cached: the wizard always reflects the
 * versions that are currently published.
 */
export function createProviderCatalogService(
  options: ProviderCatalogServiceOptions = {},
): ProviderCatalogService {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async vanillaVersions(): Promise<VanillaVersionsResponse> {
      const versions: VanillaVersion[] = (await fetchVanillaVersions(fetchImpl)).map(
        (version) => ({ id: version.id, type: version.type }),
      );
      return { versions };
    },

    async paperVersions(): Promise<PaperVersionsResponse> {
      return { versions: await fetchPaperVersions(fetchImpl) };
    },

    async paperBuilds(version: string): Promise<PaperBuildsResponse> {
      const builds: PaperBuild[] = await fetchPaperBuilds(version, fetchImpl);
      return { builds };
    },

    async fabricVersions(): Promise<FabricVersionsResponse> {
      const [gameVersions, loaderVersions] = await Promise.all([
        fetchFabricGameVersions(fetchImpl),
        fetchFabricLoaderVersions(fetchImpl),
      ]);
      return { gameVersions, loaderVersions };
    },
  };
}
