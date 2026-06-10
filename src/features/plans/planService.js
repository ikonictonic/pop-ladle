/**
 * Plans & entitlements — "one internal truth: what can this household access
 * right now?" (Plan-2 §07).
 *
 * Read + enforce only. There is deliberately NO write surface here: tier
 * changes come from billing webhooks or the Super Admin console later
 * (matching the prototype's posture). Every household gets a free entitlement
 * row at creation; a missing row still defaults to free so old households work.
 *
 * Per-household overrides: household_entitlements.usage_limits may override
 * the plan's defaults (e.g. a comped household with a raised recipient cap),
 * and feature_flags may override feature keys.
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { createHttpError, requireHouseholdRole } from '../households/householdAccess.js'

const PLAN_VIEW_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']

// Plan states that grant feature access (past_due/canceled/suspended do not).
const GOOD_STANDING_STATUSES = new Set(['active', 'trialing', 'comped'])

const DEFAULT_ENTITLEMENT = Object.freeze({
  planTier: 'free',
  planStatus: 'active',
  billingSource: null,
  trialEndsAt: null,
  currentPeriodEndsAt: null,
  gracePeriodEndsAt: null,
  usageLimits: {},
  featureFlags: {},
})

function definitionProjection() {
  return `
    code,
    display_name as "displayName",
    monthly_price_cents as "monthlyPriceCents",
    care_recipient_limit as "careRecipientLimit",
    household_member_limit as "householdMemberLimit",
    features,
    is_active as "isActive"
  `
}

async function readPlanDefinition(db, tier) {
  const result = await db.query(
    `select ${definitionProjection()} from plan_definitions where code = $1 limit 1`,
    [tier],
  )
  return result.rows[0] ?? null
}

async function readEntitlementRow(db, householdId) {
  const result = await db.query(
    `
      select
        plan_tier as "planTier",
        plan_status as "planStatus",
        billing_source as "billingSource",
        trial_ends_at as "trialEndsAt",
        current_period_ends_at as "currentPeriodEndsAt",
        grace_period_ends_at as "gracePeriodEndsAt",
        usage_limits as "usageLimits",
        feature_flags as "featureFlags"
      from household_entitlements
      where household_id = $1
      limit 1
    `,
    [householdId],
  )
  return result.rows[0] ?? null
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value
  }
  return null
}

/**
 * Load the resolved entitlement context for a household: entitlement row
 * (defaulting to free), its plan definition, effective limits (per-household
 * usage_limits override the plan defaults), effective features (feature_flags
 * override the plan's feature keys), and standing.
 */
export async function getEntitlementContext(db, householdId) {
  const entitlement = (await readEntitlementRow(db, householdId)) ?? { ...DEFAULT_ENTITLEMENT }
  const definition = (await readPlanDefinition(db, entitlement.planTier))
    ?? (await readPlanDefinition(db, 'free'))

  if (!definition) {
    throw createHttpError(500, 'PLAN_CATALOG_MISSING', 'The plan catalog is not seeded.', false)
  }

  const overrides = entitlement.usageLimits ?? {}
  const features = { ...(definition.features ?? {}), ...(entitlement.featureFlags ?? {}) }

  const limits = {
    careRecipientLimit: firstDefined(overrides.care_recipient_limit, definition.careRecipientLimit),
    householdMemberLimit: firstDefined(overrides.household_member_limit, definition.householdMemberLimit),
    savedRecipeCap: firstDefined(overrides.saved_recipe_cap, features.saved_recipe_cap),
  }

  return {
    entitlement,
    definition,
    features,
    limits,
    inGoodStanding: GOOD_STANDING_STATUSES.has(entitlement.planStatus),
  }
}

// ---------------------------------------------------------------------------
// Enforcement helpers — "the Application Brain reads entitlements before
// exposing features". Each throws PLAN_UPGRADE_REQUIRED / PLAN_NOT_IN_GOOD_
// STANDING / PLAN_LIMIT_REACHED with a caregiver-readable message.
// ---------------------------------------------------------------------------

/**
 * Generator access is strictly Solo+ (Basic copies from the master library;
 * Free browses). Also requires the plan to be in good standing.
 */
export async function requireGeneratorAccess(db, householdId) {
  const context = await getEntitlementContext(db, householdId)

  if (!context.inGoodStanding) {
    throw createHttpError(
      403,
      'PLAN_NOT_IN_GOOD_STANDING',
      `This household's plan is ${context.entitlement.planStatus}. Restore billing to use the recipe generator.`,
      true,
    )
  }

  if (context.features.generator_access !== true) {
    throw createHttpError(
      403,
      'PLAN_UPGRADE_REQUIRED',
      'Recipe generation requires the Solo plan or higher. This plan can browse and save recipes from the Pop & Ladle library.',
      true,
    )
  }

  return context
}

export async function assertWithinCareRecipientLimit(db, householdId) {
  const context = await getEntitlementContext(db, householdId)
  const limit = context.limits.careRecipientLimit
  if (limit === null) return context

  const result = await db.query(
    `select count(*)::int as "count" from care_recipients where household_id = $1 and status = 'active'`,
    [householdId],
  )

  if (result.rows[0].count >= limit) {
    throw createHttpError(
      403,
      'PLAN_LIMIT_REACHED',
      `This plan supports ${limit} care recipient${limit === 1 ? '' : 's'}. Upgrade to add more.`,
      true,
    )
  }

  return context
}

/**
 * Member limit counts accepted members plus open (pending, unexpired) invites,
 * so a household can't over-invite past its seat count.
 */
export async function assertWithinHouseholdMemberLimit(db, householdId) {
  const context = await getEntitlementContext(db, householdId)
  const limit = context.limits.householdMemberLimit
  if (limit === null) return context

  const result = await db.query(
    `
      select
        (select count(*)::int from household_members
          where household_id = $1 and status = 'accepted')
        +
        (select count(*)::int from household_invites
          where household_id = $1
            and accepted_at is null
            and revoked_at is null
            and expires_at > now())
        as "count"
    `,
    [householdId],
  )

  if (result.rows[0].count >= limit) {
    throw createHttpError(
      403,
      'PLAN_LIMIT_REACHED',
      `This plan supports ${limit} household member${limit === 1 ? '' : 's'} (including pending invites). Upgrade to invite more.`,
      true,
    )
  }

  return context
}

export async function assertWithinSavedRecipeCap(db, householdId) {
  const context = await getEntitlementContext(db, householdId)
  const cap = context.limits.savedRecipeCap
  if (cap === null || cap === undefined) return context

  const result = await db.query(
    `
      select count(*)::int as "count"
      from recipe_adaptations
      where household_id = $1 and saved_at is not null and deleted_at is null
    `,
    [householdId],
  )

  if (result.rows[0].count >= cap) {
    throw createHttpError(
      403,
      'PLAN_LIMIT_REACHED',
      `This plan caps saved recipes at ${cap}. Upgrade for unlimited saves.`,
      true,
    )
  }

  return context
}

// ---------------------------------------------------------------------------
// Route entries
// ---------------------------------------------------------------------------

export async function listPlanCatalog() {
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const result = await db.query(
    `
      select ${definitionProjection()}
      from plan_definitions
      where is_active = true
      order by monthly_price_cents asc nulls last
    `,
  )

  return { plans: result.rows }
}

export async function getHouseholdPlanForCurrentUser(clerkUserId, householdId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, PLAN_VIEW_ROLES)
  const context = await getEntitlementContext(db, access.household.id)

  const usage = await db.query(
    `
      select
        (select count(*)::int from care_recipients
          where household_id = $1 and status = 'active') as "careRecipients",
        (select count(*)::int from household_members
          where household_id = $1 and status = 'accepted') as "members",
        (select count(*)::int from household_invites
          where household_id = $1 and accepted_at is null and revoked_at is null
            and expires_at > now()) as "pendingInvites",
        (select count(*)::int from recipe_adaptations
          where household_id = $1 and saved_at is not null and deleted_at is null) as "savedRecipes"
    `,
    [access.household.id],
  )

  return {
    household: access.household,
    requester: access.membership,
    plan: {
      tier: context.entitlement.planTier,
      status: context.entitlement.planStatus,
      inGoodStanding: context.inGoodStanding,
      billingSource: context.entitlement.billingSource,
      trialEndsAt: context.entitlement.trialEndsAt,
      currentPeriodEndsAt: context.entitlement.currentPeriodEndsAt,
      gracePeriodEndsAt: context.entitlement.gracePeriodEndsAt,
      definition: context.definition,
      features: context.features,
      limits: context.limits,
    },
    usage: usage.rows[0],
  }
}
