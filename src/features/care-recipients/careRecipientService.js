import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
} from '../households/householdAccess.js'

const CARE_RECIPIENT_READ_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']
const CARE_RECIPIENT_WRITE_ROLES = ['owner', 'co_owner', 'caregiver']
const CARE_RECIPIENT_STATUSES = ['active', 'archived']
const MAX_DISPLAY_NAME_LENGTH = 120
const MAX_RELATIONSHIP_LABEL_LENGTH = 120
const MAX_PROFILE_TEXT_LENGTH = 50000
const MIN_SORT_ORDER = 0
const MAX_SORT_ORDER = 10000
const DEFAULT_SORT_ORDER = 100

function getDbOrThrow() {
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  return db
}

function normalizeCareRecipientId(value) {
  return normalizeUuid(
    value,
    'INVALID_CARE_RECIPIENT_ID',
    'Care recipient id must be a UUID.',
  )
}

function hasOwn(payload, fieldName) {
  return Object.hasOwn(payload, fieldName)
}

function assertPayloadObject(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
}

function normalizeRequiredText(value, fieldName, code, maxLength) {
  if (typeof value !== 'string') {
    throw createHttpError(400, code, `${fieldName} must be a string.`, true)
  }

  const normalized = value.trim()

  if (!normalized) {
    throw createHttpError(400, code, `${fieldName} cannot be blank.`, true)
  }

  if (normalized.length > maxLength) {
    throw createHttpError(400, code, `${fieldName} must be ${maxLength} characters or fewer.`, true)
  }

  return normalized
}

function normalizeOptionalText(value, fieldName, code, maxLength) {
  if (value === undefined) return undefined
  if (value === null) return null

  if (typeof value !== 'string') {
    throw createHttpError(400, code, `${fieldName} must be a string.`, true)
  }

  const normalized = value.trim()

  if (!normalized) return null

  if (normalized.length > maxLength) {
    throw createHttpError(400, code, `${fieldName} must be ${maxLength} characters or fewer.`, true)
  }

  return normalized
}

function normalizeSortOrder(value, fallback = DEFAULT_SORT_ORDER) {
  if (value === undefined || value === null || value === '') return fallback

  const normalized = Number(value)

  if (
    !Number.isInteger(normalized) ||
    normalized < MIN_SORT_ORDER ||
    normalized > MAX_SORT_ORDER
  ) {
    throw createHttpError(
      400,
      'INVALID_SORT_ORDER',
      `sortOrder must be an integer between ${MIN_SORT_ORDER} and ${MAX_SORT_ORDER}.`,
      true,
    )
  }

  return normalized
}

function normalizeStatus(value) {
  if (!CARE_RECIPIENT_STATUSES.includes(value)) {
    throw createHttpError(
      400,
      'INVALID_CARE_RECIPIENT_STATUS',
      `status must be one of: ${CARE_RECIPIENT_STATUSES.join(', ')}.`,
      true,
    )
  }

  return value
}

function normalizeJsonObject(value, fieldName) {
  if (value === undefined) return undefined
  if (value === null) return {}

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createHttpError(400, 'INVALID_JSON_OBJECT', `${fieldName} must be a JSON object.`, true)
  }

  return value
}

function normalizeProfileText(value) {
  if (value === undefined) return undefined
  if (value === null) return ''

  if (typeof value !== 'string') {
    throw createHttpError(400, 'INVALID_PROFILE_TEXT', 'profileText must be a string.', true)
  }

  if (value.length > MAX_PROFILE_TEXT_LENGTH) {
    throw createHttpError(
      400,
      'INVALID_PROFILE_TEXT',
      `profileText must be ${MAX_PROFILE_TEXT_LENGTH} characters or fewer.`,
      true,
    )
  }

  return value
}

function normalizeCreateCareRecipientPayload(payload) {
  assertPayloadObject(payload)

  return {
    displayName: normalizeRequiredText(
      payload.displayName,
      'displayName',
      'INVALID_CARE_RECIPIENT_DISPLAY_NAME',
      MAX_DISPLAY_NAME_LENGTH,
    ),
    relationshipLabel:
      normalizeOptionalText(
        payload.relationshipLabel,
        'relationshipLabel',
        'INVALID_RELATIONSHIP_LABEL',
        MAX_RELATIONSHIP_LABEL_LENGTH,
      ) ?? null,
    sortOrder: normalizeSortOrder(payload.sortOrder),
    profileText: normalizeProfileText(payload.profileText) ?? '',
    completedSections: normalizeJsonObject(payload.completedSections, 'completedSections') ?? {},
    sourceSummary: normalizeJsonObject(payload.sourceSummary, 'sourceSummary') ?? {},
  }
}

function normalizeUpdateCareRecipientPayload(payload) {
  assertPayloadObject(payload)

  const updates = {}

  if (hasOwn(payload, 'displayName')) {
    updates.displayName = normalizeRequiredText(
      payload.displayName,
      'displayName',
      'INVALID_CARE_RECIPIENT_DISPLAY_NAME',
      MAX_DISPLAY_NAME_LENGTH,
    )
  }

  if (hasOwn(payload, 'relationshipLabel')) {
    updates.relationshipLabel =
      normalizeOptionalText(
        payload.relationshipLabel,
        'relationshipLabel',
        'INVALID_RELATIONSHIP_LABEL',
        MAX_RELATIONSHIP_LABEL_LENGTH,
      ) ?? null
  }

  if (hasOwn(payload, 'sortOrder')) {
    updates.sortOrder = normalizeSortOrder(payload.sortOrder)
  }

  if (hasOwn(payload, 'status')) {
    updates.status = normalizeStatus(payload.status)
  }

  if (Object.keys(updates).length === 0) {
    throw createHttpError(
      400,
      'NO_CARE_RECIPIENT_UPDATES',
      'Provide at least one care recipient field to update.',
      true,
    )
  }

  return updates
}

function normalizeUpdateCareProfilePayload(payload) {
  assertPayloadObject(payload)

  const updates = {}

  if (hasOwn(payload, 'profileText')) {
    updates.profileText = normalizeProfileText(payload.profileText)
  }

  if (hasOwn(payload, 'completedSections')) {
    updates.completedSections = normalizeJsonObject(payload.completedSections, 'completedSections')
  }

  if (hasOwn(payload, 'sourceSummary')) {
    updates.sourceSummary = normalizeJsonObject(payload.sourceSummary, 'sourceSummary')
  }

  if (Object.keys(updates).length === 0) {
    throw createHttpError(
      400,
      'NO_CARE_PROFILE_UPDATES',
      'Provide at least one care profile field to update.',
      true,
    )
  }

  return updates
}

function normalizeListQuery(query = {}) {
  return {
    includeArchived: query.includeArchived === 'true' || query.includeArchived === true,
  }
}

function careRecipientWithProfileProjection() {
  return `
    cr.id,
    cr.household_id as "householdId",
    cr.display_name as "displayName",
    cr.relationship_label as "relationshipLabel",
    cr.status,
    cr.sort_order as "sortOrder",
    cr.created_by as "createdByUserId",
    cr.updated_by as "updatedByUserId",
    cr.archived_at as "archivedAt",
    cr.created_at as "createdAt",
    cr.updated_at as "updatedAt",
    cp.id as "profileId",
    cp.profile_text as "profileText",
    cp.completed_sections as "completedSections",
    cp.source_summary as "sourceSummary",
    cp.updated_by as "profileUpdatedByUserId",
    cp.created_at as "profileCreatedAt",
    cp.updated_at as "profileUpdatedAt"
  `
}

function mapProfile(row) {
  return {
    id: row.profileId ?? null,
    careRecipientId: row.id,
    profileText: row.profileText ?? '',
    completedSections: row.completedSections ?? {},
    sourceSummary: row.sourceSummary ?? {},
    updatedByUserId: row.profileUpdatedByUserId ?? null,
    createdAt: row.profileCreatedAt ?? null,
    updatedAt: row.profileUpdatedAt ?? null,
  }
}

function mapCareRecipient(row) {
  return {
    id: row.id,
    householdId: row.householdId,
    displayName: row.displayName,
    relationshipLabel: row.relationshipLabel,
    status: row.status,
    sortOrder: row.sortOrder,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    profile: mapProfile(row),
  }
}

async function readCareRecipientById(db, householdId, careRecipientId, includeArchived = false) {
  const result = await db.query(
    `
      select
        ${careRecipientWithProfileProjection()}
      from care_recipients cr
      left join care_profiles cp on cp.care_recipient_id = cr.id
      where cr.id = $1
        and cr.household_id = $2
        and ($3::boolean = true or cr.status = 'active')
      limit 1
    `,
    [careRecipientId, householdId, includeArchived],
  )

  return result.rows[0] ? mapCareRecipient(result.rows[0]) : null
}

async function insertCareRecipient(client, householdId, userId, payload) {
  const recipientResult = await client.query(
    `
      insert into care_recipients (
        household_id,
        display_name,
        relationship_label,
        sort_order,
        created_by,
        updated_by
      )
      values ($1, $2, $3, $4, $5, $5)
      returning id
    `,
    [householdId, payload.displayName, payload.relationshipLabel, payload.sortOrder, userId],
  )
  const careRecipientId = recipientResult.rows[0].id

  await client.query(
    `
      insert into care_profiles (
        care_recipient_id,
        profile_text,
        completed_sections,
        source_summary,
        updated_by
      )
      values ($1, $2, $3, $4, $5)
    `,
    [
      careRecipientId,
      payload.profileText,
      payload.completedSections,
      payload.sourceSummary,
      userId,
    ],
  )

  return readCareRecipientById(client, householdId, careRecipientId, true)
}

async function updateCareRecipient(db, householdId, careRecipientId, userId, updates) {
  const values = [careRecipientId, householdId]
  const setClauses = []

  if (hasOwn(updates, 'displayName')) {
    values.push(updates.displayName)
    setClauses.push(`display_name = $${values.length}`)
  }

  if (hasOwn(updates, 'relationshipLabel')) {
    values.push(updates.relationshipLabel)
    setClauses.push(`relationship_label = $${values.length}`)
  }

  if (hasOwn(updates, 'sortOrder')) {
    values.push(updates.sortOrder)
    setClauses.push(`sort_order = $${values.length}`)
  }

  if (hasOwn(updates, 'status')) {
    values.push(updates.status)
    setClauses.push(`status = $${values.length}::care_recipient_status`)
    setClauses.push(
      updates.status === 'archived'
        ? 'archived_at = coalesce(archived_at, now())'
        : 'archived_at = null',
    )
  }

  values.push(userId)
  setClauses.push(`updated_by = $${values.length}`)
  setClauses.push('updated_at = now()')

  const result = await db.query(
    `
      update care_recipients
      set
        ${setClauses.join(',\n        ')}
      where id = $1
        and household_id = $2
      returning id
    `,
    values,
  )

  if (!result.rows[0]) return null

  return readCareRecipientById(db, householdId, careRecipientId, true)
}

async function ensureCareProfile(db, careRecipientId, userId) {
  await db.query(
    `
      insert into care_profiles (care_recipient_id, updated_by)
      values ($1, $2)
      on conflict (care_recipient_id) do nothing
    `,
    [careRecipientId, userId],
  )
}

async function updateCareProfile(db, careRecipientId, userId, updates) {
  await ensureCareProfile(db, careRecipientId, userId)

  const values = [careRecipientId]
  const setClauses = []

  if (hasOwn(updates, 'profileText')) {
    values.push(updates.profileText)
    setClauses.push(`profile_text = $${values.length}`)
  }

  if (hasOwn(updates, 'completedSections')) {
    values.push(updates.completedSections)
    setClauses.push(`completed_sections = $${values.length}`)
  }

  if (hasOwn(updates, 'sourceSummary')) {
    values.push(updates.sourceSummary)
    setClauses.push(`source_summary = $${values.length}`)
  }

  values.push(userId)
  setClauses.push(`updated_by = $${values.length}`)
  setClauses.push('updated_at = now()')

  const result = await db.query(
    `
      update care_profiles cp
      set
        ${setClauses.join(',\n        ')}
      where cp.care_recipient_id = $1
      returning
        cp.id as "profileId",
        cp.care_recipient_id as id,
        cp.profile_text as "profileText",
        cp.completed_sections as "completedSections",
        cp.source_summary as "sourceSummary",
        cp.updated_by as "profileUpdatedByUserId",
        cp.created_at as "profileCreatedAt",
        cp.updated_at as "profileUpdatedAt"
    `,
    values,
  )

  return mapProfile(result.rows[0])
}

export async function listCareRecipientsForCurrentUser(clerkUserId, householdId, query) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const filters = normalizeListQuery(query)
  const access = await requireHouseholdRole(db, user.id, householdId, CARE_RECIPIENT_READ_ROLES)
  const result = await db.query(
    `
      select
        ${careRecipientWithProfileProjection()}
      from care_recipients cr
      left join care_profiles cp on cp.care_recipient_id = cr.id
      where cr.household_id = $1
        and ($2::boolean = true or cr.status = 'active')
      order by
        case cr.status when 'active' then 1 else 2 end,
        cr.sort_order asc,
        cr.created_at asc
    `,
    [access.household.id, filters.includeArchived],
  )

  return {
    household: access.household,
    requester: access.membership,
    careRecipients: result.rows.map(mapCareRecipient),
  }
}

export async function createCareRecipientForCurrentUser(clerkUserId, householdId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const careRecipientPayload = normalizeCreateCareRecipientPayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, CARE_RECIPIENT_WRITE_ROLES)
  const client = await db.connect()

  try {
    await client.query('begin')

    const careRecipient = await insertCareRecipient(
      client,
      access.household.id,
      user.id,
      careRecipientPayload,
    )

    await client.query('commit')

    return {
      household: access.household,
      requester: access.membership,
      careRecipient,
    }
  } catch (err) {
    try {
      await client.query('rollback')
    } catch {
      // Preserve the original error from the failed transaction.
    }
    throw err
  } finally {
    client.release()
  }
}

export async function getCareRecipientForCurrentUser(clerkUserId, householdId, careRecipientId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const normalizedCareRecipientId = normalizeCareRecipientId(careRecipientId)
  const access = await requireHouseholdRole(db, user.id, householdId, CARE_RECIPIENT_READ_ROLES)
  const careRecipient = await readCareRecipientById(
    db,
    access.household.id,
    normalizedCareRecipientId,
    true,
  )

  if (!careRecipient) {
    throw createHttpError(404, 'CARE_RECIPIENT_NOT_FOUND', 'Care recipient was not found.', true)
  }

  return {
    household: access.household,
    requester: access.membership,
    careRecipient,
  }
}

export async function updateCareRecipientForCurrentUser(
  clerkUserId,
  householdId,
  careRecipientId,
  payload,
) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const normalizedCareRecipientId = normalizeCareRecipientId(careRecipientId)
  const updates = normalizeUpdateCareRecipientPayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, CARE_RECIPIENT_WRITE_ROLES)
  const careRecipient = await updateCareRecipient(
    db,
    access.household.id,
    normalizedCareRecipientId,
    user.id,
    updates,
  )

  if (!careRecipient) {
    throw createHttpError(404, 'CARE_RECIPIENT_NOT_FOUND', 'Care recipient was not found.', true)
  }

  return {
    household: access.household,
    requester: access.membership,
    careRecipient,
  }
}

export async function getCareProfileForCurrentUser(clerkUserId, householdId, careRecipientId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const normalizedCareRecipientId = normalizeCareRecipientId(careRecipientId)
  const access = await requireHouseholdRole(db, user.id, householdId, CARE_RECIPIENT_READ_ROLES)
  const careRecipient = await readCareRecipientById(
    db,
    access.household.id,
    normalizedCareRecipientId,
    true,
  )

  if (!careRecipient) {
    throw createHttpError(404, 'CARE_RECIPIENT_NOT_FOUND', 'Care recipient was not found.', true)
  }

  return {
    household: access.household,
    requester: access.membership,
    careRecipient: {
      id: careRecipient.id,
      displayName: careRecipient.displayName,
      status: careRecipient.status,
    },
    profile: careRecipient.profile,
  }
}

export async function updateCareProfileForCurrentUser(
  clerkUserId,
  householdId,
  careRecipientId,
  payload,
) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const normalizedCareRecipientId = normalizeCareRecipientId(careRecipientId)
  const updates = normalizeUpdateCareProfilePayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, CARE_RECIPIENT_WRITE_ROLES)
  const careRecipient = await readCareRecipientById(
    db,
    access.household.id,
    normalizedCareRecipientId,
    true,
  )

  if (!careRecipient) {
    throw createHttpError(404, 'CARE_RECIPIENT_NOT_FOUND', 'Care recipient was not found.', true)
  }

  const profile = await updateCareProfile(db, normalizedCareRecipientId, user.id, updates)

  return {
    household: access.household,
    requester: access.membership,
    careRecipient: {
      id: careRecipient.id,
      displayName: careRecipient.displayName,
      status: careRecipient.status,
    },
    profile,
  }
}
