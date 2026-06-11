/**
 * Ownership-transfer notification emails.
 *
 * Acceptance happens in-app (POST .../transfer-ownership/accept), so these are
 * notifications that point the recipient back into the app — there is no token
 * link to follow. No I/O here; the caller passes the resolved app URL.
 */

import { emailLayout, primaryButton, escapeHtml, formatDate } from './layout.js'

/** Sent to the target member when an owner initiates a transfer to them. */
export function renderTransferInitiatedEmail({ appUrl, householdName, initiatedByName, expiresAt }) {
  const safeHousehold = householdName || 'a household'
  const inviter = initiatedByName ? `${initiatedByName} wants` : 'The owner wants'
  const expiry = formatDate(expiresAt)

  const subject = `You've been offered ownership of ${safeHousehold} on Pop & Ladle`

  const textLines = [
    `${inviter} to transfer ownership of "${safeHousehold}" to you on Pop & Ladle.`,
    '',
    'Sign in to Pop & Ladle and open the household\'s settings to accept or decline:',
    appUrl,
  ]
  if (expiry) textLines.push('', `This offer expires on ${expiry}.`)
  textLines.push('', 'If you weren’t expecting this, you can safely ignore this email — nothing changes unless you accept.')

  const expiryHtml = expiry
    ? `<p style="color:#6b7280;font-size:13px;margin:16px 0 0;">This offer expires on ${escapeHtml(expiry)}.</p>`
    : ''

  const html = emailLayout(`
    <p style="font-size:15px;color:#374151;line-height:1.5;margin:0 0 8px;">
      ${escapeHtml(inviter)} to transfer ownership of <strong>${escapeHtml(safeHousehold)}</strong> to you.
    </p>
    <p style="font-size:14px;color:#6b7280;line-height:1.5;margin:0;">
      Sign in and open the household's settings to accept or decline.
    </p>
    ${primaryButton(appUrl, 'Open Pop & Ladle')}
    ${expiryHtml}
    <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;">
      If you weren’t expecting this, you can ignore this email — nothing changes unless you accept.
    </p>
  `)

  return { subject, text: textLines.join('\n'), html }
}

/** Sent to the previous owner once the target accepts and ownership swaps. */
export function renderTransferAcceptedEmail({ appUrl, householdName, newOwnerName }) {
  const safeHousehold = householdName || 'your household'
  const newOwner = newOwnerName || 'another member'

  const subject = `Ownership of ${safeHousehold} was transferred`

  const text = [
    `Ownership of "${safeHousehold}" on Pop & Ladle has been transferred to ${newOwner}.`,
    'You are now a co-owner of this household.',
    '',
    appUrl,
    '',
    'If you didn’t expect this change, review your household settings or contact support.',
  ].join('\n')

  const html = emailLayout(`
    <p style="font-size:15px;color:#374151;line-height:1.5;margin:0 0 8px;">
      Ownership of <strong>${escapeHtml(safeHousehold)}</strong> has been transferred to ${escapeHtml(newOwner)}.
    </p>
    <p style="font-size:14px;color:#6b7280;line-height:1.5;margin:0;">
      You are now a <strong>co-owner</strong> of this household.
    </p>
    ${primaryButton(appUrl, 'Open Pop & Ladle')}
    <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;">
      If you didn’t expect this change, review your household settings or contact support.
    </p>
  `)

  return { subject, text, html }
}
