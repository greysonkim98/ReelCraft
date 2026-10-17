import { Login } from '@/components/Login';
import { AuthProvider } from '@/lib/auth';
export const metadata = { title: 'Sign in · ReelCraft' };
export default function LoginPage() {
  return (
    <AuthProvider mode="signin">
      <Login />
    </AuthProvider>
  );
}
