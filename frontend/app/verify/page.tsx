import { AuthProvider } from '@/lib/auth';
import { NetworkVerification } from '@/components/NetworkVerification';

export const metadata = { title: 'Network verification · ReelCraft' };

// Outside /editor so reCAPTCHA can load without the video renderer's COEP headers.
export default function Page() {
  return (
    <AuthProvider mode="session">
      <NetworkVerification />
    </AuthProvider>
  );
}
