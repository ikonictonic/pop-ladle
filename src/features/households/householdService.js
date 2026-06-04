import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'

const DEFAULT_HOUSEHOLD_NAME = 'Pop & Ladle Household'
const MAX_HOUSEHOLD_NAME_LENGTH = 120

function createHttpError(statusCode, code, message, expose = true) {
  const err = new Error(message)
  err.statusCode = statusCode
  err.code = code
  err.expose = expose
  return err
}

function normalizeHouseholdName(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_HOUSEHOLD_NAME
  }

  if (typeof value !== 'string') {
    throw createHttpError(400, 'INVALID_HOUSEHOLD_NAME', 'Household name must be text.', true)
  }

  const name = value.trim()

  if (!name) {
    throw createHttpError(400, 'INVALID_HOUSEHOLD_NAME', 'Household name cannot be blank.', true)
  }

  if (name.length > MAX_HOUSEHOLD_NAME_LENGTH) {
    throw createHttpError(
      400,
      'INVALID_HOUSEHOLD_NAME',
      `Household name must be ${MAX_HOUSEHOLD_NAME_LENGTH} characters or fewer.`,
      true,
    )
  }

  return name
}

function normalizeCreateHouseholdPayload(payload) {
  if (payload === undefined || payload === null) {
    return {
      name: DEFAULT_HOUSEHOLD_NAME,
    }
  }

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  return {
    name: normalizeHouseholdName(payload.name),
  }
}

async function createHousehold(client, owner, name) {
  const result = await client.query(
    `
      insert into households (
        name,
        primary_owner_user_id,
        billing_owner_user_id,
        created_by
      )
      values ($1, $2, $2, $2)
      returning
        id,
        name,
        primary_owner_user_id as "primaryOwnerUserId",
        billing_owner_user_id as "billingOwnerUserId",
        status,
        created_by as "createdBy",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [name, owner.id],
  )

  return result.rows[0]
}

async function lockOwnerProvisioning(client, owner) {
  await client.query('select pg_advisory_xact_lock(827120402, hashtext($1))', [owner.id])
}

async function findFirstOwnedHouseholdId(client, owner) {
  const result = await client.query(
    `
      select hm.household_id as "householdId"
      from household_members hm
      join households h on h.id = hm.household_id
      where hm.user_id = $1
        and hm.role = 'owner'
        and hm.status = 'accepted'
        and h.status = 'active'
      order by hm.created_at asc
      limit 1
    `,
    [owner.id],
  )

  return result.rows[0]?.householdId ?? null
}

async function createOwnerMembership(client, household, owner) {
  const result = await client.query(
    `
      insert into household_members (
        household_id,
        user_id,
        email,
        role,
        status,
        accepted_at
      )
      values ($1, $2, $3, 'owner', 'accepted', now())
      returning
        id as "membershipId",
        household_id as "householdId",
        user_id as "userId",
        email,
        role,
        status,
        accepted_at as "acceptedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [household.id, owner.id, owner.email],
  )

  return result.rows[0]
}

async function readHousehold(client, householdId) {
  const result = await client.query(
    `
      select
        id,
        name,
        primary_owner_user_id as "primaryOwnerUserId",
        billing_owner_user_id as "billingOwnerUserId",
        status,
        created_by as "createdBy",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from households
      where id = $1
    `,
    [householdId],
  )

  return result.rows[0] ?? null
}

async function readOwnerMembership(client, householdId, owner) {
  const result = await client.query(
    `
      select
        id as "membershipId",
        household_id as "householdId",
        user_id as "userId",
        email,
        role,
        status,
        accepted_at as "acceptedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from household_members
      where household_id = $1
        and user_id = $2
        and role = 'owner'
        and status = 'accepted'
      limit 1
    `,
    [householdId, owner.id],
  )

  return result.rows[0] ?? null
}

async function readEntitlement(client, householdId) {
  const result = await client.query(
    `
      select
        household_id as "householdId",
        plan_tier as "planTier",
        plan_status as "planStatus",
        billing_source as "billingSource",
        usage_limits as "usageLimits",
        feature_flags as "featureFlags",
        created_at as "createdAt",
        updated_at as "updatedAt"
      from household_entitlements
      where household_id = $1
    `,
    [householdId],
  )

  return result.rows[0] ?? null
}

async function ensureHouseholdEntitlement(client, household, owner) {
  await client.query(
    `
      insert into household_entitlements (
        household_id,
        plan_tier,
        plan_status,
        updated_by
      )
      values ($1, 'free', 'active', $2)
      on conflict (household_id) do nothing
    `,
    [household.id, owner.id],
  )

  return readEntitlement(client, household.id)
}

async function readHouseholdBundle(client, householdId, owner, created) {
  const household = await readHousehold(client, householdId)

  if (!household) {
    throw createHttpError(404, 'HOUSEHOLD_NOT_FOUND', 'Household was not found.', true)
  }

  const membership = await readOwnerMembership(client, householdId, owner)

  if (!membership) {
    throw createHttpError(404, 'HOUSEHOLD_MEMBERSHIP_NOT_FOUND', 'Owner membership was not found.', true)
  }

  const entitlement = await ensureHouseholdEntitlement(client, household, owner)

  return {
    created,
    household,
    membership,
    entitlement,
  }
}

export async function createHouseholdForCurrentUser(clerkUserId, payload = {}) {
  const owner = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const { name } = normalizeCreateHouseholdPayload(payload)
  const client = await db.connect()

  try {
    await client.query('begin')
    await lockOwnerProvisioning(client, owner)

    const existingHouseholdId = await findFirstOwnedHouseholdId(client, owner)

    if (existingHouseholdId) {
      const existing = await readHouseholdBundle(client, existingHouseholdId, owner, false)
      await client.query('commit')
      return existing
    }

    const household = await createHousehold(client, owner, name)
    const membership = await createOwnerMembership(client, household, owner)
    const entitlement = await ensureHouseholdEntitlement(client, household, owner)

    await client.query('commit')

    return {
      created: true,
      household,
      membership,
      entitlement,
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
