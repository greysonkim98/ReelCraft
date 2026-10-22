'use client';
import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { canAccessAdminPage } from '@/lib/admin-access';

/**
 * Support can inspect users and network activity; settings and audit remain admin-only.
 * This UI guard never replaces the API's independent role check.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { user, role, loading, sessionError } = useAuth();
  const path = usePathname();
  const allowed = !!user && canAccessAdminPage(role, path);

  useEffect(() => {
    if (loading) return;
    if (!user) window.location.replace('/login');
    else if (role && !allowed && !sessionError)
      window.location.replace(role === 'support' ? '/admin/ips' : '/projects');
  }, [loading, user, role, allowed, sessionError]);

  if (sessionError)
    return (
      <div className="empty-state">
        <h2>Access unavailable</h2>
        <p role="alert">{sessionError}</p>
        <a href="/login">Return to sign-in</a>
      </div>
    );

  if (!allowed)
    return (
      <div className="empty-state">
        <span className="loading-ring" />
        <h2>Checking your access…</h2>
        <p>Checking your account permissions for this page.</p>
      </div>
    );
  return <>{children}</>;
}
