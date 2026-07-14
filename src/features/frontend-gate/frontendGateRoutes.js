import { Router } from 'express'
import { env } from '../../config/env.js'
import {
  FRONTEND_GATE_COOKIE,
  createFrontendGateToken,
  frontendGatePasswordsMatch,
  isFrontendGateConfigured,
  readCookie,
  verifyFrontendGateToken,
} from './frontendGate.js'

const MAX_FAILED_ATTEMPTS = 8
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const failedAttempts = new Map()

function clientKey(req) {
  const forwarded = req.headers['x-forwarded-for']
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]
  return firstForwarded?.trim() || req.ip || req.socket?.remoteAddress || 'unknown'
}

function getAttemptState(key, now = Date.now()) {
  const state = failedAttempts.get(key)
  if (!state || now - state.startedAt >= ATTEMPT_WINDOW_MS) {
    failedAttempts.delete(key)
    return null
  }
  return state
}

function recordFailure(key, now = Date.now()) {
  const state = getAttemptState(key, now) ?? { count: 0, startedAt: now }
  state.count += 1
  failedAttempts.set(key, state)
  return state
}

function cookieOptions() {
  const production = env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    path: '/api/v1',
  }
}

function sessionTtlMs() {
  return env.FRONTEND_GATE_SESSION_HOURS * 60 * 60 * 1000
}

function hasValidSession(req) {
  const token = readCookie(req.headers.cookie, FRONTEND_GATE_COOKIE)
  return verifyFrontendGateToken(token, {
    password: env.FRONTEND_GATE_PASSWORD,
    sessionSecret: env.FRONTEND_GATE_SESSION_SECRET,
  })
}

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store')
}

export function createFrontendGateRouter() {
  const router = Router()

  router.get('/access-gate/status', (req, res) => {
    noStore(res)
    const required = isFrontendGateConfigured(env.FRONTEND_GATE_PASSWORD)
    res.status(200).json({
      required,
      authorized: !required || hasValidSession(req),
    })
  })

  router.post('/access-gate/unlock', (req, res) => {
    noStore(res)

    if (!isFrontendGateConfigured(env.FRONTEND_GATE_PASSWORD)) {
      return res.status(200).json({ required: false, authorized: true })
    }

    const key = clientKey(req)
    const attemptState = getAttemptState(key)
    if (attemptState?.count >= MAX_FAILED_ATTEMPTS) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((ATTEMPT_WINDOW_MS - (Date.now() - attemptState.startedAt)) / 1000),
      )
      res.setHeader('Retry-After', String(retryAfterSeconds))
      return res.status(429).json({
        error: {
          code: 'FRONTEND_GATE_RATE_LIMITED',
          message: 'Too many incorrect attempts. Please wait and try again.',
        },
      })
    }

    const password = req.body?.password
    if (typeof password !== 'string' || password.length === 0 || password.length > 512) {
      return res.status(400).json({
        error: {
          code: 'FRONTEND_GATE_PASSWORD_REQUIRED',
          message: 'Enter the temporary access password.',
        },
      })
    }

    if (!frontendGatePasswordsMatch(password, env.FRONTEND_GATE_PASSWORD)) {
      recordFailure(key)
      return res.status(401).json({
        error: {
          code: 'FRONTEND_GATE_PASSWORD_INCORRECT',
          message: 'That password is incorrect.',
        },
      })
    }

    failedAttempts.delete(key)
    const ttlMs = sessionTtlMs()
    const token = createFrontendGateToken({
      password: env.FRONTEND_GATE_PASSWORD,
      sessionSecret: env.FRONTEND_GATE_SESSION_SECRET,
      ttlMs,
    })
    res.cookie(FRONTEND_GATE_COOKIE, token, { ...cookieOptions(), maxAge: ttlMs })
    return res.status(200).json({ required: true, authorized: true })
  })

  router.post('/access-gate/lock', (_req, res) => {
    noStore(res)
    res.clearCookie(FRONTEND_GATE_COOKIE, cookieOptions())
    const required = isFrontendGateConfigured(env.FRONTEND_GATE_PASSWORD)
    return res.status(200).json({ required, authorized: !required })
  })

  return router
}

export function requireFrontendGateAccess(req, res, next) {
  if (!isFrontendGateConfigured(env.FRONTEND_GATE_PASSWORD)) return next()
  if (req.path === '/health' || req.path === '/ready') return next()
  if (hasValidSession(req)) return next()

  noStore(res)
  return res.status(403).json({
    error: {
      code: 'FRONTEND_GATE_REQUIRED',
      message: 'Enter the temporary access password to continue.',
    },
  })
}
