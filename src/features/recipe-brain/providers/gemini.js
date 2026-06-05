/**
 * Google Gemini (generateContent) adapter — non-streaming.
 * Returns collected text + token usage. Throws on non-2xx.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export async function callGemini({ apiKey, model, system, user, signal }) {
  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature: 0.2, topP: 0.9 },
  }
  if (system) body.systemInstruction = { parts: [{ text: system }] }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    throw upstreamError('gemini', response.status, await safeText(response))
  }

  const data = await response.json()
  const content = (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text)
    .filter((text) => typeof text === 'string')
    .join('')

  return {
    content,
    inputTokens: data.usageMetadata?.promptTokenCount ?? null,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
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
