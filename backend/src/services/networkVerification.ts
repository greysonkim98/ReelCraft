import { getAppCheck } from 'firebase-admin/app-check';
import { getFirebaseApp } from '../lib/firebase';

export interface NetworkVerifier {
  verify(token: string): Promise<boolean>;
}

/** Limited-use tokens cannot be reused to verify a second account or network. */
export function createNetworkVerifier(projectId: string, appId: string): NetworkVerifier {
  return {
    async verify(token) {
      try {
        const result = await getAppCheck(getFirebaseApp(projectId)).verifyToken(token, {
          consume: true,
        });
        return result.appId === appId && !result.alreadyConsumed;
      } catch {
        return false;
      }
    },
  };
}
