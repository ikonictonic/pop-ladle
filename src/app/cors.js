/**
 * CORS — allow the deployed frontend (a different origin, e.g. dev.popladle.com)
 * to call this API from the browser. Local dev doesn't need it (Vite proxies
 * /api same-origin), so this only matters once frontend + API are on separate
 * hosts.
 *
 * No `cors` dependency: auth is a Bearer token (Authorization header), not
 * cookies, so we don't need Allow-Credentials — just echo the Origin when it's
 * on the allowlist and answer preflight. Allowlist = CORS_ALLOWED_ORIGINS
 * (comma-separated) + APP_BASE_URL + localhost dev. Set CORS_ALLOWED_ORIGINS to
 * '*' to allow any origin (handy while wiring up; tighten before launch).
 */

import { env } from '../config/env.js'

const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']
const ALLOWED_METHODS = 'GET,POST,PATCH,PUT,DELETE,OPTIONS'

function normalizeOrigin(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
}

export function createCorsMiddleware() {
  const configured = (env.CORS_ALLOWED_ORIGINS || '').split(',').map(normalizeOrigin).filter(Boolean)
  const allowAll = configured.includes('*')
  const allowlist = new Set(
    [...DEFAULT_DEV_ORIGINS, normalizeOrigin(env.APP_BASE_URL), ...configured].filter(
      (origin) => origin && origin !== '*',
    ),
  )

  return function cors(req, res, next) {
    const origin = req.headers.origin

    if (origin && (allowAll || allowlist.has(normalizeOrigin(origin)))) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }

    if (req.method === 'OPTIONS') {
      // Preflight: only origins that matched above carry the Allow-Origin header,
      // so disallowed origins are still blocked by the browser.
      res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS)
      res.setHeader(
        'Access-Control-Allow-Headers',
        req.headers['access-control-request-headers'] || 'Authorization, Content-Type',
      )
      res.setHeader('Access-Control-Max-Age', '86400')
      return res.status(204).end()
    }

    return next()
  }
}
