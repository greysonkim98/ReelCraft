import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../lib/errors';

/** Validates req.body with zod; replaces it with the parsed (defaulted) value. */
export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const fields: Record<string, string> = {};
      for (const issue of result.error.issues) {
        fields[issue.path.join('.') || '(body)'] = issue.message;
      }
      return next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request body.', { fields }));
    }
    req.body = result.data;
    next();
  };
}
