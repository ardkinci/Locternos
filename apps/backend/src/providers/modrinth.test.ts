import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ModrinthError,
  modrinthLoadersForCore,
  parseModrinthUrl,
  resolveModrinthPage,
  resolveRequiredDependencies,
  type ModrinthVersion,
} from './modrinth.js';

const API = 'https://api.modrinth.com/v2';

const LITHIUM = {
  id: 'P1',
  slug: 'lithium',
  title: 'Lithium',
  project_type: 'mod',
  description: 'Optimization mod',
};
const FABRIC_API = {
  id: 'P2',
  slug: 'fabric-api',
  title: 'Fabric API',
  project_type: 'mod',
  description: 'Required library',
};

function file(name: string) {
  return {
    url: `https://cdn.modrinth.com/${name}`,
    filename: name,
    size: 1234,
    sha1: 'a'.repeat(40),
    sha512: 'b'.repeat(128),
    primary: true,
  };
}

function version(overrides: Record<string, unknown>) {
  return {
    id: 'V1',
    project_id: 'P1',
    name: 'Lithium 1.0',
    version_number: '1.0',
    game_versions: ['1.21.4'],
    loaders: ['fabric'],
    files: [file('lithium-1.0.jar')],
    dependencies: [],
    ...overrides,
  };
}

const LITHIUM_VERSION = version({
  dependencies: [
    { dependency_type: 'required', project_id: 'P2', version_id: null, file_name: null },
    { dependency_type: 'optional', project_id: 'P3', version_id: null, file_name: null },
  ],
});
const FABRIC_API_VERSION = version({
  id: 'V2',
  project_id: 'P2',
  name: 'Fabric API 0.1',
  version_number: '0.1',
  files: [file('fabric-api-0.1.jar')],
  dependencies: [],
});
const OLD_VERSION = version({
  id: 'V3',
  name: 'Lithium 0.9',
  version_number: '0.9',
  loaders: ['forge'],
});

const PARSED_LITHIUM: ModrinthVersion = {
  id: 'V1',
  projectId: 'P1',
  name: 'Lithium 1.0',
  versionNumber: '1.0',
  gameVersions: ['1.21.4'],
  loaders: ['fabric'],
  primaryFile: {
    url: 'https://cdn.modrinth.com/lithium-1.0.jar',
    filename: 'lithium-1.0.jar',
    size: 1234,
    sha1: 'a'.repeat(40),
    sha512: 'b'.repeat(128),
  },
  dependencies: [
    { dependencyType: 'required', projectId: 'P2', versionId: null, fileName: null },
    { dependencyType: 'optional', projectId: 'P3', versionId: null, fileName: null },
  ],
};

interface Route {
  path: string;
  body: unknown;
}

function fakeFetch(routes: Route[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const route = routes.find((entry) => entry.path === url.pathname);
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route.body), { status: 200 });
  }) as unknown as typeof fetch;
}

function defaultRoutes(): Route[] {
  return [
    { path: `${new URL(API).pathname}/project/lithium`, body: LITHIUM },
    { path: `${new URL(API).pathname}/project/P1`, body: LITHIUM },
    { path: `${new URL(API).pathname}/project/P2`, body: FABRIC_API },
    { path: `${new URL(API).pathname}/version/V1`, body: LITHIUM_VERSION },
    { path: `${new URL(API).pathname}/version/V2`, body: FABRIC_API_VERSION },
  ];
}

/** Projects return matching versions based on the loader filter in the query. */
function versionAwareFetch(): typeof fetch {
  const routes = defaultRoutes();
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/version') && url.pathname.includes('/project/')) {
      const loaders = JSON.parse(url.searchParams.get('loaders') ?? '[]') as string[];
      if (url.pathname.includes('/P2')) {
        return new Response(JSON.stringify([FABRIC_API_VERSION]), { status: 200 });
      }
      if (loaders.length === 0) {
        return new Response(JSON.stringify([LITHIUM_VERSION, OLD_VERSION]), { status: 200 });
      }
      if (loaders.includes('fabric')) {
        return new Response(JSON.stringify([LITHIUM_VERSION]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }
    const route = routes.find((entry) => entry.path === url.pathname);
    if (!route) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(route.body), { status: 200 });
  }) as unknown as typeof fetch;
}

describe('modrinth resolver', () => {
  it('parses supported Modrinth page URLs', () => {
    assert.deepEqual(parseModrinthUrl('https://modrinth.com/mod/lithium'), {
      projectType: 'mod',
      slug: 'lithium',
      versionId: null,
    });
    assert.deepEqual(parseModrinthUrl('https://www.modrinth.com/plugin/essentialsx/version/abc123'), {
      projectType: 'plugin',
      slug: 'essentialsx',
      versionId: 'abc123',
    });
    assert.equal(parseModrinthUrl('https://modrinth.com/datapack/foo')?.projectType, 'datapack');
  });

  it('rejects other hosts and malformed paths', () => {
    assert.equal(parseModrinthUrl('https://example.com/mod/lithium'), null);
    assert.equal(parseModrinthUrl('https://modrinth.com/user/lithium'), null);
    assert.equal(parseModrinthUrl('https://modrinth.com/mod/lithium/version'), null);
    assert.equal(parseModrinthUrl('not a url'), null);
  });

  it('picks the newest exact version for game version and loader', async () => {
    const resolution = await resolveModrinthPage('https://modrinth.com/mod/lithium', {
      gameVersion: '1.21.4',
      loaders: ['fabric'],
      fetchImpl: versionAwareFetch(),
    });

    assert.equal(resolution.exactMatch, true);
    assert.equal(resolution.version?.id, 'V1');
    assert.equal(resolution.version?.primaryFile.filename, 'lithium-1.0.jar');
    assert.deepEqual(resolution.fallbackVersions, []);
  });

  it('offers fallback versions when no loader match exists', async () => {
    const resolution = await resolveModrinthPage('https://modrinth.com/mod/lithium', {
      gameVersion: '1.21.4',
      loaders: ['forge'],
      fetchImpl: versionAwareFetch(),
    });

    assert.equal(resolution.exactMatch, false);
    assert.equal(resolution.version, null);
    assert.deepEqual(
      resolution.fallbackVersions.map((entry) => entry.id),
      ['V1', 'V3'],
    );
  });

  it('resolves required dependencies transitively but ignores optional ones', async () => {
    const dependencies = await resolveRequiredDependencies(PARSED_LITHIUM, {
      gameVersion: '1.21.4',
      loaders: ['fabric'],
      fetchImpl: versionAwareFetch(),
    });

    assert.equal(dependencies.length, 1);
    assert.equal(dependencies[0]?.project.title, 'Fabric API');
    assert.equal(dependencies[0]?.version.id, 'V2');
  });

  it('fails when a required dependency has no compatible build', async () => {
    await assert.rejects(
      resolveRequiredDependencies(PARSED_LITHIUM, {
        gameVersion: '1.21.4',
        loaders: ['quilt'],
        fetchImpl: fakeFetch(defaultRoutes()),
      }),
      ModrinthError,
    );
  });

  it('maps server cores to Modrinth loader filters', () => {
    assert.deepEqual(modrinthLoadersForCore('paper'), ['paper', 'spigot', 'bukkit']);
    assert.deepEqual(modrinthLoadersForCore('fabric'), ['fabric']);
    assert.deepEqual(modrinthLoadersForCore('vanilla'), []);
  });
});
