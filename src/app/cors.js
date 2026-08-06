/**
 * CORS — allow the deployed frontend (a different origin, e.g. dev.popladle.com)
 * to call this API from the browser. Local dev doesn't need it (Vite proxies
 * /api same-origin), so this only matters once frontend + API are on separate
 * hosts.
 *
 * No `cors` dependency: echo the Origin when it is on the allowlist, allow the
 * frontend-gate HttpOnly cookie, and answer preflight. Clerk authentication
 * continues to use its Bearer token. Allowlist = CORS_ALLOWED_ORIGINS
 * (comma-separated) + APP_BASE_URL + localhost dev. Set CORS_ALLOWED_ORIGINS to
 * '*' to allow any origin (handy while wiring up; tighten before launch).
 */

import { env } from '../config/env.js'

const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']
const ALLOWED_METHODS = 'GET,POST,PATCH,PUT,DELETE,OPTIONS'

// The product domain family is always allowed over https: the apex and every
// subdomain (popladle.com, www., app., dev., ...). This avoids exact-origin
// whack-a-mole (e.g. www vs apex) across the marketing site, app, and staging.
const ALLOWED_ORIGIN_SUFFIX = '.popladle.com'
const ALLOWED_APEX = 'popladle.com'

function normalizeOrigin(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : ''
}

function isProductDomain(origin) {
  try {
    const { protocol, hostname } = new URL(origin)
    return (
      protocol === 'https:' &&
      (hostname === ALLOWED_APEX || hostname.endsWith(ALLOWED_ORIGIN_SUFFIX))
    )
  } catch {
    return false
  }
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

    const normalizedOrigin = normalizeOrigin(origin)
    if (origin && (allowAll || allowlist.has(normalizedOrigin) || isProductDomain(normalizedOrigin))) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
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
