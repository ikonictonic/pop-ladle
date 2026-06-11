/**
 * Invite email dispatch — orchestrates send + delivery bookkeeping.
 *
 * Best-effort by design: a transient email outage must never block creating or
 * resending an invite (the link is still retrievable via the invites list).
 * Outcomes are recorded on the household_invites row (email_sent_at /
 * email_send_count / email_last_error) and summarized back to the caller.
 */

import { env } from '../../config/env.js'
import { sendEmail, getEmailTransport } from '../../integrations/email/emailClient.js'
import { renderInviteEmail } from '../../integrations/email/templates/inviteEmail.js'

function buildInviteUrl(inviteToken) {
  const base = env.APP_BASE_URL.replace(/\/+$/, '')
  return `${base}/?invite=${inviteToken}`
}

async function recordDelivery(db, inviteId, { delivered, error }) {
  await db.query(
    `
      update household_invites
      set
        email_send_count = email_send_count + 1,
        email_sent_at = case when $2 then now() else email_sent_at end,
        email_last_error = $3
      where id = $1
    `,
    [inviteId, delivered, error ?? null],
  )
}

/**
 * Send the invite link to its recipient. Never throws — returns an
 * { delivered, transport, error } summary and updates the invite row.
 */
export async function dispatchInviteEmail(db, { invite, householdName, invitedByName }) {
  const { subject, text, html } = renderInviteEmail({
    inviteUrl: buildInviteUrl(invite.inviteToken),
    householdName,
    role: invite.role,
    invitedByName,
    expiresAt: invite.expiresAt,
  })

  try {
    const result = await sendEmail({ to: invite.email, subject, text, html })
    await recordDelivery(db, invite.id, { delivered: result.delivered, error: null })
    return { delivered: result.delivered, transport: result.transport, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Invite email delivery failed', { inviteId: invite.id, error: message })
    await recordDelivery(db, invite.id, { delivered: false, error: message })
    return { delivered: false, transport: getEmailTransport(), error: message }
  }
}
