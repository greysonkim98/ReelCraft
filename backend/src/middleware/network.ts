import type { RequestHandler } from 'express';
import type { NetworkActivity } from '@reelcraft/shared';
import { AppError } from '../lib/errors';
import { currentUser } from '../services/auth';
import type { IpInfoService } from '../services/ipinfo';
import type { NetworkStore } from '../services/networks';
import { utcDay } from '../services/usage';

export interface NetworkDeps {
  ipinfo: IpInfoService;
  networks: NetworkStore;
  flaggedAsns: string[];
  restriction?: (hash: string) => Promise<{ expiresAt: number } | null>;
}

export function checkNetwork({
  ipinfo,
  networks,
  flaggedAsns,
  restriction,
}: NetworkDeps): RequestHandler {
  const watchlist = new Set(flaggedAsns);
  return async (req, res, next) => {
    try {
      const result = await ipinfo.lookup(req.ip);
      if (!result.ipHash) return next();
      if (result.status === 'disabled') {
        if (restriction && ((await restriction(result.ipHash))?.expiresAt ?? 0) > Date.now())
          return next(
            new AppError(
              403,
              'NETWORK_BLOCKED',
              'AI requests from this network are temporarily restricted. Contact support.',
            ),
          );
        return next();
      }
      const flagged = result.info.asn !== null && watchlist.has(result.info.asn);
      const activity: Omit<NetworkActivity, 'requests' | 'accountCount'> = {
        ...result.info,
        ipHash: result.ipHash,
        day: utcDay(),
        flagged,
        lookupStatus: result.status,
      };
      const { uid } = currentUser(res);
      await networks.record(uid, activity);
      res.locals.network = activity;
      if (restriction && ((await restriction(result.ipHash))?.expiresAt ?? 0) > Date.now())
        return next(
          new AppError(
            403,
            'NETWORK_BLOCKED',
            'AI requests from this network are temporarily restricted. Contact support.',
          ),
        );
      if (flagged && (await networks.verifiedUntil(uid, result.ipHash)) <= Date.now()) {
        return next(
          new AppError(
            403,
            'NETWORK_VERIFICATION_REQUIRED',
            'This network needs an additional security check. Verify in a new tab, then retry your captions.',
            { verificationPath: '/verify' },
          ),
        );
      }
      next();
    } catch {
      // No raw IP, provider response, or token is attached to errors/logs.
      next(
        new AppError(
          503,
          'NETWORK_CHECK_UNAVAILABLE',
          'The network security check is temporarily unavailable. Please try again.',
        ),
      );
    }
  };
}
