/**
 * Household invite email content.
 * Renders subject + html + text from invite/household details. No I/O here —
 * the caller resolves the absolute invite URL and passes it in.
 */

const ROLE_LABELS = {
  co_owner: 'co-owner',
  caregiver: 'caregiver',
  viewer: 'viewer',
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function roleLabel(role) {
  return ROLE_LABELS[role] ?? role
}

function formatExpiry(expiresAt) {
  if (!expiresAt) return null
  const date = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function renderInviteEmail({ inviteUrl, householdName, role, invitedByName, expiresAt }) {
  const safeHousehold = householdName || 'a household'
  const inviterClause = invitedByName ? `${invitedByName} invited you` : 'You have been invited'
  const roleText = roleLabel(role)
  const expiryText = formatExpiry(expiresAt)

  const subject = `You're invited to ${safeHousehold} on Pop & Ladle`

  const textLines = [
    `${inviterClause} to join "${safeHousehold}" on Pop & Ladle as a ${roleText}.`,
    '',
    'Accept your invite:',
    inviteUrl,
  ]
  if (expiryText) {
    textLines.push('', `This invite expires on ${expiryText}.`)
  }
  textLines.push('', 'If you weren’t expecting this, you can safely ignore this email.')
  const text = textLines.join('\n')

  const expiryHtml = expiryText
    ? `<p style="color:#6b7280;font-size:13px;margin:16px 0 0;">This invite expires on ${escapeHtml(expiryText)}.</p>`
    : ''

  const html = `<!doctype html>
<html>
  <body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
      <h1 style="font-size:20px;color:#111827;margin:0 0 16px;">Pop &amp; Ladle</h1>
      <p style="font-size:15px;color:#374151;line-height:1.5;margin:0 0 8px;">
        ${escapeHtml(inviterClause)} to join <strong>${escapeHtml(safeHousehold)}</strong> as a ${escapeHtml(roleText)}.
      </p>
      <p style="margin:24px 0;">
        <a href="${escapeHtml(inviteUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;">Accept invite</a>
      </p>
      <p style="color:#6b7280;font-size:13px;margin:0;word-break:break-all;">
        Or paste this link into your browser:<br />
        <a href="${escapeHtml(inviteUrl)}" style="color:#2563eb;">${escapeHtml(inviteUrl)}</a>
      </p>
      ${expiryHtml}
      <p style="color:#9ca3af;font-size:12px;margin:24px 0 0;">
        If you weren’t expecting this, you can safely ignore this email.
      </p>
    </div>
  </body>
</html>`

  return { subject, text, html }
}
