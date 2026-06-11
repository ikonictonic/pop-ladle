/**
 * Ownership-transfer email dispatch — best-effort, fire-and-forget.
 *
 * These are courtesy notifications: a failure must never break or roll back the
 * transfer itself (the pending transfer is still visible via GET /households).
 * Each helper catches its own errors, logs, and returns a delivery summary.
 */

import { env } from '../../config/env.js'
import { sendEmail, getEmailTransport } from '../../integrations/email/emailClient.js'
import {
  renderTransferInitiatedEmail,
  renderTransferAcceptedEmail,
} from '../../integrations/email/templates/ownershipTransferEmail.js'

function appUrl() {
  return env.APP_BASE_URL.replace(/\/+$/, '') + '/'
}

async function deliver(to, { subject, text, html }, context) {
  try {
    const result = await sendEmail({ to, subject, text, html })
    return { delivered: result.delivered, transport: result.transport, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Transfer notification email failed', { ...context, error: message })
    return { delivered: false, transport: getEmailTransport(), error: message }
  }
}

/** Notify the target member that they've been offered ownership. */
export async function dispatchTransferInitiatedEmail({ toEmail, householdName, initiatedByName, expiresAt, transferId }) {
  if (!toEmail) return { delivered: false, transport: getEmailTransport(), error: 'no recipient email' }

  const email = renderTransferInitiatedEmail({
    appUrl: appUrl(),
    householdName,
    initiatedByName,
    expiresAt,
  })
  return deliver(toEmail, email, { transferId, kind: 'transfer_initiated' })
}

/** Notify the previous owner that the transfer was accepted and they are now a co-owner. */
export async function dispatchTransferAcceptedEmail({ toEmail, householdName, newOwnerName, transferId }) {
  if (!toEmail) return { delivered: false, transport: getEmailTransport(), error: 'no recipient email' }

  const email = renderTransferAcceptedEmail({
    appUrl: appUrl(),
    householdName,
    newOwnerName,
  })
  return deliver(toEmail, email, { transferId, kind: 'transfer_accepted' })
}
