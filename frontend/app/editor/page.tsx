import { AuthGate } from '@/components/AuthGate';
import { EditorWizard } from '@/components/EditorWizard';
import { AuthProvider } from '@/lib/auth';

export default function EditorPage() {
  return (
    <AuthProvider mode="session">
      <AuthGate>
        <EditorWizard />
      </AuthGate>
    </AuthProvider>
  );
}
