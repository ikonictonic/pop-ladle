/**
 * In-memory fixed-window rate limiting for public, unauthenticated endpoints.
 *
 * Process-local, like the frontend gate's attempt counter: fine while the API
 * runs as a single Railway replica, and it resets on deploy. Move to a shared
 * store before scaling out.
 */

const SWEEP_THRESHOLD = 10_000

/** Best-effort caller identity: first X-Forwarded-For hop, else the socket. */
export function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for']
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  return firstForwarded?.trim() || req.ip || req.socket?.remoteAddress || 'unknown'
}

/**
 * Returns hit(key) → true while `key` is within `max` hits per `windowMs`,
 * false once it is over the limit.
 */
export function createRateLimiter({ max, windowMs }) {
  const windows = new Map()

  return function hit(key, now = Date.now()) {
    if (windows.size > SWEEP_THRESHOLD) {
      for (const [k, state] of windows) {
        if (now - state.startedAt >= windowMs) windows.delete(k)
      }
    }

    let state = windows.get(key)
    if (!state || now - state.startedAt >= windowMs) {
      state = { count: 0, startedAt: now }
      windows.set(key, state)
    }

    state.count += 1
    return state.count <= max
  }
}
