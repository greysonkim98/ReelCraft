import { describe, expect, it, vi } from 'vitest';
import { hashIp, isPublicIp, normalizeIp } from '../src/lib/ip';
import { createIpInfoService, IPINFO_CACHE_MS, unknownNetwork } from '../src/services/ipinfo';
import { createMemoryNetworkStore } from '../src/services/networks';

const payload = {
  ip: '8.8.8.8',
  country: 'United States',
  country_code: 'US',
  asn: 'AS15169',
  as_name: 'Google LLC',
  as_domain: 'google.com',
  continent: 'North America',
};
const json = (body: unknown = payload) => new Response(JSON.stringify(body));

describe('client IP handling', () => {
  it('canonicalizes IPv6 and mapped IPv4 into stable hashes', () => {
    expect(normalizeIp('::ffff:8.8.8.8')).toBe('8.8.8.8');
    expect(normalizeIp('::ffff:0808:0808')).toBe('8.8.8.8');
    expect(normalizeIp('2001:4860:4860:0000:0000:0000:0000:8888')).toBe('2001:4860:4860::8888');
    expect(hashIp('8.8.8.8', 'salt')).not.toBe(hashIp('8.8.8.8', 'other-salt'));
  });
  it.each(['localhost', '8.8.8.8/path', '8.8.8.8, 1.1.1.1', 'fe80::1%eth0', '999.8.8.8'])(
    'rejects invalid IP %s',
    (ip) => {
      expect(normalizeIp(ip)).toBeNull();
    },
  );
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '3fff::1',
  ])('does not look up reserved IP %s', (ip) => {
    expect(isPublicIp(normalizeIp(ip)!)).toBe(false);
  });
  it.each(['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888'])('accepts public IP %s', (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });
});

describe('IPinfo Lite', () => {
  function setup(fetchFn = vi.fn<typeof fetch>().mockImplementation(async () => json())) {
    const store = createMemoryNetworkStore();
    let now = 1_000_000;
    const service = createIpInfoService({
      token: 'secret-token',
      salt: 'salt',
      cache: store.cache,
      fetchFn,
      now: () => now,
      timeoutMs: 10,
    });
    return {
      service,
      store,
      fetchFn,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it('uses the Lite endpoint and header token, retaining only allowed fields for 24 hours', async () => {
    const { service, store, fetchFn, advance } = setup();
    const result = await service.lookup('::ffff:8.8.8.8');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.ipinfo.io/lite/8.8.8.8',
      expect.objectContaining({
        headers: { Authorization: 'Bearer secret-token', Accept: 'application/json' },
        redirect: 'error',
      }),
    );
    expect(result).toMatchObject({
      status: 'ok',
      info: { country: 'United States', countryCode: 'US', asn: 'AS15169', asName: 'Google LLC' },
    });
    const stored = await store.cache.get(result.ipHash!);
    expect(JSON.stringify(stored)).not.toMatch(/8\.8\.8\.8|secret-token|continent/);
    advance(IPINFO_CACHE_MS - 1);
    await service.lookup('8.8.8.8');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    advance(1);
    await service.lookup('8.8.8.8');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous lookups', async () => {
    const { service, fetchFn } = setup();
    const results = await Promise.all(Array.from({ length: 10 }, () => service.lookup('8.8.8.8')));
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('supports country-only responses and public IPv6', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ ip: '2001:4860:4860::8888', country_code: 'US' }));
    const result = await setup(fetchFn).service.lookup('2001:4860:4860:0:0:0:0:8888');
    expect(result).toMatchObject({
      status: 'ok',
      info: { countryCode: 'US', asn: null, asName: null },
    });
    expect(fetchFn.mock.calls[0]![0]).toBe(
      'https://api.ipinfo.io/lite/2001%3A4860%3A4860%3A%3A8888',
    );
  });

  it('skips private and invalid IPs and remains disabled without credentials', async () => {
    const { service, fetchFn, store } = setup();
    for (const ip of ['127.0.0.1', '::ffff:192.168.1.1', 'garbage', undefined]) {
      expect((await service.lookup(ip)).status).toBe('private');
    }
    const disabled = createIpInfoService({ cache: store.cache, fetchFn });
    expect((await disabled.lookup('8.8.8.8')).status).toBe('disabled');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 500])(
    'degrades gracefully on HTTP %s, backing off briefly then retrying',
    async (status) => {
      const fetchFn = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('{}', { status }))
        .mockImplementation(async () => json());
      const { service, store, advance } = setup(fetchFn);
      const result = await service.lookup('8.8.8.8');
      expect(result).toMatchObject({ status: 'unavailable', info: unknownNetwork });
      expect(await store.cache.get(result.ipHash!)).toBeNull();
      await service.lookup('8.8.8.8');
      expect(fetchFn).toHaveBeenCalledTimes(1);
      advance(30_000);
      expect((await service.lookup('8.8.8.8')).status).toBe('ok');
    },
  );

  it.each([
    {},
    { ...payload, ip: '1.1.1.1' },
    { ...payload, asn: {} },
    { ip: '8.8.8.8', bogon: true },
  ])('rejects malformed or mismatched data', async (body) => {
    const { service } = setup(vi.fn<typeof fetch>().mockResolvedValue(json(body)));
    expect((await service.lookup('8.8.8.8')).status).toBe('unavailable');
  });

  it('handles invalid JSON and connection errors without exposing their contents', async () => {
    for (const fetchFn of [
      vi.fn<typeof fetch>().mockResolvedValue(new Response('not JSON')),
      vi.fn<typeof fetch>().mockRejectedValue(new Error('secret-token 8.8.8.8')),
    ]) {
      const result = await setup(fetchFn).service.lookup('8.8.8.8');
      expect(result.status).toBe('unavailable');
      expect(JSON.stringify(result)).not.toMatch(/secret-token|8\.8\.8\.8/);
    }
  });

  it('aborts stalled requests', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => reject(new Error('timeout')), {
            once: true,
          });
        }),
    );
    expect((await setup(fetchFn).service.lookup('8.8.8.8')).status).toBe('unavailable');
  });

  it('still returns enrichment if cache storage is temporarily unavailable', async () => {
    const cache = {
      get: vi.fn().mockRejectedValue(new Error('offline')),
      set: vi.fn().mockRejectedValue(new Error('offline')),
    };
    const service = createIpInfoService({
      token: 'token',
      salt: 'salt',
      cache,
      fetchFn: vi.fn().mockResolvedValue(json()),
    });
    expect((await service.lookup('8.8.8.8')).status).toBe('ok');
  });
});
