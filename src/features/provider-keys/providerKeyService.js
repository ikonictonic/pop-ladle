/**
 * providerKeyService — platform LLM provider API key management (encrypted).
 *
 * Backs the Control Center "Recipe Brain" (RecipeBrainSection) provider-key
 * editor and, via helpers, the "Care Team" (CareTeamSection) per-specialist key
 * editor. Replaces the Supabase services platformProviderKeysService and
 * committeeMemberKeysService, which stored plaintext keys guarded only by RLS.
 *
 * Here the plaintext is encrypted with AES-256-GCM (providerKeyCrypto) and
 * never returned to any client — reads return only { provider, isSet,
 * maskedKey, updatedAt }. All endpoints are PLATFORM super-admin only.
 *
 * Feature placement: this lives in its own feature (not super-admin) because
 * the encryption concern + the shared upsert helper are consumed from two
 * places — these /admin/provider-keys routes AND the recipe-brain proxy's
 * resolveProviderKey (DB-first key lookup). Keeping the crypto + table access
 * in one feature avoids super-admin importing recipe-brain and vice versa.
 */

import { writeAuditLog } from '../audit-log/auditLogService.js'
import { createHttpError } from '../households/householdAccess.js'
import { requireInternalAdmin, SUPER_ONLY } from '../super-admin/adminAccess.js'
import {
  encryptProviderKey,
  isProviderKeyEncryptionConfigured,
  maskFromLast4,
} from './providerKeyCrypto.js'

// Providers whose keys can be managed. Mirrors the recipe-brain adapters and
// the llm_provider_configs.provider check constraint ('mock' takes no key).
const SUPPORTED_PROVIDERS = ['groq', 'gemini', 'anthropic']

const MAX_KEY_LENGTH = 512

function assertEncryptionConfigured() {
  if (!isProviderKeyEncryptionConfigured()) {
    throw createHttpError(
      503,
      'PROVIDER_KEY_ENCRYPTION_UNAVAILABLE',
      'PROVIDER_KEY_ENC_SECRET is not set; provider key management is disabled.',
      true,
    )
  }
}

function assertPayloadObject(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
}

function normalizeProvider(value) {
  if (!SUPPORTED_PROVIDERS.includes(value)) {
    throw createHttpError(
      400,
      'INVALID_PROVIDER',
      `provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}.`,
      true,
    )
  }
  return value
}

function normalizeApiKey(value) {
  if (typeof value !== 'string') {
    throw createHttpError(400, 'INVALID_API_KEY', 'apiKey must be a string.', true)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw createHttpError(400, 'INVALID_API_KEY', 'apiKey cannot be blank.', true)
  }
  if (trimmed.length > MAX_KEY_LENGTH) {
    throw createHttpError(400, 'INVALID_API_KEY', `apiKey must be ${MAX_KEY_LENGTH} characters or fewer.`, true)
  }
  return trimmed
}

/**
 * Shape a provider-wide key row (or absence) into the read contract. Never
 * includes any decrypted material.
 */
function toProviderReadShape(provider, row) {
  return {
    provider,
    isSet: Boolean(row),
    maskedKey: row ? maskFromLast4(row.last4) : null,
    updatedAt: row ? row.updated_at : null,
  }
}

// ---------------------------------------------------------------------------
// GET /admin/provider-keys
// ---------------------------------------------------------------------------

export async function listProviderKeysForAdmin(clerkUserId) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, SUPER_ONLY)

  const result = await db.query(
    `
      select provider, last4, updated_at
      from platform_provider_keys
      where scope = 'provider'
    `,
  )
  const byProvider = new Map(result.rows.map((row) => [row.provider, row]))

  const providers = SUPPORTED_PROVIDERS.map((provider) =>
    toProviderReadShape(provider, byProvider.get(provider) ?? null),
  )

  return { adminRole: admin.role, providers }
}

// ---------------------------------------------------------------------------
// PUT /admin/provider-keys/:provider
// ---------------------------------------------------------------------------

export async function setProviderKeyForAdmin(clerkUserId, providerParam, payload) {
  assertEncryptionConfigured()
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, SUPER_ONLY)
  assertPayloadObject(payload)

  const provider = normalizeProvider(providerParam)
  const apiKey = normalizeApiKey(payload.apiKey)
  const { ciphertext, iv, authTag, last4 } = encryptProviderKey(apiKey)

  const result = await db.query(
    `
      insert into platform_provider_keys
        (scope, provider, roster_member_id, ciphertext, iv, auth_tag, last4, updated_by)
      values ('provider', $1, null, $2, $3, $4, $5, $6)
      on conflict (provider) where scope = 'provider'
      do update set
        ciphertext = excluded.ciphertext,
        iv = excluded.iv,
        auth_tag = excluded.auth_tag,
        last4 = excluded.last4,
        updated_by = excluded.updated_by,
        updated_at = now()
      returning id, provider, last4, updated_at
    `,
    [provider, ciphertext, iv, authTag, last4, user.id],
  )
  const row = result.rows[0]

  await writeAuditLog(db, {
    action: 'admin.provider_key_set',
    entityType: 'platform_provider_key',
    entityId: row.id,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    after: { provider, scope: 'provider', maskedKey: maskFromLast4(row.last4) },
  })

  return { adminRole: admin.role, providerKey: toProviderReadShape(provider, row) }
}

// ---------------------------------------------------------------------------
// DELETE /admin/provider-keys/:provider
// ---------------------------------------------------------------------------

export async function deleteProviderKeyForAdmin(clerkUserId, providerParam) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, SUPER_ONLY)
  const provider = normalizeProvider(providerParam)

  const result = await db.query(
    `
      delete from platform_provider_keys
      where scope = 'provider' and provider = $1
      returning id
    `,
    [provider],
  )

  if (!result.rows[0]) {
    throw createHttpError(404, 'PROVIDER_KEY_NOT_FOUND', 'No key is configured for that provider.', true)
  }

  await writeAuditLog(db, {
    action: 'admin.provider_key_deleted',
    entityType: 'platform_provider_key',
    entityId: result.rows[0].id,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    before: { provider, scope: 'provider' },
  })

  return { adminRole: admin.role, providerKey: toProviderReadShape(provider, null) }
}

// ---------------------------------------------------------------------------
// Shared helper — per-specialist (roster_member) key upsert.
//
// Used by the super-admin roster route PUT /admin/roster/:id/key so the roster
// CRUD stays with the other roster endpoints while the encryption + table
// access stays here. Runs inside the caller's already-authorized context (the
// caller has already resolved the roster row and its admin identity).
// ---------------------------------------------------------------------------

export async function upsertRosterMemberKey(db, { rosterMemberId, provider, apiKey, updatedByUserId }) {
  assertEncryptionConfigured()
  const normalizedKey = normalizeApiKey(apiKey)
  normalizeProvider(provider)
  const { ciphertext, iv, authTag, last4 } = encryptProviderKey(normalizedKey)

  const result = await db.query(
    `
      insert into platform_provider_keys
        (scope, provider, roster_member_id, ciphertext, iv, auth_tag, last4, updated_by)
      values ('roster_member', $1, $2, $3, $4, $5, $6, $7)
      on conflict (roster_member_id) where scope = 'roster_member'
      do update set
        provider = excluded.provider,
        ciphertext = excluded.ciphertext,
        iv = excluded.iv,
        auth_tag = excluded.auth_tag,
        last4 = excluded.last4,
        updated_by = excluded.updated_by,
        updated_at = now()
      returning id, provider, last4, updated_at
    `,
    [provider, rosterMemberId, ciphertext, iv, authTag, last4, updatedByUserId],
  )
  const row = result.rows[0]

  return {
    id: row.id,
    isSet: true,
    maskedKey: maskFromLast4(row.last4),
    updatedAt: row.updated_at,
  }
}

export { SUPPORTED_PROVIDERS as PROVIDER_KEY_SUPPORTED_PROVIDERS }
