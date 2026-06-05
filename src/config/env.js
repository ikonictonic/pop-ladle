function parsePort(value) {
  const port = Number.parseInt(value ?? '9000', 10)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a valid TCP port. Received: ${value}`)
  }

  return port
}

export const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  HOST: process.env.HOST ?? '0.0.0.0',
  PORT: parsePort(process.env.PORT),
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY ?? '',
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? '',
  // Recipe Brain provider keys — server-side only, resolved by provider name.
  // Never shipped to clients. A missing key surfaces as a per-specialist run
  // error rather than fabricating a clinical verdict.
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '',
  GROQ_API_KEY: process.env.GROQ_API_KEY ?? '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? '',
})
