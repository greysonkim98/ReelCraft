import { z } from 'zod';
import type { NetworkInfo } from '@reelcraft/shared';
import { hashIp, isPublicIp, normalizeIp } from '../lib/ip';

export const IPINFO_CACHE_MS = 24 * 60 * 60 * 1000;
export interface IpInfoCacheEntry {
  info: NetworkInfo;
  expiresAt: number;
}
export interface IpInfoCache {
  get(hash: string): Promise<IpInfoCacheEntry | null>;
  set(hash: string, entry: IpInfoCacheEntry): Promise<void>;
}
export interface IpInfoResult {
  ipHash: string | null;
  info: NetworkInfo;
  status: 'ok' | 'unavailable' | 'private' | 'disabled';
}
export interface IpInfoService {
  lookup(ip: string | undefined): Promise<IpInfoResult>;
}
export const unknownNetwork: NetworkInfo = {
  country: null,
  countryCode: null,
  asn: null,
  asName: null,
  asDomain: null,
};
const optionalText = z.string().trim().min(1).max(200).nullish();
const responseSchema = z.object({
  ip: z.string(),
  country: optionalText,
  country_code: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullish(),
  asn: z
    .string()
    .regex(/^AS\d+$/)
    .nullish(),
  as_name: optionalText,
  as_domain: optionalText,
});

export function createIpInfoService({
  token,
  salt,
  cache,
  fetchFn = fetch,
  now = Date.now,
  timeoutMs = 2500,
}: {
  token?: string;
  salt?: string;
  cache: IpInfoCache;
  fetchFn?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}): IpInfoService {
  // Coalesce simultaneous misses; retain only hashes, never raw IPs, as cache keys.
  const pending = new Map<string, Promise<IpInfoResult>>();
  let retryAfter = 0;
  return {
    async lookup(rawIp) {
      const ip = normalizeIp(rawIp);
      const ipHash = ip && salt ? hashIp(ip, salt) : null;
      const result = (status: IpInfoResult['status'], info = unknownNetwork): IpInfoResult => ({
        ipHash,
        info,
        status,
      });
      if (!token || !salt) return result('disabled');
      if (!ip || !isPublicIp(ip)) return result('private');
      const key = ipHash!;
      const existing = pending.get(key);
      if (existing) return existing;
      const work = async (): Promise<IpInfoResult> => {
        const cached = await cache.get(key).catch(() => null);
        if (cached && cached.expiresAt > now()) return result('ok', cached.info);
        if (now() < retryAfter) return result('unavailable');
        try {
          const response = await fetchFn(`https://api.ipinfo.io/lite/${encodeURIComponent(ip)}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
            redirect: 'error',
          });
          if (!response.ok) throw new Error('IPinfo unavailable');
          const data = responseSchema.parse(await response.json());
          if (normalizeIp(data.ip) !== ip || (!data.country_code && !data.asn))
            throw new Error('Invalid IPinfo result');
          // Deliberate allowlist: the provider's raw IP and any extra fields never reach storage.
          const info: NetworkInfo = {
            country: data.country ?? null,
            countryCode: data.country_code ?? null,
            asn: data.asn ?? null,
            asName: data.as_name ?? null,
            asDomain: data.as_domain ?? null,
          };
          await cache.set(key, { info, expiresAt: now() + IPINFO_CACHE_MS }).catch(() => undefined);
          return result('ok', info);
        } catch {
          // Short circuit outages/429s without caching unknown data for a whole day.
          retryAfter = now() + 30_000;
          return result('unavailable');
        }
      };
      const task = work();
      pending.set(key, task);
      try {
        return await task;
      } finally {
        pending.delete(key);
      }
    },
  };
}
