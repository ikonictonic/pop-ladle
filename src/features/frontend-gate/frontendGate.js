import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export const FRONTEND_GATE_COOKIE = 'pop_ladle_frontend_gate'

const TOKEN_VERSION = 'v1'
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/

function digest(value) {
  return createHash('sha256').update(value).digest()
}

function safeEqual(left, right) {
  return timingSafeEqual(digest(left), digest(right))
}

function passwordTag(password, sessionSecret) {
  return createHmac('sha256', sessionSecret)
    .update(`password:${password}`)
    .digest('hex')
}

function signToken(expiresAt, tag, sessionSecret) {
  return createHmac('sha256', sessionSecret)
    .update(`${TOKEN_VERSION}.${expiresAt}.${tag}`)
    .digest('hex')
}

export function isFrontendGateConfigured(password) {
  return typeof password === 'string' && password.length > 0
}

export function frontendGatePasswordsMatch(candidate, expected) {
  if (typeof candidate !== 'string' || !isFrontendGateConfigured(expected)) return false
  return safeEqual(candidate, expected)
}

export function createFrontendGateToken({ password, sessionSecret, now = Date.now(), ttlMs }) {
  if (!isFrontendGateConfigured(password)) {
    throw new Error('A frontend gate password is required to create a session token.')
  }
  if (typeof sessionSecret !== 'string' || sessionSecret.length < 32) {
    throw new Error('A frontend gate session secret of at least 32 characters is required.')
  }
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('Frontend gate session TTL must be a positive number.')
  }

  const expiresAt = Math.floor(now + ttlMs)
  const tag = passwordTag(password, sessionSecret)
  const signature = signToken(expiresAt, tag, sessionSecret)
  return `${TOKEN_VERSION}.${expiresAt}.${tag}.${signature}`
}

export function verifyFrontendGateToken(token, { password, sessionSecret, now = Date.now() }) {
  if (
    typeof token !== 'string'
    || !isFrontendGateConfigured(password)
    || typeof sessionSecret !== 'string'
    || sessionSecret.length < 32
  ) return false

  const [version, rawExpiresAt, tag, signature, ...extra] = token.split('.')
  if (extra.length || version !== TOKEN_VERSION || !/^\d+$/.test(rawExpiresAt)) return false
  if (!SIGNATURE_PATTERN.test(tag ?? '') || !SIGNATURE_PATTERN.test(signature ?? '')) return false

  const expiresAt = Number(rawExpiresAt)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false

  const expectedTag = passwordTag(password, sessionSecret)
  if (!safeEqual(tag, expectedTag)) return false
  return safeEqual(signature, signToken(expiresAt, tag, sessionSecret))
}

export function readCookie(cookieHeader, name) {
  if (typeof cookieHeader !== 'string' || !cookieHeader || !name) return null

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue

    const value = part.slice(separator + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }

  return null
}
