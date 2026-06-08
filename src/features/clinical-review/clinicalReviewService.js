/**
 * Clinical Review service — the human verdict gate + audit queue on top of the
 * committee's automated verdict.
 *
 * Two-table pattern: rolled-up current state on recipe_adaptations + append-only
 * history in recipe_clinical_reviews. The committee writes the initial verdict
 * (source='committee'); a human owner/co-owner confirms or overrides it here.
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
} from '../households/householdAccess.js'

const VIEW_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']
const DECISION_ROLES = ['owner', 'co_owner']
const REVIEW_STATUSES = ['not_reviewed', 'needs_review', 'approved', 'approved_with_caveats', 'denied']
const DECISION_STATUSES = ['needs_review', 'approved', 'approved_with_caveats', 'denied']
const ACCURACY_CONFIDENCES = ['high', 'medium', 'low', 'unknown']
const MAX_TEXT = 4000
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function reviewProjection(alias = 'ra') {
  return `
    ${alias}.id,
    ${alias}.title,
    ${alias}.clinical_review_status as "clinicalReviewStatus",
    ${alias}.clinical_review_summary as "clinicalReviewSummary",
    ${alias}.clinical_review_notes as "clinicalReviewNotes",
    ${alias}.clinical_review_caveats as "clinicalReviewCaveats",
    ${alias}.clinical_reviewed_by as "clinicalReviewedBy",
    ${alias}.clinical_reviewed_at as "clinicalReviewedAt",
    ${alias}.clinical_review_version_number as "clinicalReviewVersionNumber",
    ${alias}.clinical_review_updated_at as "clinicalReviewUpdatedAt",
    ${alias}.clinical_warning as "clinicalWarning",
    ${alias}.clinical_warning_items as "clinicalWarningItems",
    ${alias}.accuracy_check_status as "accuracyCheckStatus",
    ${alias}.accuracy_confidence as "accuracyConfidence",
    ${alias}.needs_clinician_review as "needsClinicianReview",
    ${alias}.clinician_review_flags as "clinicianReviewFlags",
    ${alias}.version_number as "versionNumber",
    ${alias}.recipe_brain_run_id as "recipeBrainRunId",
    ${alias}.saved_at as "savedAt",
    ${alias}.created_at as "createdAt",
    ${alias}.updated_at as "updatedAt"
  `
}

export async function listRecipesForReviewForCurrentUser(clerkUserId, householdId, query = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, VIEW_ROLES)

  const status = normalizeText(query.status)
  if (status && !REVIEW_STATUSES.includes(status)) {
    throw createHttpError(400, 'INVALID_REVIEW_STATUS', `status must be one of: ${REVIEW_STATUSES.join(', ')}.`, true)
  }
  const accuracyConfidence = normalizeText(query.accuracyConfidence)
  if (accuracyConfidence && !ACCURACY_CONFIDENCES.includes(accuracyConfidence)) {
    throw createHttpError(400, 'INVALID_ACCURACY_CONFIDENCE', `accuracyConfidence must be one of: ${ACCURACY_CONFIDENCES.join(', ')}.`, true)
  }
  const search = normalizeText(query.search) || null
  const requestedLimit = Number.parseInt(query.limit ?? `${DEFAULT_LIMIT}`, 10)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT

  const rows = await db.query(
    `
      select
        ${reviewProjection('ra')}
      from recipe_adaptations ra
      where ra.household_id = $1
        and ra.deleted_at is null
        and ra.saved_at is not null
        and ($2::text is null or ra.clinical_review_status = $2)
        and ($3::text is null or ra.accuracy_confidence = $3)
        and ($4::text is null or ra.title ilike '%' || $4 || '%')
      order by ra.clinical_review_updated_at desc nulls last, ra.saved_at desc
      limit $5
    `,
    [access.household.id, status || null, accuracyConfidence || null, search, limit],
  )

  const counts = await db.query(
    `
      select clinical_review_status as "status", count(*)::int as "count"
      from recipe_adaptations
      where household_id = $1 and deleted_at is null and saved_at is not null
      group by clinical_review_status
    `,
    [access.household.id],
  )

  const statusCounts = Object.fromEntries(REVIEW_STATUSES.map((s) => [s, 0]))
  for (const row of counts.rows) statusCounts[row.status] = row.count

  return {
    household: access.household,
    requester: access.membership,
    statusCounts,
    recipes: rows.rows,
  }
}

export async function getRecipeReviewForCurrentUser(clerkUserId, householdId, recipeId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedRecipeId = normalizeUuid(recipeId, 'INVALID_RECIPE_ID', 'Recipe id must be a UUID.')
  const access = await requireHouseholdRole(db, user.id, householdId, VIEW_ROLES)

  const recipeResult = await db.query(
    `
      select ${reviewProjection('ra')}
      from recipe_adaptations ra
      where ra.id = $1 and ra.household_id = $2 and ra.deleted_at is null
      limit 1
    `,
    [normalizedRecipeId, access.household.id],
  )
  const recipe = recipeResult.rows[0]
  if (!recipe) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
  }

  const accuracyResult = await db.query(
    `
      select
        id, passed, confidence,
        clinical_profile_used as "clinicalProfileUsed",
        hard_rules_used as "hardRulesUsed",
        issues, required_corrections as "requiredCorrections",
        clinician_review_flags as "clinicianReviewFlags",
        source_registry_topics_used as "sourceRegistryTopicsUsed",
        final_safety_summary as "finalSafetySummary",
        check_version as "checkVersion",
        created_at as "createdAt"
      from recipe_accuracy_checks
      where recipe_adaptation_id = $1
      order by created_at desc
      limit 1
    `,
    [normalizedRecipeId],
  )

  const historyResult = await db.query(
    `
      select
        id, source, status, notes, caveats,
        reviewer_user_id as "reviewerUserId",
        recipe_version_number as "recipeVersionNumber",
        recipe_brain_run_id as "recipeBrainRunId",
        accuracy_check_id as "accuracyCheckId",
        created_at as "createdAt"
      from recipe_clinical_reviews
      where recipe_adaptation_id = $1
      order by created_at desc
    `,
    [normalizedRecipeId],
  )

  return {
    household: access.household,
    requester: access.membership,
    recipe,
    latestAccuracyCheck: accuracyResult.rows[0] ?? null,
    history: historyResult.rows,
  }
}

function normalizeDecisionPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const status = normalizeText(payload.status)
  if (!DECISION_STATUSES.includes(status)) {
    throw createHttpError(400, 'INVALID_REVIEW_STATUS', `status must be one of: ${DECISION_STATUSES.join(', ')}.`, true)
  }

  const notes = normalizeText(payload.notes)
  const caveats = normalizeText(payload.caveats)

  if (status === 'approved_with_caveats' && !caveats) {
    throw createHttpError(400, 'CAVEATS_REQUIRED', 'caveats are required when approving with caveats.', true)
  }
  if (notes.length > MAX_TEXT || caveats.length > MAX_TEXT) {
    throw createHttpError(400, 'TEXT_TOO_LONG', `notes and caveats must be ${MAX_TEXT} characters or fewer.`, true)
  }

  return { status, notes: notes || null, caveats: caveats || null }
}

export async function applyReviewDecisionForCurrentUser(clerkUserId, householdId, recipeId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedRecipeId = normalizeUuid(recipeId, 'INVALID_RECIPE_ID', 'Recipe id must be a UUID.')
  const decision = normalizeDecisionPayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, DECISION_ROLES)

  const recipeResult = await db.query(
    `
      select id, version_number as "versionNumber"
      from recipe_adaptations
      where id = $1 and household_id = $2 and deleted_at is null
      limit 1
    `,
    [normalizedRecipeId, access.household.id],
  )
  const recipe = recipeResult.rows[0]
  if (!recipe) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
  }

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
        returning
          id, source, status, notes, caveats,
          reviewer_user_id as "reviewerUserId",
          recipe_version_number as "recipeVersionNumber",
          created_at as "createdAt"
      `,
      [
        access.household.id, normalizedRecipeId, decision.status,
        decision.notes, decision.caveats, user.id, recipe.versionNumber,
      ],
    )

    const updated = await client.query(
      `
        update recipe_adaptations
        set
          clinical_review_status = $2,
          clinical_review_notes = $3,
          clinical_review_caveats = $4,
          clinical_reviewed_by = $5,
          clinical_reviewed_at = now(),
          clinical_review_version_number = $6,
          clinical_review_updated_at = now(),
          updated_at = now()
        where id = $1
        returning ${reviewProjection('recipe_adaptations')}
      `,
      [
        normalizedRecipeId, decision.status, decision.notes, decision.caveats,
        user.id, recipe.versionNumber,
      ],
    )

    await client.query('commit')

    return {
      household: access.household,
      requester: access.membership,
      recipe: updated.rows[0],
      review: historyInsert.rows[0],
    }
  } catch (err) {
    try { await client.query('rollback') } catch { /* keep original error */ }
    throw err
  } finally {
    client.release()
  }
}
