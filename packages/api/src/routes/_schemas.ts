import { z } from '@hono/zod-openapi';

// ── Shared response schemas ──

export const errorResponseSchema = z.object({
  error: z.string(),
}).openapi('ErrorResponse');

export const messageResponseSchema = z.object({
  message: z.string(),
}).openapi('MessageResponse');

export const validationErrorResponseSchema = z.object({
  error: z.string(),
  details: z.array(z.string()).optional(),
}).openapi('ValidationErrorResponse');

// ── Helpers ──

export function jsonBody<T extends z.ZodType>(schema: T) {
  return { content: { 'application/json': { schema } }, required: true as const };
}

export function jsonContent<T extends z.ZodType>(schema: T, description: string) {
  return { content: { 'application/json': { schema } }, description };
}

// ── Reusable response map fragments ──

export const standardErrors = {
  400: jsonContent(errorResponseSchema, 'Validation error'),
  401: jsonContent(errorResponseSchema, 'Unauthorized'),
  403: jsonContent(errorResponseSchema, 'Forbidden'),
  404: jsonContent(errorResponseSchema, 'Not found'),
  500: jsonContent(errorResponseSchema, 'Internal server error'),
} as const;

// ── Security definitions ──

export const bearerSecurity = [{ bearerAuth: [] }];
export const apiKeySecurity = [{ apiKey: [] }];
export const noSecurity: [] = [];
