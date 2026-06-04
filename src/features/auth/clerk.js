import { clerkMiddleware, createClerkClient, getAuth } from '@clerk/express'
import { env } from '../../config/env.js'

let clerkClient

export function isClerkConfigured() {
  return Boolean(env.CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY)
}

export function getClerkClient() {
  if (!isClerkConfigured()) {
    throw new Error('Clerk environment variables are not set.')
  }

  clerkClient ??= createClerkClient({
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    secretKey: env.CLERK_SECRET_KEY,
  })

  return clerkClient
}

export function createClerkRequestMiddleware() {
  if (!isClerkConfigured()) {
    return (_req, _res, next) => next()
  }

  return clerkMiddleware({
    clerkClient: getClerkClient(),
    publishableKey: env.CLERK_PUBLISHABLE_KEY,
    secretKey: env.CLERK_SECRET_KEY,
  })
}

export function requireAuthenticatedRequest(req, res, next) {
  if (!isClerkConfigured()) {
    res.status(503).json({
      error: {
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Clerk environment variables are not set.',
      },
    })
    return
  }

  try {
    const auth = getAuth(req)

    if (!auth.userId) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Sign in is required for this endpoint.',
        },
      })
      return
    }

    req.authContext = auth
    next()
  } catch (err) {
    next(err)
  }
}
