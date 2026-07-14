function parsePort(value) {
  const port = Number.parseInt(value ?? '9000', 10)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a valid TCP port. Received: ${value}`)
  }

  return port
}

function parsePositiveNumber(value, fallback, name) {
  const parsed = Number(value === undefined || value === '' ? fallback : value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number. Received: ${value}`)
  }
  return parsed
}

const frontendGatePassword = process.env.FRONTEND_GATE_PASSWORD ?? ''
const frontendGateSessionSecret = process.env.FRONTEND_GATE_SESSION_SECRET ?? ''

if (frontendGatePassword && frontendGateSessionSecret.length < 32) {
  throw new Error(
    'FRONTEND_GATE_SESSION_SECRET must be at least 32 characters when FRONTEND_GATE_PASSWORD is set.',
  )
}

export const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  HOST: process.env.HOST ?? '0.0.0.0',
  PORT: parsePort(process.env.PORT),
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY ?? '',
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? '',
  // Recipe Brain provider keys — server-side only. Never shipped to clients;
  // a missing key surfaces as a per-specialist run error rather than
  // fabricating a clinical verdict. Production is Groq-only: each committee
  // member additionally has its own key via GROQ_API_KEY_<ROLE_KEY>
  // (e.g. GROQ_API_KEY_NEPHROLOGY), read dynamically in providers/index.js
  // with these provider-wide values as the fallback.
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  GROQ_API_KEY: process.env.GROQ_API_KEY ?? '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
  // Outbound email — server-side only. A missing RESEND_API_KEY degrades to a
  // console transport rather than failing; never store this key in the DB.
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  EMAIL_FROM: process.env.EMAIL_FROM ?? 'Pop & Ladle <onboarding@resend.dev>',
  // Public app origin used to build absolute invite links in emails.
  APP_BASE_URL: process.env.APP_BASE_URL ?? 'http://localhost:5173',
  // Extra browser origins allowed to call this API (comma-separated). APP_BASE_URL
  // and localhost dev are always allowed. Set to '*' to allow any origin.
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS ?? '',
  // Temporary whole-app preview gate. The password remains server-side; a
  // successful unlock receives a signed HttpOnly cookie. Empty = gate off.
  FRONTEND_GATE_PASSWORD: frontendGatePassword,
  FRONTEND_GATE_SESSION_SECRET: frontendGateSessionSecret,
  FRONTEND_GATE_SESSION_HOURS: parsePositiveNumber(
    process.env.FRONTEND_GATE_SESSION_HOURS,
    12,
    'FRONTEND_GATE_SESSION_HOURS',
  ),
  // Stripe billing — server-side only. Unset STRIPE_SECRET_KEY degrades the
  // billing endpoints to 503 BILLING_NOT_CONFIGURED (matching the S3/Resend
  // posture); the webhook additionally requires STRIPE_WEBHOOK_SECRET for
  // signature verification. STRIPE_API_VERSION is optional — empty string
  // uses the SDK's pinned default.
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  STRIPE_API_VERSION: process.env.STRIPE_API_VERSION ?? '',
  // Object storage (S3-compatible — Cloudflare R2) for recipe photos.
  // Private bucket; presigned URLs only. Unset = storage features return 503.
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? '',
  S3_REGION: process.env.S3_REGION ?? 'auto',
  S3_BUCKET: process.env.S3_BUCKET ?? '',
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? '',
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? '',
})
