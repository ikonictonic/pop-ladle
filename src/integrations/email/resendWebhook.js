/**
 * Resend webhook signature check (Svix scheme), without the svix package.
 *
 * Resend signs `${svix-id}.${svix-timestamp}.${raw body}` with HMAC-SHA256
 * using the base64 secret after its `whsec_` prefix, and sends one or more
 * space-separated `v1,<base64 signature>` values in svix-signature. The raw
 * body must be used: re-serialized JSON will not match.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const TOLERANCE_SECONDS = 5 * 60

export function verifyResendWebhook({ rawBody, headers, secret, now = Date.now() }) {
  const id = headers['svix-id']
  const timestamp = headers['svix-timestamp']
  const signatureHeader = headers['svix-signature']

  if (typeof secret !== 'string' || !secret) return false
  if (typeof id !== 'string' || typeof timestamp !== 'string' || typeof signatureHeader !== 'string') {
    return false
  }
  if (!/^\d+$/.test(timestamp)) return false
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false

  const key = Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64')
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.`)
    .update(rawBody)
    .digest()

  return signatureHeader.split(' ').some((entry) => {
    const [version, signature] = entry.split(',')
    if (version !== 'v1' || !signature) return false
    const given = Buffer.from(signature, 'base64')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}
