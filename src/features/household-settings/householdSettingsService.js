import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'
import { createHttpError, requireHouseholdRole } from '../households/householdAccess.js'

// =============================================================================
// householdSettingsService — per-household app settings (Branding section).
//
// Backs the Control Center "Branding" editor. Replaces the Supabase
// app_settings table + households.patient_display_name. One row per household,
// upserted on save.
//
// default_provider / default_model are stored here for forward-compat with the
// still-legacy Recipe Brain section; backend generation never reads them
// (provider keys are env-only, the committee roster is governed via
// /admin/roster). Until Recipe Brain migrates, only Branding writes this row.
// =============================================================================

const SETTINGS_READ_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']
const SETTINGS_WRITE_ROLES = ['owner', 'co_owner']

// Faithful copy of the legacy DEFAULT_SETTINGS so a household that has never
// saved sees the same fallbacks it did under Supabase.
const DEFAULT_SETTINGS = {
  title: 'Recipe Helper',
  subtitle: "Paste a recipe and I'll adapt it to your household's plan.",
  patientDisplayName: 'Patient',
  caregiverHelpName: '',
  defaultProvider: 'groq',
  defaultModel: '',
}

const MAX_TITLE_LENGTH = 120
const MAX_SUBTITLE_LENGTH = 240
const MAX_NAME_LENGTH = 120
const MAX_PROVIDER_LENGTH = 40
const MAX_MODEL_LENGTH = 120

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

function normalizeOptionalText(value, fieldName, code, maxLength, fallback = null) {
  if (value === undefined || value === null) return fallback

  if (typeof value !== 'string') {
    throw createHttpError(400, code, `${fieldName} must be a string.`, true)
  }

  const normalized = value.trim()

  if (normalized.length > maxLength) {
    throw createHttpError(400, code, `${fieldName} must be ${maxLength} characters or fewer.`, true)
  }

  return normalized
}

function settingsProjection(alias = 's') {
  return `
    ${alias}.household_id as "householdId",
    ${alias}.title,
    ${alias}.subtitle,
    ${alias}.patient_display_name as "patientDisplayName",
    ${alias}.caregiver_help_name as "caregiverHelpName",
    ${alias}.default_provider as "defaultProvider",
    ${alias}.default_model as "defaultModel",
    ${alias}.updated_at as "updatedAt"
  `
}

// Merge a stored row (possibly null) onto the defaults so callers always get a
// complete settings object, even before the household has saved anything.
function shapeSettings(row) {
  return {
    title: row?.title ?? DEFAULT_SETTINGS.title,
    subtitle: row?.subtitle ?? DEFAULT_SETTINGS.subtitle,
    patientDisplayName: row?.patientDisplayName ?? DEFAULT_SETTINGS.patientDisplayName,
    caregiverHelpName: row?.caregiverHelpName ?? DEFAULT_SETTINGS.caregiverHelpName,
    defaultProvider: row?.defaultProvider ?? DEFAULT_SETTINGS.defaultProvider,
    defaultModel: row?.defaultModel ?? DEFAULT_SETTINGS.defaultModel,
    updatedAt: row?.updatedAt ?? null,
  }
}

async function readSettings(db, householdId) {
  const result = await db.query(
    `
      select
        ${settingsProjection('s')}
      from app_settings s
      where s.household_id = $1
      limit 1
    `,
    [householdId],
  )

  return result.rows[0] ?? null
}

function normalizeSettingsPayload(payload) {
  assertPayloadObject(payload)

  const fields = [
    ['title', 'INVALID_TITLE', MAX_TITLE_LENGTH],
    ['subtitle', 'INVALID_SUBTITLE', MAX_SUBTITLE_LENGTH],
    ['patientDisplayName', 'INVALID_PATIENT_NAME', MAX_NAME_LENGTH],
    ['caregiverHelpName', 'INVALID_CAREGIVER_NAME', MAX_NAME_LENGTH],
    ['defaultProvider', 'INVALID_PROVIDER', MAX_PROVIDER_LENGTH],
    ['defaultModel', 'INVALID_MODEL', MAX_MODEL_LENGTH],
  ]

  const updates = {}

  for (const [fieldName, code, maxLength] of fields) {
    if (!Object.hasOwn(payload, fieldName)) continue
    updates[fieldName] = normalizeOptionalText(payload[fieldName], fieldName, code, maxLength)
  }

  if (Object.keys(updates).length === 0) {
    throw createHttpError(400, 'NO_SETTINGS_UPDATES', 'Provide at least one settings field to update.', true)
  }

  return updates
}

export async function getHouseholdSettingsForCurrentUser(clerkUserId, householdId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const access = await requireHouseholdRole(db, user.id, householdId, SETTINGS_READ_ROLES)
  const row = await readSettings(db, access.household.id)

  return {
    household: access.household,
    requester: access.membership,
    settings: shapeSettings(row),
  }
}

export async function saveHouseholdSettingsForCurrentUser(clerkUserId, householdId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const updates = normalizeSettingsPayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, SETTINGS_WRITE_ROLES)

  const columnByField = {
    title: 'title',
    subtitle: 'subtitle',
    patientDisplayName: 'patient_display_name',
    caregiverHelpName: 'caregiver_help_name',
    defaultProvider: 'default_provider',
    defaultModel: 'default_model',
  }

  // Upsert: insert a row on first save (omitted columns stay NULL and fall back
  // to defaults on read), and on conflict update only the provided columns.
  const insertColumns = ['household_id']
  const insertValues = [access.household.id]
  const conflictSets = []

  for (const [fieldName, columnName] of Object.entries(columnByField)) {
    if (!Object.hasOwn(updates, fieldName)) continue
    insertValues.push(updates[fieldName])
    insertColumns.push(columnName)
    conflictSets.push(`${columnName} = excluded.${columnName}`)
  }

  insertValues.push(user.id)
  insertColumns.push('updated_by')
  conflictSets.push('updated_by = excluded.updated_by')
  conflictSets.push('updated_at = now()')

  const placeholders = insertColumns.map((_, i) => `$${i + 1}`).join(', ')

  await db.query(
    `
      insert into app_settings (${insertColumns.join(', ')})
      values (${placeholders})
      on conflict (household_id) do update set
        ${conflictSets.join(',\n        ')}
    `,
    insertValues,
  )

  const row = await readSettings(db, access.household.id)

  await writeAuditLog(db, {
    action: 'household_settings.updated',
    entityType: 'app_settings',
    entityId: access.household.id,
    actorUserId: user.id,
    householdId: access.household.id,
    after: updates,
  })

  return {
    household: access.household,
    requester: access.membership,
    settings: shapeSettings(row),
  }
}
