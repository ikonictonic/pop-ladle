/**
 * Plunk (PLUNK_API_URL, https://next-api.useplunk.com): early-access contacts,
 * the workflow events that start email sequences, and the subscriber emails.
 *
 * Same posture as emailClient: real HTTPS calls when both Plunk keys are set,
 * a console transport otherwise so the subscriber flow runs locally. Contacts
 * are addressed by email, so callers never store a Plunk id, and custom `data`
 * fields need no setup in Plunk. The secret key covers contacts and sends;
 * /v1/track accepts only the public key.
 */

import { createHash, timingSafeEqual } from 'node:crypto'
import { env } from '../../config/env.js'

export function getPlunkTransport() {
  return env.PLUNK_SECRET_KEY && env.PLUNK_PUBLIC_KEY ? 'plunk' : 'console'
}

/**
 * Create or update the contact for `email`. Pass `subscribed` explicitly on
 * every consent change; omit it to leave Plunk's subscription state untouched.
 */
export async function upsertPlunkContact({ email, subscribed, data }) {
  const body = { email }
  if (typeof subscribed === 'boolean') body.subscribed = subscribed
  if (data) body.data = data

  if (getPlunkTransport() === 'console') {
    logConsole('Plunk contact upsert', body)
    return { transport: 'console' }
  }

  await plunkRequest('/contacts', body, env.PLUNK_SECRET_KEY)
  return { transport: 'plunk' }
}

/**
 * Start the Plunk workflows that trigger on `event` for this contact. Leaves
 * an existing contact's subscription alone; callers only track confirmed
 * subscribers.
 */
export async function trackPlunkEvent({ event, email }) {
  if (getPlunkTransport() === 'console') {
    logConsole('Plunk workflow event', { event, email })
    return { transport: 'console' }
  }

  await plunkRequest('/v1/track', { event, email }, env.PLUNK_PUBLIC_KEY)
  return { transport: 'plunk' }
}

/**
 * Send one Plunk template. `variables` fill its {{placeholders}} for this send
 * only, so links are never stored on the contact; sender and subject come from
 * the template. A Transactional template reaches unsubscribed contacts (the
 * confirmation email has to). A Marketing one needs the contact subscribed
 * first and gets Plunk's unsubscribe footer. `headers` override Plunk's, so
 * List-Unsubscribe can point at our own endpoint. The recipient becomes a Plunk
 * contact; a new one starts unsubscribed. A reused `idempotencyKey` means Plunk
 * already sent it, which counts as sent.
 */
export async function sendPlunkTemplate({ to, template, variables, headers, idempotencyKey }) {
  if (getPlunkTransport() === 'console') {
    logConsole('Email', { to, template, variables })
    return { transport: 'console' }
  }

  const data = Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [key, { value, persistent: false }]),
  )
  const body = { to, template, data }
  if (headers) body.headers = headers

  const result = await plunkRequest('/v1/send', body, env.PLUNK_SECRET_KEY, { idempotencyKey })
  return { transport: 'plunk', duplicate: result === null }
}

/**
 * Plunk webhooks are unsigned. Each workflow Webhook step sends
 * `Authorization: Bearer <PLUNK_WEBHOOK_SECRET>`, compared in constant time.
 */
export function verifyPlunkWebhook({ headers, secret }) {
  if (typeof secret !== 'string' || secret.length < 32) return false
  const header = headers?.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false
  return timingSafeEqual(digest(header.slice('Bearer '.length)), digest(secret))
}

function digest(value) {
  return createHash('sha256').update(value).digest()
}

async function plunkRequest(path, body, key, { idempotencyKey } = {}) {
  const response = await fetch(`${env.PLUNK_API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
  })

  if (idempotencyKey && response.status === 409) return null

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const err = new Error(`plunk POST ${path} ${response.status}: ${detail.slice(0, 300)}`)
    err.httpStatus = response.status
    throw err
  }

  return response.json().catch(() => ({}))
}

function logConsole(message, detail) {
  console.log(JSON.stringify({
    level: 'info',
    message: `${message} (console transport — Plunk keys not set)`,
    ...detail,
  }))
}
