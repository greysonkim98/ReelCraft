import type {
  ApiErrorBody,
  GenerateScriptResponse,
  ScriptRequestInput,
  UsageInfo,
  NetworkActivityResponse,
  Role,
  Style,
  AdminUser,
  AdminPage,
  AuditEntry,
  RuntimeSettings,
  RuntimeLimits,
  UserAction,
  NetworkAction,
  NetworkRestriction,
  NetworkDetails,
  AdminOverview,
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

export const getRuntimeSettings = (token: string) =>
  request<RuntimeSettings>('/config', { token, cache: 'no-store' });
export const getAdminOverview = (token: string) =>
  request<AdminOverview>('/admin/overview', { token, cache: 'no-store' });
export const getAdminUsers = (token: string, search = '', status = '', cursor?: string) => {
  const params = new URLSearchParams({ search, status });
  if (cursor) params.set('cursor', cursor);
  return request<AdminPage<AdminUser>>(`/admin/users?${params}`, { token, cache: 'no-store' });
};
export const changeAdminUser = (token: string, uid: string, action: UserAction) =>
  request<AdminUser>(`/admin/users/${encodeURIComponent(uid)}/actions`, {
    token,
    method: 'POST',
    body: JSON.stringify(action),
  });
export const getAdminSettings = (token: string) =>
  request<RuntimeSettings>('/admin/settings', { token, cache: 'no-store' });
export const saveAdminSettings = (
  token: string,
  limits: RuntimeLimits,
  version: number,
  reason: string,
) =>
  request<RuntimeSettings>('/admin/settings', {
    token,
    method: 'PUT',
    body: JSON.stringify({ limits, version, reason }),
  });
export const getAdminAudit = (token: string, cursor?: string) =>
  request<AdminPage<AuditEntry>>(
    `/admin/audit${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    { token, cache: 'no-store' },
  );
export const getNetworkDetails = (token: string, hash: string, day: string, cursor?: string) => {
  const query = new URLSearchParams({ day });
  if (cursor) query.set('cursor', cursor);
  return request<NetworkDetails>(`/admin/ips/${encodeURIComponent(hash)}?${query}`, {
    token,
    cache: 'no-store',
  });
};
export const changeNetworkRestriction = (token: string, hash: string, action: NetworkAction) =>
  request<NetworkRestriction>(`/admin/ips/${encodeURIComponent(hash)}/restriction`, {
    token,
    method: 'PUT',
    body: JSON.stringify(action),
  });
