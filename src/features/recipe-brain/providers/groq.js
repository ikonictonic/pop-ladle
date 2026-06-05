/**
 * Groq (OpenAI-compatible chat completions) adapter — non-streaming.
 * Returns collected text + token usage. Throws on non-2xx.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

export async function callGroq({ apiKey, model, system, user, signal }) {
  const messages = []
  if (system) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: user })

  const response = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      top_p: 0.9,
      stream: false,
    }),
    signal,
  })

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
