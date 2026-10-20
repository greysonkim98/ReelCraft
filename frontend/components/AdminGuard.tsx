'use client';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth';

/**
 * The management console is for admins only. The role comes from the server (users/{uid}.role, set
 * by hand in the Firebase console), so this hides the screens and routes people away; any real
 * admin API must still check the role on the server.
 */
export function AdminGuard({ children }: { children: ReactNode }) {
  const { user, role, loading } = useAuth();
  const allowed = !!user && role === 'admin';

  useEffect(() => {
    if (loading) return;
    if (!user) window.location.replace('/login');
    else if (role && role !== 'admin') window.location.replace('/projects');
  }, [loading, user, role]);

  if (!allowed)
    return (
      <div className="empty-state">
        <span className="loading-ring" />
        <h2>Checking your access…</h2>
        <p>The console is available to administrators.</p>
      </div>
    );
  return <>{children}</>;
}
