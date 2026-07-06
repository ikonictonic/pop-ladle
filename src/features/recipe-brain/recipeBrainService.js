/**
 * Recipe Brain orchestration — the governed Care Team committee.
 *
 * Pipeline: validate + gate access -> load the Super-Admin-governed roster ->
 * build the shared patient context -> fan out specialists in parallel via the
 * server-side provider proxy -> Chairwoman synthesis -> Clinical Review verdict
 * (the gate) -> persist run + deliberations + (when not denied) the recipe.
 *
 * Every upstream model call is recorded in llm_proxy_logs; every specialist and
 * the Chairwoman get their own run rows. Provider keys never leave the server.
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
  requireHouseholdCapability,
} from '../households/householdAccess.js'
import { callModel } from './providers/index.js'
import { runAccuracyCheckForRecipe } from '../clinical-review/accuracyCheckService.js'
import { requireGeneratorAccess } from '../plans/planService.js'
import {
  buildChairwomanPrompt,
  buildPatientContext,
  buildSpecialistSystemPrompt,
  parseChairwomanEnvelope,
  parseSpecialistEnvelope,
} from './prompts.js'
import { GENERATE_ROLES, shouldAutoPublish } from './generationPolicy.js'
import { validateRecipeText } from './recipeInputGate.js'
import { CONTENT_ADMINS, requireInternalAdmin } from '../super-admin/adminAccess.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'

const SPECIALIST_USER_PROMPT =
  'Review the recipe above against the patient context. Return the JSON envelope as instructed.'
const MAX_SOURCE_LENGTH = 20000
const MAX_TITLE_LENGTH = 180

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function normalizeText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function normalizeStringArray(value, fieldName) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw createHttpError(400, 'INVALID_ARRAY', `${fieldName} must be an array of strings.`, true)
  }
  return value.map((item) => normalizeText(item)).filter(Boolean)
}

function normalizeJsonObject(value, fieldName) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createHttpError(400, 'INVALID_JSON_OBJECT', `${fieldName} must be a JSON object.`, true)
  }
  return value
}

function normalizeRunPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const sourceRecipe = normalizeText(payload.sourceRecipe ?? payload.sourceRecipeText)
  if (!sourceRecipe) {
    throw createHttpError(400, 'INVALID_SOURCE_RECIPE', 'sourceRecipe is required.', true)
  }
  if (sourceRecipe.length > MAX_SOURCE_LENGTH) {
    throw createHttpError(
      400,
      'INVALID_SOURCE_RECIPE',
      `sourceRecipe must be ${MAX_SOURCE_LENGTH} characters or fewer.`,
      true,
    )
  }

  // Token-saving pre-flight: the committee ADAPTS a pasted recipe, so block
  // prompt-style / incomplete inputs before the roster load or the LLM proxy.
  // Mirrors the frontend gate; the backend is canonical. See recipeInputGate.js
  // (rules: business/recipe_text_intake_validation_rules.md).
  const validation = validateRecipeText(sourceRecipe)
  if (!validation.allowed) {
    const err = createHttpError(422, 'NOT_A_VALID_RECIPE', validation.message, true)
    err.details = {
      reason: validation.reason,
      missingFields: validation.missingFields,
      careTeamDispatchAllowed: validation.careTeamDispatchAllowed,
    }
    throw err
  }

  const title = normalizeText(payload.title)
  if (title.length > MAX_TITLE_LENGTH) {
    throw createHttpError(
      400,
      'INVALID_RECIPE_TITLE',
      `title must be ${MAX_TITLE_LENGTH} characters or fewer.`,
      true,
    )
  }

  return {
    sourceRecipe,
    clinicalProfileText: normalizeText(payload.clinicalProfileText),
    clinicalProfileData: normalizeJsonObject(payload.clinicalProfileData, 'clinicalProfileData') ?? {},
    hardRules: normalizeStringArray(payload.hardRules, 'hardRules'),
    dailyLimits: normalizeJsonObject(payload.dailyLimits, 'dailyLimits') ?? {},
    nutritionSnapshot: normalizeJsonObject(payload.nutritionSnapshot, 'nutritionSnapshot'),
    title,
    mealSlots: normalizeStringArray(payload.mealSlots, 'mealSlots').map((s) => s.toLowerCase()),
    recipeCategories: normalizeStringArray(payload.recipeCategories, 'recipeCategories').map((s) => s.toLowerCase()),
    careRecipientId: payload.careRecipientId
      ? normalizeUuid(payload.careRecipientId, 'INVALID_CARE_RECIPIENT_ID', 'careRecipientId must be a UUID.')
      : null,
    targetServings: normalizeOptionalServings(payload.targetServings, 'targetServings'),
    originalServings: normalizeOptionalServings(payload.originalServings, 'originalServings'),
    mode: normalizeMode(payload.mode),
    save: payload.save === undefined ? true : Boolean(payload.save),
  }
}

const RUN_MODES = ['adapt', 'preserve']

function normalizeMode(value) {
  if (value === undefined || value === null || value === '') return 'adapt'
  const mode = typeof value === 'string' ? value.trim() : value
  if (!RUN_MODES.includes(mode)) {
    throw createHttpError(400, 'INVALID_MODE', `mode must be one of: ${RUN_MODES.join(', ')}.`, true)
  }
  return mode
}

function normalizeOptionalServings(value, fieldName) {
  if (value === undefined || value === null || value === '') return null
  const numberValue = Number(value)
  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > 50) {
    throw createHttpError(400, 'INVALID_SERVINGS', `${fieldName} must be a positive integer (1-50).`, true)
  }
  return numberValue
}

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

async function loadActiveRoster(db) {
  const result = await db.query(
    `
      select
        id,
        role_key as "roleKey",
        display_name as "displayName",
        kind,
        provider,
        model,
        system_prompt as "systemPrompt",
        position
      from llm_provider_configs
      where active = true
      order by kind, position
    `,
  )

  const specialists = result.rows.filter((row) => row.kind === 'specialist')
  const chairwoman = result.rows.find((row) => row.kind === 'chairman') ?? null

  if (specialists.length === 0) {
    throw createHttpError(
      422,
      'NO_ACTIVE_SPECIALISTS',
      'No active Care Team specialists are configured.',
      true,
    )
  }
  if (!chairwoman) {
    throw createHttpError(
      422,
      'NO_ACTIVE_CHAIRWOMAN',
      'No active Chairwoman (synthesizer) is configured.',
      true,
    )
  }

  return { specialists, chairwoman }
}

async function loadCareRecipientContext(db, householdId, careRecipientId) {
  if (!careRecipientId) return null

  const result = await db.query(
    `
      select
        cr.id,
        cr.display_name as "displayName",
        cr.relationship_label as "relationshipLabel",
        cr.status,
        cp.profile_text as "profileText",
        cp.profile_data as "profileData",
        cp.completed_sections as "completedSections",
        cp.source_summary as "sourceSummary",
        cp.updated_at as "profileUpdatedAt"
      from care_recipients cr
      left join care_profiles cp on cp.care_recipient_id = cr.id
      where cr.id = $1
        and cr.household_id = $2
        and cr.status = 'active'
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

  return {
    id: careRecipient.id,
    displayName: careRecipient.displayName,
    relationshipLabel: careRecipient.relationshipLabel,
    status: careRecipient.status,
    profileText: careRecipient.profileText ?? '',
    profileData: careRecipient.profileData ?? {},
    completedSections: careRecipient.completedSections ?? {},
    sourceSummary: careRecipient.sourceSummary ?? {},
    profileUpdatedAt: careRecipient.profileUpdatedAt ?? null,
  }
}

async function loadActiveHardRuleContext(db, householdId, careRecipientId) {
  const result = await db.query(
    `
      select
        hr.id,
        hr.household_id as "householdId",
        hr.care_recipient_id as "careRecipientId",
        cr.display_name as "careRecipientDisplayName",
        hr.rule_text as "ruleText",
        hr.trigger_terms as "triggerTerms",
        hr.replacement_text as "replacementText",
        hr.rule_type as "ruleType",
        hr.severity,
        hr.sort_order as "sortOrder",
        hr.updated_at as "updatedAt"
      from clinical_hard_rules hr
      left join care_recipients cr on cr.id = hr.care_recipient_id
      where hr.household_id = $1
        and hr.is_active = true
        and (
          hr.care_recipient_id is null
          or ($2::uuid is not null and hr.care_recipient_id = $2)
        )
      order by
        case when hr.care_recipient_id is null then 1 else 2 end,
        hr.sort_order asc,
        hr.created_at asc
    `,
    [householdId, careRecipientId],
  )

  return result.rows
}

function formatHardRuleForPrompt(rule) {
  const scope = rule.careRecipientDisplayName
    ? `for ${rule.careRecipientDisplayName}`
    : 'household-wide'
  const triggerText = rule.triggerTerms?.length
    ? ` Triggers: ${rule.triggerTerms.join(', ')}.`
    : ''
  const replacementText = rule.replacementText
    ? ` Replacement/guidance: ${rule.replacementText}.`
    : ''

  return `[${rule.severity}/${rule.ruleType}; ${scope}] ${rule.ruleText}.${triggerText}${replacementText}`
}

function createHardRuleSnapshot(rules, fallbackRules) {
  if (rules.length > 0) {
    return rules.map((rule) => ({
      id: rule.id,
      careRecipientId: rule.careRecipientId,
      careRecipientDisplayName: rule.careRecipientDisplayName,
      ruleText: rule.ruleText,
      triggerTerms: rule.triggerTerms,
      replacementText: rule.replacementText,
      ruleType: rule.ruleType,
      severity: rule.severity,
      sortOrder: rule.sortOrder,
      updatedAt: rule.updatedAt,
      source: rule.careRecipientId ? 'care_recipient' : 'household',
    }))
  }

  return fallbackRules.map((ruleText, index) => ({
    id: null,
    careRecipientId: null,
    ruleText,
    triggerTerms: [],
    replacementText: '',
    ruleType: 'avoid',
    severity: 'hard',
    sortOrder: index + 1,
    updatedAt: null,
    source: 'request_body_fallback',
  }))
}

function maxUpdatedAt(rules) {
  let maxTime = null

  for (const rule of rules) {
    if (!rule.updatedAt) continue

    const ruleTime = new Date(rule.updatedAt).getTime()
    if (!Number.isFinite(ruleTime)) continue

    maxTime = maxTime === null ? ruleTime : Math.max(maxTime, ruleTime)
  }

  return maxTime === null ? null : new Date(maxTime).toISOString()
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '')
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== ''),
  )
}

function extractDailyLimitsFromProfileData(profileData = {}) {
  const dailyLimits = profileData.dailyLimits ?? {}
  const hydrationRules = profileData.hydrationRules ?? {}

  return compactObject({
    sodium_mg: firstDefined(dailyLimits.sodiumMg, dailyLimits.sodium_mg),
    potassium_mg: firstDefined(dailyLimits.potassiumMg, dailyLimits.potassium_mg),
    phosphorus_mg: firstDefined(dailyLimits.phosphorusMg, dailyLimits.phosphorus_mg),
    protein_g: firstDefined(dailyLimits.proteinG, dailyLimits.protein_g),
    fluid_ml: firstDefined(dailyLimits.fluidMl, dailyLimits.fluid_ml, hydrationRules.dailyGoalMl),
  })
}

// ---------------------------------------------------------------------------
// Specialist + Chairwoman passes
// ---------------------------------------------------------------------------

async function runSpecialist(specialist, contextBlock, signal) {
  const system = buildSpecialistSystemPrompt(specialist, contextBlock)
  const result = await callModel({
    provider: specialist.provider,
    model: specialist.model,
    system,
    user: SPECIALIST_USER_PROMPT,
    roleKey: specialist.roleKey,
    purpose: 'specialist',
    signal,
  })

  const envelope = result.ok ? parseSpecialistEnvelope(result.content) : null

  return {
    roleKey: specialist.roleKey,
    displayName: specialist.displayName,
    provider: specialist.provider,
    model: specialist.model,
    position: specialist.position,
    ok: result.ok && envelope !== null,
    verdict: envelope?.verdict ?? null,
    verdictRationale: envelope?.verdict_rationale ?? '',
    concerns: envelope?.concerns ?? [],
    suggestions: envelope?.suggestions ?? [],
    rawOutput: result.content,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
    httpStatus: result.httpStatus,
    error: result.ok
      ? (envelope ? null : 'Specialist returned a malformed envelope.')
      : result.error,
  }
}

async function runChairwoman(chairwoman, contextBlock, deliberations, signal) {
  const { system, user } = buildChairwomanPrompt(chairwoman, contextBlock, deliberations)
  const result = await callModel({
    provider: chairwoman.provider,
    model: chairwoman.model,
    system,
    user,
    roleKey: chairwoman.roleKey,
    purpose: 'chairman',
    signal,
  })

  const envelope = result.ok ? parseChairwomanEnvelope(result.content) : null
  const synthesis = envelope ?? rollUpFallback(deliberations, result.content)

  return {
    provider: chairwoman.provider,
    model: chairwoman.model,
    ok: result.ok && envelope !== null,
    ...synthesis,
    rawOutput: result.content,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    latencyMs: result.latencyMs,
    httpStatus: result.httpStatus,
    error: result.ok
      ? (envelope ? null : 'Chairwoman returned a malformed envelope; rolled up specialist verdicts.')
      : result.error,
  }
}

// Deterministic fallback when synthesis fails — never silently approve.
function rollUpFallback(deliberations, rawContent) {
  const hasDeny = deliberations.some((d) => d.verdict === 'deny')
  const hasCaveats = deliberations.some((d) => d.verdict === 'approve_with_caveats' || !d.ok)
  const verdict = hasDeny ? 'denied' : (hasCaveats ? 'approved_with_caveats' : 'approved')

  return {
    recipe_markdown: rawContent || '(Chairwoman synthesis failed — see specialist deliberations.)',
    verdict,
    verdict_summary: 'Auto-rolled-up from specialist verdicts; Chairwoman synthesis did not produce a valid envelope.',
    caveats: deliberations
      .filter((d) => d.verdict !== 'approve')
      .map((d) => `${d.displayName}: ${d.verdictRationale || d.error || 'no rationale'}`),
    warning_items: [],
    clinician_flags: [],
  }
}

function sumTokens(deliberations, chairwoman, key) {
  const specialistTotal = deliberations.reduce((acc, d) => acc + (d[key] ?? 0), 0)
  return specialistTotal + (chairwoman[key] ?? 0)
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function insertRunRow(db, { householdId, careRecipientId, payload, userId, specialistCount }) {
  const result = await db.query(
    `
      insert into recipe_brain_runs (
        household_id, care_recipient_id, status, mode,
        source_recipe_text, clinical_profile_text, clinical_profile_data,
        hard_rules_snapshot, hard_rules_updated_at_used, specialist_count, requested_by, started_at
      )
      values ($1, $2, 'running', 'committee', $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, now())
      returning id
    `,
    [
      householdId,
      careRecipientId,
      payload.sourceRecipe,
      payload.clinicalProfileText,
      JSON.stringify(payload.clinicalProfileData),
      JSON.stringify(payload.hardRulesSnapshot),
      payload.hardRulesUpdatedAtUsed,
      specialistCount,
      userId,
    ],
  )
  return result.rows[0].id
}

async function persistSpecialistRows(client, runId, deliberations) {
  for (const d of deliberations) {
    await client.query(
      `
        insert into care_team_specialist_runs (
          brain_run_id, role_key, display_name, provider, model, ok, verdict,
          verdict_rationale, concerns, suggestions, raw_output,
          input_tokens, output_tokens, latency_ms, error_message, position
        )
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16)
      `,
      [
        runId, d.roleKey, d.displayName, d.provider, d.model, d.ok, d.verdict,
        d.verdictRationale, JSON.stringify(d.concerns), JSON.stringify(d.suggestions),
        d.rawOutput, d.inputTokens, d.outputTokens, d.latencyMs, d.error, d.position,
      ],
    )

    await insertProxyLog(client, runId, 'specialist', d)
  }
}

async function persistChairwomanRow(client, runId, chairwoman) {
  await client.query(
    `
      insert into chairman_synthesis_runs (
        brain_run_id, provider, model, ok, verdict, verdict_summary,
        recipe_markdown, caveats, warning_items, clinician_flags, raw_output,
        input_tokens, output_tokens, latency_ms, error_message
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)
    `,
    [
      runId, chairwoman.provider, chairwoman.model, chairwoman.ok, chairwoman.verdict,
      chairwoman.verdict_summary, chairwoman.recipe_markdown, JSON.stringify(chairwoman.caveats),
      JSON.stringify(chairwoman.warning_items), JSON.stringify(chairwoman.clinician_flags),
      chairwoman.rawOutput, chairwoman.inputTokens, chairwoman.outputTokens, chairwoman.latencyMs,
      chairwoman.error,
    ],
  )

  await insertProxyLog(client, runId, 'chairman', chairwoman)
}

async function insertProxyLog(client, runId, purpose, call) {
  await client.query(
    `
      insert into llm_proxy_logs (
        brain_run_id, provider, model, purpose, status, http_status,
        input_tokens, output_tokens, latency_ms, error_message
      )
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    `,
    [
      runId, call.provider, call.model, purpose, call.error ? 'error' : 'ok',
      call.httpStatus, call.inputTokens, call.outputTokens, call.latencyMs, call.error,
    ],
  )
}

async function persistRecipe(client, { householdId, userId, runId, chairwoman, payload }) {
  const request = await client.query(
    `
      insert into recipe_requests (
        household_id, care_recipient_id, source_recipe_text, provider, model,
        status, requested_by, completed_at
      )
      values ($1, $2, $3, $4, $5, 'completed', $6, now())
      returning id
    `,
    [
      householdId,
      payload.careRecipientId,
      payload.sourceRecipe,
      chairwoman.provider,
      chairwoman.model,
      userId,
    ],
  )

  const title = payload.title || parseTitleFromMarkdown(chairwoman.recipe_markdown) || 'Untitled Recipe'

  const recipe = await client.query(
    `
      insert into recipe_adaptations (
        recipe_request_id, household_id, care_recipient_id, title,
        source_recipe_text, output_markdown, meal_slots, recipe_categories,
        saved_by, saved_at, generation_mode,
        clinical_warning, clinical_warning_items, clinical_review_status,
        clinical_review_summary, recipe_brain_run_id, target_servings,
        original_servings, created_by, updated_by
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, now(), $17,
        $10, $11::jsonb, $12, $13, $14, $15, $16, $9, $9
      )
      returning
        id,
        care_recipient_id as "careRecipientId",
        title,
        output_markdown as "outputMarkdown",
        clinical_review_status as "clinicalReviewStatus",
        clinical_review_summary as "clinicalReviewSummary",
        clinical_warning as "clinicalWarning",
        clinical_warning_items as "clinicalWarningItems",
        recipe_brain_run_id as "recipeBrainRunId",
        saved_at as "savedAt",
        created_at as "createdAt"
    `,
    [
      request.rows[0].id, householdId, payload.careRecipientId, title,
      payload.sourceRecipe, chairwoman.recipe_markdown, payload.mealSlots,
      payload.recipeCategories, userId,
      chairwoman.warning_items.length > 0, JSON.stringify(chairwoman.warning_items),
      chairwoman.verdict, chairwoman.verdict_summary, runId,
      payload.targetServings, payload.originalServings,
      payload.mode === 'preserve' ? 'preserve_original' : 'committee',
    ],
  )

  return recipe.rows[0]
}

// Seed the committee's verdict into the clinical-review audit history so the
// Clinical Review queue shows the synthesis-layer decision before any human
// override (plan: "verdict set by synthesis layer; audited").
async function insertCommitteeReview(client, { householdId, recipeId, status, summary, runId, accuracyCheckId }) {
  await client.query(
    `
      insert into recipe_clinical_reviews (
        household_id, recipe_adaptation_id, source, status, notes,
        recipe_brain_run_id, accuracy_check_id
      )
      values ($1, $2, 'committee', $3, $4, $5, $6)
    `,
    [householdId, recipeId, status, summary ?? null, runId, accuracyCheckId ?? null],
  )
}

async function completeRun(client, runId, { chairwoman, totalInputTokens, totalOutputTokens, recipeId }) {
  await client.query(
    `
      update recipe_brain_runs
      set
        status = 'completed',
        verdict = $2,
        verdict_summary = $3,
        caveats = $4::jsonb,
        warning_items = $5::jsonb,
        clinician_flags = $6::jsonb,
        total_input_tokens = $7,
        total_output_tokens = $8,
        recipe_adaptation_id = $9,
        completed_at = now()
      where id = $1
    `,
    [
      runId, chairwoman.verdict, chairwoman.verdict_summary, JSON.stringify(chairwoman.caveats),
      JSON.stringify(chairwoman.warning_items), JSON.stringify(chairwoman.clinician_flags),
      totalInputTokens, totalOutputTokens, recipeId,
    ],
  )
}

async function failRun(db, runId, message) {
  try {
    await db.query(
      `update recipe_brain_runs set status = 'failed', error_message = $2, completed_at = now() where id = $1`,
      [runId, message?.slice(0, 1000) ?? 'Recipe Brain run failed.'],
    )
  } catch {
    // Best-effort; the original error is what matters.
  }
}

function parseTitleFromMarkdown(markdown) {
  for (const line of (markdown ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/)
    if (headingMatch?.[1]) return headingMatch[1].trim()
  }
  return null
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * The gate-free committee pipeline. Callers own authorization — the customer
 * entry runs the household capability + entitlement gates, the admin entry
 * runs requireInternalAdmin. Options:
 *   signal          AbortSignal for the LLM calls
 *   neutralContext  true = ignore the anchor household's care recipients and
 *                   hard rules (admin/master generation: the anchor household
 *                   only satisfies the NOT NULL constraint — its clinical
 *                   context must not shape platform content)
 *   autoPublish     { publishedByUserId, adminRole } — publish the saved
 *                   recipe as a master IN THE SAME TRANSACTION when the
 *                   verdict is publishable (PL-001: never on needs_review/denied)
 */
async function executeRecipeBrainRun(db, { user, householdId, runPayload, options = {} }) {
  const neutralContext = options.neutralContext === true
  const careRecipient = neutralContext
    ? null
    : await loadCareRecipientContext(db, householdId, runPayload.careRecipientId)
  const activeHardRules = neutralContext
    ? []
    : await loadActiveHardRuleContext(db, householdId, runPayload.careRecipientId)
  const serverHardRules = activeHardRules.map(formatHardRuleForPrompt)
  const hardRules = serverHardRules.length > 0 ? serverHardRules : runPayload.hardRules
  const profileDailyLimits = careRecipient
    ? extractDailyLimitsFromProfileData(careRecipient.profileData)
    : {}
  const effectiveRunPayload = {
    ...runPayload,
    clinicalProfileText: careRecipient ? careRecipient.profileText : runPayload.clinicalProfileText,
    clinicalProfileData: careRecipient ? careRecipient.profileData : runPayload.clinicalProfileData,
    hardRules,
    dailyLimits: {
      ...runPayload.dailyLimits,
      ...profileDailyLimits,
    },
    hardRulesSnapshot: createHardRuleSnapshot(activeHardRules, runPayload.hardRules),
    hardRulesUpdatedAtUsed: maxUpdatedAt(activeHardRules),
  }
  const { specialists, chairwoman } = await loadActiveRoster(db)

  const runId = await insertRunRow(db, {
    householdId,
    careRecipientId: effectiveRunPayload.careRecipientId,
    payload: effectiveRunPayload,
    userId: user.id,
    specialistCount: specialists.length,
  })

  try {
    const contextBlock = buildPatientContext({
      careRecipient,
      clinicalProfileText: effectiveRunPayload.clinicalProfileText,
      clinicalProfileData: effectiveRunPayload.clinicalProfileData,
      hardRules: effectiveRunPayload.hardRules,
      sourceRecipe: effectiveRunPayload.sourceRecipe,
      nutritionSnapshot: effectiveRunPayload.nutritionSnapshot,
      dailyLimits: effectiveRunPayload.dailyLimits,
      targetServings: effectiveRunPayload.targetServings,
      originalServings: effectiveRunPayload.originalServings,
      mode: effectiveRunPayload.mode,
    })

    // Specialists in parallel; the Chairwoman synthesizes once all have returned.
    const deliberations = await Promise.all(
      specialists.map((specialist) => runSpecialist(specialist, contextBlock, options.signal)),
    )
    const chairwomanResult = await runChairwoman(chairwoman, contextBlock, deliberations, options.signal)

    const totalInputTokens = sumTokens(deliberations, chairwomanResult, 'inputTokens')
    const totalOutputTokens = sumTokens(deliberations, chairwomanResult, 'outputTokens')
    const shouldSave = runPayload.save && chairwomanResult.verdict !== 'denied'

    const client = await db.connect()
    let recipe = null
    try {
      await client.query('begin')
      await persistSpecialistRows(client, runId, deliberations)
      await persistChairwomanRow(client, runId, chairwomanResult)
      if (shouldSave) {
        recipe = await persistRecipe(client, {
          householdId,
          userId: user.id,
          runId,
          chairwoman: chairwomanResult,
          payload: effectiveRunPayload,
        })

        // Deterministic accuracy check on the produced recipe, using the same
        // clinical profile the committee saw. Household runs load hard rules
        // from the DB; neutral (admin/master) runs pass the same empty rule
        // set the committee saw so the anchor household's rules stay out.
        const { accuracyCheckId } = await runAccuracyCheckForRecipe(client, {
          recipe: {
            id: recipe.id,
            source_recipe_text: effectiveRunPayload.sourceRecipe,
            output_markdown: chairwomanResult.recipe_markdown,
            recipe_categories: effectiveRunPayload.recipeCategories,
            target_servings: effectiveRunPayload.targetServings,
            original_servings: effectiveRunPayload.originalServings,
          },
          householdId,
          careRecipientId: effectiveRunPayload.careRecipientId,
          clinicalProfileText: effectiveRunPayload.clinicalProfileText,
          hardRules: neutralContext ? effectiveRunPayload.hardRules : null,
        })

        await insertCommitteeReview(client, {
          householdId,
          recipeId: recipe.id,
          status: chairwomanResult.verdict,
          summary: chairwomanResult.verdict_summary,
          runId,
          accuracyCheckId,
        })

        // Admin generation: publish atomically with the save so an approved
        // master never exists as an unpublished household row. Verdicts below
        // the bar stay unpublished — the Clinical Review Gate is not bypassed.
        if (options.autoPublish && shouldAutoPublish(chairwomanResult.verdict)) {
          await client.query(
            `
              update recipe_adaptations
              set scope = 'master', is_master_recipe = true,
                  published_at = now(), published_by = $2, updated_at = now()
              where id = $1
            `,
            [recipe.id, options.autoPublish.publishedByUserId],
          )
          await writeAuditLog(client, {
            action: 'platform_recipe.published',
            entityType: 'recipe_adaptation',
            entityId: recipe.id,
            actorUserId: options.autoPublish.publishedByUserId,
            actorAdminRole: options.autoPublish.adminRole,
            householdId,
            after: { title: recipe.title, verdict: chairwomanResult.verdict },
            extra: { via: 'admin_generation', runId },
          })
          recipe.published = true
        }
      }
      await completeRun(client, runId, {
        chairwoman: chairwomanResult,
        totalInputTokens,
        totalOutputTokens,
        recipeId: recipe?.id ?? null,
      })
      await client.query('commit')
    } catch (err) {
      try { await client.query('rollback') } catch { /* keep original error */ }
      throw err
    } finally {
      client.release()
    }

    return {
      run: {
        id: runId,
        careRecipientId: effectiveRunPayload.careRecipientId,
        status: 'completed',
        mode: effectiveRunPayload.mode,
        verdict: chairwomanResult.verdict,
        verdictSummary: chairwomanResult.verdict_summary,
        caveats: chairwomanResult.caveats,
        warningItems: chairwomanResult.warning_items,
        clinicianFlags: chairwomanResult.clinician_flags,
        specialistCount: specialists.length,
        totalInputTokens,
        totalOutputTokens,
        saved: Boolean(recipe),
        hardRuleCount: effectiveRunPayload.hardRulesSnapshot.length,
      },
      careRecipient: careRecipient
        ? {
            id: careRecipient.id,
            displayName: careRecipient.displayName,
            relationshipLabel: careRecipient.relationshipLabel,
            profileUpdatedAt: careRecipient.profileUpdatedAt,
          }
        : null,
      deliberations: deliberations.map(publicDeliberation),
      chairwoman: {
        provider: chairwomanResult.provider,
        model: chairwomanResult.model,
        ok: chairwomanResult.ok,
        error: chairwomanResult.error,
      },
      recipe,
    }
  } catch (err) {
    await failRun(db, runId, err.message)
    throw err
  }
}

export async function runRecipeBrainForCurrentUser(clerkUserId, householdId, payload, options = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const runPayload = normalizeRunPayload(payload)
  // Phase 3: the generator is the first feature cut over to PDP enforcement. The
  // `recipe:generate` capability (matrix-derived, golden-tested = owner/co_owner/
  // caregiver) is now the decision; Phase 2 shadow proved it equals GENERATE_ROLES.
  const access = await requireHouseholdCapability(db, user.id, householdId, 'recipe:generate', {
    resourceType: 'recipe',
  })
  // Entitlement gate: generation is Solo+ only and requires good standing.
  await requireGeneratorAccess(db, access.household.id)

  const result = await executeRecipeBrainRun(db, {
    user,
    householdId: access.household.id,
    runPayload,
    options: { signal: options.signal },
  })

  return { household: access.household, requester: access.membership, ...result }
}

// The anchor household for an admin/master run: masters keep a non-null
// household_id (migration 013 — the publishing admin's household). The
// household is a storage anchor only; neutralContext keeps its clinical
// context out of the run.
async function resolveAdminAnchorHousehold(db, userId) {
  const result = await db.query(
    `
      select h.id, h.name
      from household_members hm
      join households h on h.id = hm.household_id
      where hm.user_id = $1
        and hm.role in ('owner', 'co_owner')
        and hm.status = 'accepted'
        and h.status = 'active'
      order by hm.created_at asc
      limit 1
    `,
    [userId],
  )

  if (result.rows.length === 0) {
    throw createHttpError(
      409,
      'ADMIN_HOUSEHOLD_REQUIRED',
      'Admin recipe generation needs a household to anchor the run. Create or join a household with this account first.',
      true,
    )
  }

  return result.rows[0]
}

/**
 * Admin generation for the Master Library (ABAC PL-005). Runs the committee
 * with a NEUTRAL clinical context (no care recipient, no household hard rules)
 * and auto-publishes the recipe as a master when the verdict is publishable —
 * instantly visible in every household's library browse. No entitlement gate:
 * this is an internal action, and customer plan tiers do not apply to staff.
 */
export async function runRecipeBrainForAdmin(clerkUserId, payload, options = {}) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, CONTENT_ADMINS)

  const runPayload = normalizeRunPayload({ ...payload, careRecipientId: null, save: true })
  const household = await resolveAdminAnchorHousehold(db, user.id)

  const result = await executeRecipeBrainRun(db, {
    user,
    householdId: household.id,
    runPayload,
    options: {
      signal: options.signal,
      neutralContext: true,
      autoPublish: { publishedByUserId: user.id, adminRole: admin.role },
    },
  })

  await writeAuditLog(db, {
    action: 'admin_recipe.generated',
    entityType: 'recipe_brain_run',
    entityId: result.run.id,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    householdId: household.id,
    after: {
      verdict: result.run.verdict,
      recipeId: result.recipe?.id ?? null,
      autoPublished: Boolean(result.recipe?.published),
    },
  })

  return { adminRole: admin.role, anchorHouseholdId: household.id, ...result }
}

export async function getRecipeBrainRunForCurrentUser(clerkUserId, householdId, runId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedRunId = normalizeUuid(runId, 'INVALID_RUN_ID', 'Run id must be a UUID.')
  const access = await requireHouseholdRole(db, user.id, householdId, GENERATE_ROLES, {
    action: 'view',
    resourceType: 'recipe_brain_run',
    label: 'recipe-brain:get-run',
  })

  const runResult = await db.query(
    `
      select
        r.id,
        r.care_recipient_id as "careRecipientId",
        cr.display_name as "careRecipientDisplayName",
        cr.relationship_label as "careRecipientRelationshipLabel",
        r.status,
        r.verdict,
        r.verdict_summary as "verdictSummary",
        r.clinical_profile_data as "clinicalProfileData",
        r.caveats,
        r.warning_items as "warningItems",
        r.clinician_flags as "clinicianFlags",
        r.hard_rules_snapshot as "hardRulesSnapshot",
        r.hard_rules_updated_at_used as "hardRulesUpdatedAtUsed",
        r.specialist_count as "specialistCount",
        r.total_input_tokens as "totalInputTokens",
        r.total_output_tokens as "totalOutputTokens",
        r.recipe_adaptation_id as "recipeAdaptationId",
        r.error_message as "errorMessage",
        r.started_at as "startedAt",
        r.completed_at as "completedAt",
        r.created_at as "createdAt"
      from recipe_brain_runs r
      left join care_recipients cr on cr.id = r.care_recipient_id
      where r.id = $1 and r.household_id = $2
      limit 1
    `,
    [normalizedRunId, access.household.id],
  )

  const run = runResult.rows[0]
  if (!run) {
    throw createHttpError(404, 'RUN_NOT_FOUND', 'Recipe Brain run was not found.', true)
  }

  const specialistResult = await db.query(
    `
      select
        role_key as "roleKey", display_name as "displayName", provider, model, ok,
        verdict, verdict_rationale as "verdictRationale", concerns, suggestions,
        input_tokens as "inputTokens", output_tokens as "outputTokens",
        latency_ms as "latencyMs", error_message as "errorMessage", position
      from care_team_specialist_runs
      where brain_run_id = $1
      order by position
    `,
    [normalizedRunId],
  )

  const chairwomanResult = await db.query(
    `
      select
        provider, model, ok, verdict, verdict_summary as "verdictSummary",
        recipe_markdown as "recipeMarkdown", caveats,
        warning_items as "warningItems", clinician_flags as "clinicianFlags",
        input_tokens as "inputTokens", output_tokens as "outputTokens",
        latency_ms as "latencyMs", error_message as "errorMessage"
      from chairman_synthesis_runs
      where brain_run_id = $1
      order by created_at desc
      limit 1
    `,
    [normalizedRunId],
  )

  return {
    household: access.household,
    requester: access.membership,
    run,
    deliberations: specialistResult.rows,
    chairwoman: chairwomanResult.rows[0] ?? null,
  }
}

export async function listRecipeBrainRunsForCurrentUser(clerkUserId, householdId, query = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, GENERATE_ROLES, {
    action: 'view',
    resourceType: 'recipe_brain_run',
    label: 'recipe-brain:list-runs',
  })
  const requestedLimit = Number.parseInt(query.limit ?? '50', 10)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 50

  const result = await db.query(
    `
      select
        r.id,
        r.care_recipient_id as "careRecipientId",
        cr.display_name as "careRecipientDisplayName",
        cr.relationship_label as "careRecipientRelationshipLabel",
        r.status,
        r.verdict,
        r.verdict_summary as "verdictSummary",
        jsonb_array_length(r.hard_rules_snapshot) as "hardRuleCount",
        r.hard_rules_updated_at_used as "hardRulesUpdatedAtUsed",
        r.specialist_count as "specialistCount",
        r.recipe_adaptation_id as "recipeAdaptationId",
        r.total_input_tokens as "totalInputTokens",
        r.total_output_tokens as "totalOutputTokens",
        r.created_at as "createdAt",
        r.completed_at as "completedAt"
      from recipe_brain_runs r
      left join care_recipients cr on cr.id = r.care_recipient_id
      where r.household_id = $1
      order by r.created_at desc
      limit $2
    `,
    [access.household.id, limit],
  )

  return {
    household: access.household,
    requester: access.membership,
    runs: result.rows,
  }
}

function publicDeliberation(d) {
  return {
    roleKey: d.roleKey,
    displayName: d.displayName,
    provider: d.provider,
    model: d.model,
    ok: d.ok,
    verdict: d.verdict,
    verdictRationale: d.verdictRationale,
    concerns: d.concerns,
    suggestions: d.suggestions,
    inputTokens: d.inputTokens,
    outputTokens: d.outputTokens,
    latencyMs: d.latencyMs,
    error: d.error,
  }
}
