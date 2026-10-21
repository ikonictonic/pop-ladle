/**
 * Email content for early-access subscribers and the public contact form.
 * Pure renderers (subject + html + text); callers build absolute URLs.
 * Styling follows the popladle.com landing page rather than the app layout.
 */

import { escapeHtml } from './layout.js'

const DISCLAIMER = 'Pop & Ladle supports food and household routines and does not replace medical care.'

function brandLayout(innerHtml, footerHtml) {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#FCF7F0;font-family:Arial,Helvetica,sans-serif;color:#1f1f1f;">
    <div style="max-width:520px;margin:0 auto;padding:36px 24px;">
      <p style="margin:0 0 28px;font-size:12px;font-weight:700;letter-spacing:.2em;color:#B5371C;">POP &amp; LADLE</p>
      ${innerHtml}
      <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e9e2d5;font-size:12px;line-height:1.6;color:#67635e;">
        ${footerHtml}
      </p>
    </div>
  </body>
</html>`
}

function heading(text) {
  return `<h1 style="margin:0 0 14px;font:400 30px/1.15 Georgia,'Times New Roman',serif;letter-spacing:-.02em;">${escapeHtml(text)}</h1>`
}

function paragraph(text) {
  return `<p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#46433f;">${escapeHtml(text)}</p>`
}

function button(url, label) {
  return `<p style="margin:26px 0;">
        <a href="${escapeHtml(url)}" style="display:inline-block;background:#D34120;color:#ffffff;text-decoration:none;padding:14px 26px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.08em;">${escapeHtml(label)}</a>
      </p>`
}

export function renderSubscriberConfirmEmail({ confirmUrl }) {
  const subject = 'Confirm your email for Pop & Ladle'
  const expiry = "This link works for 48 hours. If you didn't sign up for Pop & Ladle, ignore this email and you won't hear from us again."

  const text = [
    'Confirm your email to join the Pop & Ladle list:',
    confirmUrl,
    '',
    expiry,
    '',
    DISCLAIMER,
  ].join('\n')

  const html = brandLayout(
    `${heading('Pull up a chair.')}
      ${paragraph("Confirm your email address and we'll start sending recipes and launch news your way.")}
      ${button(confirmUrl, 'CONFIRM MY EMAIL')}
      <p style="margin:0;font-size:13px;line-height:1.6;color:#67635e;">${escapeHtml(expiry)}</p>`,
    escapeHtml(DISCLAIMER),
  )

  return { subject, text, html }
}

export function renderWelcomePlannerEmail({ plannerUrl, preferencesUrl, mailingAddress }) {
  const subject = 'Your Everyday Kitchen Planner is ready.'
  const planner = "Here's the Everyday Kitchen Planner we promised: four printable pages for meals, drinks, favorites, and the week ahead."
  const later = "We'll write as launch gets closer, with recipes and food ideas worth trying."

  const text = [
    "You're confirmed. Welcome to the table.",
    '',
    planner,
    `Download it: ${plannerUrl}`,
    '',
    later,
    '',
    `Change your interests or unsubscribe: ${preferencesUrl}`,
    ...(mailingAddress ? [mailingAddress] : []),
    DISCLAIMER,
  ].join('\n')

  const footer = [
    `<a href="${escapeHtml(preferencesUrl)}" style="color:#B5371C;">Change your interests or unsubscribe</a>`,
    ...(mailingAddress ? [escapeHtml(mailingAddress)] : []),
    escapeHtml(DISCLAIMER),
  ].join('<br />')

  const html = brandLayout(
    `${heading("You're confirmed. Welcome to the table.")}
      ${paragraph(planner)}
      ${button(plannerUrl, 'DOWNLOAD YOUR PLANNER')}
      ${paragraph(later)}`,
    footer,
  )

  return { subject, text, html }
}

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
