/**
 * Accuracy check service — runs the deterministic engine against a recipe,
 * persists the audit record (recipe_accuracy_checks), and rolls the result up
 * onto recipe_adaptations. No LLM calls.
 *
 * Used two ways:
 *   - runAccuracyCheckForRecipe(client, {...}) — low-level, called inside the
 *     recipe-brain transaction right after a recipe is produced.
 *   - runAccuracyCheckForCurrentUser(...) — route entry to (re)run on a saved recipe.
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
} from '../households/householdAccess.js'
import { runClinicalAccuracyCheck } from './engine/accuracyCheck.js'

const ACCURACY_WRITE_ROLES = ['owner', 'co_owner', 'caregiver']

/**
 * Initial clinical-review classification from the deterministic signals.
 * Ported from the prototype clinicalReviewService.computeInitialReviewStatus.
 * (Prototype's NOT_REQUIRED maps to this backend's 'not_reviewed'.)
 */
export function computeInitialReviewStatus({ clinicalWarning, accuracyCheckStatus, needsClinicianReview }) {
  const hasWarning = Boolean(clinicalWarning)
  const accuracyNeedsReview = accuracyCheckStatus === 'needs_review'
  const flagged = Boolean(needsClinicianReview)
  if (hasWarning || accuracyNeedsReview || flagged) return 'needs_review'
  return 'not_reviewed'
}

// Map a clinical_hard_rules row to the shape the engine expects. The engine
// only special-cases 'require'; 'avoid' behaves like 'remove'.
function toEngineRule(row) {
  return {
    id: row.id,
    is_active: row.is_active,
    rule_type: row.rule_type === 'avoid' ? 'remove' : row.rule_type,
    rule_text: row.rule_text,
    trigger_terms: row.trigger_terms || [],
    replacement_text: row.replacement_text || '',
  }
}

async function loadEngineHardRules(db, householdId, careRecipientId) {
  const result = await db.query(
    `
      select id, rule_text, trigger_terms, replacement_text, rule_type, is_active
      from clinical_hard_rules
      where household_id = $1
        and is_active = true
        and (care_recipient_id is null or care_recipient_id = $2)
      order by sort_order, created_at
    `,
    [householdId, careRecipientId],
  )
  return result.rows.map(toEngineRule)
}

async function loadClinicalProfileText(db, householdId, careRecipientId) {
  if (!careRecipientId) return ''
  const result = await db.query(
    `
      select cp.profile_text as "profileText"
      from care_recipients cr
      join care_profiles cp on cp.care_recipient_id = cr.id
      where cr.id = $1 and cr.household_id = $2
      limit 1
    `,
    [careRecipientId, householdId],
  )
  return result.rows[0]?.profileText ?? ''
}

function buildCheckArgs(recipe, clinicalProfileText, hardRules) {
  return {
    sourceRecipeText: recipe.source_recipe_text ?? recipe.sourceRecipeText ?? '',
    generatedRecipe: recipe.output_markdown ?? recipe.outputMarkdown ?? '',
    clinicalProfile: clinicalProfileText,
    hardRules,
    targetServings: recipe.target_servings ?? recipe.targetServings ?? null,
    originalServings: recipe.original_servings ?? recipe.originalServings ?? null,
    generationMode: (recipe.generation_mode ?? recipe.generationMode) === 'preserve_original'
      ? 'preserve_original'
      : 'adapt_clinically',
    recipeTaxonomy: recipe.recipe_categories ?? recipe.recipeCategories ?? [],
  }
}

async function persistAccuracyCheck(client, { recipeId, householdId, result }) {
  const inserted = await client.query(
    `
      insert into recipe_accuracy_checks (
        recipe_adaptation_id, household_id, passed, confidence,
        clinical_profile_used, hard_rules_used,
        serving_check_passed, ingredient_check_passed, substitution_check_passed,
        dietary_claim_check_passed, medication_food_check_passed, caregiver_practicality_passed,
        issues, required_corrections, clinician_review_flags, source_registry_topics_used,
        final_safety_summary, check_version
      )
      values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
        $13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18
      )
      returning id
    `,
    [
      recipeId, householdId, result.passed, result.confidence,
      result.clinicalProfileUsed, result.hardRulesUsed,
      result.servingCheckPassed, result.ingredientCheckPassed, result.substitutionCheckPassed,
      result.dietaryClaimCheckPassed, result.medicationFoodCheckPassed, result.caregiverPracticalityPassed,
      JSON.stringify(result.issues), JSON.stringify(result.requiredCorrections),
      JSON.stringify(result.clinicianReviewFlags), JSON.stringify(result.sourceRegistryTopicsUsed),
      result.finalSafetySummary, result.checkVersion,
    ],
  )

  await client.query(
    `
      update recipe_adaptations
      set
        accuracy_check_status = $2,
        accuracy_confidence = $3,
        needs_clinician_review = $4,
        clinician_review_flags = $5::jsonb,
        updated_at = now()
      where id = $1
    `,
    [
      recipeId,
      result.passed ? 'passed' : 'needs_review',
      result.confidence,
      result.clinicianReviewFlags.length > 0,
      JSON.stringify(result.clinicianReviewFlags),
    ],
  )

  return inserted.rows[0].id
}

/**
 * Low-level: run + persist using a caller-supplied client (so it can join an
 * existing transaction, e.g. inside the recipe-brain pipeline). The caller may
 * pass clinicalProfileText / hardRules to avoid re-loading them.
 */
export async function runAccuracyCheckForRecipe(client, {
  recipe,
  householdId,
  careRecipientId = null,
  clinicalProfileText = null,
  hardRules = null,
}) {
  const rules = hardRules ?? await loadEngineHardRules(client, householdId, careRecipientId)
  const profileText = clinicalProfileText ?? await loadClinicalProfileText(client, householdId, careRecipientId)
  const result = runClinicalAccuracyCheck(buildCheckArgs(recipe, profileText, rules))
  const accuracyCheckId = await persistAccuracyCheck(client, {
    recipeId: recipe.id,
    householdId,
    result,
  })
  return { accuracyCheckId, result }
}

/**
 * Route entry: (re)run the accuracy check on a saved recipe.
 */
export async function runAccuracyCheckForCurrentUser(clerkUserId, householdId, recipeId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedRecipeId = normalizeUuid(recipeId, 'INVALID_RECIPE_ID', 'Recipe id must be a UUID.')
  const access = await requireHouseholdRole(db, user.id, householdId, ACCURACY_WRITE_ROLES)

  const recipeResult = await db.query(
    `
      select id, source_recipe_text, output_markdown, meal_slots, recipe_categories,
             target_servings, original_servings, generation_mode, care_recipient_id as "careRecipientId"
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
    const { accuracyCheckId, result } = await runAccuracyCheckForRecipe(client, {
      recipe,
      householdId: access.household.id,
      careRecipientId: recipe.careRecipientId ?? null,
    })
    await client.query('commit')
    return {
      household: access.household,
      requester: access.membership,
      accuracyCheckId,
      result,
    }
  } catch (err) {
    try { await client.query('rollback') } catch { /* keep original error */ }
    throw err
  } finally {
    client.release()
  }
}
