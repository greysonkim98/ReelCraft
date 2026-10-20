import type { Role } from '@reelcraft/shared';

/** Navigation only; the API independently enforces access using the stored account role. */
export function canAccessAdminPage(role: Role | null, pathname: string): boolean {
  if (role === 'admin') return true;
  if (role !== 'support') return false;
  return (
    pathname === '/admin' ||
    ['/admin/users', '/admin/ips'].some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    )
  );
}
