import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
  requireHouseholdCapability,
} from '../households/householdAccess.js'

// =============================================================================
// taxonomyService — owner-managed meal slots and recipe categories.
//
// Backs the Control Center "Categories" editor and the recipe library/save
// filters. Replaces the Supabase recipe_taxonomy table. Reads are open to any
// household member (caregivers tag recipes); writes are owner / co_owner.
//
// The slug is the stable matcher persisted on recipe_adaptations.meal_slots[] /
// .recipe_categories[]; rename never changes it, so existing recipes stay
// tagged. "in-use" checks those arrays to choose delete vs. archive in the UI.
// =============================================================================

const TAXONOMY_READ_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']
const TAXONOMY_WRITE_ROLES = ['owner', 'co_owner']
const TAXONOMY_TYPES = ['meal_slot', 'recipe_category']
const MAX_NAME_LENGTH = 80
const MAX_COLOR_LENGTH = 32
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

function typeLabel(type) {
  return type === 'meal_slot' ? 'meal slot' : 'category'
}

// Mirror of the legacy client-side slugify so existing recipe tags (which were
// matched against the old slugs) keep resolving after the migration.
export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

function assertPayloadObject(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
}

function normalizeTaxonomyId(value) {
  return normalizeUuid(value, 'INVALID_TAXONOMY_ID', 'Taxonomy id must be a UUID.')
}

function normalizeType(value, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return null
    throw createHttpError(400, 'INVALID_TAXONOMY_TYPE', `type must be one of: ${TAXONOMY_TYPES.join(', ')}.`, true)
  }

  if (!TAXONOMY_TYPES.includes(value)) {
    throw createHttpError(400, 'INVALID_TAXONOMY_TYPE', `type must be one of: ${TAXONOMY_TYPES.join(', ')}.`, true)
  }

  return value
}

function normalizeName(value) {
  if (typeof value !== 'string') {
    throw createHttpError(400, 'INVALID_TAXONOMY_NAME', 'name must be a string.', true)
  }

  const normalized = value.trim()

  if (!normalized) {
    throw createHttpError(400, 'INVALID_TAXONOMY_NAME', 'name cannot be blank.', true)
  }

  if (normalized.length > MAX_NAME_LENGTH) {
    throw createHttpError(400, 'INVALID_TAXONOMY_NAME', `name must be ${MAX_NAME_LENGTH} characters or fewer.`, true)
  }

  return normalized
}

function normalizeColor(value) {
  if (value === undefined || value === null || value === '') return null

  if (typeof value !== 'string') {
    throw createHttpError(400, 'INVALID_TAXONOMY_COLOR', 'color must be a string.', true)
  }

  const normalized = value.trim()

  if (normalized.length > MAX_COLOR_LENGTH) {
    throw createHttpError(400, 'INVALID_TAXONOMY_COLOR', `color must be ${MAX_COLOR_LENGTH} characters or fewer.`, true)
  }

  return normalized
}

function normalizeSortOrder(value, fallback = DEFAULT_SORT_ORDER) {
  if (value === undefined || value === null || value === '') return fallback

  const normalized = Number(value)

  if (!Number.isInteger(normalized) || normalized < MIN_SORT_ORDER || normalized > MAX_SORT_ORDER) {
    throw createHttpError(
      400,
      'INVALID_SORT_ORDER',
      `sortOrder must be an integer between ${MIN_SORT_ORDER} and ${MAX_SORT_ORDER}.`,
      true,
    )
  }

  return normalized
}

function normalizeBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw createHttpError(400, 'INVALID_BOOLEAN', `${fieldName} must be a boolean.`, true)
  }

  return value
}

function taxonomyProjection(alias = 't') {
  return `
    ${alias}.id,
    ${alias}.household_id as "householdId",
    ${alias}.type,
    ${alias}.name,
    ${alias}.slug,
    ${alias}.color,
    ${alias}.sort_order as "sortOrder",
    ${alias}.is_active as "isActive",
    ${alias}.created_at as "createdAt",
    ${alias}.updated_at as "updatedAt"
  `
}

async function readTaxonomyById(db, householdId, taxonomyId) {
  const result = await db.query(
    `
      select
        ${taxonomyProjection('t')}
      from recipe_taxonomy t
      where t.id = $1
        and t.household_id = $2
      limit 1
    `,
    [taxonomyId, householdId],
  )

  return result.rows[0] ?? null
}

export async function listTaxonomyForCurrentUser(clerkUserId, householdId, query = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const type = normalizeType(query.type, { required: false })
  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', { resourceType: 'taxonomy' })
  const result = await db.query(
    `
      select
        ${taxonomyProjection('t')}
      from recipe_taxonomy t
      where t.household_id = $1
        and ($2::text is null or t.type = $2)
      order by t.type asc, t.sort_order asc, t.created_at asc
    `,
    [access.household.id, type],
  )

  return {
    household: access.household,
    requester: access.membership,
    taxonomy: result.rows,
  }
}

export async function createTaxonomyForCurrentUser(clerkUserId, householdId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  assertPayloadObject(payload)
  const type = normalizeType(payload.type)
  const name = normalizeName(payload.name)
  const color = normalizeColor(payload.color)
  const sortOrder = normalizeSortOrder(payload.sortOrder)
  const slug = slugify(name)

  if (!slug) {
    throw createHttpError(400, 'INVALID_TAXONOMY_NAME', 'name produces an empty slug; pick a different name.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, TAXONOMY_WRITE_ROLES, {
    action: 'taxonomy:edit:household',
    resourceType: 'taxonomy',
    label: 'taxonomy:edit',
  })

  let insertedId
  try {
    const result = await db.query(
      `
        insert into recipe_taxonomy (
          household_id, type, name, slug, color, sort_order, is_active, created_by, updated_by
        )
        values ($1, $2, $3, $4, $5, $6, true, $7, $7)
        returning id
      `,
      [access.household.id, type, name, slug, color, sortOrder, user.id],
    )
    insertedId = result.rows[0].id
  } catch (err) {
    if (err.code === '23505') {
      throw createHttpError(409, 'TAXONOMY_DUPLICATE', `A ${typeLabel(type)} with that name already exists.`, true)
    }
    throw err
  }

  const taxonomy = await readTaxonomyById(db, access.household.id, insertedId)

  await writeAuditLog(db, {
    action: 'taxonomy.created',
    entityType: 'recipe_taxonomy',
    entityId: taxonomy.id,
    actorUserId: user.id,
    householdId: access.household.id,
    after: { type, name, slug },
  })

  return {
    household: access.household,
    requester: access.membership,
    taxonomy,
  }
}

export async function updateTaxonomyForCurrentUser(clerkUserId, householdId, taxonomyId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  assertPayloadObject(payload)
  const normalizedId = normalizeTaxonomyId(taxonomyId)

  const updates = {}
  // Rename intentionally leaves the slug untouched so existing recipe tags keep matching.
  if (Object.hasOwn(payload, 'name')) updates.name = normalizeName(payload.name)
  if (Object.hasOwn(payload, 'color')) updates.color = normalizeColor(payload.color)
  if (Object.hasOwn(payload, 'isActive')) updates.isActive = normalizeBoolean(payload.isActive, 'isActive')
  if (Object.hasOwn(payload, 'sortOrder')) updates.sortOrder = normalizeSortOrder(payload.sortOrder)

  if (Object.keys(updates).length === 0) {
    throw createHttpError(400, 'NO_TAXONOMY_UPDATES', 'Provide at least one taxonomy field to update.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, TAXONOMY_WRITE_ROLES, {
    action: 'taxonomy:edit:household',
    resourceType: 'taxonomy',
    label: 'taxonomy:edit',
  })

  const columnByField = {
    name: 'name',
    color: 'color',
    isActive: 'is_active',
    sortOrder: 'sort_order',
  }

  const values = [normalizedId, access.household.id]
  const setClauses = []

  for (const [fieldName, columnName] of Object.entries(columnByField)) {
    if (!Object.hasOwn(updates, fieldName)) continue
    values.push(updates[fieldName])
    setClauses.push(`${columnName} = $${values.length}`)
  }

  values.push(user.id)
  setClauses.push(`updated_by = $${values.length}`)
  setClauses.push('updated_at = now()')

  const result = await db.query(
    `
      update recipe_taxonomy
      set
        ${setClauses.join(',\n        ')}
      where id = $1
        and household_id = $2
      returning id
    `,
    values,
  )

  if (!result.rows[0]) {
    throw createHttpError(404, 'TAXONOMY_NOT_FOUND', 'Taxonomy item was not found.', true)
  }

  const taxonomy = await readTaxonomyById(db, access.household.id, normalizedId)

  await writeAuditLog(db, {
    action: 'taxonomy.updated',
    entityType: 'recipe_taxonomy',
    entityId: normalizedId,
    actorUserId: user.id,
    householdId: access.household.id,
    after: updates,
  })

  return {
    household: access.household,
    requester: access.membership,
    taxonomy,
  }
}

export async function deleteTaxonomyForCurrentUser(clerkUserId, householdId, taxonomyId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const normalizedId = normalizeTaxonomyId(taxonomyId)
  const access = await requireHouseholdRole(db, user.id, householdId, TAXONOMY_WRITE_ROLES, {
    action: 'taxonomy:edit:household',
    resourceType: 'taxonomy',
    label: 'taxonomy:edit',
  })
  const existing = await readTaxonomyById(db, access.household.id, normalizedId)

  if (!existing) {
    throw createHttpError(404, 'TAXONOMY_NOT_FOUND', 'Taxonomy item was not found.', true)
  }

  await db.query(
    `delete from recipe_taxonomy where id = $1 and household_id = $2`,
    [normalizedId, access.household.id],
  )

  await writeAuditLog(db, {
    action: 'taxonomy.deleted',
    entityType: 'recipe_taxonomy',
    entityId: normalizedId,
    actorUserId: user.id,
    householdId: access.household.id,
    before: { type: existing.type, name: existing.name, slug: existing.slug },
  })

  return {
    deleted: true,
    household: access.household,
    requester: access.membership,
    taxonomy: existing,
  }
}

export async function getTaxonomyUsageForCurrentUser(clerkUserId, householdId, query = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const type = normalizeType(query.type)
  const slug = typeof query.slug === 'string' ? query.slug.trim() : ''

  if (!slug) {
    throw createHttpError(400, 'INVALID_TAXONOMY_SLUG', 'slug is required.', true)
  }

  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', { resourceType: 'taxonomy' })
  // type is whitelist-validated above, so the column name is one of two literals.
  const column = type === 'meal_slot' ? 'meal_slots' : 'recipe_categories'
  const result = await db.query(
    `
      select 1
      from recipe_adaptations
      where household_id = $1
        and $2 = any(${column})
      limit 1
    `,
    [access.household.id, slug],
  )

  return {
    household: access.household,
    requester: access.membership,
    inUse: result.rows.length > 0,
  }
}
