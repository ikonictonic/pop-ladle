import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// =============================================================================
// Subscriber tokens.
//
//   * Opaque tokens (confirmation link, signup session): 32 random bytes,
//     base64url. Only their sha256 is stored, so a database read cannot be
//     replayed as a link.
//   * Manage tokens (preferences + unsubscribe links in marketing email):
//     "<subscriber id>.<HMAC>" signed with SUBSCRIBER_TOKEN_SECRET. They do not
//     expire, because an unsubscribe link has to keep working. Rotating the
//     secret invalidates every link already sent.
// =============================================================================

const OPAQUE_TOKEN_BYTES = 32
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MANAGE_SCOPE = 'subscriber-manage:v1'

export function createOpaqueToken() {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url')
}

export function isOpaqueToken(value) {
  return typeof value === 'string' && OPAQUE_TOKEN_PATTERN.test(value)
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function manageSignature(subscriberId, secret) {
  return createHmac('sha256', secret).update(`${MANAGE_SCOPE}.${subscriberId}`).digest('base64url')
}

export function createManageToken(subscriberId, secret) {
  return `${subscriberId}.${manageSignature(subscriberId, secret)}`
}

/** Returns the subscriber id a manage token was issued for, or null. */
export function readManageToken(token, secret) {
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.length < 32) return null

  const [subscriberId, signature, ...extra] = token.split('.')
  if (extra.length || !UUID_PATTERN.test(subscriberId ?? '') || !signature) return null

  const expected = Buffer.from(manageSignature(subscriberId, secret))
  const given = Buffer.from(signature)
  return given.length === expected.length && timingSafeEqual(given, expected) ? subscriberId : null
}
