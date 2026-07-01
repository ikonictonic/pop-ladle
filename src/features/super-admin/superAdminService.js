/**
 * Super Admin — the company control plane (plan §08/§08b).
 *
 * Internal-admin-gated operations over the whole platform: account registry,
 * household operations (comps, suspend), committee roster governance, proxy
 * observability, privacy-request workflows, and admin management. Every
 * mutation is audited with the actor's admin role.
 */

import { writeAuditLog } from '../audit-log/auditLogService.js'
import { createHttpError, normalizeUuid } from '../households/householdAccess.js'
import { maskFromLast4 } from '../provider-keys/providerKeyCrypto.js'
import { upsertRosterMemberKey } from '../provider-keys/providerKeyService.js'
import {
  ANY_ADMIN,
  CLINICAL_ADMINS,
  SUPER_ONLY,
  SUPPORT_ADMINS,
  requireInternalAdmin,
} from './adminAccess.js'

const SEARCH_LIMIT_DEFAULT = 50
const SEARCH_LIMIT_MAX = 200

const PLAN_STATUSES = ['trialing', 'active', 'past_due', 'canceled', 'comped', 'suspended']
const BILLING_SOURCES = ['web', 'ios', 'android', 'partner', 'manual_comp', 'enterprise_contract']
const ROSTER_PROVIDERS = ['anthropic', 'groq', 'gemini', 'mock']
const PRIVACY_REQUEST_TYPES = ['export_user', 'delete_user', 'delete_household', 'anonymize_records']
const PRIVACY_STATUSES = ['requested', 'approved', 'processing', 'completed', 'rejected', 'failed', 'canceled']
const PRIVACY_TERMINAL = new Set(['completed', 'rejected', 'failed', 'canceled'])
const ADMIN_ROLES = ['super_admin', 'support_admin', 'clinical_admin']

function normalizeLimit(value, fallback = SEARCH_LIMIT_DEFAULT) {
  const parsed = Number.parseInt(value ?? `${fallback}`, 10)
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), SEARCH_LIMIT_MAX) : fallback
}

function normalizeSearch(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export async function getAdminOverview(clerkUserId) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, ANY_ADMIN)

  const result = await db.query(`
    select
      (select count(*)::int from app_users where status = 'active') as "activeUsers",
      (select count(*)::int from households where status = 'active') as "activeHouseholds",
      (select count(*)::int from households where status = 'suspended') as "suspendedHouseholds",
      (select count(*)::int from care_recipients where status = 'active') as "careRecipients",
      (select count(*)::int from recipe_adaptations where saved_at is not null and deleted_at is null) as "savedRecipes",
      (select count(*)::int from recipe_adaptations where clinical_review_status = 'needs_review' and deleted_at is null) as "recipesNeedingReview",
      (select count(*)::int from recipe_brain_runs) as "brainRuns",
      (select coalesce(sum(total_input_tokens), 0)::bigint from recipe_brain_runs) as "totalInputTokens",
      (select coalesce(sum(total_output_tokens), 0)::bigint from recipe_brain_runs) as "totalOutputTokens",
      (select count(*)::int from llm_proxy_logs where status = 'error' and created_at > now() - interval '7 days') as "proxyErrors7d",
      (select count(*)::int from privacy_requests where status in ('requested', 'approved', 'processing')) as "openPrivacyRequests",
      (select count(*)::int from household_invites where accepted_at is null and revoked_at is null and expires_at > now()) as "pendingInvites"
  `)

  const tiers = await db.query(`
    select plan_tier as "tier", count(*)::int as "households"
    from household_entitlements
    group by plan_tier
    order by count(*) desc
  `)

  return { adminRole: admin.role, overview: result.rows[0], householdsByTier: tiers.rows }
}

// ---------------------------------------------------------------------------
// Registries: users + households
// ---------------------------------------------------------------------------

export async function listUsersForAdmin(clerkUserId, query = {}) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, ANY_ADMIN)
  const search = normalizeSearch(query.search)
  const limit = normalizeLimit(query.limit)

  const result = await db.query(
    `
      select
        u.id,
        u.email,
        u.display_name as "displayName",
        u.status,
        u.email_verified_at as "emailVerifiedAt",
        u.last_seen_at as "lastSeenAt",
        u.created_at as "createdAt",
        coalesce(
          (select json_agg(json_build_object(
            'householdId', hm.household_id,
            'householdName', h.name,
            'role', hm.role,
            'status', hm.status
          ) order by hm.created_at)
          from household_members hm
          join households h on h.id = hm.household_id
          where hm.user_id = u.id),
          '[]'::json
        ) as "memberships"
      from app_users u
      where ($1::text is null or u.email::text ilike '%' || $1 || '%' or u.display_name ilike '%' || $1 || '%')
      order by u.created_at desc
      limit $2
    `,
    [search, limit],
  )

  return { adminRole: admin.role, users: result.rows }
}

export async function listHouseholdsForAdmin(clerkUserId, query = {}) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, ANY_ADMIN)
  const search = normalizeSearch(query.search)
  const limit = normalizeLimit(query.limit)

  const result = await db.query(
    `
      select
        h.id,
        h.name,
        h.status,
        h.created_at as "createdAt",
        owner.email as "ownerEmail",
        he.plan_tier as "planTier",
        he.plan_status as "planStatus",
        (select count(*)::int from household_members hm
          where hm.household_id = h.id and hm.status = 'accepted') as "members",
        (select count(*)::int from care_recipients cr
          where cr.household_id = h.id and cr.status = 'active') as "careRecipients",
        (select count(*)::int from recipe_adaptations ra
          where ra.household_id = h.id and ra.saved_at is not null and ra.deleted_at is null) as "savedRecipes"
      from households h
      left join app_users owner on owner.id = h.primary_owner_user_id
      left join household_entitlements he on he.household_id = h.id
      where ($1::text is null or h.name ilike '%' || $1 || '%' or owner.email::text ilike '%' || $1 || '%')
      order by h.created_at desc
      limit $2
    `,
    [search, limit],
  )

  return { adminRole: admin.role, households: result.rows }
}

export async function getHouseholdForAdmin(clerkUserId, householdId) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, ANY_ADMIN)
  const normalizedHouseholdId = normalizeUuid(householdId, 'INVALID_HOUSEHOLD_ID', 'Household id must be a UUID.')

  const householdResult = await db.query(
    `
      select
        h.id, h.name, h.status,
        h.primary_owner_user_id as "primaryOwnerUserId",
        owner.email as "ownerEmail",
        h.suspended_at as "suspendedAt",
        h.created_at as "createdAt",
        h.updated_at as "updatedAt"
      from households h
      left join app_users owner on owner.id = h.primary_owner_user_id
      where h.id = $1
      limit 1
    `,
    [normalizedHouseholdId],
  )
  const household = householdResult.rows[0]
  if (!household) {
    throw createHttpError(404, 'HOUSEHOLD_NOT_FOUND', 'Household was not found.', true)
  }

  const [members, entitlement, recentAudit] = await Promise.all([
    db.query(
      `
        select hm.id as "membershipId", hm.role, hm.status, hm.email,
               u.display_name as "displayName", hm.accepted_at as "acceptedAt"
        from household_members hm
        join app_users u on u.id = hm.user_id
        where hm.household_id = $1
        order by hm.created_at
      `,
      [normalizedHouseholdId],
    ),
    db.query(
      `
        select plan_tier as "planTier", plan_status as "planStatus",
               billing_source as "billingSource", trial_ends_at as "trialEndsAt",
               usage_limits as "usageLimits", feature_flags as "featureFlags",
               updated_at as "updatedAt"
        from household_entitlements
        where household_id = $1
      `,
      [normalizedHouseholdId],
    ),
    db.query(
      `
        select action, actor_user_id as "actorUserId", created_at as "createdAt"
        from admin_audit_logs
        where household_id = $1
        order by created_at desc
        limit 20
      `,
      [normalizedHouseholdId],
    ),
  ])

  return {
    adminRole: admin.role,
    household,
    members: members.rows,
    entitlement: entitlement.rows[0] ?? null,
    recentAudit: recentAudit.rows,
  }
}

// ---------------------------------------------------------------------------
// Entitlement write surface (comps / tier changes) — super admin only
// ---------------------------------------------------------------------------

export async function updateHouseholdEntitlementForAdmin(clerkUserId, householdId, payload) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, SUPER_ONLY)
  const normalizedHouseholdId = normalizeUuid(householdId, 'INVALID_HOUSEHOLD_ID', 'Household id must be a UUID.')

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const planTier = typeof payload.planTier === 'string' ? payload.planTier.trim() : null
  const planStatus = typeof payload.planStatus === 'string' ? payload.planStatus.trim() : null

  if (!planTier && !planStatus && payload.usageLimits === undefined && payload.featureFlags === undefined) {
    throw createHttpError(400, 'NO_ENTITLEMENT_UPDATES', 'Provide planTier, planStatus, usageLimits, or featureFlags.', true)
  }

  if (planTier) {
    const tierExists = await db.query(`select 1 from plan_definitions where code = $1::plan_tier and is_active = true`, [planTier])
      .catch(() => ({ rows: [] }))
    if (tierExists.rows.length === 0) {
      throw createHttpError(400, 'INVALID_PLAN_TIER', 'planTier must be an active plan code.', true)
    }
  }
  if (planStatus && !PLAN_STATUSES.includes(planStatus)) {
    throw createHttpError(400, 'INVALID_PLAN_STATUS', `planStatus must be one of: ${PLAN_STATUSES.join(', ')}.`, true)
  }
  const billingSource = payload.billingSource === undefined ? undefined : payload.billingSource
  if (billingSource !== undefined && billingSource !== null && !BILLING_SOURCES.includes(billingSource)) {
    throw createHttpError(400, 'INVALID_BILLING_SOURCE', `billingSource must be one of: ${BILLING_SOURCES.join(', ')}.`, true)
  }
  for (const key of ['usageLimits', 'featureFlags']) {
    if (payload[key] !== undefined && (typeof payload[key] !== 'object' || Array.isArray(payload[key]) || payload[key] === null)) {
      throw createHttpError(400, 'INVALID_JSON_OBJECT', `${key} must be a JSON object.`, true)
    }
  }

  const householdExists = await db.query(`select 1 from households where id = $1`, [normalizedHouseholdId])
  if (householdExists.rows.length === 0) {
    throw createHttpError(404, 'HOUSEHOLD_NOT_FOUND', 'Household was not found.', true)
  }

  const client = await db.connect()
  try {
    await client.query('begin')

    const beforeResult = await client.query(
      `select plan_tier as "planTier", plan_status as "planStatus",
              usage_limits as "usageLimits", feature_flags as "featureFlags"
       from household_entitlements where household_id = $1 for update`,
      [normalizedHouseholdId],
    )
    const before = beforeResult.rows[0] ?? null

    const updated = await client.query(
      `
        insert into household_entitlements (household_id, plan_tier, plan_status, billing_source, usage_limits, feature_flags, updated_by)
        values (
          $1,
          coalesce($2::plan_tier, 'free'),
          coalesce($3::plan_status, 'active'),
          $4,
          coalesce($5::jsonb, '{}'::jsonb),
          coalesce($6::jsonb, '{}'::jsonb),
          $7
        )
        on conflict (household_id) do update set
          plan_tier = coalesce($2::plan_tier, household_entitlements.plan_tier),
          plan_status = coalesce($3::plan_status, household_entitlements.plan_status),
          billing_source = case when $8 then $4 else household_entitlements.billing_source end,
          usage_limits = coalesce($5::jsonb, household_entitlements.usage_limits),
          feature_flags = coalesce($6::jsonb, household_entitlements.feature_flags),
          updated_by = $7,
          updated_at = now()
        returning
          household_id as "householdId",
          plan_tier as "planTier",
          plan_status as "planStatus",
          billing_source as "billingSource",
          usage_limits as "usageLimits",
          feature_flags as "featureFlags",
          updated_at as "updatedAt"
      `,
      [
        normalizedHouseholdId,
        planTier,
        planStatus,
        billingSource === undefined ? null : billingSource,
        payload.usageLimits === undefined ? null : JSON.stringify(payload.usageLimits),
        payload.featureFlags === undefined ? null : JSON.stringify(payload.featureFlags),
        user.id,
        billingSource !== undefined,
      ],
    )

    await writeAuditLog(client, {
      action: 'admin.entitlement_updated',
      entityType: 'household_entitlement',
      entityId: normalizedHouseholdId,
      actorUserId: user.id,
      actorAdminRole: admin.role,
      householdId: normalizedHouseholdId,
      before,
      after: {
        planTier: updated.rows[0].planTier,
        planStatus: updated.rows[0].planStatus,
      },
      reason: typeof payload.reason === 'string' ? payload.reason : null,
    })

    await client.query('commit')
    return { adminRole: admin.role, entitlement: updated.rows[0] }
  } catch (err) {
    try { await client.query('rollback') } catch { /* keep original error */ }
    throw err
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------
// Household suspend / reinstate — super or support admin
// ---------------------------------------------------------------------------

async function setHouseholdStatus(clerkUserId, householdId, { suspend, reason }) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, SUPPORT_ADMINS)
  const normalizedHouseholdId = normalizeUuid(householdId, 'INVALID_HOUSEHOLD_ID', 'Household id must be a UUID.')

  const result = await db.query(
    suspend
      ? `update households
         set status = 'suspended', suspended_at = now(), suspended_by = $2, updated_at = now()
         where id = $1 and status = 'active'
         returning id, name, status, suspended_at as "suspendedAt"`
      : `update households
         set status = 'active', suspended_at = null, suspended_by = null, updated_at = now()
         where id = $1 and status = 'suspended'
         returning id, name, status, suspended_at as "suspendedAt"`,
    [normalizedHouseholdId, ...(suspend ? [user.id] : [])],
  )

  if (result.rows.length === 0) {
    throw createHttpError(
      409,
      suspend ? 'HOUSEHOLD_NOT_ACTIVE' : 'HOUSEHOLD_NOT_SUSPENDED',
      suspend ? 'Only active households can be suspended.' : 'Only suspended households can be reinstated.',
      true,
    )
  }

  await writeAuditLog(db, {
    action: suspend ? 'admin.household_suspended' : 'admin.household_reinstated',
    entityType: 'household',
    entityId: normalizedHouseholdId,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    householdId: normalizedHouseholdId,
    reason: reason ?? null,
  })

  return { adminRole: admin.role, household: result.rows[0] }
}

export async function suspendHouseholdForAdmin(clerkUserId, householdId, payload = {}) {
  return setHouseholdStatus(clerkUserId, householdId, {
    suspend: true,
    reason: typeof payload?.reason === 'string' ? payload.reason : null,
  })
}

export async function reinstateHouseholdForAdmin(clerkUserId, householdId, payload = {}) {
  return setHouseholdStatus(clerkUserId, householdId, {
    suspend: false,
    reason: typeof payload?.reason === 'string' ? payload.reason : null,
  })
}

// ---------------------------------------------------------------------------
// Committee roster governance — super or clinical admin
// ---------------------------------------------------------------------------

function rosterProjection(alias = '') {
  const p = alias ? `${alias}.` : ''
  return `
    ${p}id,
    ${p}role_key as "roleKey",
    ${p}display_name as "displayName",
    ${p}kind,
    ${p}provider,
    ${p}model,
    ${p}system_prompt as "systemPrompt",
    ${p}active,
    ${p}position,
    ${p}updated_at as "updatedAt"
  `
}

export async function getRosterForAdmin(clerkUserId) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, ANY_ADMIN)
  const result = await db.query(
    `
      select
        ${rosterProjection('c')},
        k.last4 as "keyLast4",
        k.updated_at as "keyUpdatedAt"
      from llm_provider_configs c
      left join platform_provider_keys k
        on k.scope = 'roster_member' and k.roster_member_id = c.id
      order by c.kind desc, c.position
    `,
  )
  const roster = result.rows.map(rowToRosterEntry)
  return { adminRole: admin.role, roster }
}

/**
 * Reshape a roster row (with optional joined per-specialist key columns) into
 * the roster entry contract. The per-specialist key is surfaced only as an
 * { isSet, maskedKey, updatedAt } summary — never the raw key.
 */
function rowToRosterEntry(row) {
  const { keyLast4, keyUpdatedAt, ...entry } = row
  entry.key = {
    isSet: keyLast4 !== undefined && keyLast4 !== null ? true : Boolean(keyUpdatedAt),
    maskedKey: keyUpdatedAt ? maskFromLast4(keyLast4) : null,
    updatedAt: keyUpdatedAt ?? null,
  }
  return entry
}

async function readRosterEntryById(db, id) {
  const result = await db.query(
    `
      select
        ${rosterProjection('c')},
        k.last4 as "keyLast4",
        k.updated_at as "keyUpdatedAt"
      from llm_provider_configs c
      left join platform_provider_keys k
        on k.scope = 'roster_member' and k.roster_member_id = c.id
      where c.id = $1
      limit 1
    `,
    [id],
  )
  return result.rows[0] ? rowToRosterEntry(result.rows[0]) : null
}

export async function updateRosterEntryForAdmin(clerkUserId, roleKey, payload) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, CLINICAL_ADMINS)

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const updates = {}
  if (payload.provider !== undefined) {
    if (!ROSTER_PROVIDERS.includes(payload.provider)) {
      throw createHttpError(400, 'INVALID_PROVIDER', `provider must be one of: ${ROSTER_PROVIDERS.join(', ')}.`, true)
    }
    updates.provider = payload.provider
  }
  if (payload.model !== undefined) {
    if (typeof payload.model !== 'string' || !payload.model.trim()) {
      throw createHttpError(400, 'INVALID_MODEL', 'model must be a non-empty string.', true)
    }
    updates.model = payload.model.trim()
  }
  if (payload.active !== undefined) {
    if (typeof payload.active !== 'boolean') {
      throw createHttpError(400, 'INVALID_BOOLEAN', 'active must be a boolean.', true)
    }
    updates.active = payload.active
  }
  if (payload.systemPrompt !== undefined) {
    updates.system_prompt = payload.systemPrompt === null ? null : String(payload.systemPrompt)
  }
  if (payload.displayName !== undefined) {
    if (typeof payload.displayName !== 'string' || !payload.displayName.trim()) {
      throw createHttpError(400, 'INVALID_DISPLAY_NAME', 'displayName must be a non-empty string.', true)
    }
    updates.display_name = payload.displayName.trim()
  }
  if (payload.position !== undefined) {
    if (!Number.isInteger(payload.position)) {
      throw createHttpError(400, 'INVALID_POSITION', 'position must be an integer.', true)
    }
    updates.position = payload.position
  }

  if (Object.keys(updates).length === 0) {
    throw createHttpError(400, 'NO_ROSTER_UPDATES', 'Provide at least one roster field to update.', true)
  }

  const beforeResult = await db.query(
    `select ${rosterProjection()} from llm_provider_configs where role_key = $1 limit 1`,
    [roleKey],
  )
  const before = beforeResult.rows[0]
  if (!before) {
    throw createHttpError(404, 'ROSTER_ENTRY_NOT_FOUND', 'Roster entry was not found.', true)
  }

  const values = [roleKey]
  const setClauses = []
  for (const [column, value] of Object.entries(updates)) {
    values.push(value)
    setClauses.push(`${column} = $${values.length}`)
  }

  const result = await db.query(
    `
      update llm_provider_configs
      set ${setClauses.join(', ')}, updated_at = now()
      where role_key = $1
      returning ${rosterProjection()}
    `,
    values,
  )

  await writeAuditLog(db, {
    action: 'admin.roster_updated',
    entityType: 'llm_provider_config',
    entityId: before.id,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    before: { provider: before.provider, model: before.model, active: before.active },
    after: {
      provider: result.rows[0].provider,
      model: result.rows[0].model,
      active: result.rows[0].active,
    },
    extra: { roleKey, systemPromptChanged: payload.systemPrompt !== undefined },
  })

  const entry = await readRosterEntryById(db, before.id)
  return { adminRole: admin.role, entry }
}

// ---------------------------------------------------------------------------
// Roster CRUD — create / delete a specialist, set a per-specialist key.
// Governance matches the existing roster PATCH: super or clinical admin.
// The new key + delete endpoints are keyed by the roster row UUID (:id),
// matching the platform_provider_keys.roster_member_id FK.
// ---------------------------------------------------------------------------

const ROSTER_KINDS = ['specialist', 'chairman']

function normalizeRosterId(value) {
  return normalizeUuid(value, 'INVALID_ROSTER_ID', 'Roster id must be a UUID.')
}

function normalizeRoleKey(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw createHttpError(400, 'INVALID_ROLE_KEY', 'roleKey must be a non-empty string.', true)
  }
  const normalized = value.trim().toLowerCase()
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    throw createHttpError(400, 'INVALID_ROLE_KEY', 'roleKey may contain only lowercase letters, digits, and underscores.', true)
  }
  return normalized
}

export async function createRosterEntryForAdmin(clerkUserId, payload) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, CLINICAL_ADMINS)

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const roleKey = normalizeRoleKey(payload.roleKey)

  if (typeof payload.displayName !== 'string' || !payload.displayName.trim()) {
    throw createHttpError(400, 'INVALID_DISPLAY_NAME', 'displayName must be a non-empty string.', true)
  }
  const displayName = payload.displayName.trim()

  const kind = payload.kind === undefined ? 'specialist' : payload.kind
  if (!ROSTER_KINDS.includes(kind)) {
    throw createHttpError(400, 'INVALID_KIND', `kind must be one of: ${ROSTER_KINDS.join(', ')}.`, true)
  }

  const provider = payload.provider === undefined ? 'groq' : payload.provider
  if (!ROSTER_PROVIDERS.includes(provider)) {
    throw createHttpError(400, 'INVALID_PROVIDER', `provider must be one of: ${ROSTER_PROVIDERS.join(', ')}.`, true)
  }

  if (typeof payload.model !== 'string' || !payload.model.trim()) {
    throw createHttpError(400, 'INVALID_MODEL', 'model must be a non-empty string.', true)
  }
  const model = payload.model.trim()

  const systemPrompt = payload.systemPrompt === undefined || payload.systemPrompt === null
    ? null
    : String(payload.systemPrompt)

  let position = payload.position
  if (position !== undefined && !Number.isInteger(position)) {
    throw createHttpError(400, 'INVALID_POSITION', 'position must be an integer.', true)
  }
  if (position === undefined) {
    const maxResult = await db.query(
      `select coalesce(max(position), -1) + 1 as "next" from llm_provider_configs`,
    )
    position = maxResult.rows[0].next
  }

  let inserted
  try {
    const result = await db.query(
      `
        insert into llm_provider_configs
          (role_key, display_name, kind, provider, model, system_prompt, position)
        values ($1, $2, $3, $4, $5, $6, $7)
        returning id
      `,
      [roleKey, displayName, kind, provider, model, systemPrompt, position],
    )
    inserted = result.rows[0]
  } catch (err) {
    if (err && err.code === '23505') {
      throw createHttpError(409, 'ROSTER_ROLE_KEY_TAKEN', `A roster entry with roleKey "${roleKey}" already exists.`, true)
    }
    throw err
  }

  await writeAuditLog(db, {
    action: 'admin.roster_created',
    entityType: 'llm_provider_config',
    entityId: inserted.id,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    after: { roleKey, displayName, kind, provider, model },
  })

  const entry = await readRosterEntryById(db, inserted.id)
  return { adminRole: admin.role, entry }
}

export async function deleteRosterEntryForAdmin(clerkUserId, id) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, CLINICAL_ADMINS)
  const rosterId = normalizeRosterId(id)

  // Deleting the row cascades to platform_provider_keys (roster_member_id FK
  // ON DELETE CASCADE), removing any per-specialist key with it.
  const result = await db.query(
    `delete from llm_provider_configs where id = $1
     returning id, role_key as "roleKey", display_name as "displayName", kind`,
    [rosterId],
  )
  const removed = result.rows[0]
  if (!removed) {
    throw createHttpError(404, 'ROSTER_ENTRY_NOT_FOUND', 'Roster entry was not found.', true)
  }

  await writeAuditLog(db, {
    action: 'admin.roster_deleted',
    entityType: 'llm_provider_config',
    entityId: rosterId,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    before: { roleKey: removed.roleKey, displayName: removed.displayName, kind: removed.kind },
  })

  return { adminRole: admin.role, deletedId: rosterId }
}

export async function setRosterEntryKeyForAdmin(clerkUserId, id, payload) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, CLINICAL_ADMINS)
  const rosterId = normalizeRosterId(id)

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const memberResult = await db.query(
    `select id, provider, role_key as "roleKey" from llm_provider_configs where id = $1 limit 1`,
    [rosterId],
  )
  const member = memberResult.rows[0]
  if (!member) {
    throw createHttpError(404, 'ROSTER_ENTRY_NOT_FOUND', 'Roster entry was not found.', true)
  }

  const key = await upsertRosterMemberKey(db, {
    rosterMemberId: member.id,
    provider: member.provider,
    apiKey: payload.apiKey,
    updatedByUserId: user.id,
  })

  await writeAuditLog(db, {
    action: 'admin.roster_member_key_set',
    entityType: 'platform_provider_key',
    entityId: key.id,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    after: { rosterMemberId: member.id, roleKey: member.roleKey, maskedKey: key.maskedKey },
  })

  const entry = await readRosterEntryById(db, member.id)
  return { adminRole: admin.role, entry }
}

// ---------------------------------------------------------------------------
// Proxy observability + platform audit view
// ---------------------------------------------------------------------------

export async function listProxyLogsForAdmin(clerkUserId, query = {}) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, ANY_ADMIN)
  const limit = normalizeLimit(query.limit)

  const [logs, summary] = await Promise.all([
    db.query(
      `
        select
          id, brain_run_id as "brainRunId", provider, model, purpose, status,
          http_status as "httpStatus", input_tokens as "inputTokens",
          output_tokens as "outputTokens", latency_ms as "latencyMs",
          error_message as "errorMessage", created_at as "createdAt"
        from llm_proxy_logs
        order by created_at desc
        limit $1
      `,
      [limit],
    ),
    db.query(`
      select
        provider,
        count(*)::int as "calls",
        count(*) filter (where status = 'error')::int as "errors",
        coalesce(sum(input_tokens), 0)::bigint as "inputTokens",
        coalesce(sum(output_tokens), 0)::bigint as "outputTokens",
        round(avg(latency_ms))::int as "avgLatencyMs"
      from llm_proxy_logs
      where created_at > now() - interval '30 days'
      group by provider
      order by count(*) desc
    `),
  ])

  return { adminRole: admin.role, summary30d: summary.rows, logs: logs.rows }
}

export async function listPlatformAuditLogForAdmin(clerkUserId, query = {}) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, ANY_ADMIN)
  const limit = normalizeLimit(query.limit)
  const action = normalizeSearch(query.action)
  const householdId = query.householdId
    ? normalizeUuid(query.householdId, 'INVALID_HOUSEHOLD_ID', 'householdId must be a UUID.')
    : null

  const result = await db.query(
    `
      select
        al.id, al.action, al.entity_type as "entityType", al.entity_id as "entityId",
        al.actor_user_id as "actorUserId", al.actor_admin_role as "actorAdminRole",
        actor.email as "actorEmail",
        al.household_id as "householdId",
        al.target_user_id as "targetUserId",
        al.metadata, al.ip_address as "ipAddress", al.created_at as "createdAt"
      from admin_audit_logs al
      left join app_users actor on actor.id = al.actor_user_id
      where ($1::text is null or al.action = $1)
        and ($2::uuid is null or al.household_id = $2)
      order by al.created_at desc
      limit $3
    `,
    [action, householdId, limit],
  )

  return { adminRole: admin.role, entries: result.rows }
}

// ---------------------------------------------------------------------------
// Privacy requests (export / delete workflows)
// ---------------------------------------------------------------------------

function privacyProjection() {
  return `
    id,
    request_type as "requestType",
    status,
    household_id as "householdId",
    target_user_id as "targetUserId",
    requested_by as "requestedBy",
    approved_by as "approvedBy",
    processed_by as "processedBy",
    reason,
    result_metadata as "resultMetadata",
    requested_at as "requestedAt",
    approved_at as "approvedAt",
    processed_at as "processedAt",
    completed_at as "completedAt",
    failed_at as "failedAt",
    updated_at as "updatedAt"
  `
}

export async function listPrivacyRequestsForAdmin(clerkUserId, query = {}) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, ANY_ADMIN)
  const limit = normalizeLimit(query.limit)
  const status = normalizeSearch(query.status)
  if (status && !PRIVACY_STATUSES.includes(status)) {
    throw createHttpError(400, 'INVALID_STATUS', `status must be one of: ${PRIVACY_STATUSES.join(', ')}.`, true)
  }

  const result = await db.query(
    `
      select ${privacyProjection()}
      from privacy_requests
      where ($1::text is null or status = $1::workflow_status)
      order by requested_at desc
      limit $2
    `,
    [status, limit],
  )

  return { adminRole: admin.role, requests: result.rows }
}

export async function createPrivacyRequestForAdmin(clerkUserId, payload) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, SUPPORT_ADMINS)

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
  if (!PRIVACY_REQUEST_TYPES.includes(payload.requestType)) {
    throw createHttpError(400, 'INVALID_REQUEST_TYPE', `requestType must be one of: ${PRIVACY_REQUEST_TYPES.join(', ')}.`, true)
  }

  const householdId = payload.householdId
    ? normalizeUuid(payload.householdId, 'INVALID_HOUSEHOLD_ID', 'householdId must be a UUID.')
    : null
  const targetUserId = payload.targetUserId
    ? normalizeUuid(payload.targetUserId, 'INVALID_TARGET_USER_ID', 'targetUserId must be a UUID.')
    : null

  if (!householdId && !targetUserId) {
    throw createHttpError(400, 'PRIVACY_TARGET_REQUIRED', 'Provide householdId and/or targetUserId.', true)
  }

  const result = await db.query(
    `
      insert into privacy_requests (request_type, household_id, target_user_id, requested_by, reason)
      values ($1, $2, $3, $4, $5)
      returning ${privacyProjection()}
    `,
    [payload.requestType, householdId, targetUserId, user.id, payload.reason ?? null],
  )

  await writeAuditLog(db, {
    action: 'admin.privacy_request_created',
    entityType: 'privacy_request',
    entityId: result.rows[0].id,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    householdId,
    targetUserId,
    after: { requestType: payload.requestType },
    reason: payload.reason ?? null,
  })

  return { adminRole: admin.role, request: result.rows[0] }
}

const PRIVACY_STATUS_STAMPS = {
  approved: 'approved_at = now(), approved_by = $3',
  processing: 'processed_at = now(), processed_by = $3',
  completed: 'completed_at = now(), processed_by = coalesce(processed_by, $3)',
  failed: 'failed_at = now(), processed_by = coalesce(processed_by, $3)',
  rejected: 'approved_by = coalesce(approved_by, $3)',
  canceled: 'approved_by = coalesce(approved_by, $3)',
}

export async function updatePrivacyRequestForAdmin(clerkUserId, requestId, payload) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, SUPER_ONLY)
  const normalizedRequestId = normalizeUuid(requestId, 'INVALID_REQUEST_ID', 'Request id must be a UUID.')

  const status = payload?.status
  if (!PRIVACY_STATUSES.includes(status) || status === 'requested') {
    throw createHttpError(
      400,
      'INVALID_STATUS',
      `status must be one of: ${PRIVACY_STATUSES.filter((s) => s !== 'requested').join(', ')}.`,
      true,
    )
  }

  const existing = await db.query(
    `select status from privacy_requests where id = $1 limit 1`,
    [normalizedRequestId],
  )
  if (existing.rows.length === 0) {
    throw createHttpError(404, 'PRIVACY_REQUEST_NOT_FOUND', 'Privacy request was not found.', true)
  }
  if (PRIVACY_TERMINAL.has(existing.rows[0].status)) {
    throw createHttpError(409, 'PRIVACY_REQUEST_FINALIZED', 'This privacy request is already finalized.', true)
  }

  const result = await db.query(
    `
      update privacy_requests
      set status = $2::workflow_status, ${PRIVACY_STATUS_STAMPS[status]}, updated_at = now()
      where id = $1
      returning ${privacyProjection()}
    `,
    [normalizedRequestId, status, user.id],
  )

  await writeAuditLog(db, {
    action: 'admin.privacy_request_updated',
    entityType: 'privacy_request',
    entityId: normalizedRequestId,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    householdId: result.rows[0].householdId,
    targetUserId: result.rows[0].targetUserId,
    before: { status: existing.rows[0].status },
    after: { status },
    reason: typeof payload?.reason === 'string' ? payload.reason : null,
  })

  return { adminRole: admin.role, request: result.rows[0] }
}

// ---------------------------------------------------------------------------
// Admin management — super admin only
// ---------------------------------------------------------------------------

export async function listAdminsForAdmin(clerkUserId) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, SUPER_ONLY)
  const result = await db.query(`
    select
      ia.id, ia.role, ia.status,
      ia.user_id as "userId",
      u.email, u.display_name as "displayName",
      ia.created_at as "createdAt"
    from internal_admin_users ia
    join app_users u on u.id = ia.user_id
    order by ia.created_at
  `)
  return { adminRole: admin.role, admins: result.rows }
}

export async function createAdminForAdmin(clerkUserId, payload) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, SUPER_ONLY)

  const email = typeof payload?.email === 'string' ? payload.email.trim().toLowerCase() : ''
  const role = payload?.role
  if (!email) {
    throw createHttpError(400, 'INVALID_EMAIL', 'email is required.', true)
  }
  if (!ADMIN_ROLES.includes(role)) {
    throw createHttpError(400, 'INVALID_ADMIN_ROLE', `role must be one of: ${ADMIN_ROLES.join(', ')}.`, true)
  }

  const target = await db.query(`select id, email from app_users where email = $1::citext limit 1`, [email])
  if (target.rows.length === 0) {
    throw createHttpError(404, 'USER_NOT_FOUND', 'No account exists with that email. The user must sign in once first.', true)
  }

  let inserted
  try {
    inserted = await db.query(
      `
        insert into internal_admin_users (user_id, role, created_by)
        values ($1, $2, $3)
        returning id, user_id as "userId", role, status, created_at as "createdAt"
      `,
      [target.rows[0].id, role, user.id],
    )
  } catch (err) {
    if (err.code === '23505') {
      throw createHttpError(409, 'ADMIN_ALREADY_EXISTS', 'This user is already an internal admin.', true)
    }
    throw err
  }

  await writeAuditLog(db, {
    action: 'admin.admin_created',
    entityType: 'internal_admin_user',
    entityId: inserted.rows[0].id,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    targetUserId: target.rows[0].id,
    after: { role },
  })

  return { adminRole: admin.role, admin: { ...inserted.rows[0], email: target.rows[0].email } }
}

export async function updateAdminForAdmin(clerkUserId, adminId, payload) {
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, SUPER_ONLY)
  const normalizedAdminId = normalizeUuid(adminId, 'INVALID_ADMIN_ID', 'Admin id must be a UUID.')

  const role = payload?.role
  const status = payload?.status
  if (role === undefined && status === undefined) {
    throw createHttpError(400, 'NO_ADMIN_UPDATES', 'Provide role and/or status.', true)
  }
  if (role !== undefined && !ADMIN_ROLES.includes(role)) {
    throw createHttpError(400, 'INVALID_ADMIN_ROLE', `role must be one of: ${ADMIN_ROLES.join(', ')}.`, true)
  }
  if (status !== undefined && !['active', 'suspended'].includes(status)) {
    throw createHttpError(400, 'INVALID_ADMIN_STATUS', 'status must be active or suspended.', true)
  }

  const existing = await db.query(
    `select id, user_id as "userId", role, status from internal_admin_users where id = $1 limit 1`,
    [normalizedAdminId],
  )
  if (existing.rows.length === 0) {
    throw createHttpError(404, 'ADMIN_NOT_FOUND', 'Internal admin was not found.', true)
  }
  if (existing.rows[0].userId === user.id) {
    throw createHttpError(409, 'CANNOT_MODIFY_SELF', 'You cannot change your own admin access.', true)
  }

  const result = await db.query(
    `
      update internal_admin_users
      set
        role = coalesce($2, role),
        status = coalesce($3, status),
        suspended_at = case when $3 = 'suspended' then now() when $3 = 'active' then null else suspended_at end,
        suspended_by = case when $3 = 'suspended' then $4 when $3 = 'active' then null else suspended_by end,
        updated_at = now()
      where id = $1
      returning id, user_id as "userId", role, status, updated_at as "updatedAt"
    `,
    [normalizedAdminId, role ?? null, status ?? null, user.id],
  )

  await writeAuditLog(db, {
    action: 'admin.admin_updated',
    entityType: 'internal_admin_user',
    entityId: normalizedAdminId,
    actorUserId: user.id,
    actorAdminRole: admin.role,
    targetUserId: existing.rows[0].userId,
    before: { role: existing.rows[0].role, status: existing.rows[0].status },
    after: { role: result.rows[0].role, status: result.rows[0].status },
  })

  return { adminRole: admin.role, admin: result.rows[0] }
}
