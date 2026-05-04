/**
 * Hono response envelope helpers.
 *
 * All API responses share one of two shapes:
 *   success: { ok: true,  data: T }
 *   error:   { ok: false, error: string, code?: string }
 *
 * The client unwraps `data` automatically (see lib/api-client.ts in M3).
 */

import type { Context } from 'hono';

export function successResponse<T>(c: Context, data: T, status: 200 | 201 = 200) {
  return c.json({ ok: true as const, data }, status);
}

export function createdResponse<T>(c: Context, data: T) {
  return c.json({ ok: true as const, data }, 201);
}

export function noContentResponse(c: Context) {
  return c.body(null, 204);
}

function errorResponse(c: Context, message: string, status: number, code?: string) {
  const body: { ok: false; error: string; code?: string } = { ok: false, error: message };
  if (code) body.code = code;
  return c.json(body, status as Parameters<typeof c.json>[1]);
}

export function unauthorizedResponse(c: Context, code = 'AUTH_UNAUTHORIZED') {
  return errorResponse(c, 'Unauthorized', 401, code);
}

export function badRequestResponse(c: Context, message: string, code = 'VALIDATION_INVALID_INPUT') {
  return errorResponse(c, message, 400, code);
}

export function forbiddenResponse(c: Context, message: string, code?: string) {
  return errorResponse(c, message, 403, code);
}

export function notFoundResponse(c: Context, resource: string, code = 'RESOURCE_NOT_FOUND') {
  return errorResponse(c, `${resource} not found`, 404, code);
}

export function conflictResponse(c: Context, message: string, code = 'RESOURCE_CONFLICT') {
  return errorResponse(c, message, 409, code);
}

export function serverErrorResponse(c: Context, message: string, code = 'SERVER_ERROR') {
  return errorResponse(c, message, 500, code);
}

/**
 * Safely parse JSON body. Returns the parsed value, or a 400 error response
 * if the body is missing or malformed. Use instead of `c.req.json()` directly
 * so JSON parse errors don't get caught by generic 500 handlers.
 */
export async function parseJsonBody<T = unknown>(c: Context): Promise<T | Response> {
  try {
    return await c.req.json<T>();
  } catch {
    return badRequestResponse(c, 'Invalid or missing JSON body');
  }
}
