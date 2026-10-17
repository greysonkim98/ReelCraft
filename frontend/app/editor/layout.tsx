import type { ReactNode } from 'react';
import { AuthGate } from '@/components/AuthGate';
import { AppShell } from '@/components/AppShell';
import { EditorWizard } from '@/components/EditorWizard';
import { AuthProvider } from '@/lib/auth';
export const metadata = { title: 'Reel editor · ReelCraft' };
// A shared layout retains the selected Files and edit state across step routes.
// Enter and leave /editor with ordinary anchors to preserve document isolation.
export default function EditorLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider mode="session">
      <AppShell>
        <AuthGate>
          <EditorWizard />
          {children}
        </AuthGate>
      </AppShell>
    </AuthProvider>
  );
}
