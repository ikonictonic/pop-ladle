/**
 * Outbound email transport.
 *
 * Mirrors the recipe-brain provider pattern: a real HTTPS adapter (Resend) when
 * a key is configured, and a keyless console transport for local/dev so the
 * full invite flow works without an email account. A missing key never throws
 * at boot — it degrades to console so callers can still record delivery state.
 *
 * Secrets live in env vars only (RESEND_API_KEY), never in the database.
 */

import { env } from '../../config/env.js'

const RESEND_URL = 'https://api.resend.com/emails'

export function getEmailTransport() {
  return env.RESEND_API_KEY ? 'resend' : 'console'
}

/**
 * Send one transactional email.
 * Resolves to { delivered, transport, id, error }. Throws only on a transport
 * error from Resend — callers that want best-effort delivery should catch.
 */
export async function sendEmail({ to, subject, html, text, replyTo, signal }) {
  const transport = getEmailTransport()

  if (transport === 'resend') {
    return sendViaResend({ to, subject, html, text, replyTo, signal })
  }

  return sendViaConsole({ to, subject, text })
}

async function sendViaResend({ to, subject, html, text, replyTo, signal }) {
  const body = {
    from: env.EMAIL_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text,
  }
  if (replyTo) body.reply_to = replyTo

  const response = await fetch(RESEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    throw upstreamError('resend', response.status, await safeText(response))
  }

  const data = await response.json().catch(() => ({}))

  return {
    delivered: true,
    transport: 'resend',
    id: data.id ?? null,
    error: null,
  }
}

function sendViaConsole({ to, subject, text }) {
  console.log(JSON.stringify({
    level: 'info',
    message: 'Email (console transport — RESEND_API_KEY not set)',
    to,
    subject,
    preview: typeof text === 'string' ? text.slice(0, 280) : null,
  }))

  return {
    delivered: true,
    transport: 'console',
    id: null,
    error: null,
  }
}

function upstreamError(provider, status, detail) {
  const err = new Error(`${provider} email transport ${status}: ${detail.slice(0, 300)}`)
  err.httpStatus = status
  return err
}

async function safeText(response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}
