import { env } from '../../config/env.js'
import { createHttpError } from '../households/householdAccess.js'
import { getEmailTransport, sendEmail } from '../../integrations/email/emailClient.js'
import { renderContactMessageEmail } from '../../integrations/email/templates/siteContactEmail.js'
import { createRateLimiter } from '../../shared/http/rateLimit.js'

// =============================================================================
// siteContactService — the popladle.com contact form.
//
// Messages are emailed to CONTACT_INBOX with the sender as reply-to and are not
// stored. Sending a message is never treated as consent to marketing email, so
// nothing here touches the subscriber ledger or Resend contacts.
// =============================================================================

const REASONS = Object.freeze([
  'Early access and launch',
  'Product questions',
  'Caregiver feedback',
  'Professional or organizational partnership',
  'Press and media',
  'Privacy or personal data request',
  'Technical or website issue',
  'Other',
])
const MAX_NAME_LENGTH = 120
const MAX_EMAIL_LENGTH = 254
const MAX_MESSAGE_LENGTH = 4000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const messagesPerClient = createRateLimiter({ max: 5, windowMs: 60 * 60 * 1000 })

function requiredText(value, max, code, label) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text || text.length > max) {
    throw createHttpError(400, code, `${label} is required (${max} characters or fewer).`, true)
  }
  return text
}

function normalizeContactMessage(payload) {
  const body = payload && typeof payload === 'object' ? payload : {}
  const name = requiredText(body.name, MAX_NAME_LENGTH, 'INVALID_CONTACT_NAME', 'Your name')
  const email = requiredText(body.email, MAX_EMAIL_LENGTH, 'INVALID_CONTACT_EMAIL', 'Email address').toLowerCase()
  if (!EMAIL_PATTERN.test(email)) {
    throw createHttpError(400, 'INVALID_CONTACT_EMAIL', 'Enter a valid email address.', true)
  }
  if (!REASONS.includes(body.reason)) {
    throw createHttpError(400, 'INVALID_CONTACT_REASON', 'Choose a topic.', true)
  }
  const message = requiredText(body.message, MAX_MESSAGE_LENGTH, 'INVALID_CONTACT_MESSAGE', 'Your message')

  return {
    name,
    email,
    reason: body.reason,
    message,
    isBot: typeof body.company === 'string' && body.company.trim() !== '',
  }
}

export async function submitSiteContactMessage(payload, { clientKey }) {
  if (!env.CONTACT_INBOX || (env.NODE_ENV === 'production' && getEmailTransport() !== 'resend')) {
    throw createHttpError(503, 'CONTACT_NOT_CONFIGURED', 'The contact form is not configured.', true)
  }

  const input = normalizeContactMessage(payload)
  if (input.isBot) return { received: true }

  if (!messagesPerClient(clientKey)) {
    throw createHttpError(429, 'CONTACT_RATE_LIMITED', 'Too many messages from this connection. Please try again later.', true)
  }

  const content = renderContactMessageEmail(input)
  try {
    await sendEmail({ to: env.CONTACT_INBOX, replyTo: input.email, ...content })
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', message: 'Contact form email failed', error: err?.message }))
    throw createHttpError(502, 'CONTACT_EMAIL_FAILED', 'Your message could not be sent right now.', true)
  }

  return { received: true }
}

export const __normalizeContactMessageForTests = normalizeContactMessage
