/**
 * Grocery list (Application Brain A9 shopping).
 *
 * A household checklist, optionally scoped to one care recipient. Items are
 * generated from the Day Plan (the planned recipes' ingredients, parsed with the
 * same deterministic ingredient parser the accuracy engine uses) or added by
 * hand. Available on every plan tier; view = all roles, edit = owner/co-owner/caregiver.
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
} from '../households/householdAccess.js'
import { parseIngredients, normalizeIngredient } from '../clinical-review/engine/ingredientParser.js'

const VIEW_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']
const EDIT_ROLES = ['owner', 'co_owner', 'caregiver']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_ITEM = 180
const MAX_RANGE_DAYS = 31

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDate(value, fieldName) {
  const v = normalizeText(value)
  if (!DATE_RE.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) {
    throw createHttpError(400, 'INVALID_DATE', `${fieldName} must be a valid YYYY-MM-DD date.`, true)
  }
  return v
}

function normalizeOptionalCareRecipientId(value) {
  if (value === undefined || value === null || value === '') return null
  return normalizeUuid(value, 'INVALID_CARE_RECIPIENT_ID', 'careRecipientId must be a UUID.')
}

function itemProjection(alias = 'g') {
  return `
    ${alias}.id,
    ${alias}.care_recipient_id as "careRecipientId",
    ${alias}.item_text as "itemText",
    ${alias}.normalized_key as "normalizedKey",
    ${alias}.source,
    ${alias}.source_recipe_id as "sourceRecipeId",
    ${alias}.checked,
    ${alias}.position,
    ${alias}.created_at as "createdAt",
    ${alias}.updated_at as "updatedAt"
  `
}

async function assertCareRecipient(db, householdId, careRecipientId) {
  if (!careRecipientId) return
  const r = await db.query(
    `select 1 from care_recipients where id = $1 and household_id = $2 and status = 'active' limit 1`,
    [careRecipientId, householdId],
  )
  if (r.rows.length === 0) {
    throw createHttpError(404, 'CARE_RECIPIENT_NOT_FOUND', 'Care recipient was not found for this household.', true)
  }
}

// Scope predicate: a specific recipient, or the household-wide (null) list.
function scopeWhere(careRecipientId, startIdx) {
  return careRecipientId
    ? { sql: `care_recipient_id = $${startIdx}`, params: [careRecipientId] }
    : { sql: `care_recipient_id is null`, params: [] }
}

export async function getGroceryListForCurrentUser(clerkUserId, householdId, query = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const careRecipientId = normalizeOptionalCareRecipientId(query.careRecipientId)
  const access = await requireHouseholdRole(db, user.id, householdId, VIEW_ROLES)
  await assertCareRecipient(db, access.household.id, careRecipientId)

  const scope = scopeWhere(careRecipientId, 2)
  const result = await db.query(
    `
      select ${itemProjection('g')}
      from grocery_list_items g
      where g.household_id = $1 and ${scope.sql}
      order by g.checked, g.position, g.created_at
    `,
    [access.household.id, ...scope.params],
  )

  const items = result.rows
  return {
    household: access.household,
    requester: access.membership,
    careRecipientId,
    counts: {
      total: items.length,
      checked: items.filter((i) => i.checked).length,
      remaining: items.filter((i) => !i.checked).length,
    },
    items,
  }
}

/**
 * Build the grocery list from the Day Plan: collect the recipes planned in the
 * date range, parse their ingredients, and insert any not already on the list.
 */
export async function generateGroceryListFromPlanForCurrentUser(clerkUserId, householdId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
  const careRecipientId = normalizeOptionalCareRecipientId(payload.careRecipientId)
  const from = normalizeDate(payload.from ?? payload.date, 'from')
  const to = payload.to ? normalizeDate(payload.to, 'to') : from
  const days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000
  if (days < 0) throw createHttpError(400, 'INVALID_RANGE', 'to must be on or after from.', true)
  if (days > MAX_RANGE_DAYS) throw createHttpError(400, 'RANGE_TOO_LARGE', `Range must be ${MAX_RANGE_DAYS} days or fewer.`, true)

  const access = await requireHouseholdRole(db, user.id, householdId, EDIT_ROLES)
  await assertCareRecipient(db, access.household.id, careRecipientId)

  // Planned recipes in range. If a care recipient is given, only their plan;
  // otherwise all of the household's planned recipes in range.
  const planScope = careRecipientId
    ? { sql: 'dpe.care_recipient_id = $4', params: [careRecipientId] }
    : { sql: 'true', params: [] }
  const planned = await db.query(
    `
      select distinct ra.id as "recipeId", ra.title, ra.output_markdown as "outputMarkdown",
             ra.source_recipe_text as "sourceRecipeText"
      from day_plan_entries dpe
      join recipe_adaptations ra on ra.id = dpe.recipe_adaptation_id
      where dpe.household_id = $1
        and dpe.plan_date >= $2::date and dpe.plan_date <= $3::date
        and dpe.recipe_adaptation_id is not null
        and ${planScope.sql}
    `,
    [access.household.id, from, to, ...planScope.params],
  )

  // Parse + collect unique ingredients (first recipe that yields a noun wins as its source).
  const byKey = new Map()
  for (const recipe of planned.rows) {
    const text = `${recipe.outputMarkdown ?? ''}\n${recipe.sourceRecipeText ?? ''}`
    for (const ingredient of parseIngredients(text)) {
      const key = normalizeIngredient(ingredient)
      if (!key) continue
      if (!byKey.has(key)) byKey.set(key, { itemText: ingredient, sourceRecipeId: recipe.recipeId })
    }
  }

  let added = 0
  const client = await db.connect()
  try {
    await client.query('begin')
    for (const [key, { itemText, sourceRecipeId }] of byKey) {
      // ON CONFLICT against the scope dedup index — already-present keys are skipped.
      const ins = await client.query(
        `
          insert into grocery_list_items (
            household_id, care_recipient_id, item_text, normalized_key,
            source, source_recipe_id, created_by, updated_by
          )
          values ($1, $2, $3, $4, 'recipe', $5, $6, $6)
          on conflict (household_id, care_recipient_id, normalized_key) do nothing
          returning id
        `,
        [access.household.id, careRecipientId, itemText, key, sourceRecipeId, user.id],
      )
      if (ins.rows.length > 0) added += 1
    }
    await client.query('commit')
  } catch (err) {
    try { await client.query('rollback') } catch { /* keep original error */ }
    throw err
  } finally {
    client.release()
  }

  const list = await getGroceryListForCurrentUser(clerkUserId, householdId, { careRecipientId })
  return {
    ...list,
    generated: { recipes: planned.rows.length, uniqueIngredients: byKey.size, added },
  }
}

export async function addGroceryItemForCurrentUser(clerkUserId, householdId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
  const itemText = normalizeText(payload.itemText)
  if (!itemText) throw createHttpError(400, 'INVALID_ITEM', 'itemText is required.', true)
  if (itemText.length > MAX_ITEM) throw createHttpError(400, 'INVALID_ITEM', `itemText must be ${MAX_ITEM} characters or fewer.`, true)
  const careRecipientId = normalizeOptionalCareRecipientId(payload.careRecipientId)

  const access = await requireHouseholdRole(db, user.id, householdId, EDIT_ROLES)
  await assertCareRecipient(db, access.household.id, careRecipientId)

  const normalizedKey = normalizeIngredient(itemText) || itemText.toLowerCase()
  const result = await db.query(
    `
      insert into grocery_list_items (
        household_id, care_recipient_id, item_text, normalized_key, source, created_by, updated_by
      )
      values ($1, $2, $3, $4, 'manual', $5, $5)
      on conflict (household_id, care_recipient_id, normalized_key)
        do update set item_text = excluded.item_text, checked = false, updated_by = $5, updated_at = now()
      returning ${itemProjection('grocery_list_items')}
    `,
    [access.household.id, careRecipientId, itemText, normalizedKey, user.id],
  )

  return { household: access.household, requester: access.membership, item: result.rows[0] }
}

export async function updateGroceryItemForCurrentUser(clerkUserId, householdId, itemId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedItemId = normalizeUuid(itemId, 'INVALID_ITEM_ID', 'Item id must be a UUID.')
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const updates = {}
  if (Object.hasOwn(payload, 'checked')) {
    if (typeof payload.checked !== 'boolean') throw createHttpError(400, 'INVALID_CHECKED', 'checked must be a boolean.', true)
    updates.checked = payload.checked
  }
  if (Object.hasOwn(payload, 'itemText')) {
    const itemText = normalizeText(payload.itemText)
    if (!itemText) throw createHttpError(400, 'INVALID_ITEM', 'itemText cannot be blank.', true)
    if (itemText.length > MAX_ITEM) throw createHttpError(400, 'INVALID_ITEM', `itemText must be ${MAX_ITEM} characters or fewer.`, true)
    updates.item_text = itemText
    updates.normalized_key = normalizeIngredient(itemText) || itemText.toLowerCase()
  }
  if (Object.hasOwn(payload, 'position')) {
    if (!Number.isInteger(payload.position)) throw createHttpError(400, 'INVALID_POSITION', 'position must be an integer.', true)
    updates.position = payload.position
  }
  if (Object.keys(updates).length === 0) {
    throw createHttpError(400, 'NO_ITEM_UPDATES', 'Provide checked, itemText, or position.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, EDIT_ROLES)

  const values = [normalizedItemId, access.household.id]
  const setClauses = []
  for (const [column, value] of Object.entries(updates)) {
    values.push(value)
    setClauses.push(`${column} = $${values.length}`)
  }
  values.push(user.id)
  setClauses.push(`updated_by = $${values.length}`)

  const result = await db.query(
    `
      update grocery_list_items
      set ${setClauses.join(', ')}, updated_at = now()
      where id = $1 and household_id = $2
      returning ${itemProjection('grocery_list_items')}
    `,
    values,
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'ITEM_NOT_FOUND', 'Grocery item was not found.', true)
  }

  return { household: access.household, requester: access.membership, item: result.rows[0] }
}

export async function removeGroceryItemForCurrentUser(clerkUserId, householdId, itemId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedItemId = normalizeUuid(itemId, 'INVALID_ITEM_ID', 'Item id must be a UUID.')
  const access = await requireHouseholdRole(db, user.id, householdId, EDIT_ROLES)

  const result = await db.query(
    `delete from grocery_list_items where id = $1 and household_id = $2 returning id`,
    [normalizedItemId, access.household.id],
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'ITEM_NOT_FOUND', 'Grocery item was not found.', true)
  }

  return { deleted: true, household: access.household, requester: access.membership, itemId: normalizedItemId }
}

/**
 * Clear the whole list or just the checked items, in scope.
 */
export async function clearGroceryListForCurrentUser(clerkUserId, householdId, query = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const careRecipientId = normalizeOptionalCareRecipientId(query.careRecipientId)
  const checkedOnly = query.checkedOnly === 'true' || query.checkedOnly === true
  const access = await requireHouseholdRole(db, user.id, householdId, EDIT_ROLES)

  const scope = scopeWhere(careRecipientId, 2)
  const result = await db.query(
    `
      delete from grocery_list_items
      where household_id = $1 and ${scope.sql} ${checkedOnly ? 'and checked = true' : ''}
      returning id
    `,
    [access.household.id, ...scope.params],
  )

  return {
    household: access.household,
    requester: access.membership,
    careRecipientId,
    cleared: result.rows.length,
    checkedOnly,
  }
}
