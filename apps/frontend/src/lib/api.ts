import {
  acceptEulaResponseSchema,
  artifactListResponseSchema,
  auditEventListResponseSchema,
  createServerInputSchema,
  fabricVersionsResponseSchema,
  healthResponseSchema,
  installArtifactOutcomeSchema,
  installCoreResponseSchema,
  installJavaRuntimeResponseSchema,
  javaRuntimeListResponseSchema,
  javaVersionRequirementSchema,
  logFileListResponseSchema,
  paperBuildsResponseSchema,
  paperVersionsResponseSchema,
  serverConsoleResponseSchema,
  serverListResponseSchema,
  serverLogListResponseSchema,
  serverResponseSchema,
  serverRunListResponseSchema,
  serverRuntimeResponseSchema,
  sessionResponseSchema,
  setArtifactEnabledResponseSchema,
  setupStatusSchema,
  updateServerInputSchema,
  vanillaVersionsResponseSchema,
  type AcceptEulaInput,
  type Artifact,
  type CreateServerInput,
  type HealthResponse,
  type InstallArtifactInput,
  type InstallCoreInput,
  type InstallCoreResponse,
  type InstallArtifactOutcome,
  type JavaVersionRequirement,
  type LogSearchQuery,
  type LoginRequest,
  type SendConsoleCommandInput,
  type SetupRequest,
  type SetupStatus,
  type StopServerInput,
  type UpdateServerInput,
} from '@locternos/shared';

/** Anything with a `parse` method, so the client does not import zod directly. */
interface Parser<T> {
  parse(input: unknown): T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Machine readable failure reason, for example `eula_required`. */
    public code?: string,
  ) {
    super(message);
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // Non-JSON error body; fall through to the status text.
  }
  return res.statusText || `HTTP ${res.status}`;
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown };
    if (typeof body.code === 'string') return body.code;
  } catch {
    // No machine readable code available.
  }
  return undefined;
}

async function request<T>(path: string, schema: Parser<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...jsonHeaders(init), ...init?.headers },
  });
  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res), await errorCode(res));
  }
  return schema.parse(await res.json());
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { ...jsonHeaders(init), ...init?.headers },
  });
  if (!res.ok) {
    throw new ApiError(res.status, await errorMessage(res), await errorCode(res));
  }
}

function jsonHeaders(init?: RequestInit): Record<string, string> {
  return init?.body === undefined ? {} : { 'Content-Type': 'application/json' };
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
});

const patch = (body: unknown): RequestInit => ({
  method: 'PATCH',
  body: JSON.stringify(body),
});

const del: RequestInit = { method: 'DELETE' };

function queryString(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

export const api = {
  health: (): Promise<HealthResponse> => request('/health', healthResponseSchema),
  setupStatus: (): Promise<SetupStatus> => request('/setup/status', setupStatusSchema),
  setup: (input: SetupRequest) => request('/setup', sessionResponseSchema, post(input)),
  login: (input: LoginRequest) => request('/auth/login', sessionResponseSchema, post(input)),
  /** Resolves to the signed-in user, or rejects with ApiError(401). */
  me: () => request('/auth/me', sessionResponseSchema),
  logout: async (): Promise<void> => {
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
  },

  listServers: () => request('/servers', serverListResponseSchema),
  getServer: (id: string) => request(`/servers/${id}`, serverResponseSchema),
  createServer: (input: CreateServerInput) =>
    request('/servers', serverResponseSchema, post(createServerInputSchema.parse(input))),
  updateServer: (id: string, input: UpdateServerInput) =>
    request(`/servers/${id}`, serverResponseSchema, patch(updateServerInputSchema.parse(input))),
  deleteServer: (id: string) => requestVoid(`/servers/${id}`, del),

  getRuntime: (id: string) => request(`/servers/${id}/runtime`, serverRuntimeResponseSchema),
  getConsole: (id: string) => request(`/servers/${id}/console`, serverConsoleResponseSchema),
  startServer: (id: string) => request(`/servers/${id}/start`, serverRuntimeResponseSchema, post()),
  stopServer: (id: string, input: StopServerInput = {}) =>
    request(`/servers/${id}/stop`, serverRuntimeResponseSchema, post(input)),
  killServer: (id: string) => request(`/servers/${id}/kill`, serverRuntimeResponseSchema, post()),
  restartServer: (id: string, input: StopServerInput = {}) =>
    request(`/servers/${id}/restart`, serverRuntimeResponseSchema, post(input)),
  sendCommand: (id: string, input: SendConsoleCommandInput) =>
    requestVoid(`/servers/${id}/command`, post(input)),
  acceptEula: (id: string, input: AcceptEulaInput) =>
    request(`/servers/${id}/eula`, acceptEulaResponseSchema, post(input)),

  listArtifacts: (id: string) => request(`/servers/${id}/artifacts`, artifactListResponseSchema),
  installCore: (id: string, input: InstallCoreInput): Promise<InstallCoreResponse> =>
    request(`/servers/${id}/core`, installCoreResponseSchema, post(input)),
  installArtifact: (id: string, input: InstallArtifactInput): Promise<InstallArtifactOutcome> =>
    request(`/servers/${id}/artifacts`, installArtifactOutcomeSchema, post(input)),
  uploadArtifact: async (id: string, kind: string, file: File): Promise<{ artifact: Artifact }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/servers/${id}/artifacts/upload?kind=${kind}`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      throw new ApiError(res.status, await errorMessage(res), await errorCode(res));
    }
    const body = (await res.json()) as { artifact: Artifact };
    return body;
  },
  removeArtifact: (id: string, artifactId: string) =>
    requestVoid(`/servers/${id}/artifacts/${artifactId}`, del),
  setArtifactEnabled: (id: string, artifactId: string, enabled: boolean) =>
    request(
      `/servers/${id}/artifacts/${artifactId}`,
      setArtifactEnabledResponseSchema,
      patch({ enabled }),
    ),

  listJavaRuntimes: () => request('/java/runtimes', javaRuntimeListResponseSchema),
  javaRequirement: (mcVersion: string): Promise<JavaVersionRequirement> =>
    request(`/java/requirement${queryString({ mcVersion })}`, javaVersionRequirementSchema),
  installJavaRuntime: (featureVersion: number, imageType: 'jdk' | 'jre' = 'jdk') =>
    request(
      '/java/runtimes/install',
      installJavaRuntimeResponseSchema,
      post({ featureVersion, imageType }),
    ),

  vanillaVersions: () => request('/providers/vanilla/versions', vanillaVersionsResponseSchema),
  paperVersions: () => request('/providers/paper/versions', paperVersionsResponseSchema),
  paperBuilds: (version: string) =>
    request(`/providers/paper/builds${queryString({ version })}`, paperBuildsResponseSchema),
  fabricVersions: () => request('/providers/fabric/versions', fabricVersionsResponseSchema),

  listRuns: (id: string) => request(`/servers/${id}/runs`, serverRunListResponseSchema),
  listLogs: (id: string, query: LogSearchQuery = {}) =>
    request(
      `/servers/${id}/logs${queryString({
        query: query.query,
        runId: query.runId,
        level: query.level,
        limit: query.limit,
      })}`,
      serverLogListResponseSchema,
    ),
  listAuditEvents: (id: string) => request(`/servers/${id}/audit`, auditEventListResponseSchema),
  listLogFiles: (id: string) => request(`/servers/${id}/logs/files`, logFileListResponseSchema),
  logFileUrl: (id: string, name: string) =>
    `/api/servers/${id}/logs/files/${encodeURIComponent(name)}`,
};
