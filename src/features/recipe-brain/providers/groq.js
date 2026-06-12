/**
 * Groq (OpenAI-compatible chat completions) adapter — non-streaming.
 * Returns collected text + token usage. Throws on non-2xx.
 *
 * 429 handling: Groq rate limits are per-organization per-model (TPM buckets),
 * so all our per-member keys share one bucket. The 8 parallel specialists can
 * exhaust the minute's tokens right before the Chairwoman's synthesis call —
 * on 429 we honor Groq's suggested wait (or Retry-After) and retry, up to
 * MAX_RETRIES times, capped at MAX_WAIT_MS per wait.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const MAX_RETRIES = 2
const MAX_WAIT_MS = 65000
const DEFAULT_WAIT_MS = 20000

function parseRetryDelayMs(response, bodyText) {
  const retryAfter = Number.parseFloat(response.headers?.get?.('retry-after') ?? '')
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter * 1000)

  // Groq error message: "... Please try again in 18.92s."
  const m = /try again in\s+([\d.]+)\s*s/i.exec(bodyText ?? '')
  if (m) return Math.ceil(Number.parseFloat(m[1]) * 1000)

  return DEFAULT_WAIT_MS
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(new Error('Aborted')) }, { once: true })
  })
}

export async function callGroq({ apiKey, model, system, user, signal }) {
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: user })

  const body = JSON.stringify({
    model,
    messages,
    temperature: 0.2,
    top_p: 0.9,
    stream: false,
  })

  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
      signal,
    })

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const text = await safeText(response)
      const waitMs = Math.min(parseRetryDelayMs(response, text), MAX_WAIT_MS)
      await sleep(waitMs + 1000, signal)
      continue
    }

    if (!response.ok) {
      throw upstreamError('groq', response.status, await safeText(response))
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content ?? ''

    return {
      content,
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
      httpStatus: response.status,
    }
  }
}

function upstreamError(provider, status, detail) {
  const err = new Error(`${provider} upstream ${status}: ${detail.slice(0, 300)}`)
  err.httpStatus = status
  return err
}

async function safeText(response) {
  try {
    return await response.text()
  } catch {
    return ''
  }
}
