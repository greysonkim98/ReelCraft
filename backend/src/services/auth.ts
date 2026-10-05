import type { RequestHandler, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { AppError } from '../lib/errors';
import { getFirebaseApp } from '../lib/firebase';

export interface AuthUser {
  uid: string;
  email?: string;
}

export interface TokenVerifier {
  verify(idToken: string): Promise<AuthUser>;
}

export function createFirebaseVerifier(projectId: string): TokenVerifier {
  return {
    async verify(idToken) {
      const decoded = await getAuth(getFirebaseApp(projectId)).verifyIdToken(idToken);
      return { uid: decoded.uid, email: decoded.email };
    },
  };
}

export const bearerToken = (header: string | undefined): string | null => {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return m ? m[1]! : null;
};

export function requireAuth(verifier: TokenVerifier): RequestHandler {
  return async (req, res, next) => {
    const token = bearerToken(req.header('authorization'));
    if (!token) return next(new AppError(401, 'UNAUTHENTICATED', 'Sign in to use this feature.'));
    try {
      res.locals.user = await verifier.verify(token);
      next();
    } catch {
      next(new AppError(401, 'UNAUTHENTICATED', 'Your session is invalid or expired. Sign in again.'));
    }
  };
}

export const currentUser = (res: Response): AuthUser => res.locals.user as AuthUser;
