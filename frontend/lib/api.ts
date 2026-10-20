import type {
  ApiErrorBody,
  GenerateScriptResponse,
  ScriptRequestInput,
  UsageInfo,
  NetworkActivityResponse,
  Role,
  Style,
} from '@reelcraft/shared';

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
    throw new ApiError(
      'Cannot reach the server. Check your connection and try again.',
      0,
      'NETWORK',
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      body?.error ?? `Request failed (${res.status})`,
      res.status,
      body?.code ?? 'UNKNOWN',
      body?.details,
    );
  }
  return (await res.json()) as T;
}

export const getHealth = () => request<{ ok: boolean; time: string }>('/health');

export const getUsage = (token: string) => request<UsageInfo>('/me/usage', { token });

export const getNetworkActivity = (token: string, day: string, cursor?: string) => {
  const params = new URLSearchParams({ day });
  if (cursor) params.set('cursor', cursor);
  return request<NetworkActivityResponse>(`/admin/ips?${params}`, { token, cache: 'no-store' });
};

export const verifyNetwork = (token: string, appCheckToken: string) =>
  request<{ expiresAt: string }>('/me/network-verification', {
    method: 'POST',
    token,
    headers: { 'X-Firebase-AppCheck': appCheckToken },
  });

/** scenes.json in, script JSON out. Costs one of the account's daily AI uses. */
export const generateScript = (token: string, body: ScriptRequestInput) =>
  request<GenerateScriptResponse>('/ai/script', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });

/** Creates the profile on first sign-in (users/{uid}) and returns the saved role and style. */
export const startSession = (token: string) =>
  request<{ email?: string; role?: Role; style?: Style }>('/me/session', { method: 'POST', token });
