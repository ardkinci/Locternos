import { healthResponseSchema, type HealthResponse } from '@locternos/shared';
import type { ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return schema.parse(await res.json());
}

export const api = {
  health: (): Promise<HealthResponse> => request('/health', healthResponseSchema),
};
