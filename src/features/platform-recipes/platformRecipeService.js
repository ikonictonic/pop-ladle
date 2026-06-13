/**
 * Master Recipe Library (platform recipes).
 *
 * Single-table model (scope flag on recipe_adaptations): a master recipe is
 * platform-owned content published by a Super Admin; a household copy is a clone
 * with `source_master_recipe_id` set, re-gated against the copying household's
 * own Care Profile + hard rules.
 *
 *   Publish  — Super/Clinical admin flips an approved committee recipe to master.
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
import { CLINICAL_ADMINS, requireInternalAdmin } from '../super-admin/adminAccess.js'

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

// ---------------------------------------------------------------------------
// Publish / unpublish (admin)
// ---------------------------------------------------------------------------

export async function publishRecipeForAdmin(clerkUserId, recipeId) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, CLINICAL_ADMINS)
  const normalizedId = normalizeRecipeId(recipeId)

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
          published_at = now(), published_by = $2, updated_at = now()
      where id = $1
      returning ${masterProjection('recipe_adaptations')}
    `,
    [normalizedId, user.id],
  )

  await writeAuditLog(db, {
    action: 'platform_recipe.published',
    entityType: 'recipe_adaptation',
    entityId: normalizedId,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    after: { scope: 'master', title: recipe.title },
  })

  return { adminRole: admin.role, recipe: updated.rows[0] }
}

export async function unpublishRecipeForAdmin(clerkUserId, recipeId) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, CLINICAL_ADMINS)
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

  const access = await requireHouseholdRole(db, user.id, householdId, COPY_ROLES)
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
