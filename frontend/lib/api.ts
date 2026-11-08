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

/** scenes.json (plus a few labeled grid images) in, script JSON out: ONE Groq call, one daily AI use. */
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

export const searchMusic = (token: string, term: string) =>
  request<{ tracks: import('@reelcraft/shared').MusicTrack[]; collectionFallback?: boolean }>(
    `/music/search?${new URLSearchParams({ term })}`,
    { token },
  );
export const musicLink = (token: string, id: string, action: 'preview' | 'download') =>
  request<{ url: string; expires: string }>(`/music/${encodeURIComponent(id)}/${action}`, {
    token,
    method: 'POST',
  });
export const reportMusicExport = (token: string, id: string) =>
  request(`/music/${encodeURIComponent(id)}/export`, { token, method: 'POST' });
export async function saveMusicPreference(
  token: string,
  id: string,
  music: import('@reelcraft/shared').MusicPreference,
) {
  const res = await fetch(`${API_URL}/api/v1/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ music }),
  });
  if (!res.ok)
    throw new Error('Music preference could not be saved. Your current edit is still available.');
}
