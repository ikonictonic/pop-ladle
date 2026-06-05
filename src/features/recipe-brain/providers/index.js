/**
 * Recipe Brain LLM proxy — server-side provider dispatch.
 *
 * The governed equivalent of the prototype's llm-proxy Edge Function: provider
 * API keys live ONLY in server env (resolved by provider name here) and are
 * never shipped to a client. Calls are non-streaming so we get real token usage
 * back for cost/observability tracking.
 *
 * callModel() never throws — it always resolves to a uniform result envelope so
 * the orchestrator can log every attempt (ok or error) to llm_proxy_logs.
 */

import { env } from '../../../config/env.js'
import { callAnthropic } from './anthropic.js'
import { callGroq } from './groq.js'
import { callGemini } from './gemini.js'
import { callMock } from './mock.js'

const PROVIDERS = {
  anthropic: { call: callAnthropic, keyEnv: 'ANTHROPIC_API_KEY' },
  groq: { call: callGroq, keyEnv: 'GROQ_API_KEY' },
  gemini: { call: callGemini, keyEnv: 'GEMINI_API_KEY' },
  mock: { call: callMock, keyEnv: null },
}

export function isSupportedProvider(provider) {
  return Object.hasOwn(PROVIDERS, provider)
}

/**
 * Resolve a provider's API key from server env. Returns '' when unset.
 */
export function resolveProviderKey(provider) {
  const entry = PROVIDERS[provider]
  if (!entry || !entry.keyEnv) return ''
  return env[entry.keyEnv] ?? ''
}

/**
 * Call a model. Resolves to:
 *   { ok, content, inputTokens, outputTokens, latencyMs, httpStatus, error }
 *
 * @param {object} args
 * @param {'anthropic'|'groq'|'gemini'|'mock'} args.provider
 * @param {string} args.model
 * @param {string} [args.system]
 * @param {string} args.user
 * @param {'specialist'|'chairman'} [args.purpose]  hint for the mock provider
 * @param {AbortSignal} [args.signal]
 */
export async function callModel({ provider, model, system = '', user, purpose = 'specialist', signal }) {
  const entry = PROVIDERS[provider]
  const startedAt = performance.now()

  if (!entry) {
    return errorResult(`Unsupported provider: ${provider}`, startedAt)
  }

  if (!model || typeof model !== 'string') {
    return errorResult(`Missing model for provider ${provider}`, startedAt)
  }

  const apiKey = entry.keyEnv ? (env[entry.keyEnv] ?? '') : ''
  if (entry.keyEnv && !apiKey) {
    return errorResult(
      `No API key configured for ${provider} (set ${entry.keyEnv}).`,
      startedAt,
    )
  }

  try {
    const result = await entry.call({ apiKey, model, system, user, purpose, signal })
    return {
      ok: true,
      content: result.content ?? '',
      inputTokens: numberOrNull(result.inputTokens),
      outputTokens: numberOrNull(result.outputTokens),
      latencyMs: Math.round(performance.now() - startedAt),
      httpStatus: result.httpStatus ?? 200,
      error: null,
    }
  } catch (err) {
    return errorResult(err.message || String(err), startedAt, err.httpStatus)
  }
}

function errorResult(message, startedAt, httpStatus = null) {
  return {
    ok: false,
    content: '',
    inputTokens: null,
    outputTokens: null,
    latencyMs: Math.round(performance.now() - startedAt),
    httpStatus,
    error: message,
  }
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
