import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { AppError } from '../lib/errors';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof AppError) {
      res.status(err.status).json({
        error: err.message,
        code: err.code,
        ...(err.details ? { details: err.details } : {}),
      });
      return;
    }
    // Malformed JSON / oversized body from express.json()
    const status = (err as { status?: number }).status;
    if (status === 400 || status === 413) {
      res.status(status).json({
        error: status === 413 ? 'Request body too large.' : 'Malformed JSON body.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }
    logger.error({ err }, 'unhandled error');
    res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL' });
  };
}
