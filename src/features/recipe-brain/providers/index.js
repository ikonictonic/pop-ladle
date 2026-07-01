/**
 * Recipe Brain LLM proxy — server-side provider dispatch.
 *
 * The governed equivalent of the prototype's llm-proxy Edge Function: provider
 * API keys live ONLY in server env and are never shipped to a client. Calls are
 * non-streaming so we get real token usage back for cost/observability tracking.
 *
 * Key resolution is PER COMMITTEE MEMBER: each roster role can carry its own
 * key via `<PROVIDER>_API_KEY_<ROLE_KEY>` (e.g. GROQ_API_KEY_NEPHROLOGY,
 * GROQ_API_KEY_CHAIRMAN), giving every specialist its own rate limit. A missing
 * per-role key falls back to the provider-wide `<PROVIDER>_API_KEY`.
 *
 * Production runs Groq-only (every roster row -> groq); the anthropic/gemini
 * adapters are kept wired for later use.
 *
 * callModel() never throws — it always resolves to a uniform result envelope so
 * the orchestrator can log every attempt (ok or error) to llm_proxy_logs.
 */

import { env } from '../../../config/env.js'
import { getDatabasePool } from '../../../database/pool.js'
import { decryptProviderKey } from '../../provider-keys/providerKeyCrypto.js'
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
 * Resolve the API key for a provider + optional committee role.
 *
 * DB-FIRST, ENV-FALLBACK:
 *   1. Per-specialist encrypted key in platform_provider_keys (scope
 *      'roster_member', matched by role_key) — decrypted here.
 *   2. Provider-wide encrypted key in platform_provider_keys (scope 'provider').
 *   3. Per-role env var (`GROQ_API_KEY_NEPHROLOGY`).
 *   4. Provider-wide env var (`GROQ_API_KEY`).
 *   5. '' (caller surfaces a "no key configured" run error).
 *
 * Defensive by design: a missing DB, a missing PROVIDER_KEY_ENC_SECRET, or a
 * decrypt failure NEVER throws — it logs and falls through to the env logic so
 * a committee run can still proceed on env-configured keys.
 *
 * @returns {Promise<string>}
 */
export async function resolveProviderKey(provider, roleKey = null) {
  const entry = PROVIDERS[provider]
  if (!entry || !entry.keyEnv) return ''

  const dbKey = await resolveEncryptedKey(provider, roleKey)
  if (dbKey) return dbKey

  return resolveEnvKey(entry, roleKey)
}

/**
 * Look up + decrypt a stored key. Prefers a per-specialist key (by role_key),
 * then the provider-wide key. Any error resolves to '' so callers fall back to
 * env. Errors are logged to llm_proxy_logs-style stderr (never re-thrown).
 */
async function resolveEncryptedKey(provider, roleKey) {
  // No encryption secret => nothing was ever stored decryptably. Skip cleanly.
  if (!process.env.PROVIDER_KEY_ENC_SECRET || !process.env.PROVIDER_KEY_ENC_SECRET.trim()) {
    return ''
  }

  const db = getDatabasePool()
  if (!db) return ''

  try {
    // Prefer a per-specialist key matched via the roster's role_key.
    if (roleKey) {
      const memberResult = await db.query(
        `
          select k.ciphertext, k.iv, k.auth_tag as "authTag"
          from platform_provider_keys k
          join llm_provider_configs c on c.id = k.roster_member_id
          where k.scope = 'roster_member' and c.role_key = $1
          limit 1
        `,
        [roleKey],
      )
      const memberRow = memberResult.rows[0]
      if (memberRow) {
        const plaintext = decryptProviderKey(memberRow)
        if (plaintext && plaintext.trim()) return plaintext.trim()
      }
    }

    // Fall back to the provider-wide stored key.
    const providerResult = await db.query(
      `
        select ciphertext, iv, auth_tag as "authTag"
        from platform_provider_keys
        where scope = 'provider' and provider = $1
        limit 1
      `,
      [provider],
    )
    const providerRow = providerResult.rows[0]
    if (providerRow) {
      const plaintext = decryptProviderKey(providerRow)
      if (plaintext && plaintext.trim()) return plaintext.trim()
    }
  } catch (err) {
    // Defensive: a DB or decrypt failure must not crash a committee run.
    console.error(
      `[recipe-brain] resolveProviderKey DB lookup failed for provider=${provider} roleKey=${roleKey ?? ''}: ${err.message || err}. Falling back to env.`,
    )
  }

  return ''
}

/**
 * Legacy env resolution: per-role env (`GROQ_API_KEY_NEPHROLOGY`) then
 * provider-wide env (`GROQ_API_KEY`).
 */
function resolveEnvKey(entry, roleKey) {
  if (roleKey) {
    const roleEnvName = `${entry.keyEnv}_${String(roleKey).toUpperCase()}`
    const roleKeyValue = process.env[roleEnvName]
    if (roleKeyValue && roleKeyValue.trim()) return roleKeyValue.trim()
  }

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
 * @param {string} [args.roleKey]  committee role for per-member key resolution
 * @param {'specialist'|'chairman'} [args.purpose]  hint for the mock provider
 * @param {AbortSignal} [args.signal]
 */
export async function callModel({ provider, model, system = '', user, roleKey = null, purpose = 'specialist', signal }) {
  const entry = PROVIDERS[provider]
  const startedAt = performance.now()

  if (!entry) {
    return errorResult(`Unsupported provider: ${provider}`, startedAt)
  }

  if (!model || typeof model !== 'string') {
    return errorResult(`Missing model for provider ${provider}`, startedAt)
  }

  const apiKey = await resolveProviderKey(provider, roleKey)
  if (entry.keyEnv && !apiKey) {
    const roleHint = roleKey ? `${entry.keyEnv}_${String(roleKey).toUpperCase()} or ` : ''
    return errorResult(
      `No API key configured for ${provider} (set ${roleHint}${entry.keyEnv}).`,
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
