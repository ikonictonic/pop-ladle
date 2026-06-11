/**
 * Shared email rendering helpers — HTML escaping and the common branded
 * wrapper. Keep template-specific copy in the individual template modules.
 */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Wrap inner body HTML in the Pop & Ladle email chrome.
 * `innerHtml` is inserted verbatim — callers must escape dynamic values.
 */
export function emailLayout(innerHtml) {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
      <h1 style="font-size:20px;color:#111827;margin:0 0 16px;">Pop &amp; Ladle</h1>
      ${innerHtml}
    </div>
  </body>
</html>`
}

export function primaryButton(url, label) {
  return `<p style="margin:24px 0;">
    <a href="${escapeHtml(url)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:15px;">${escapeHtml(label)}</a>
  </p>`
}

export function formatDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}
