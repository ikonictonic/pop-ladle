/**
 * Master Recipe Library (platform recipes).
 *
 * Single-table model (scope flag on recipe_adaptations): a master recipe is
 * platform-owned content published by a Super Admin; a household copy is a clone
 * with `source_master_recipe_id` set, re-gated against the copying household's
 * own Care Profile + hard rules.
 *
 *   Publish  — library admins (super/clinical/content) flip an approved
 *              committee recipe to master; admin generation auto-publishes on
 *              a publishable verdict (recipe-brain runRecipeBrainForAdmin).
 *   Edit     — content admins edit masters in place; content edits re-gate
 *              (accuracy re-check + needs_review) per PL-001.
 *   Review   — library admins re-approve/deny masters; denied = unpublished.
 *   Browse   — any authenticated user lists/reads published masters.
 *   Copy     — owner/co-owner/caregiver clones a master into their household;
 *              entitlement-gated (library_copy = Basic+), accuracy re-checked,
 *              starts at clinical_review_status = 'needs_review', audited.
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'
import { runAccuracyCheckForRecipe } from '../clinical-review/accuracyCheckService.js'
import {
  assertWithinSavedRecipeCap,
  requireLibraryCopyAccess,
} from '../plans/planService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
} from '../households/householdAccess.js'
import { CONTENT_ADMINS, LIBRARY_ADMINS, requireInternalAdmin } from '../super-admin/adminAccess.js'
import { normalizeDecisionPayload } from '../clinical-review/clinicalReviewService.js'

const COPY_ROLES = ['owner', 'co_owner', 'caregiver']
const PUBLISHABLE_STATUSES = new Set(['approved', 'approved_with_caveats'])
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const MAX_SEARCH = 120

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeRecipeId(value) {
  return normalizeUuid(value, 'INVALID_RECIPE_ID', 'Recipe id must be a UUID.')
}

// Public-facing projection — no household internals leak into the library.
function masterProjection(alias = 'ra') {
  return `
    ${alias}.id,
    ${alias}.title,
    ${alias}.output_markdown as "outputMarkdown",
    ${alias}.meal_slots as "mealSlots",
    ${alias}.recipe_categories as "recipeCategories",
    ${alias}.photo_url as "photoUrl",
    ${alias}.target_servings as "targetServings",
    ${alias}.original_servings as "originalServings",
    ${alias}.clinical_review_status as "clinicalReviewStatus",
    ${alias}.clinical_review_summary as "clinicalReviewSummary",
    ${alias}.clinical_warning as "clinicalWarning",
    ${alias}.clinical_warning_items as "clinicalWarningItems",
    ${alias}.published_at as "publishedAt",
    ${alias}.created_at as "createdAt"
  `
}

const REVIEW_QUEUE_STATUSES = ['approved', 'approved_with_caveats']
const MAX_TAGS = 20

function normalizeTagArray(value, field) {
  if (value === undefined || value === null) return null
  if (!Array.isArray(value)) {
    throw createHttpError(400, 'INVALID_TAGS', `${field} must be an array of strings.`, true)
  }
  const out = value.map((v) => normalizeText(v).toLowerCase()).filter(Boolean)
  if (out.length > MAX_TAGS) {
    throw createHttpError(400, 'INVALID_TAGS', `${field} must have ${MAX_TAGS} or fewer entries.`, true)
  }
  return [...new Set(out)]
}

// Tags applied when accepting a recipe into the library. Null = leave unchanged.
function normalizeAcceptTags(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { recipeCategories: null, mealSlots: null }
  }
  return {
    recipeCategories: normalizeTagArray(payload.recipeCategories, 'recipeCategories'),
    mealSlots: normalizeTagArray(payload.mealSlots, 'mealSlots'),
  }
}

// ---------------------------------------------------------------------------
// Recipe Review Queue (admin) — gate-cleared recipes awaiting library acceptance
// ---------------------------------------------------------------------------

/**
 * Recipes the Clinical Review Gate has cleared (approved / approved_with_caveats)
 * but that are NOT yet master recipes — i.e. awaiting a Recipe Library Admin's
 * acceptance into the library. This is the doctrine's "Recipe Review Queue".
 */
export async function listRecipeReviewQueueForAdmin(clerkUserId, query = {}) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, LIBRARY_ADMINS)

  const search = normalizeText(query.search)
  if (search.length > MAX_SEARCH) {
    throw createHttpError(400, 'INVALID_SEARCH', `Search must be ${MAX_SEARCH} characters or fewer.`, true)
  }
  const requestedLimit = Number.parseInt(query.limit ?? `${DEFAULT_LIMIT}`, 10)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT

  const result = await db.query(
    `
      select
        ra.id, ra.title, ra.household_id as "householdId", h.name as "householdName",
        ra.meal_slots as "mealSlots", ra.recipe_categories as "recipeCategories",
        ra.clinical_review_status as "clinicalReviewStatus",
        ra.clinical_review_summary as "clinicalReviewSummary",
        ra.accuracy_check_status as "accuracyCheckStatus",
        ra.accuracy_confidence as "accuracyConfidence",
        ra.needs_clinician_review as "needsClinicianReview",
        ra.photo_url as "photoUrl",
        ra.generation_mode as "generationMode",
        ra.clinical_reviewed_at as "clinicalReviewedAt",
        ra.created_at as "createdAt"
      from recipe_adaptations ra
      join households h on h.id = ra.household_id
      where ra.scope = 'household'
        and ra.deleted_at is null
        and ra.clinical_review_status = any($1::text[])
        and ($2::text is null or ra.title ilike '%' || $2 || '%')
      order by ra.clinical_reviewed_at desc nulls last, ra.created_at desc
      limit $3
    `,
    [REVIEW_QUEUE_STATUSES, search || null, limit],
  )

  return { adminRole: admin.role, queue: result.rows }
}

// ---------------------------------------------------------------------------
// Publish / unpublish (admin) — accept a cleared recipe into the library
// ---------------------------------------------------------------------------

export async function publishRecipeForAdmin(clerkUserId, recipeId, payload = {}) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, LIBRARY_ADMINS)
  const normalizedId = normalizeRecipeId(recipeId)
  const tags = normalizeAcceptTags(payload)

  const existing = await db.query(
    `
      select id, title, scope, clinical_review_status as "clinicalReviewStatus", deleted_at as "deletedAt"
      from recipe_adaptations
      where id = $1
      limit 1
    `,
    [normalizedId],
  )
  const recipe = existing.rows[0]
  if (!recipe || recipe.deletedAt) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
  }
  if (!PUBLISHABLE_STATUSES.has(recipe.clinicalReviewStatus)) {
    throw createHttpError(
      409,
      'RECIPE_NOT_APPROVED',
      'Only recipes approved by Clinical Review can be published to the library.',
      true,
    )
  }

  const updated = await db.query(
    `
      update recipe_adaptations
      set scope = 'master', is_master_recipe = true,
          recipe_categories = coalesce($3::text[], recipe_categories),
          meal_slots = coalesce($4::text[], meal_slots),
          published_at = now(), published_by = $2, updated_at = now()
      where id = $1
      returning ${masterProjection('recipe_adaptations')}
    `,
    [normalizedId, user.id, tags.recipeCategories, tags.mealSlots],
  )

  await writeAuditLog(db, {
    action: 'platform_recipe.published',
    entityType: 'recipe_adaptation',
    entityId: normalizedId,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    after: {
      scope: 'master',
      title: recipe.title,
      recipeCategories: tags.recipeCategories,
      mealSlots: tags.mealSlots,
    },
  })

  return { adminRole: admin.role, recipe: updated.rows[0] }
}

export async function unpublishRecipeForAdmin(clerkUserId, recipeId) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, LIBRARY_ADMINS)
  const normalizedId = normalizeRecipeId(recipeId)

  const updated = await db.query(
    `
      update recipe_adaptations
      set scope = 'household', is_master_recipe = false,
          published_at = null, published_by = null, updated_at = now()
      where id = $1 and scope = 'master'
      returning id, title
    `,
    [normalizedId],
  )
  if (updated.rows.length === 0) {
    throw createHttpError(404, 'MASTER_RECIPE_NOT_FOUND', 'Published master recipe was not found.', true)
  }

  await writeAuditLog(db, {
    action: 'platform_recipe.unpublished',
    entityType: 'recipe_adaptation',
    entityId: normalizedId,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    before: { scope: 'master', title: updated.rows[0].title },
  })

  return { adminRole: admin.role, recipe: updated.rows[0] }
}

// ---------------------------------------------------------------------------
// Browse (any authenticated user)
// ---------------------------------------------------------------------------

export async function listPlatformRecipesForCurrentUser(clerkUserId, query = {}) {
  await getCurrentAppUser(clerkUserId) // authentication only; the library is cross-household
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const search = normalizeText(query.search)
  if (search.length > MAX_SEARCH) {
    throw createHttpError(400, 'INVALID_SEARCH', `Search must be ${MAX_SEARCH} characters or fewer.`, true)
  }
  const mealSlots = toLowerArray(query.mealSlots ?? query.mealSlot)
  const categories = toLowerArray(query.recipeCategories ?? query.categories ?? query.category)
  const requestedLimit = Number.parseInt(query.limit ?? `${DEFAULT_LIMIT}`, 10)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT

  const result = await db.query(
    `
      select ${masterProjection('ra')}
      from recipe_adaptations ra
      where ra.scope = 'master'
        and ra.deleted_at is null
        and ra.published_at is not null
        and ($1::text is null or ra.title ilike '%' || $1 || '%')
        and ($2::text[] is null or ra.meal_slots && $2::text[])
        and ($3::text[] is null or ra.recipe_categories && $3::text[])
      order by ra.published_at desc
      limit $4
    `,
    [search || null, mealSlots, categories, limit],
  )

  return { recipes: result.rows }
}

export async function getPlatformRecipeForCurrentUser(clerkUserId, recipeId) {
  await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedId = normalizeRecipeId(recipeId)
  const result = await db.query(
    `
      select ${masterProjection('ra')}
      from recipe_adaptations ra
      where ra.id = $1 and ra.scope = 'master' and ra.deleted_at is null and ra.published_at is not null
      limit 1
    `,
    [normalizedId],
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'MASTER_RECIPE_NOT_FOUND', 'Master recipe was not found.', true)
  }

  return { recipe: result.rows[0] }
}

function toLowerArray(value) {
  if (value === undefined || value === null || value === '') return null
  const raw = Array.isArray(value) ? value : `${value}`.split(',')
  const out = raw.map((v) => normalizeText(v).toLowerCase()).filter(Boolean)
  return out.length > 0 ? out : null
}

// ---------------------------------------------------------------------------
// Admin read + edit of master recipes (content admins; ABAC PL-005)
// ---------------------------------------------------------------------------

// Content fields carry the recipe body the committee approved: changing them
// re-runs the deterministic gate. Metadata applies instantly (PL-001: a changed
// recipe body has not cleared the Clinical Review Gate; a retitle has).
const ADMIN_CONTENT_FIELDS = ['outputMarkdown', 'sourceRecipeText']

/** Pure: does this update set touch gate-relevant recipe content? */
export function classifyAdminRecipeUpdates(updates) {
  return {
    contentChanged: ADMIN_CONTENT_FIELDS.some((field) => Object.hasOwn(updates ?? {}, field)),
  }
}

const MAX_ADMIN_TITLE = 180
const MAX_ADMIN_TEXT = 20000

/**
 * Pure: whitelist-normalize an admin master-recipe PATCH. Everything outside
 * the whitelist is rejected — committee/gate-owned state (clinical_* fields,
 * scope, saved, care recipient linkage) is never editable here.
 */
export function normalizeAdminUpdatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const updates = {}

  if (payload.title !== undefined) {
    const title = normalizeText(payload.title)
    if (!title || title.length > MAX_ADMIN_TITLE) {
      throw createHttpError(400, 'INVALID_RECIPE_TITLE', `title must be 1–${MAX_ADMIN_TITLE} characters.`, true)
    }
    updates.title = title
  }

  for (const [key, label] of [['outputMarkdown', 'outputMarkdown'], ['sourceRecipeText', 'sourceRecipeText']]) {
    if (payload[key] !== undefined) {
      const text = normalizeText(payload[key])
      if (!text || text.length > MAX_ADMIN_TEXT) {
        throw createHttpError(400, 'INVALID_RECIPE_TEXT', `${label} must be 1–${MAX_ADMIN_TEXT} characters.`, true)
      }
      updates[key] = text
    }
  }

  for (const key of ['mealSlots', 'recipeCategories']) {
    if (payload[key] !== undefined) {
      updates[key] = normalizeTagArray(payload[key], key) ?? []
    }
  }

  if (payload.photoUrl !== undefined) {
    const url = normalizeText(payload.photoUrl)
    updates.photoUrl = url || null
  }

  for (const key of ['targetServings', 'originalServings']) {
    if (payload[key] !== undefined) {
      if (payload[key] === null) {
        updates[key] = null
      } else {
        const parsed = Number.parseInt(payload[key], 10)
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          throw createHttpError(400, 'INVALID_SERVINGS', `${key} must be an integer between 1 and 100.`, true)
        }
        updates[key] = parsed
      }
    }
  }

  if (payload.servingNotes !== undefined) {
    const notes = normalizeText(payload.servingNotes)
    updates.servingNotes = notes || null
  }

  if (Object.keys(updates).length === 0) {
    throw createHttpError(400, 'NO_RECIPE_UPDATES', 'Provide at least one editable field.', true)
  }

  return updates
}

const ADMIN_UPDATE_COLUMNS = {
  title: 'title',
  outputMarkdown: 'output_markdown',
  sourceRecipeText: 'source_recipe_text',
  mealSlots: 'meal_slots',
  recipeCategories: 'recipe_categories',
  photoUrl: 'photo_url',
  targetServings: 'target_servings',
  originalServings: 'original_servings',
  servingNotes: 'serving_notes',
}

function adminRecipeProjection(alias = 'ra') {
  return `
    ${masterProjection(alias)},
    ${alias}.source_recipe_text as "sourceRecipeText",
    ${alias}.serving_notes as "servingNotes",
    ${alias}.generation_mode as "generationMode",
    ${alias}.accuracy_check_status as "accuracyCheckStatus",
    ${alias}.accuracy_confidence as "accuracyConfidence",
    ${alias}.needs_clinician_review as "needsClinicianReview",
    ${alias}.clinical_review_notes as "clinicalReviewNotes",
    ${alias}.clinical_review_caveats as "clinicalReviewCaveats",
    ${alias}.clinical_reviewed_at as "clinicalReviewedAt",
    ${alias}.household_id as "householdId",
    ${alias}.published_by as "publishedBy",
    ${alias}.updated_at as "updatedAt"
  `
}

async function loadMasterForAdmin(db, recipeId) {
  const result = await db.query(
    `
      select ${adminRecipeProjection('ra')},
             ra.care_recipient_id as "careRecipientId",
             ra.version_number as "versionNumber"
      from recipe_adaptations ra
      where ra.id = $1 and ra.scope = 'master' and ra.deleted_at is null
      limit 1
    `,
    [recipeId],
  )
  const recipe = result.rows[0]
  if (!recipe) {
    throw createHttpError(404, 'MASTER_RECIPE_NOT_FOUND', 'Master recipe was not found.', true)
  }
  return recipe
}

/** Full master read for the admin console: content + gate state + review history. */
export async function getRecipeForAdmin(clerkUserId, recipeId) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, LIBRARY_ADMINS)
  const normalizedId = normalizeRecipeId(recipeId)

  const recipe = await loadMasterForAdmin(db, normalizedId)

  const [accuracyResult, historyResult] = await Promise.all([
    db.query(
      `
        select id, passed, confidence, issues,
               required_corrections as "requiredCorrections",
               clinician_review_flags as "clinicianReviewFlags",
               final_safety_summary as "finalSafetySummary",
               created_at as "createdAt"
        from recipe_accuracy_checks
        where recipe_adaptation_id = $1
        order by created_at desc
        limit 1
      `,
      [normalizedId],
    ),
    db.query(
      `
        select id, source, status, notes, caveats,
               reviewer_user_id as "reviewerUserId",
               recipe_brain_run_id as "recipeBrainRunId",
               created_at as "createdAt"
        from recipe_clinical_reviews
        where recipe_adaptation_id = $1
        order by created_at desc
      `,
      [normalizedId],
    ),
  ])

  return {
    adminRole: admin.role,
    recipe,
    latestAccuracyCheck: accuracyResult.rows[0] ?? null,
    history: historyResult.rows,
  }
}

/**
 * Admin edit of a master recipe. Metadata edits apply instantly; content edits
 * (markdown / source text) re-run the accuracy check and send the recipe back
 * to 'needs_review' — it STAYS published, wearing its pending status, until a
 * library admin re-approves (or denies, which unpublishes).
 */
export async function updateRecipeForAdmin(clerkUserId, recipeId, payload) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, CONTENT_ADMINS)
  const normalizedId = normalizeRecipeId(recipeId)
  const updates = normalizeAdminUpdatePayload(payload)

  const master = await loadMasterForAdmin(db, normalizedId)

  // No-op content saves must not churn the gate: drop content fields whose
  // value is identical to what the committee already approved.
  if (updates.outputMarkdown !== undefined && updates.outputMarkdown === master.outputMarkdown) {
    delete updates.outputMarkdown
  }
  if (updates.sourceRecipeText !== undefined && updates.sourceRecipeText === master.sourceRecipeText) {
    delete updates.sourceRecipeText
  }
  if (Object.keys(updates).length === 0) {
    return { adminRole: admin.role, recipe: master, regated: false, accuracyCheck: null }
  }

  const { contentChanged } = classifyAdminRecipeUpdates(updates)

  const setClauses = []
  const values = [normalizedId]
  for (const [key, column] of Object.entries(ADMIN_UPDATE_COLUMNS)) {
    if (updates[key] !== undefined) {
      values.push(updates[key])
      setClauses.push(`${column} = $${values.length}`)
    }
  }
  // An externally-hosted photo URL replaces any uploaded object (mirrors the
  // household updateRecipe rule).
  if (typeof updates.photoUrl === 'string' && updates.photoUrl) {
    setClauses.push('photo_storage_path = null')
  }
  values.push(user.id)
  setClauses.push(`updated_by = $${values.length}`)

  const client = await db.connect()
  try {
    await client.query('begin')

    const updated = await client.query(
      `
        update recipe_adaptations ra
        set ${setClauses.join(', ')}, updated_at = now()
        where ra.id = $1 and ra.scope = 'master' and ra.deleted_at is null
        returning ${adminRecipeProjection('ra')}
      `,
      values,
    )
    if (updated.rows.length === 0) {
      throw createHttpError(404, 'MASTER_RECIPE_NOT_FOUND', 'Master recipe was not found.', true)
    }
    let recipe = updated.rows[0]
    let accuracyCheck = null

    if (contentChanged) {
      const { accuracyCheckId, result: accuracy } = await runAccuracyCheckForRecipe(client, {
        recipe: {
          id: normalizedId,
          source_recipe_text: recipe.sourceRecipeText,
          output_markdown: recipe.outputMarkdown,
          recipe_categories: recipe.recipeCategories,
          target_servings: recipe.targetServings,
          original_servings: recipe.originalServings,
        },
        householdId: master.householdId,
        careRecipientId: master.careRecipientId,
      })
      accuracyCheck = { id: accuracyCheckId, passed: accuracy.passed, confidence: accuracy.confidence }

      const regated = await client.query(
        `
          update recipe_adaptations ra
          set clinical_review_status = 'needs_review', clinical_review_updated_at = now(), updated_at = now()
          where ra.id = $1
          returning ${adminRecipeProjection('ra')}
        `,
        [normalizedId],
      )
      recipe = regated.rows[0]

      await client.query(
        `
          insert into recipe_clinical_reviews (
            household_id, recipe_adaptation_id, source, status, notes,
            reviewer_user_id, accuracy_check_id, recipe_version_number
          )
          values ($1, $2, 'human', 'needs_review', $3, $4, $5, $6)
        `,
        [
          master.householdId, normalizedId,
          `Content edited by ${admin.role} — re-review required.`,
          user.id, accuracyCheckId, master.versionNumber,
        ],
      )
    }

    await writeAuditLog(client, {
      action: 'platform_recipe.updated',
      entityType: 'recipe_adaptation',
      entityId: normalizedId,
      actorUserId: user.id,
      actorAdminRole: admin.role,
      householdId: master.householdId,
      before: {
        clinicalReviewStatus: master.clinicalReviewStatus,
        ...Object.fromEntries(Object.keys(updates).map((k) => [k, master[k] ?? null])),
      },
      after: {
        clinicalReviewStatus: recipe.clinicalReviewStatus,
        ...Object.fromEntries(Object.keys(updates).map((k) => [k, updates[k]])),
      },
      extra: { regated: contentChanged, accuracyCheckId: accuracyCheck?.id ?? null },
    })

    await client.query('commit')
    return { adminRole: admin.role, recipe, regated: contentChanged, accuracyCheck }
  } catch (err) {
    try { await client.query('rollback') } catch { /* keep original error */ }
    throw err
  } finally {
    client.release()
  }
}

/**
 * Clinical-review decision on a master recipe from the admin console. The
 * household decision route requires membership in the master's home household —
 * the wrong layer for internal staff. Denied decisions also unpublish in the
 * same transaction: a denied recipe cannot remain in the library (PL-001).
 */
export async function applyReviewDecisionForAdmin(clerkUserId, recipeId, payload) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, LIBRARY_ADMINS)
  const normalizedId = normalizeRecipeId(recipeId)
  const decision = normalizeDecisionPayload(payload)

  const master = await loadMasterForAdmin(db, normalizedId)

  const client = await db.connect()
  try {
    await client.query('begin')

    const historyInsert = await client.query(
      `
        insert into recipe_clinical_reviews (
          household_id, recipe_adaptation_id, source, status, notes, caveats,
          reviewer_user_id, recipe_version_number
        )
        values ($1, $2, 'human', $3, $4, $5, $6, $7)
        returning id, source, status, notes, caveats, created_at as "createdAt"
      `,
      [
        master.householdId, normalizedId, decision.status,
        decision.notes, decision.caveats, user.id, master.versionNumber,
      ],
    )

    let updated = await client.query(
      `
        update recipe_adaptations ra
        set clinical_review_status = $2,
            clinical_review_notes = $3,
            clinical_review_caveats = $4,
            clinical_reviewed_by = $5,
            clinical_reviewed_at = now(),
            clinical_review_version_number = $6,
            clinical_review_updated_at = now(),
            updated_at = now()
        where ra.id = $1
        returning ${adminRecipeProjection('ra')}
      `,
      [normalizedId, decision.status, decision.notes, decision.caveats, user.id, master.versionNumber],
    )
    let recipe = updated.rows[0]

    if (decision.status === 'denied') {
      updated = await client.query(
        `
          update recipe_adaptations ra
          set scope = 'household', is_master_recipe = false,
              published_at = null, published_by = null, updated_at = now()
          where ra.id = $1
          returning ${adminRecipeProjection('ra')}
        `,
        [normalizedId],
      )
      recipe = updated.rows[0]

      await writeAuditLog(client, {
        action: 'platform_recipe.unpublished',
        entityType: 'recipe_adaptation',
        entityId: normalizedId,
        actorUserId: user.id,
        actorAdminRole: admin.role,
        householdId: master.householdId,
        before: { scope: 'master', title: master.title },
        reason: 'clinical review denied',
      })
    }

    await writeAuditLog(client, {
      action: 'clinical_review.decision',
      entityType: 'recipe_adaptation',
      entityId: normalizedId,
      actorUserId: user.id,
      actorAdminRole: admin.role,
      householdId: master.householdId,
      before: { clinicalReviewStatus: master.clinicalReviewStatus },
      after: { clinicalReviewStatus: decision.status, caveats: decision.caveats },
      reason: decision.notes,
      extra: { via: 'admin_console' },
    })

    await client.query('commit')
    return { adminRole: admin.role, recipe, review: historyInsert.rows[0], unpublished: decision.status === 'denied' }
  } catch (err) {
    try { await client.query('rollback') } catch { /* keep original error */ }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Copy a master into the household (the monetized action)
// ---------------------------------------------------------------------------

export async function copyPlatformRecipeToHousehold(clerkUserId, householdId, recipeId, payload = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedId = normalizeRecipeId(recipeId)
  const careRecipientId = payload?.careRecipientId
    ? normalizeUuid(payload.careRecipientId, 'INVALID_CARE_RECIPIENT_ID', 'careRecipientId must be a UUID.')
    : null

  const access = await requireHouseholdRole(db, user.id, householdId, COPY_ROLES, {
    action: 'copy:recipe',
    resourceType: 'recipe',
    label: 'platform-recipe:copy',
  })
  // Entitlement: library copy is Basic+ and good standing; respect the saved cap.
  await requireLibraryCopyAccess(db, access.household.id)
  await assertWithinSavedRecipeCap(db, access.household.id)

  if (careRecipientId) {
    const cr = await db.query(
      `select 1 from care_recipients where id = $1 and household_id = $2 and status = 'active'`,
      [careRecipientId, access.household.id],
    )
    if (cr.rows.length === 0) {
      throw createHttpError(404, 'CARE_RECIPIENT_NOT_FOUND', 'Care recipient was not found for this household.', true)
    }
  }

  // Load the master content.
  const masterResult = await db.query(
    `
      select
        id, title, source_recipe_text as "sourceRecipeText", output_markdown as "outputMarkdown",
        output_json as "outputJson", meal_slots as "mealSlots", recipe_categories as "recipeCategories",
        target_servings as "targetServings", original_servings as "originalServings",
        serving_scale_factor as "servingScaleFactor", serving_count_estimated as "servingCountEstimated",
        serving_notes as "servingNotes", photo_url as "photoUrl",
        clinical_warning as "clinicalWarning", clinical_warning_items as "clinicalWarningItems"
      from recipe_adaptations
      where id = $1 and scope = 'master' and deleted_at is null and published_at is not null
      limit 1
    `,
    [normalizedId],
  )
  const master = masterResult.rows[0]
  if (!master) {
    throw createHttpError(404, 'MASTER_RECIPE_NOT_FOUND', 'Master recipe was not found in the library.', true)
  }

  const client = await db.connect()
  try {
    await client.query('begin')

    const request = await client.query(
      `
        insert into recipe_requests (household_id, care_recipient_id, source_recipe_text, status, requested_by, completed_at)
        values ($1, $2, $3, 'completed', $4, now())
        returning id
      `,
      [access.household.id, careRecipientId, master.sourceRecipeText, user.id],
    )

    // Clone the content; reset household-scoped state. The master's verdict was
    // against Patient Zero, so the copy starts at needs_review for THIS household.
    const copy = await client.query(
      `
        insert into recipe_adaptations (
          recipe_request_id, household_id, care_recipient_id, title,
          source_recipe_text, output_markdown, output_json, meal_slots, recipe_categories,
          target_servings, original_servings, serving_scale_factor, serving_count_estimated, serving_notes,
          photo_url, clinical_warning, clinical_warning_items,
          saved_by, saved_at, generation_mode, scope, source_master_recipe_id,
          clinical_review_status, created_by, updated_by
        )
        values (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17::jsonb,
          $18, now(), 'library_copy', 'household', $19,
          'needs_review', $18, $18
        )
        returning
          id, title, care_recipient_id as "careRecipientId",
          output_markdown as "outputMarkdown", clinical_review_status as "clinicalReviewStatus",
          source_master_recipe_id as "sourceMasterRecipeId", saved_at as "savedAt", created_at as "createdAt"
      `,
      [
        request.rows[0].id, access.household.id, careRecipientId, master.title,
        master.sourceRecipeText, master.outputMarkdown, JSON.stringify(master.outputJson ?? {}),
        master.mealSlots, master.recipeCategories,
        master.targetServings, master.originalServings, master.servingScaleFactor,
        master.servingCountEstimated, master.servingNotes, master.photoUrl,
        master.clinicalWarning, JSON.stringify(master.clinicalWarningItems ?? []),
        user.id, normalizedId,
      ],
    )
    const newRecipe = copy.rows[0]

    // Re-run the deterministic accuracy check against THIS household's profile + hard rules.
    const { accuracyCheckId, result: accuracy } = await runAccuracyCheckForRecipe(client, {
      recipe: {
        id: newRecipe.id,
        source_recipe_text: master.sourceRecipeText,
        output_markdown: master.outputMarkdown,
        recipe_categories: master.recipeCategories,
        target_servings: master.targetServings,
        original_servings: master.originalServings,
      },
      householdId: access.household.id,
      careRecipientId,
    })

    await writeAuditLog(client, {
      action: 'platform_recipe.copied',
      entityType: 'recipe_adaptation',
      entityId: newRecipe.id,
      actorUserId: user.id,
      householdId: access.household.id,
      after: { title: newRecipe.title, sourceMasterRecipeId: normalizedId },
    })

    await client.query('commit')

    return {
      household: access.household,
      requester: access.membership,
      recipe: newRecipe,
      accuracyCheck: { id: accuracyCheckId, passed: accuracy.passed, confidence: accuracy.confidence },
    }
  } catch (err) {
    try { await client.query('rollback') } catch { /* keep original error */ }
    throw err
  } finally {
    client.release()
  }
}
