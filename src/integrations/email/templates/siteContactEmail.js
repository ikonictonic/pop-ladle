/**
 * The email the public contact form sends to CONTACT_INBOX. Subscriber email
 * lives in Plunk templates (features/subscribers).
 */

import { escapeHtml } from './layout.js'

export function renderContactMessageEmail({ name, email, reason, message }) {
  const subject = `Website message: ${reason}`
  const text = [`From: ${name} <${email}>`, `Topic: ${reason}`, '', message].join('\n')
  const html = `<!doctype html>
<html>
  <body style="margin:0;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
    <div style="max-width:600px;padding:24px;">
      <p style="margin:0 0 4px;"><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;</p>
      <p style="margin:0 0 16px;"><strong>Topic:</strong> ${escapeHtml(reason)}</p>
      <div style="white-space:pre-wrap;font-size:15px;line-height:1.5;">${escapeHtml(message)}</div>
    </div>
  </body>
</html>`

  return { subject, text, html }
}
