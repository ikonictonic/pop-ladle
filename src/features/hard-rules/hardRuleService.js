import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
  requireHouseholdCapability,
} from '../households/householdAccess.js'

const HARD_RULE_READ_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']
const HARD_RULE_WRITE_ROLES = ['owner', 'co_owner', 'caregiver']
const RULE_TYPES = ['replace', 'remove', 'avoid', 'require']
const SEVERITIES = ['hard', 'soft']
const MAX_RULE_TEXT_LENGTH = 240
const MAX_REPLACEMENT_LENGTH = 500
const MAX_TRIGGER_TERM_LENGTH = 80
const MAX_TRIGGER_TERMS = 50
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

function hasOwn(payload, fieldName) {
  return Object.hasOwn(payload, fieldName)
}

function normalizeHardRuleId(value) {
  return normalizeUuid(value, 'INVALID_HARD_RULE_ID', 'Hard rule id must be a UUID.')
}

function normalizeOptionalCareRecipientId(value) {
  if (value === undefined || value === null || value === '') return null

  return normalizeUuid(
    value,
    'INVALID_CARE_RECIPIENT_ID',
    'careRecipientId must be a UUID.',
  )
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

function normalizeOptionalText(value, fieldName, code, maxLength, fallback = '') {
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

function normalizeTriggerTerms(value) {
  if (value === undefined || value === null || value === '') return []

  const rawTerms = Array.isArray(value)
    ? value
    : `${value}`.split(/[\n,]+/)
  const terms = rawTerms
    .map((term) => (typeof term === 'string' ? term.trim() : ''))
    .filter(Boolean)

  if (terms.length > MAX_TRIGGER_TERMS) {
    throw createHttpError(
      400,
      'INVALID_TRIGGER_TERMS',
      `triggerTerms can include at most ${MAX_TRIGGER_TERMS} values.`,
      true,
    )
  }

  for (const term of terms) {
    if (term.length > MAX_TRIGGER_TERM_LENGTH) {
      throw createHttpError(
        400,
        'INVALID_TRIGGER_TERMS',
        `triggerTerms values must be ${MAX_TRIGGER_TERM_LENGTH} characters or fewer.`,
        true,
      )
    }
  }

  return [...new Set(terms)]
}

function normalizeRuleType(value, fallback = 'replace') {
  const normalized = value ?? fallback

  if (!RULE_TYPES.includes(normalized)) {
    throw createHttpError(
      400,
      'INVALID_RULE_TYPE',
      `ruleType must be one of: ${RULE_TYPES.join(', ')}.`,
      true,
    )
  }

  return normalized
}

function normalizeSeverity(value, fallback = 'hard') {
  const normalized = value ?? fallback

  if (!SEVERITIES.includes(normalized)) {
    throw createHttpError(
      400,
      'INVALID_RULE_SEVERITY',
      `severity must be one of: ${SEVERITIES.join(', ')}.`,
      true,
    )
  }

  return normalized
}

function normalizeBoolean(value, fieldName, fallback) {
  if (value === undefined) return fallback

  if (typeof value !== 'boolean') {
    throw createHttpError(400, 'INVALID_BOOLEAN', `${fieldName} must be a boolean.`, true)
  }

  return value
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

function normalizeCreateHardRulePayload(payload) {
  assertPayloadObject(payload)

  return {
    careRecipientId: normalizeOptionalCareRecipientId(payload.careRecipientId),
    ruleText: normalizeRequiredText(
      payload.ruleText,
      'ruleText',
      'INVALID_RULE_TEXT',
      MAX_RULE_TEXT_LENGTH,
    ),
    triggerTerms: normalizeTriggerTerms(payload.triggerTerms),
    replacementText: normalizeOptionalText(
      payload.replacementText,
      'replacementText',
      'INVALID_REPLACEMENT_TEXT',
      MAX_REPLACEMENT_LENGTH,
    ),
    ruleType: normalizeRuleType(payload.ruleType),
    severity: normalizeSeverity(payload.severity),
    isActive: normalizeBoolean(payload.isActive, 'isActive', true),
    sortOrder: normalizeSortOrder(payload.sortOrder),
  }
}

function normalizeUpdateHardRulePayload(payload) {
  assertPayloadObject(payload)

  const updates = {}

  if (hasOwn(payload, 'careRecipientId')) {
    updates.careRecipientId = normalizeOptionalCareRecipientId(payload.careRecipientId)
  }

  if (hasOwn(payload, 'ruleText')) {
    updates.ruleText = normalizeRequiredText(
      payload.ruleText,
      'ruleText',
      'INVALID_RULE_TEXT',
      MAX_RULE_TEXT_LENGTH,
    )
  }

  if (hasOwn(payload, 'triggerTerms')) {
    updates.triggerTerms = normalizeTriggerTerms(payload.triggerTerms)
  }

  if (hasOwn(payload, 'replacementText')) {
    updates.replacementText = normalizeOptionalText(
      payload.replacementText,
      'replacementText',
      'INVALID_REPLACEMENT_TEXT',
      MAX_REPLACEMENT_LENGTH,
    )
  }

  if (hasOwn(payload, 'ruleType')) {
    updates.ruleType = normalizeRuleType(payload.ruleType)
  }

  if (hasOwn(payload, 'severity')) {
    updates.severity = normalizeSeverity(payload.severity)
  }

  if (hasOwn(payload, 'isActive')) {
    updates.isActive = normalizeBoolean(payload.isActive, 'isActive')
  }

  if (hasOwn(payload, 'sortOrder')) {
    updates.sortOrder = normalizeSortOrder(payload.sortOrder)
  }

  if (Object.keys(updates).length === 0) {
    throw createHttpError(400, 'NO_HARD_RULE_UPDATES', 'Provide at least one hard rule field to update.', true)
  }

  return updates
}

function normalizeListQuery(query = {}) {
  const careRecipientId = normalizeOptionalCareRecipientId(query.careRecipientId)
  return {
    careRecipientId,
    effective: query.effective === 'true' || query.effective === true,
    activeOnly: query.activeOnly === 'true' || query.activeOnly === true,
  }
}

function hardRuleProjection(alias = 'hr') {
  return `
    ${alias}.id,
    ${alias}.household_id as "householdId",
    ${alias}.care_recipient_id as "careRecipientId",
    cr.display_name as "careRecipientDisplayName",
    ${alias}.rule_text as "ruleText",
    ${alias}.trigger_terms as "triggerTerms",
    ${alias}.replacement_text as "replacementText",
    ${alias}.rule_type as "ruleType",
    ${alias}.severity,
    ${alias}.is_active as "isActive",
    ${alias}.sort_order as "sortOrder",
    ${alias}.created_by as "createdByUserId",
    ${alias}.updated_by as "updatedByUserId",
    ${alias}.created_at as "createdAt",
    ${alias}.updated_at as "updatedAt"
  `
}

async function requireActiveCareRecipient(db, householdId, careRecipientId) {
  if (!careRecipientId) return null

  const result = await db.query(
    `
      select id
      from care_recipients
      where id = $1
        and household_id = $2
        and status = 'active'
      limit 1
    `,
    [careRecipientId, householdId],
  )

  if (!result.rows[0]) {
    throw createHttpError(
      404,
      'CARE_RECIPIENT_NOT_FOUND',
      'Care recipient was not found for this household.',
      true,
    )
  }

  return result.rows[0]
}

async function readHardRuleById(db, householdId, hardRuleId) {
  const result = await db.query(
    `
      select
        ${hardRuleProjection('hr')}
      from clinical_hard_rules hr
      left join care_recipients cr on cr.id = hr.care_recipient_id
      where hr.id = $1
        and hr.household_id = $2
      limit 1
    `,
    [hardRuleId, householdId],
  )

  return result.rows[0] ?? null
}

async function insertHardRule(db, householdId, userId, payload) {
  const result = await db.query(
    `
      insert into clinical_hard_rules (
        household_id,
        care_recipient_id,
        rule_text,
        trigger_terms,
        replacement_text,
        rule_type,
        severity,
        is_active,
        sort_order,
        created_by,
        updated_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
      returning id
    `,
    [
      householdId,
      payload.careRecipientId,
      payload.ruleText,
      payload.triggerTerms,
      payload.replacementText,
      payload.ruleType,
      payload.severity,
      payload.isActive,
      payload.sortOrder,
      userId,
    ],
  )

  return readHardRuleById(db, householdId, result.rows[0].id)
}

async function updateHardRule(db, householdId, hardRuleId, userId, updates) {
  const values = [hardRuleId, householdId]
  const setClauses = []

  const columnByField = {
    careRecipientId: 'care_recipient_id',
    ruleText: 'rule_text',
    triggerTerms: 'trigger_terms',
    replacementText: 'replacement_text',
    ruleType: 'rule_type',
    severity: 'severity',
    isActive: 'is_active',
    sortOrder: 'sort_order',
  }

  for (const [fieldName, columnName] of Object.entries(columnByField)) {
    if (!hasOwn(updates, fieldName)) continue

    values.push(updates[fieldName])
    setClauses.push(`${columnName} = $${values.length}`)
  }

  values.push(userId)
  setClauses.push(`updated_by = $${values.length}`)
  setClauses.push('updated_at = now()')

  const result = await db.query(
    `
      update clinical_hard_rules
      set
        ${setClauses.join(',\n        ')}
      where id = $1
        and household_id = $2
      returning id
    `,
    values,
  )

  if (!result.rows[0]) return null

  return readHardRuleById(db, householdId, hardRuleId)
}

async function deleteHardRule(db, householdId, hardRuleId) {
  const result = await db.query(
    `
      delete from clinical_hard_rules
      where id = $1
        and household_id = $2
      returning id
    `,
    [hardRuleId, householdId],
  )

  return Boolean(result.rows[0])
}

export async function listHardRulesForCurrentUser(clerkUserId, householdId, query) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const filters = normalizeListQuery(query)
  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', { resourceType: 'hard_rule' })
  const result = await db.query(
    `
      select
        ${hardRuleProjection('hr')}
      from clinical_hard_rules hr
      left join care_recipients cr on cr.id = hr.care_recipient_id
      where hr.household_id = $1
        and ($2::boolean = false or hr.is_active = true)
        and (
          $3::uuid is null
          or (
            $4::boolean = true
            and (hr.care_recipient_id is null or hr.care_recipient_id = $3)
          )
          or (
            $4::boolean = false
            and hr.care_recipient_id = $3
          )
        )
      order by
        case when hr.care_recipient_id is null then 1 else 2 end,
        hr.sort_order asc,
        hr.created_at asc
    `,
    [access.household.id, filters.activeOnly, filters.careRecipientId, filters.effective],
  )

  return {
    household: access.household,
    requester: access.membership,
    hardRules: result.rows,
  }
}

export async function createHardRuleForCurrentUser(clerkUserId, householdId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const hardRulePayload = normalizeCreateHardRulePayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, HARD_RULE_WRITE_ROLES, {
    action: 'hard_rule:edit',
    resourceType: 'hard_rule',
    label: 'hard_rule:edit',
  })

  await requireActiveCareRecipient(db, access.household.id, hardRulePayload.careRecipientId)

  const hardRule = await insertHardRule(db, access.household.id, user.id, hardRulePayload)

  await writeAuditLog(db, {
    action: 'hard_rule.created',
    entityType: 'clinical_hard_rule',
    entityId: hardRule.id,
    actorUserId: user.id,
    householdId: access.household.id,
    after: {
      ruleText: hardRule.ruleText,
      ruleType: hardRule.ruleType,
      severity: hardRule.severity,
      triggerTerms: hardRule.triggerTerms,
    },
  })

  return {
    household: access.household,
    requester: access.membership,
    hardRule,
  }
}

export async function getHardRuleForCurrentUser(clerkUserId, householdId, hardRuleId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const normalizedHardRuleId = normalizeHardRuleId(hardRuleId)
  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', { resourceType: 'hard_rule' })
  const hardRule = await readHardRuleById(db, access.household.id, normalizedHardRuleId)

  if (!hardRule) {
    throw createHttpError(404, 'HARD_RULE_NOT_FOUND', 'Hard rule was not found.', true)
  }

  return {
    household: access.household,
    requester: access.membership,
    hardRule,
  }
}

export async function updateHardRuleForCurrentUser(clerkUserId, householdId, hardRuleId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const normalizedHardRuleId = normalizeHardRuleId(hardRuleId)
  const updates = normalizeUpdateHardRulePayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, HARD_RULE_WRITE_ROLES, {
    action: 'hard_rule:edit',
    resourceType: 'hard_rule',
    label: 'hard_rule:edit',
  })

  await requireActiveCareRecipient(db, access.household.id, updates.careRecipientId)

  const existingHardRule = await readHardRuleById(db, access.household.id, normalizedHardRuleId)
  const hardRule = await updateHardRule(
    db,
    access.household.id,
    normalizedHardRuleId,
    user.id,
    updates,
  )

  if (!hardRule) {
    throw createHttpError(404, 'HARD_RULE_NOT_FOUND', 'Hard rule was not found.', true)
  }

  await writeAuditLog(db, {
    action: 'hard_rule.updated',
    entityType: 'clinical_hard_rule',
    entityId: hardRule.id,
    actorUserId: user.id,
    householdId: access.household.id,
    before: existingHardRule
      ? {
          ruleText: existingHardRule.ruleText,
          ruleType: existingHardRule.ruleType,
          severity: existingHardRule.severity,
          triggerTerms: existingHardRule.triggerTerms,
          isActive: existingHardRule.isActive,
        }
      : null,
    after: {
      ruleText: hardRule.ruleText,
      ruleType: hardRule.ruleType,
      severity: hardRule.severity,
      triggerTerms: hardRule.triggerTerms,
      isActive: hardRule.isActive,
    },
  })

  return {
    household: access.household,
    requester: access.membership,
    hardRule,
  }
}

export async function deleteHardRuleForCurrentUser(clerkUserId, householdId, hardRuleId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const normalizedHardRuleId = normalizeHardRuleId(hardRuleId)
  const access = await requireHouseholdRole(db, user.id, householdId, HARD_RULE_WRITE_ROLES, {
    action: 'hard_rule:edit',
    resourceType: 'hard_rule',
    label: 'hard_rule:edit',
  })
  const existingHardRule = await readHardRuleById(db, access.household.id, normalizedHardRuleId)

  if (!existingHardRule) {
    throw createHttpError(404, 'HARD_RULE_NOT_FOUND', 'Hard rule was not found.', true)
  }

  const deleted = await deleteHardRule(db, access.household.id, normalizedHardRuleId)

  if (deleted) {
    await writeAuditLog(db, {
      action: 'hard_rule.deleted',
      entityType: 'clinical_hard_rule',
      entityId: normalizedHardRuleId,
      actorUserId: user.id,
      householdId: access.household.id,
      before: {
        ruleText: existingHardRule.ruleText,
        ruleType: existingHardRule.ruleType,
        severity: existingHardRule.severity,
        triggerTerms: existingHardRule.triggerTerms,
      },
    })
  }

  return {
    deleted,
    household: access.household,
    requester: access.membership,
    hardRule: existingHardRule,
  }
}
