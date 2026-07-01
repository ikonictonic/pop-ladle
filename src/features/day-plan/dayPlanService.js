/**
 * Today Plan / Day Plan — per-care-recipient daily meal plan.
 *
 * The caregiver's daily loop: plan recipes (or free-text items) into a day's
 * meal slots, then mark each completed/skipped with a Food Acceptance Record
 * (finished / partial / refused). Available on every plan tier, so no
 * entitlement gate. View = all household roles; edit = owner/co-owner/caregiver.
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
  requireHouseholdCapability,
} from '../households/householdAccess.js'

const VIEW_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']
const EDIT_ROLES = ['owner', 'co_owner', 'caregiver']
const MEAL_SLOTS = new Set([
  'breakfast', 'mid_morning_snack', 'lunch',
  'mid_afternoon_snack', 'dinner', 'dessert', 'snack',
])
const STATUSES = new Set(['planned', 'completed', 'skipped'])
const ACCEPTANCES = new Set(['finished', 'partial', 'refused'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_TITLE = 180
const MAX_NOTES = 2000
const MAX_RANGE_DAYS = 31

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDate(value, fieldName = 'date') {
  const v = normalizeText(value)
  if (!DATE_RE.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) {
    throw createHttpError(400, 'INVALID_DATE', `${fieldName} must be a valid YYYY-MM-DD date.`, true)
  }
  return v
}

function normalizeEntryId(value) {
  return normalizeUuid(value, 'INVALID_ENTRY_ID', 'Day plan entry id must be a UUID.')
}

function entryProjection(alias = 'dpe') {
  return `
    ${alias}.id,
    ${alias}.care_recipient_id as "careRecipientId",
    ${alias}.plan_date as "planDate",
    ${alias}.meal_slot as "mealSlot",
    ${alias}.recipe_adaptation_id as "recipeId",
    ${alias}.title,
    ${alias}.position,
    ${alias}.status,
    ${alias}.acceptance,
    ${alias}.notes,
    ${alias}.completed_at as "completedAt",
    ${alias}.completed_by as "completedBy",
    ${alias}.created_at as "createdAt",
    ${alias}.updated_at as "updatedAt"
  `
}

const SLOT_ORDER = `
  case dpe.meal_slot
    when 'breakfast' then 1
    when 'mid_morning_snack' then 2
    when 'lunch' then 3
    when 'mid_afternoon_snack' then 4
    when 'dinner' then 5
    when 'dessert' then 6
    when 'snack' then 7
    else 8
  end
`

async function requireActiveCareRecipient(db, householdId, careRecipientId) {
  const result = await db.query(
    `select id, display_name as "displayName" from care_recipients
     where id = $1 and household_id = $2 and status = 'active' limit 1`,
    [careRecipientId, householdId],
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'CARE_RECIPIENT_NOT_FOUND', 'Care recipient was not found for this household.', true)
  }
  return result.rows[0]
}

// A planned recipe must be a saved, non-deleted recipe in this household.
async function assertRecipeInHousehold(db, householdId, recipeId) {
  const result = await db.query(
    `select 1 from recipe_adaptations where id = $1 and household_id = $2 and deleted_at is null limit 1`,
    [recipeId, householdId],
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found in this household.', true)
  }
}

// Join recipe title + review status so the day view is renderable in one call.
async function loadEntriesWithRecipe(db, careRecipientId, fromDate, toDate) {
  const result = await db.query(
    `
      select
        ${entryProjection('dpe')},
        ra.title as "recipeTitle",
        ra.clinical_review_status as "recipeReviewStatus",
        ra.photo_url as "recipePhotoUrl"
      from day_plan_entries dpe
      left join recipe_adaptations ra on ra.id = dpe.recipe_adaptation_id
      where dpe.care_recipient_id = $1
        and dpe.plan_date >= $2::date
        and dpe.plan_date <= $3::date
      order by dpe.plan_date, ${SLOT_ORDER}, dpe.position, dpe.created_at
    `,
    [careRecipientId, fromDate, toDate],
  )
  return result.rows
}

export async function getDayPlanForCurrentUser(clerkUserId, householdId, careRecipientId, query = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedCareRecipientId = normalizeUuid(careRecipientId, 'INVALID_CARE_RECIPIENT_ID', 'careRecipientId must be a UUID.')
  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', { resourceType: 'dayplan' })
  const careRecipient = await requireActiveCareRecipient(db, access.household.id, normalizedCareRecipientId)

  // Single day (?date=) or a bounded range (?from=&to=). Default = today (UTC).
  let fromDate
  let toDate
  if (query.from || query.to) {
    fromDate = normalizeDate(query.from, 'from')
    toDate = normalizeDate(query.to, 'to')
    const days = (new Date(`${toDate}T00:00:00Z`) - new Date(`${fromDate}T00:00:00Z`)) / 86400000
    if (days < 0) throw createHttpError(400, 'INVALID_RANGE', 'to must be on or after from.', true)
    if (days > MAX_RANGE_DAYS) throw createHttpError(400, 'RANGE_TOO_LARGE', `Range must be ${MAX_RANGE_DAYS} days or fewer.`, true)
  } else {
    fromDate = query.date ? normalizeDate(query.date) : new Date().toISOString().slice(0, 10)
    toDate = fromDate
  }

  const entries = await loadEntriesWithRecipe(db, normalizedCareRecipientId, fromDate, toDate)

  return {
    household: access.household,
    requester: access.membership,
    careRecipient: { id: careRecipient.id, displayName: careRecipient.displayName },
    range: { from: fromDate, to: toDate },
    entries,
  }
}

function normalizeCreatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const planDate = normalizeDate(payload.planDate ?? payload.date, 'planDate')
  const mealSlot = normalizeText(payload.mealSlot).toLowerCase()
  if (!MEAL_SLOTS.has(mealSlot)) {
    throw createHttpError(400, 'INVALID_MEAL_SLOT', `mealSlot must be one of: ${[...MEAL_SLOTS].join(', ')}.`, true)
  }

  const recipeId = payload.recipeId
    ? normalizeUuid(payload.recipeId, 'INVALID_RECIPE_ID', 'recipeId must be a UUID.')
    : null
  const title = normalizeText(payload.title)
  if (!recipeId && !title) {
    throw createHttpError(400, 'DAY_PLAN_ENTRY_EMPTY', 'Provide a recipeId and/or a title.', true)
  }
  if (title.length > MAX_TITLE) {
    throw createHttpError(400, 'INVALID_TITLE', `title must be ${MAX_TITLE} characters or fewer.`, true)
  }
  const notes = normalizeText(payload.notes)
  if (notes.length > MAX_NOTES) {
    throw createHttpError(400, 'INVALID_NOTES', `notes must be ${MAX_NOTES} characters or fewer.`, true)
  }
  const position = Number.isInteger(payload.position) ? payload.position : 0

  return { planDate, mealSlot, recipeId, title: title || null, notes: notes || null, position }
}

export async function addDayPlanEntryForCurrentUser(clerkUserId, householdId, careRecipientId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedCareRecipientId = normalizeUuid(careRecipientId, 'INVALID_CARE_RECIPIENT_ID', 'careRecipientId must be a UUID.')
  const entry = normalizeCreatePayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, EDIT_ROLES, {
    action: 'dayplan:execute',
    resourceType: 'dayplan',
    label: 'dayplan:edit',
  })
  await requireActiveCareRecipient(db, access.household.id, normalizedCareRecipientId)
  if (entry.recipeId) await assertRecipeInHousehold(db, access.household.id, entry.recipeId)

  const result = await db.query(
    `
      insert into day_plan_entries (
        household_id, care_recipient_id, plan_date, meal_slot,
        recipe_adaptation_id, title, position, notes, created_by, updated_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
      returning ${entryProjection('day_plan_entries')}
    `,
    [
      access.household.id, normalizedCareRecipientId, entry.planDate, entry.mealSlot,
      entry.recipeId, entry.title, entry.position, entry.notes, user.id,
    ],
  )

  return { household: access.household, requester: access.membership, entry: result.rows[0] }
}

function normalizeUpdatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
  const updates = {}

  if (Object.hasOwn(payload, 'mealSlot')) {
    const mealSlot = normalizeText(payload.mealSlot).toLowerCase()
    if (!MEAL_SLOTS.has(mealSlot)) {
      throw createHttpError(400, 'INVALID_MEAL_SLOT', `mealSlot must be one of: ${[...MEAL_SLOTS].join(', ')}.`, true)
    }
    updates.meal_slot = mealSlot
  }
  if (Object.hasOwn(payload, 'recipeId')) {
    updates.recipe_adaptation_id = payload.recipeId
      ? normalizeUuid(payload.recipeId, 'INVALID_RECIPE_ID', 'recipeId must be a UUID.')
      : null
  }
  if (Object.hasOwn(payload, 'title')) {
    const title = normalizeText(payload.title)
    if (title.length > MAX_TITLE) throw createHttpError(400, 'INVALID_TITLE', `title must be ${MAX_TITLE} characters or fewer.`, true)
    updates.title = title || null
  }
  if (Object.hasOwn(payload, 'position')) {
    if (!Number.isInteger(payload.position)) throw createHttpError(400, 'INVALID_POSITION', 'position must be an integer.', true)
    updates.position = payload.position
  }
  if (Object.hasOwn(payload, 'notes')) {
    const notes = normalizeText(payload.notes)
    if (notes.length > MAX_NOTES) throw createHttpError(400, 'INVALID_NOTES', `notes must be ${MAX_NOTES} characters or fewer.`, true)
    updates.notes = notes || null
  }
  if (Object.hasOwn(payload, 'status')) {
    const status = normalizeText(payload.status)
    if (!STATUSES.has(status)) throw createHttpError(400, 'INVALID_STATUS', `status must be one of: ${[...STATUSES].join(', ')}.`, true)
    updates.status = status
  }
  if (Object.hasOwn(payload, 'acceptance')) {
    if (payload.acceptance === null || payload.acceptance === '') {
      updates.acceptance = null
    } else {
      const acceptance = normalizeText(payload.acceptance)
      if (!ACCEPTANCES.has(acceptance)) throw createHttpError(400, 'INVALID_ACCEPTANCE', `acceptance must be one of: ${[...ACCEPTANCES].join(', ')}.`, true)
      updates.acceptance = acceptance
    }
  }

  if (Object.keys(updates).length === 0) {
    throw createHttpError(400, 'NO_ENTRY_UPDATES', 'Provide at least one field to update.', true)
  }
  return updates
}

export async function updateDayPlanEntryForCurrentUser(clerkUserId, householdId, entryId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedEntryId = normalizeEntryId(entryId)
  const updates = normalizeUpdatePayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, EDIT_ROLES, {
    action: 'dayplan:execute',
    resourceType: 'dayplan',
    label: 'dayplan:edit',
  })

  if (updates.recipe_adaptation_id) {
    await assertRecipeInHousehold(db, access.household.id, updates.recipe_adaptation_id)
  }

  const values = [normalizedEntryId, access.household.id]
  const setClauses = []
  for (const [column, value] of Object.entries(updates)) {
    values.push(value)
    setClauses.push(`${column} = $${values.length}`)
  }
  values.push(user.id)
  setClauses.push(`updated_by = $${values.length}`)

  let completionSql = ''
  if (updates.status === 'completed') {
    values.push(user.id)
    completionSql = `, completed_at = now(), completed_by = $${values.length}`
  } else if (updates.status === 'planned' || updates.status === 'skipped') {
    completionSql = ', completed_at = null, completed_by = null'
  }

  const result = await db.query(
    `
      update day_plan_entries
      set ${setClauses.join(', ')}${completionSql}, updated_at = now()
      where id = $1 and household_id = $2
      returning ${entryProjection('day_plan_entries')}
    `,
    values,
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'ENTRY_NOT_FOUND', 'Day plan entry was not found.', true)
  }

  return { household: access.household, requester: access.membership, entry: result.rows[0] }
}

export async function removeDayPlanEntryForCurrentUser(clerkUserId, householdId, entryId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedEntryId = normalizeEntryId(entryId)
  const access = await requireHouseholdRole(db, user.id, householdId, EDIT_ROLES, {
    action: 'dayplan:execute',
    resourceType: 'dayplan',
    label: 'dayplan:edit',
  })

  const result = await db.query(
    `delete from day_plan_entries where id = $1 and household_id = $2 returning id`,
    [normalizedEntryId, access.household.id],
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'ENTRY_NOT_FOUND', 'Day plan entry was not found.', true)
  }

  return { deleted: true, household: access.household, requester: access.membership, entryId: normalizedEntryId }
}
