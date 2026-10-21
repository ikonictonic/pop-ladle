/**
 * Resend marketing surface: contacts (for broadcasts) and automation events.
 *
 * Same posture as emailClient: real HTTPS calls when RESEND_API_KEY is set,
 * a console transport otherwise so the subscriber flow runs locally. Contacts
 * are addressed by email, so callers never need to store a Resend id.
 * Custom contact properties must already exist in Resend (Contacts →
 * Properties) or the update is rejected.
 */

import { env } from '../../config/env.js'
import { getEmailTransport } from './emailClient.js'

const RESEND_API = 'https://api.resend.com'

/**
 * Create or update the contact for `email`. Pass `unsubscribed` explicitly on
 * every consent change; omit it to leave the subscription state untouched.
 * Joins RESEND_SEGMENT_ID when one is configured.
 */
export async function upsertResendContact({ email, unsubscribed, properties }) {
  const body = {}
  if (typeof unsubscribed === 'boolean') body.unsubscribed = unsubscribed
  if (properties) body.properties = properties

  if (getEmailTransport() === 'console') {
    logConsole('Resend contact upsert', { email, ...body })
    return { transport: 'console' }
  }

  const path = `/contacts/${encodeURIComponent(email)}`
  const updated = await resendRequest('PATCH', path, body, { allowNotFound: true })
  if (updated === null) {
    await resendRequest('POST', '/contacts', { email, ...body })
  }

  if (env.RESEND_SEGMENT_ID) {
    await resendRequest('POST', `${path}/segments/${encodeURIComponent(env.RESEND_SEGMENT_ID)}`)
  }

  return { transport: 'resend' }
}

/**
 * Update an existing contact. A contact Resend has never seen (e.g. an address
 * that never confirmed) is left alone rather than created.
 */
export async function updateResendContact({ email, unsubscribed, properties }) {
  const body = {}
  if (typeof unsubscribed === 'boolean') body.unsubscribed = unsubscribed
  if (properties) body.properties = properties

  if (getEmailTransport() === 'console') {
    logConsole('Resend contact update', { email, ...body })
    return { transport: 'console', found: true }
  }

  const result = await resendRequest('PATCH', `/contacts/${encodeURIComponent(email)}`, body, {
    allowNotFound: true,
  })
  return { transport: 'resend', found: result !== null }
}

/** Trigger Resend automations listening for `event` for this contact. */
export async function sendResendEvent({ event, email, payload }) {
  if (getEmailTransport() === 'console') {
    logConsole('Resend automation event', { event, email })
    return { transport: 'console' }
  }

  await resendRequest('POST', '/events/send', { event, email, ...(payload ? { payload } : {}) })
  return { transport: 'resend' }
}

async function resendRequest(method, path, body, { allowNotFound = false } = {}) {
  const response = await fetch(`${RESEND_API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (allowNotFound && response.status === 404) return null

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const err = new Error(`resend ${method} ${path.split('/')[1]} ${response.status}: ${detail.slice(0, 300)}`)
    err.httpStatus = response.status
    throw err
  }

  return response.json().catch(() => ({}))
}

function logConsole(message, detail) {
  console.log(JSON.stringify({
    level: 'info',
    message: `${message} (console transport — RESEND_API_KEY not set)`,
    ...detail,
  }))
}
