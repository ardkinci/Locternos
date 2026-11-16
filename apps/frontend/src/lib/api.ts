import {
  healthResponseSchema,
  sessionResponseSchema,
  setupStatusSchema,
  type HealthResponse,
  type LoginRequest,
  type SessionResponse,
  type SetupRequest,
  type SetupStatus,
} from '@locternos/shared';

/** Anything with a `parse` method, so the client does not import zod directly. */
interface Parser<T> {
  parse(input: unknown): T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
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

async function request<T>(path: string, schema: Parser<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return schema.parse(await res.json());
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
});

export const api = {
  health: (): Promise<HealthResponse> => request('/health', healthResponseSchema),
  setupStatus: (): Promise<SetupStatus> => request('/setup/status', setupStatusSchema),
  setup: (input: SetupRequest): Promise<SessionResponse> =>
    request('/setup', sessionResponseSchema, post(input)),
  login: (input: LoginRequest): Promise<SessionResponse> =>
    request('/auth/login', sessionResponseSchema, post(input)),
  /** Resolves to the signed-in user, or rejects with ApiError(401). */
  me: (): Promise<SessionResponse> => request('/auth/me', sessionResponseSchema),
  logout: async (): Promise<void> => {
    const res = await fetch('/api/auth/logout', { method: 'POST' });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
  },
};
