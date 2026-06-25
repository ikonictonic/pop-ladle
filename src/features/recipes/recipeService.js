import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'
import { assertWithinSavedRecipeCap } from '../plans/planService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
} from '../households/householdAccess.js'
import {
  isStorageConfigured,
  createPresignedDownloadUrl,
} from '../../integrations/storage/storageClient.js'

const RECIPE_READ_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']
const RECIPE_WRITE_ROLES = ['owner', 'co_owner', 'caregiver']
const RECIPE_DELETE_ROLES = ['owner', 'co_owner']
const MAX_TITLE_LENGTH = 180
const MAX_TAG_LENGTH = 80
const MAX_SEARCH_LENGTH = 120
const DEFAULT_LIST_LIMIT = 50
const MAX_LIST_LIMIT = 100

function normalizeRecipeId(value) {
  return normalizeUuid(value, 'INVALID_RECIPE_ID', 'Recipe id must be a UUID.')
}

function normalizeOptionalCareRecipientId(value) {
  if (value === undefined || value === null || value === '') return null

  return normalizeUuid(
    value,
    'INVALID_CARE_RECIPIENT_ID',
    'careRecipientId must be a UUID.',
  )
}

function normalizeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function hasOwn(payload, fieldName) {
  return Object.hasOwn(payload, fieldName)
}

function normalizeTitle(value, outputMarkdown) {
  const title = normalizeText(value) || parseTitleFromMarkdown(outputMarkdown) || 'Untitled Recipe'

  if (title.length > MAX_TITLE_LENGTH) {
    throw createHttpError(
      400,
      'INVALID_RECIPE_TITLE',
      `Recipe title must be ${MAX_TITLE_LENGTH} characters or fewer.`,
      true,
    )
  }

  return title
}

function normalizeUpdatedTitle(value) {
  const title = normalizeText(value)

  if (!title) {
    throw createHttpError(400, 'INVALID_RECIPE_TITLE', 'title cannot be blank.', true)
  }

  if (title.length > MAX_TITLE_LENGTH) {
    throw createHttpError(
      400,
      'INVALID_RECIPE_TITLE',
      `Recipe title must be ${MAX_TITLE_LENGTH} characters or fewer.`,
      true,
    )
  }

  return title
}

function normalizeRequiredText(value, fieldName, code) {
  const normalized = normalizeText(value)

  if (!normalized) {
    throw createHttpError(400, code, `${fieldName} cannot be blank.`, true)
  }

  return normalized
}

function normalizeStringArray(value, fieldName) {
  if (value === undefined || value === null) return []

  if (!Array.isArray(value)) {
    throw createHttpError(400, 'INVALID_RECIPE_TAGS', `${fieldName} must be an array.`, true)
  }

  const normalized = value
    .map((item) => normalizeText(item).toLowerCase())
    .filter(Boolean)

  for (const item of normalized) {
    if (item.length > MAX_TAG_LENGTH) {
      throw createHttpError(
        400,
        'INVALID_RECIPE_TAGS',
        `${fieldName} values must be ${MAX_TAG_LENGTH} characters or fewer.`,
        true,
      )
    }
  }

  return [...new Set(normalized)]
}

function normalizePositiveInteger(value, fieldName) {
  if (value === undefined || value === null || value === '') return null

  const numberValue = Number(value)

  if (!Number.isInteger(numberValue) || numberValue < 1) {
    throw createHttpError(400, 'INVALID_SERVINGS', `${fieldName} must be a positive integer.`, true)
  }

  return numberValue
}

function normalizePositiveNumber(value, fieldName, fallback) {
  if (value === undefined || value === null || value === '') return fallback

  const numberValue = Number(value)

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw createHttpError(400, 'INVALID_SERVING_SCALE', `${fieldName} must be a positive number.`, true)
  }

  return numberValue
}

function normalizeJsonObject(value, fieldName, fallback) {
  if (value === undefined || value === null) return fallback

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createHttpError(400, 'INVALID_JSON_OBJECT', `${fieldName} must be a JSON object.`, true)
  }

  return value
}

function normalizeJsonArray(value, fieldName, fallback) {
  if (value === undefined || value === null) return fallback

  if (!Array.isArray(value)) {
    throw createHttpError(400, 'INVALID_JSON_ARRAY', `${fieldName} must be a JSON array.`, true)
  }

  return value
}

function normalizeBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw createHttpError(400, 'INVALID_BOOLEAN', `${fieldName} must be a boolean.`, true)
  }

  return value
}

function normalizeCreateRecipePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const outputMarkdown = normalizeText(payload.outputMarkdown)

  if (!outputMarkdown) {
    throw createHttpError(400, 'INVALID_RECIPE_OUTPUT', 'outputMarkdown is required.', true)
  }

  return {
    title: normalizeTitle(payload.title, outputMarkdown),
    sourceRecipeText: normalizeText(payload.sourceRecipeText),
    outputMarkdown,
    outputJson: normalizeJsonObject(payload.outputJson, 'outputJson', {}),
    mealSlots: normalizeStringArray(payload.mealSlots, 'mealSlots'),
    recipeCategories: normalizeStringArray(payload.recipeCategories, 'recipeCategories'),
    careRecipientId: normalizeOptionalCareRecipientId(payload.careRecipientId),
    isFavorite: Boolean(payload.isFavorite),
    provider: normalizeText(payload.provider) || null,
    model: normalizeText(payload.model) || null,
    originalServings: normalizePositiveInteger(payload.originalServings, 'originalServings'),
    targetServings: normalizePositiveInteger(payload.targetServings, 'targetServings'),
    servingScaleFactor: normalizePositiveNumber(payload.servingScaleFactor, 'servingScaleFactor', 1),
    servingCountEstimated: Boolean(payload.servingCountEstimated),
    servingNotes: normalizeText(payload.servingNotes) || null,
    generationMode: normalizeText(payload.generationMode) || 'manual',
    clinicalWarning: Boolean(payload.clinicalWarning),
    clinicalWarningItems: normalizeJsonArray(payload.clinicalWarningItems, 'clinicalWarningItems', []),
    // Two-phase save: the generator stores an unsaved draft (saved:false) and
    // promotes it later via PATCH. Default true preserves the single-call
    // "create == save" behavior for existing API callers.
    saved: payload.saved === undefined ? true : normalizeBoolean(payload.saved, 'saved'),
    // Generation provenance (nullable, free-form).
    promptVersion: normalizeText(payload.promptVersion) || null,
    clinicalProfileUpdatedAtUsed: normalizeOptionalTimestamp(
      payload.clinicalProfileUpdatedAtUsed,
      'clinicalProfileUpdatedAtUsed',
    ),
    hardRulesUpdatedAtUsed: normalizeOptionalTimestamp(
      payload.hardRulesUpdatedAtUsed,
      'hardRulesUpdatedAtUsed',
    ),
  }
}

function normalizeOptionalTimestamp(value, fieldName) {
  if (value === undefined || value === null || value === '') return null

  const asString = typeof value === 'string' ? value.trim() : value
  const time = new Date(asString).getTime()

  if (Number.isNaN(time)) {
    throw createHttpError(400, 'INVALID_TIMESTAMP', `${fieldName} must be an ISO timestamp.`, true)
  }

  return asString
}

function normalizeUpdateRecipePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const updates = {}

  if (hasOwn(payload, 'title')) {
    updates.title = normalizeUpdatedTitle(payload.title)
  }

  if (hasOwn(payload, 'sourceRecipeText')) {
    updates.sourceRecipeText = normalizeText(payload.sourceRecipeText)
  }

  if (hasOwn(payload, 'outputMarkdown')) {
    updates.outputMarkdown = normalizeRequiredText(
      payload.outputMarkdown,
      'outputMarkdown',
      'INVALID_RECIPE_OUTPUT',
    )
  }

  if (hasOwn(payload, 'outputJson')) {
    updates.outputJson = normalizeJsonObject(payload.outputJson, 'outputJson', {})
  }

  if (hasOwn(payload, 'mealSlots')) {
    updates.mealSlots = normalizeStringArray(payload.mealSlots, 'mealSlots')
  }

  if (hasOwn(payload, 'recipeCategories')) {
    updates.recipeCategories = normalizeStringArray(payload.recipeCategories, 'recipeCategories')
  }

  if (hasOwn(payload, 'careRecipientId')) {
    updates.careRecipientId = normalizeOptionalCareRecipientId(payload.careRecipientId)
  }

  if (hasOwn(payload, 'isFavorite')) {
    updates.isFavorite = normalizeBoolean(payload.isFavorite, 'isFavorite')
  }

  if (hasOwn(payload, 'originalServings')) {
    updates.originalServings = normalizePositiveInteger(payload.originalServings, 'originalServings')
  }

  if (hasOwn(payload, 'targetServings')) {
    updates.targetServings = normalizePositiveInteger(payload.targetServings, 'targetServings')
  }

  if (hasOwn(payload, 'servingScaleFactor')) {
    updates.servingScaleFactor = normalizePositiveNumber(
      payload.servingScaleFactor,
      'servingScaleFactor',
      1,
    )
  }

  if (hasOwn(payload, 'servingCountEstimated')) {
    updates.servingCountEstimated = normalizeBoolean(
      payload.servingCountEstimated,
      'servingCountEstimated',
    )
  }

  if (hasOwn(payload, 'servingNotes')) {
    updates.servingNotes = normalizeText(payload.servingNotes) || null
  }

  if (hasOwn(payload, 'generationMode')) {
    updates.generationMode = normalizeRequiredText(
      payload.generationMode,
      'generationMode',
      'INVALID_GENERATION_MODE',
    )
  }

  if (hasOwn(payload, 'clinicalWarning')) {
    updates.clinicalWarning = normalizeBoolean(payload.clinicalWarning, 'clinicalWarning')
  }

  if (hasOwn(payload, 'clinicalWarningItems')) {
    updates.clinicalWarningItems = normalizeJsonArray(
      payload.clinicalWarningItems,
      'clinicalWarningItems',
      [],
    )
  }

  // Promote a draft into the library (the old markRecipeAsSaved). Only `true`
  // is meaningful; unsaving isn't a supported operation.
  if (hasOwn(payload, 'saved')) {
    updates.saved = normalizeBoolean(payload.saved, 'saved')
  }

  if (Object.keys(updates).length === 0) {
    throw createHttpError(
      400,
      'NO_RECIPE_UPDATES',
      'Provide at least one recipe field to update.',
      true,
    )
  }

  return updates
}

function normalizeListQuery(query = {}) {
  const search = normalizeText(query.search)
  const mealSlots = normalizeQueryArray(query.mealSlots ?? query.mealSlot, 'mealSlots')
  const recipeCategories = normalizeQueryArray(
    query.recipeCategories ?? query.categories ?? query.category,
    'recipeCategories',
  )
  const careRecipientId = normalizeOptionalCareRecipientId(query.careRecipientId)
  const favoritesOnly = query.favoritesOnly === 'true' || query.favoritesOnly === true
  const includeGenerated = query.includeGenerated === 'true' || query.includeGenerated === true
  const excludeReviewStatuses = normalizeQueryArray(
    query.excludeReviewStatuses,
    'excludeReviewStatuses',
  )
  const requestedLimit = Number.parseInt(query.limit ?? `${DEFAULT_LIST_LIMIT}`, 10)

  if (search.length > MAX_SEARCH_LENGTH) {
    throw createHttpError(
      400,
      'INVALID_RECIPE_SEARCH',
      `Search must be ${MAX_SEARCH_LENGTH} characters or fewer.`,
      true,
    )
  }

  return {
    search: search || null,
    mealSlots: mealSlots.length > 0 ? mealSlots : null,
    recipeCategories: recipeCategories.length > 0 ? recipeCategories : null,
    careRecipientId,
    favoritesOnly,
    includeGenerated,
    excludeReviewStatuses: excludeReviewStatuses.length > 0 ? excludeReviewStatuses : null,
    limit: Number.isInteger(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), MAX_LIST_LIMIT)
      : DEFAULT_LIST_LIMIT,
  }
}

function normalizeQueryArray(value, fieldName) {
  if (value === undefined || value === null || value === '') return []

  const rawItems = Array.isArray(value) ? value : `${value}`.split(',')

  return normalizeStringArray(rawItems, fieldName)
}

function recipeProjection(alias = 'ra') {
  return `
    ${alias}.id,
    ${alias}.recipe_request_id as "recipeRequestId",
    ${alias}.household_id as "householdId",
    ${alias}.care_recipient_id as "careRecipientId",
    ${alias}.title,
    ${alias}.source_recipe_text as "sourceRecipeText",
    ${alias}.output_markdown as "outputMarkdown",
    ${alias}.output_json as "outputJson",
    ${alias}.meal_slots as "mealSlots",
    ${alias}.recipe_categories as "recipeCategories",
    ${alias}.saved_by as "savedByUserId",
    ${alias}.saved_at as "savedAt",
    ${alias}.is_favorite as "isFavorite",
    ${alias}.photo_url as "photoUrl",
    ${alias}.photo_storage_path as "photoStoragePath",
    ${alias}.original_servings as "originalServings",
    ${alias}.target_servings as "targetServings",
    ${alias}.serving_scale_factor::float as "servingScaleFactor",
    ${alias}.serving_count_estimated as "servingCountEstimated",
    ${alias}.serving_notes as "servingNotes",
    ${alias}.generation_mode as "generationMode",
    ${alias}.clinical_warning as "clinicalWarning",
    ${alias}.clinical_warning_items as "clinicalWarningItems",
    ${alias}.clinical_review_status as "clinicalReviewStatus",
    ${alias}.clinical_review_summary as "clinicalReviewSummary",
    ${alias}.recipe_brain_run_id as "recipeBrainRunId",
    ${alias}.version_number as "versionNumber",
    ${alias}.current_version_label as "currentVersionLabel",
    ${alias}.version_history as "versionHistory",
    ${alias}.flavor_change_log as "flavorChangeLog",
    ${alias}.is_master_recipe as "isMasterRecipe",
    ${alias}.accuracy_check_status as "accuracyCheckStatus",
    ${alias}.accuracy_confidence as "accuracyConfidence",
    ${alias}.needs_clinician_review as "needsClinicianReview",
    ${alias}.prompt_version as "promptVersion",
    ${alias}.clinical_profile_updated_at_used as "clinicalProfileUpdatedAtUsed",
    ${alias}.hard_rules_updated_at_used as "hardRulesUpdatedAtUsed",
    ${alias}.created_by as "createdByUserId",
    ${alias}.updated_by as "updatedByUserId",
    ${alias}.deleted_at as "deletedAt",
    ${alias}.created_at as "createdAt",
    ${alias}.updated_at as "updatedAt"
  `
}

async function createRecipeRequest(client, householdId, user, payload) {
  const result = await client.query(
    `
      insert into recipe_requests (
        household_id,
        care_recipient_id,
        source_recipe_text,
        provider,
        model,
        status,
        requested_by,
        completed_at
      )
      values ($1, $2, $3, $4, $5, 'completed', $6, now())
      returning id
    `,
    [
      householdId,
      payload.careRecipientId,
      payload.sourceRecipeText,
      payload.provider,
      payload.model,
      user.id,
    ],
  )

  return result.rows[0]
}

async function insertRecipe(client, householdId, user, requestId, payload) {
  // A draft (payload.saved === false) lands in the library only once promoted,
  // so saved_by / saved_at stay null until then.
  const savedBy = payload.saved ? user.id : null
  const result = await client.query(
    `
      insert into recipe_adaptations (
        recipe_request_id,
        household_id,
        care_recipient_id,
        title,
        source_recipe_text,
        output_markdown,
        output_json,
        meal_slots,
        recipe_categories,
        saved_by,
        saved_at,
        is_favorite,
        original_servings,
        target_servings,
        serving_scale_factor,
        serving_count_estimated,
        serving_notes,
        generation_mode,
        clinical_warning,
        clinical_warning_items,
        prompt_version,
        clinical_profile_updated_at_used,
        hard_rules_updated_at_used,
        created_by,
        updated_by
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        case when $11::uuid is null then null else now() end,
        $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $24
      )
      returning
        ${recipeProjection('recipe_adaptations')}
    `,
    [
      requestId,
      householdId,
      payload.careRecipientId,
      payload.title,
      payload.sourceRecipeText,
      payload.outputMarkdown,
      payload.outputJson,
      payload.mealSlots,
      payload.recipeCategories,
      savedBy,
      savedBy,
      payload.isFavorite,
      payload.originalServings,
      payload.targetServings,
      payload.servingScaleFactor,
      payload.servingCountEstimated,
      payload.servingNotes,
      payload.generationMode,
      payload.clinicalWarning,
      payload.clinicalWarningItems,
      payload.promptVersion,
      payload.clinicalProfileUpdatedAtUsed,
      payload.hardRulesUpdatedAtUsed,
      user.id,
    ],
  )

  return result.rows[0]
}

export async function readRecipeById(db, householdId, recipeId, includeDeleted = false) {
  const result = await db.query(
    `
      select
        ${recipeProjection('ra')}
      from recipe_adaptations ra
      where ra.id = $1
        and ra.household_id = $2
        and ($3::boolean = true or ra.deleted_at is null)
      limit 1
    `,
    [recipeId, householdId, includeDeleted],
  )

  return result.rows[0] ?? null
}

async function requireActiveCareRecipient(db, householdId, careRecipientId) {
  if (!careRecipientId) return null

  const result = await db.query(
    `
      select
        id,
        display_name as "displayName",
        relationship_label as "relationshipLabel",
        status
      from care_recipients
      where id = $1
        and household_id = $2
        and status = 'active'
      limit 1
    `,
    [careRecipientId, householdId],
  )

  const careRecipient = result.rows[0] ?? null

  if (!careRecipient) {
    throw createHttpError(
      404,
      'CARE_RECIPIENT_NOT_FOUND',
      'Care recipient was not found for this household.',
      true,
    )
  }

  return careRecipient
}

async function updateRecipe(db, householdId, recipeId, userId, updates) {
  const columnByField = {
    title: 'title',
    sourceRecipeText: 'source_recipe_text',
    outputMarkdown: 'output_markdown',
    outputJson: 'output_json',
    mealSlots: 'meal_slots',
    recipeCategories: 'recipe_categories',
    careRecipientId: 'care_recipient_id',
    isFavorite: 'is_favorite',
    originalServings: 'original_servings',
    targetServings: 'target_servings',
    servingScaleFactor: 'serving_scale_factor',
    servingCountEstimated: 'serving_count_estimated',
    servingNotes: 'serving_notes',
    generationMode: 'generation_mode',
    clinicalWarning: 'clinical_warning',
    clinicalWarningItems: 'clinical_warning_items',
    photoUrl: 'photo_url',
  }
  const values = [recipeId, householdId]
  const setClauses = []

  for (const [fieldName, columnName] of Object.entries(columnByField)) {
    if (!hasOwn(updates, fieldName)) continue

    values.push(updates[fieldName])
    setClauses.push(`${columnName} = $${values.length}`)
  }

  // An external photo URL supersedes a stored object: clear the private-bucket
  // key so reads return the external URL rather than a presigned storage URL.
  // (The replaced object is left in the bucket — best-effort, same as before.)
  if (hasOwn(updates, 'photoUrl') && updates.photoUrl) {
    setClauses.push('photo_storage_path = null')
  }

  // Promote to saved: stamp saved_at/saved_by once (coalesce keeps the original
  // save time if it's already in the library).
  if (updates.saved === true) {
    values.push(userId)
    setClauses.push(`saved_by = coalesce(saved_by, $${values.length})`)
    setClauses.push('saved_at = coalesce(saved_at, now())')
  }

  values.push(userId)
  setClauses.push(`updated_by = $${values.length}`)
  setClauses.push('updated_at = now()')

  const result = await db.query(
    `
      update recipe_adaptations
      set
        ${setClauses.join(',\n        ')}
      where recipe_adaptations.id = $1
        and recipe_adaptations.household_id = $2
        and recipe_adaptations.deleted_at is null
      returning
        ${recipeProjection('recipe_adaptations')}
    `,
    values,
  )

  return result.rows[0] ?? null
}

async function markRecipeDeleted(db, householdId, recipeId, userId) {
  const result = await db.query(
    `
      update recipe_adaptations
      set
        deleted_at = coalesce(deleted_at, now()),
        deleted_by = coalesce(deleted_by, $3),
        updated_by = $3,
        updated_at = now()
      where recipe_adaptations.id = $1
        and recipe_adaptations.household_id = $2
      returning
        ${recipeProjection('recipe_adaptations')}
    `,
    [recipeId, householdId, userId],
  )

  return result.rows[0] ?? null
}

export async function createRecipeForCurrentUser(clerkUserId, householdId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const recipePayload = normalizeCreateRecipePayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, RECIPE_WRITE_ROLES)
  await requireActiveCareRecipient(db, access.household.id, recipePayload.careRecipientId)
  // Entitlement gate: the free tier caps saved recipes. Unsaved drafts don't
  // count against the library, so only enforce the cap on an actual save.
  if (recipePayload.saved) {
    await assertWithinSavedRecipeCap(db, access.household.id)
  }
  const client = await db.connect()

  try {
    await client.query('begin')

    const request = await createRecipeRequest(client, access.household.id, user, recipePayload)
    const recipe = await insertRecipe(client, access.household.id, user, request.id, recipePayload)

    await client.query('commit')

    return {
      household: access.household,
      requester: access.membership,
      recipe,
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

export async function listRecipesForCurrentUser(clerkUserId, householdId, query) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const filters = normalizeListQuery(query)
  const access = await requireHouseholdRole(db, user.id, householdId, RECIPE_READ_ROLES)
  const result = await db.query(
    `
      select
        ${recipeProjection('ra')}
      from recipe_adaptations ra
      where ra.household_id = $1
        and ra.deleted_at is null
        and ($2::boolean = true or ra.saved_at is not null)
        and ($3::text is null or ra.title ilike '%' || $3 || '%')
        and ($4::text[] is null or ra.meal_slots && $4::text[])
        and ($5::text[] is null or ra.recipe_categories && $5::text[])
        and ($6::uuid is null or ra.care_recipient_id = $6)
        and ($7::boolean = false or ra.is_favorite = true)
        and ($8::text[] is null or coalesce(ra.clinical_review_status, '') <> all($8::text[]))
      order by ra.saved_at desc nulls last, ra.created_at desc
      limit $9
    `,
    [
      access.household.id,
      filters.includeGenerated,
      filters.search,
      filters.mealSlots,
      filters.recipeCategories,
      filters.careRecipientId,
      filters.favoritesOnly,
      filters.excludeReviewStatuses,
      filters.limit,
    ],
  )

  return {
    household: access.household,
    requester: access.membership,
    recipes: result.rows,
  }
}

export async function getRecipeForCurrentUser(clerkUserId, householdId, recipeId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const access = await requireHouseholdRole(db, user.id, householdId, RECIPE_READ_ROLES)
  const recipe = await readRecipeById(db, access.household.id, normalizedRecipeId)

  if (!recipe) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
  }

  await attachPhotoUrl(recipe)

  return {
    household: access.household,
    requester: access.membership,
    recipe,
  }
}

// Private bucket: resolve a short-lived signed view URL for the response only
// (photo_url stays null in the DB). Best-effort — a signing failure or unset
// storage just leaves photoUrl null rather than breaking the recipe read.
async function attachPhotoUrl(recipe) {
  if (!recipe?.photoStoragePath || !isStorageConfigured()) return
  try {
    recipe.photoUrl = await createPresignedDownloadUrl({ key: recipe.photoStoragePath, expiresIn: 900 })
  } catch (err) {
    console.error('Failed to sign recipe photo URL', { recipeId: recipe.id, error: err?.message })
  }
}

export async function updateRecipeForCurrentUser(clerkUserId, householdId, recipeId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const updates = normalizeUpdateRecipePayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, RECIPE_WRITE_ROLES)
  await requireActiveCareRecipient(db, access.household.id, updates.careRecipientId)

  // Promoting a draft into the library counts against the free-tier cap, but
  // only on the transition — re-saving an already-saved recipe is a no-op.
  if (updates.saved === true) {
    const existing = await readRecipeById(db, access.household.id, normalizedRecipeId)
    if (existing && !existing.savedAt) {
      await assertWithinSavedRecipeCap(db, access.household.id)
    }
  }

  const recipe = await updateRecipe(db, access.household.id, normalizedRecipeId, user.id, updates)

  if (!recipe) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
  }

  return {
    household: access.household,
    requester: access.membership,
    recipe,
  }
}

export async function deleteRecipeForCurrentUser(clerkUserId, householdId, recipeId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const access = await requireHouseholdRole(db, user.id, householdId, RECIPE_DELETE_ROLES, {
    action: 'recipe:delete',
    resourceType: 'recipe',
    label: 'recipe:delete',
  })
  const existingRecipe = await readRecipeById(db, access.household.id, normalizedRecipeId, true)

  if (!existingRecipe) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
  }

  if (existingRecipe.deletedAt) {
    return {
      deleted: false,
      household: access.household,
      requester: access.membership,
      recipe: existingRecipe,
    }
  }

  const recipe = await markRecipeDeleted(db, access.household.id, normalizedRecipeId, user.id)

  await writeAuditLog(db, {
    action: 'recipe.deleted',
    entityType: 'recipe_adaptation',
    entityId: normalizedRecipeId,
    actorUserId: user.id,
    householdId: access.household.id,
    before: { title: existingRecipe.title },
  })

  return {
    deleted: true,
    household: access.household,
    requester: access.membership,
    recipe,
  }
}

// ---------------------------------------------------------------------------
// In-place versioning: modify (push current into history, replace) / restore.
// Read-modify-write under a row lock so concurrent edits can't clobber history.
// ---------------------------------------------------------------------------

async function readRecipeForUpdate(client, householdId, recipeId) {
  const result = await client.query(
    `
      select
        ${recipeProjection('ra')}
      from recipe_adaptations ra
      where ra.id = $1
        and ra.household_id = $2
        and ra.deleted_at is null
      limit 1
      for update
    `,
    [recipeId, householdId],
  )

  return result.rows[0] ?? null
}

function currentVersionSnapshot(recipe, fallbackLabel) {
  return {
    label: recipe.currentVersionLabel || fallbackLabel,
    output_markdown: recipe.outputMarkdown,
    created_at: recipe.updatedAt || recipe.createdAt || null,
    created_by: recipe.updatedByUserId || recipe.savedByUserId || null,
    version_number: recipe.versionNumber || 1,
  }
}

export async function modifyRecipeVersionForCurrentUser(clerkUserId, householdId, recipeId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const newOutputMarkdown = normalizeRequiredText(
    payload.newOutputMarkdown,
    'newOutputMarkdown',
    'INVALID_RECIPE_OUTPUT',
  )
  const newVersionLabel = normalizeText(payload.newVersionLabel) || 'Modified'
  const incomingFlavorLog = normalizeJsonArray(payload.flavorChangeLog, 'flavorChangeLog', [])

  const access = await requireHouseholdRole(db, user.id, householdId, RECIPE_WRITE_ROLES)
  const client = await db.connect()

  try {
    await client.query('begin')

    const current = await readRecipeForUpdate(client, access.household.id, normalizedRecipeId)
    if (!current) {
      throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
    }

    const nextHistory = [...(current.versionHistory || []), currentVersionSnapshot(current, 'Original')]
    const nextFlavorLog = [...(current.flavorChangeLog || []), ...incomingFlavorLog]
    const nextTitle = parseTitleFromMarkdown(newOutputMarkdown) || current.title

    const result = await client.query(
      `
        update recipe_adaptations
        set
          output_markdown = $3,
          current_version_label = $4,
          version_history = $5::jsonb,
          version_number = $6,
          flavor_change_log = $7::jsonb,
          title = $8,
          updated_by = $9,
          updated_at = now()
        where id = $1 and household_id = $2
        returning ${recipeProjection('recipe_adaptations')}
      `,
      [
        normalizedRecipeId,
        access.household.id,
        newOutputMarkdown,
        newVersionLabel,
        JSON.stringify(nextHistory),
        (current.versionNumber || 1) + 1,
        JSON.stringify(nextFlavorLog),
        nextTitle,
        user.id,
      ],
    )

    await client.query('commit')

    return {
      household: access.household,
      requester: access.membership,
      recipe: result.rows[0],
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

export async function restoreRecipeVersionForCurrentUser(clerkUserId, householdId, recipeId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const versionIndex = Number(payload.versionIndex)
  if (!Number.isInteger(versionIndex) || versionIndex < 0) {
    throw createHttpError(400, 'INVALID_VERSION_INDEX', 'versionIndex must be a non-negative integer.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, RECIPE_WRITE_ROLES)
  const client = await db.connect()

  try {
    await client.query('begin')

    const current = await readRecipeForUpdate(client, access.household.id, normalizedRecipeId)
    if (!current) {
      throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
    }

    const history = current.versionHistory || []
    if (versionIndex >= history.length) {
      throw createHttpError(400, 'INVALID_VERSION_INDEX', 'No version exists at that index.', true)
    }

    const target = history[versionIndex]
    const remaining = history.filter((_, index) => index !== versionIndex)
    const nextHistory = [...remaining, currentVersionSnapshot(current, 'Modified')]
    const nextTitle = parseTitleFromMarkdown(target.output_markdown) || current.title

    const result = await client.query(
      `
        update recipe_adaptations
        set
          output_markdown = $3,
          current_version_label = $4,
          version_history = $5::jsonb,
          title = $6,
          updated_by = $7,
          updated_at = now()
        where id = $1 and household_id = $2
        returning ${recipeProjection('recipe_adaptations')}
      `,
      [
        normalizedRecipeId,
        access.household.id,
        target.output_markdown,
        target.label || 'Restored',
        JSON.stringify(nextHistory),
        nextTitle,
        user.id,
      ],
    )

    await client.query('commit')

    return {
      household: access.household,
      requester: access.membership,
      recipe: result.rows[0],
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

function parseTitleFromMarkdown(markdown) {
  const lines = markdown.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/)
    if (headingMatch?.[1]) {
      return headingMatch[1].trim()
    }
  }

  return null
}
