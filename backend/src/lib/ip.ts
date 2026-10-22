import { createHash } from 'node:crypto';
import { BlockList, isIP } from 'node:net';

/** Canonicalize IPv6 and IPv4-mapped IPv6 before hashing or looking up an address. */
export function normalizeIp(value: string | undefined): string | null {
  if (!value || !isIP(value) || value.includes('%')) return null;
  if (isIP(value) === 4) return value;
  const ip = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(ip);
  if (!mapped) return ip;
  const high = parseInt(mapped[1]!, 16);
  const low = parseInt(mapped[2]!, 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

const reserved = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  reserved.addSubnet(address, prefix, 'ipv4');
reserved.addSubnet('2001:db8::', 32, 'ipv6');
reserved.addSubnet('2001::', 23, 'ipv6');
reserved.addSubnet('2002::', 16, 'ipv6');
reserved.addSubnet('3fff::', 20, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicIp(ip: string): boolean {
  const version = isIP(ip);
  return version === 4
    ? !reserved.check(ip, 'ipv4')
    : version === 6 && globalV6.check(ip, 'ipv6') && !reserved.check(ip, 'ipv6');
}

export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32);
}
