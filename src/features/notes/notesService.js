/**
 * Caregiver Notes + Rejection Routing (Private Household App).
 *
 * Notes are a per-care-recipient timeline of caregiver observations. Rejection
 * Routing is a derived view: it gathers recent refusals (Day Plan entries marked
 * acceptance = 'refused', plus notes categorized 'refusal') and suggests alternate
 * recipes — approved household recipes in the same meal slots, excluding what was
 * refused. Available on every plan tier; view = all roles, write = owner/co-owner/caregiver.
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
const WRITE_ROLES = ['owner', 'co_owner', 'caregiver']
const CATEGORIES = new Set([
  'general', 'good_day', 'hard_day', 'refusal', 'appetite', 'medication', 'observation',
])
const MAX_NOTE = 4000
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const ROUTING_WINDOW_DAYS = 30
const MAX_SUGGESTIONS = 8

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeCareRecipientId(value) {
  return normalizeUuid(value, 'INVALID_CARE_RECIPIENT_ID', 'careRecipientId must be a UUID.')
}

function noteProjection(alias = 'n') {
  return `
    ${alias}.id,
    ${alias}.care_recipient_id as "careRecipientId",
    ${alias}.note_text as "noteText",
    ${alias}.category,
    ${alias}.related_recipe_id as "relatedRecipeId",
    ${alias}.related_day_plan_entry_id as "relatedDayPlanEntryId",
    ${alias}.logged_by as "loggedBy",
    ${alias}.created_at as "createdAt",
    ${alias}.updated_at as "updatedAt"
  `
}

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

async function assertRecipeInHousehold(db, householdId, recipeId) {
  const r = await db.query(
    `select 1 from recipe_adaptations where id = $1 and household_id = $2 and deleted_at is null limit 1`,
    [recipeId, householdId],
  )
  if (r.rows.length === 0) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found in this household.', true)
  }
}

// ---------------------------------------------------------------------------
// Notes CRUD
// ---------------------------------------------------------------------------

export async function listNotesForCurrentUser(clerkUserId, householdId, careRecipientId, query = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedCareRecipientId = normalizeCareRecipientId(careRecipientId)
  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', { resourceType: 'note' })
  await requireActiveCareRecipient(db, access.household.id, normalizedCareRecipientId)

  let category = null
  if (query.category) {
    category = normalizeText(query.category).toLowerCase()
    if (!CATEGORIES.has(category)) {
      throw createHttpError(400, 'INVALID_CATEGORY', `category must be one of: ${[...CATEGORIES].join(', ')}.`, true)
    }
  }
  const requestedLimit = Number.parseInt(query.limit ?? `${DEFAULT_LIMIT}`, 10)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT

  const result = await db.query(
    `
      select ${noteProjection('n')}, ra.title as "relatedRecipeTitle"
      from caregiver_notes n
      left join recipe_adaptations ra on ra.id = n.related_recipe_id
      where n.care_recipient_id = $1
        and ($2::text is null or n.category = $2)
      order by n.created_at desc
      limit $3
    `,
    [normalizedCareRecipientId, category, limit],
  )

  return { household: access.household, requester: access.membership, careRecipientId: normalizedCareRecipientId, notes: result.rows }
}

function normalizeCreatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
  const noteText = normalizeText(payload.noteText)
  if (!noteText) throw createHttpError(400, 'INVALID_NOTE', 'noteText is required.', true)
  if (noteText.length > MAX_NOTE) throw createHttpError(400, 'INVALID_NOTE', `noteText must be ${MAX_NOTE} characters or fewer.`, true)

  const category = payload.category ? normalizeText(payload.category).toLowerCase() : 'general'
  if (!CATEGORIES.has(category)) {
    throw createHttpError(400, 'INVALID_CATEGORY', `category must be one of: ${[...CATEGORIES].join(', ')}.`, true)
  }
  const relatedRecipeId = payload.relatedRecipeId
    ? normalizeUuid(payload.relatedRecipeId, 'INVALID_RECIPE_ID', 'relatedRecipeId must be a UUID.')
    : null
  const relatedDayPlanEntryId = payload.relatedDayPlanEntryId
    ? normalizeUuid(payload.relatedDayPlanEntryId, 'INVALID_ENTRY_ID', 'relatedDayPlanEntryId must be a UUID.')
    : null

  return { noteText, category, relatedRecipeId, relatedDayPlanEntryId }
}

export async function createNoteForCurrentUser(clerkUserId, householdId, careRecipientId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedCareRecipientId = normalizeCareRecipientId(careRecipientId)
  const note = normalizeCreatePayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, WRITE_ROLES, {
    action: 'note:write',
    resourceType: 'note',
    label: 'note:write',
  })
  await requireActiveCareRecipient(db, access.household.id, normalizedCareRecipientId)
  if (note.relatedRecipeId) await assertRecipeInHousehold(db, access.household.id, note.relatedRecipeId)

  const result = await db.query(
    `
      insert into caregiver_notes (
        household_id, care_recipient_id, note_text, category,
        related_recipe_id, related_day_plan_entry_id, logged_by, updated_by
      )
      values ($1, $2, $3, $4, $5, $6, $7, $7)
      returning ${noteProjection('caregiver_notes')}
    `,
    [
      access.household.id, normalizedCareRecipientId, note.noteText, note.category,
      note.relatedRecipeId, note.relatedDayPlanEntryId, user.id,
    ],
  )

  return { household: access.household, requester: access.membership, note: result.rows[0] }
}

export async function updateNoteForCurrentUser(clerkUserId, householdId, noteId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedNoteId = normalizeUuid(noteId, 'INVALID_NOTE_ID', 'Note id must be a UUID.')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const updates = {}
  if (Object.hasOwn(payload, 'noteText')) {
    const noteText = normalizeText(payload.noteText)
    if (!noteText) throw createHttpError(400, 'INVALID_NOTE', 'noteText cannot be blank.', true)
    if (noteText.length > MAX_NOTE) throw createHttpError(400, 'INVALID_NOTE', `noteText must be ${MAX_NOTE} characters or fewer.`, true)
    updates.note_text = noteText
  }
  if (Object.hasOwn(payload, 'category')) {
    const category = normalizeText(payload.category).toLowerCase()
    if (!CATEGORIES.has(category)) throw createHttpError(400, 'INVALID_CATEGORY', `category must be one of: ${[...CATEGORIES].join(', ')}.`, true)
    updates.category = category
  }
  if (Object.keys(updates).length === 0) {
    throw createHttpError(400, 'NO_NOTE_UPDATES', 'Provide noteText or category to update.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, WRITE_ROLES, {
    action: 'note:write',
    resourceType: 'note',
    label: 'note:write',
  })

  const values = [normalizedNoteId, access.household.id]
  const setClauses = []
  for (const [column, value] of Object.entries(updates)) {
    values.push(value)
    setClauses.push(`${column} = $${values.length}`)
  }
  values.push(user.id)
  setClauses.push(`updated_by = $${values.length}`)

  const result = await db.query(
    `
      update caregiver_notes
      set ${setClauses.join(', ')}, updated_at = now()
      where id = $1 and household_id = $2
      returning ${noteProjection('caregiver_notes')}
    `,
    values,
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'NOTE_NOT_FOUND', 'Note was not found.', true)
  }

  return { household: access.household, requester: access.membership, note: result.rows[0] }
}

export async function removeNoteForCurrentUser(clerkUserId, householdId, noteId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedNoteId = normalizeUuid(noteId, 'INVALID_NOTE_ID', 'Note id must be a UUID.')
  const access = await requireHouseholdRole(db, user.id, householdId, WRITE_ROLES, {
    action: 'note:write',
    resourceType: 'note',
    label: 'note:write',
  })

  const result = await db.query(
    `delete from caregiver_notes where id = $1 and household_id = $2 returning id`,
    [normalizedNoteId, access.household.id],
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'NOTE_NOT_FOUND', 'Note was not found.', true)
  }

  return { deleted: true, household: access.household, requester: access.membership, noteId: normalizedNoteId }
}

// ---------------------------------------------------------------------------
// Rejection Routing (derived)
// ---------------------------------------------------------------------------

export async function getRejectionRoutingForCurrentUser(clerkUserId, householdId, careRecipientId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedCareRecipientId = normalizeCareRecipientId(careRecipientId)
  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', { resourceType: 'note' })
  await requireActiveCareRecipient(db, access.household.id, normalizedCareRecipientId)

  // 1) Refusals from the Day Plan (acceptance = 'refused'), newest first.
  const planRefusals = await db.query(
    `
      select
        dpe.id as "dayPlanEntryId", dpe.plan_date as "planDate", dpe.meal_slot as "mealSlot",
        dpe.recipe_adaptation_id as "recipeId", coalesce(ra.title, dpe.title) as "title",
        ra.meal_slots as "recipeMealSlots", dpe.notes
      from day_plan_entries dpe
      left join recipe_adaptations ra on ra.id = dpe.recipe_adaptation_id
      where dpe.care_recipient_id = $1
        and dpe.acceptance = 'refused'
        and dpe.plan_date >= (now() at time zone 'utc')::date - $2::int
      order by dpe.plan_date desc, dpe.updated_at desc
      limit 50
    `,
    [normalizedCareRecipientId, ROUTING_WINDOW_DAYS],
  )

  // 2) Refusals captured as caregiver notes.
  const noteRefusals = await db.query(
    `
      select n.id as "noteId", n.note_text as "noteText", n.related_recipe_id as "recipeId",
             ra.title as "recipeTitle", n.created_at as "createdAt"
      from caregiver_notes n
      left join recipe_adaptations ra on ra.id = n.related_recipe_id
      where n.care_recipient_id = $1 and n.category = 'refusal'
        and n.created_at >= now() - ($2::int || ' days')::interval
      order by n.created_at desc
      limit 50
    `,
    [normalizedCareRecipientId, ROUTING_WINDOW_DAYS],
  )

  // Meal slots involved in the refusals (to bias suggestions toward the same slots).
  const refusedRecipeIds = new Set()
  const refusedSlots = new Set()
  for (const r of planRefusals.rows) {
    if (r.recipeId) refusedRecipeIds.add(r.recipeId)
    if (r.mealSlot) refusedSlots.add(r.mealSlot)
    for (const s of r.recipeMealSlots ?? []) refusedSlots.add(s)
  }
  for (const r of noteRefusals.rows) if (r.recipeId) refusedRecipeIds.add(r.recipeId)

  // 3) Suggested alternates: approved household recipes, preferring the same meal
  //    slots, excluding what was refused.
  const slotArray = refusedSlots.size > 0 ? [...refusedSlots] : null
  const excludeArray = refusedRecipeIds.size > 0 ? [...refusedRecipeIds] : null
  const suggestions = await db.query(
    `
      select ra.id, ra.title, ra.meal_slots as "mealSlots",
             ra.clinical_review_status as "clinicalReviewStatus", ra.photo_url as "photoUrl",
             (case when $2::text[] is not null and ra.meal_slots && $2::text[] then 1 else 0 end) as "slotMatch"
      from recipe_adaptations ra
      where ra.household_id = $1
        and ra.deleted_at is null
        and ra.clinical_review_status in ('approved', 'approved_with_caveats')
        and ($3::uuid[] is null or ra.id <> all($3::uuid[]))
      order by "slotMatch" desc, ra.saved_at desc nulls last, ra.created_at desc
      limit $4
    `,
    [access.household.id, slotArray, excludeArray, MAX_SUGGESTIONS],
  )

  return {
    household: access.household,
    requester: access.membership,
    careRecipientId: normalizedCareRecipientId,
    windowDays: ROUTING_WINDOW_DAYS,
    refusals: {
      fromDayPlan: planRefusals.rows,
      fromNotes: noteRefusals.rows,
      refusedMealSlots: [...refusedSlots],
    },
    suggestedAlternates: suggestions.rows,
  }
}
