import crypto from 'node:crypto'
import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
} from '../households/householdAccess.js'

// =============================================================================
// cmsApiKeyService — owner-managed CMS bearer tokens.
//
// Backs the Control Center "API Keys" editor. Replaces the Supabase
// cms_api_keys table. Token format: pl_<64 hex> (32 random bytes). We persist
// only the SHA-256 hash + an 8-char display prefix; the plaintext is returned
// exactly once from create and never stored.
//
// Token generation + hashing run SERVER-SIDE here (the legacy Supabase version
// did it in the browser). Management is owner / co_owner only. Revocation is a
// soft revoked_at stamp so the audit trail (who created it, last use) survives.
// =============================================================================

const CMS_KEY_ROLES = ['owner', 'co_owner']
const TOKEN_PREFIX = 'pl_'
const RANDOM_BYTES = 32 // 256 bits of entropy
const DEFAULT_SCOPES = ['read_recipes']
const ALLOWED_SCOPES = ['read_recipes']
const MAX_NAME_LENGTH = 120

function getDbOrThrow() {
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  return db
}

function assertPayloadObject(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
}

function generateToken() {
  return `${TOKEN_PREFIX}${crypto.randomBytes(RANDOM_BYTES).toString('hex')}`
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function normalizeKeyId(value) {
  return normalizeUuid(value, 'INVALID_CMS_API_KEY_ID', 'CMS API key id must be a UUID.')
}

function normalizeName(value) {
  if (typeof value !== 'string') {
    throw createHttpError(400, 'INVALID_CMS_API_KEY_NAME', 'name must be a string.', true)
  }

  const normalized = value.trim()

  if (!normalized) {
    throw createHttpError(400, 'INVALID_CMS_API_KEY_NAME', 'name cannot be blank.', true)
  }

  if (normalized.length > MAX_NAME_LENGTH) {
    throw createHttpError(400, 'INVALID_CMS_API_KEY_NAME', `name must be ${MAX_NAME_LENGTH} characters or fewer.`, true)
  }

  return normalized
}

function normalizeScopes(value) {
  if (value === undefined || value === null) return [...DEFAULT_SCOPES]

  if (!Array.isArray(value)) {
    throw createHttpError(400, 'INVALID_CMS_API_KEY_SCOPES', 'scopes must be an array.', true)
  }

  const scopes = value.map((scope) => String(scope))

  for (const scope of scopes) {
    if (!ALLOWED_SCOPES.includes(scope)) {
      throw createHttpError(400, 'INVALID_CMS_API_KEY_SCOPES', `Unknown scope: ${scope}.`, true)
    }
  }

  return scopes.length ? [...new Set(scopes)] : [...DEFAULT_SCOPES]
}

function normalizeExpiresAt(value) {
  if (value === undefined || value === null || value === '') return null

  if (typeof value !== 'string') {
    throw createHttpError(400, 'INVALID_EXPIRES_AT', 'expiresAt must be a date string.', true)
  }

  const parsed = new Date(value)

  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError(400, 'INVALID_EXPIRES_AT', 'expiresAt must be a valid date.', true)
  }

  return parsed.toISOString()
}

function keyProjection(alias = 'k') {
  return `
    ${alias}.id,
    ${alias}.household_id as "householdId",
    ${alias}.name,
    ${alias}.token_prefix as "tokenPrefix",
    ${alias}.scopes,
    ${alias}.expires_at as "expiresAt",
    ${alias}.last_used_at as "lastUsedAt",
    ${alias}.revoked_at as "revokedAt",
    ${alias}.created_at as "createdAt"
  `
}

async function readKeyById(db, householdId, keyId) {
  const result = await db.query(
    `
      select
        ${keyProjection('k')}
      from cms_api_keys k
      where k.id = $1
        and k.household_id = $2
      limit 1
    `,
    [keyId, householdId],
  )

  return result.rows[0] ?? null
}

export async function listCmsApiKeysForCurrentUser(clerkUserId, householdId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const access = await requireHouseholdRole(db, user.id, householdId, CMS_KEY_ROLES)
  const result = await db.query(
    `
      select
        ${keyProjection('k')}
      from cms_api_keys k
      where k.household_id = $1
      order by k.created_at desc
    `,
    [access.household.id],
  )

  return {
    household: access.household,
    requester: access.membership,
    apiKeys: result.rows,
  }
}

export async function createCmsApiKeyForCurrentUser(clerkUserId, householdId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  assertPayloadObject(payload)
  const name = normalizeName(payload.name)
  const scopes = normalizeScopes(payload.scopes)
  const expiresAt = normalizeExpiresAt(payload.expiresAt)
  const access = await requireHouseholdRole(db, user.id, householdId, CMS_KEY_ROLES)

  const token = generateToken()
  const tokenHash = sha256Hex(token)
  const tokenPrefix = token.slice(0, 8) // "pl_xxxxx"

  const result = await db.query(
    `
      insert into cms_api_keys (
        household_id, name, token_hash, token_prefix, scopes, expires_at, created_by
      )
      values ($1, $2, $3, $4, $5, $6, $7)
      returning id
    `,
    [access.household.id, name, tokenHash, tokenPrefix, scopes, expiresAt, user.id],
  )

  const apiKey = await readKeyById(db, access.household.id, result.rows[0].id)

  await writeAuditLog(db, {
    action: 'cms_api_key.created',
    entityType: 'cms_api_key',
    entityId: apiKey.id,
    actorUserId: user.id,
    householdId: access.household.id,
    after: { name, scopes },
  })

  // The plaintext token is returned exactly once and never persisted.
  return {
    household: access.household,
    requester: access.membership,
    apiKey,
    token,
  }
}

export async function renameCmsApiKeyForCurrentUser(clerkUserId, householdId, keyId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  assertPayloadObject(payload)
  const normalizedId = normalizeKeyId(keyId)
  const name = normalizeName(payload.name)
  const access = await requireHouseholdRole(db, user.id, householdId, CMS_KEY_ROLES)

  const result = await db.query(
    `update cms_api_keys set name = $3 where id = $1 and household_id = $2 returning id`,
    [normalizedId, access.household.id, name],
  )

  if (!result.rows[0]) {
    throw createHttpError(404, 'CMS_API_KEY_NOT_FOUND', 'API key was not found.', true)
  }

  const apiKey = await readKeyById(db, access.household.id, normalizedId)

  await writeAuditLog(db, {
    action: 'cms_api_key.renamed',
    entityType: 'cms_api_key',
    entityId: normalizedId,
    actorUserId: user.id,
    householdId: access.household.id,
    after: { name },
  })

  return {
    household: access.household,
    requester: access.membership,
    apiKey,
  }
}

export async function revokeCmsApiKeyForCurrentUser(clerkUserId, householdId, keyId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const normalizedId = normalizeKeyId(keyId)
  const access = await requireHouseholdRole(db, user.id, householdId, CMS_KEY_ROLES)

  // Soft revoke; coalesce keeps the original timestamp if already revoked.
  const result = await db.query(
    `
      update cms_api_keys
      set revoked_at = coalesce(revoked_at, now())
      where id = $1
        and household_id = $2
      returning id
    `,
    [normalizedId, access.household.id],
  )

  if (!result.rows[0]) {
    throw createHttpError(404, 'CMS_API_KEY_NOT_FOUND', 'API key was not found.', true)
  }

  const apiKey = await readKeyById(db, access.household.id, normalizedId)

  await writeAuditLog(db, {
    action: 'cms_api_key.revoked',
    entityType: 'cms_api_key',
    entityId: normalizedId,
    actorUserId: user.id,
    householdId: access.household.id,
  })

  return {
    household: access.household,
    requester: access.membership,
    apiKey,
  }
}
