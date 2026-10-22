import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider mode="session">
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
