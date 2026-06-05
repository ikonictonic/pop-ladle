/**
 * Anthropic Messages API adapter (non-streaming).
 * Returns collected text + token usage. Throws on non-2xx.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_TOKENS = 4096

export async function callAnthropic({ apiKey, model, system, user, signal }) {
  const body = {
    model,
    max_tokens: MAX_TOKENS,
    temperature: 0.2,
    top_p: 0.9,
    messages: [{ role: 'user', content: user }],
  }
  if (system) body.system = system

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    throw upstreamError('anthropic', response.status, await safeText(response))
  }

  const data = await response.json()
  const content = (data.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')

  return {
    content,
    inputTokens: data.usage?.input_tokens ?? null,
    outputTokens: data.usage?.output_tokens ?? null,
    httpStatus: response.status,
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
