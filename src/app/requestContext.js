/**
 * Per-request context via AsyncLocalStorage.
 *
 * Captures request metadata (ip, user agent) once in middleware so deep
 * service code — the audit log writer in particular — can read it without
 * threading extra parameters through every service signature.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

const storage = new AsyncLocalStorage()

export function createRequestContextMiddleware() {
  return (req, _res, next) => {
    storage.run(
      {
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      },
      next,
    )
  }
}

/**
 * Returns the current request's context, or an empty object outside a request
 * (e.g. scripts, tests) so callers can destructure safely.
 */
export function getRequestContext() {
  return storage.getStore() ?? {}
}
