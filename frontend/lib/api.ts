import type { ApiErrorBody, GenerateScriptResponse, ScriptRequestInput, UsageInfo } from '@reelcraft/shared';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...rest.headers,
      },
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0, 'NETWORK');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status, body?.code ?? 'UNKNOWN', body?.details);
  }
  return (await res.json()) as T;
}

export const getHealth = () => request<{ ok: boolean; time: string }>('/health');

export const getUsage = (token: string) => request<UsageInfo>('/me/usage', { token });

/** scenes.json in, script JSON out. Costs one of the account's daily AI uses. */
export const generateScript = (token: string, body: ScriptRequestInput) =>
  request<GenerateScriptResponse>('/ai/script', { method: 'POST', token, body: JSON.stringify(body) });
