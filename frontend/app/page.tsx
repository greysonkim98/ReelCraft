import { Landing } from '@/components/Landing';
import { AuthProvider } from '@/lib/auth';

export default function Home() {
  return (
    <AuthProvider mode="signin">
      <Landing />
    </AuthProvider>
  );
}
