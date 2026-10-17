import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { AdminPreviewProvider } from '@/components/AdminPreview';
export default function StudioLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider mode="session">
      <AdminPreviewProvider>
        <AppShell>{children}</AppShell>
      </AdminPreviewProvider>
    </AuthProvider>
  );
}
