import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'
import { normalizeUuid, requireHouseholdRole, requireHouseholdCapability } from './householdAccess.js'
import {
  dispatchTransferInitiatedEmail,
  dispatchTransferAcceptedEmail,
} from './transferNotifications.js'

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

    await writeAuditLog(client, {
      action: 'household.created',
      entityType: 'household',
      entityId: household.id,
      actorUserId: owner.id,
      householdId: household.id,
      after: { name: household.name, planTier: entitlement?.planTier ?? 'free' },
    })

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

// ---------------------------------------------------------------------------
// Household lifecycle: get / rename / ownership transfer (two-step, audited)
// ---------------------------------------------------------------------------

const HOUSEHOLD_VIEW_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']
const HOUSEHOLD_MANAGE_ROLES = ['owner', 'co_owner']

function transferProjection(alias = 'hot') {
  return `
    ${alias}.id,
    ${alias}.household_id as "householdId",
    ${alias}.from_user_id as "fromUserId",
    ${alias}.to_user_id as "toUserId",
    ${alias}.status,
    ${alias}.expires_at as "expiresAt",
    ${alias}.accepted_at as "acceptedAt",
    ${alias}.canceled_at as "canceledAt",
    ${alias}.created_at as "createdAt"
  `
}

async function readPendingTransfer(queryable, householdId) {
  const result = await queryable.query(
    `
      select
        ${transferProjection('hot')},
        target.email as "toUserEmail",
        target.display_name as "toUserDisplayName"
      from household_ownership_transfers hot
      join app_users target on target.id = hot.to_user_id
      where hot.household_id = $1 and hot.status = 'pending'
      limit 1
    `,
    [householdId],
  )
  return result.rows[0] ?? null
}

export async function getHouseholdForCurrentUser(clerkUserId, householdId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', { resourceType: 'household' })
  const household = await readHousehold(db, access.household.id)
  const entitlement = await readEntitlement(db, access.household.id)

  const counts = await db.query(
    `
      select
        (select count(*)::int from household_members
          where household_id = $1 and status = 'accepted') as "members",
        (select count(*)::int from care_recipients
          where household_id = $1 and status = 'active') as "careRecipients"
    `,
    [access.household.id],
  )

  const pendingTransfer = await readPendingTransfer(db, access.household.id)
  const canSeeTransfer = HOUSEHOLD_MANAGE_ROLES.includes(access.membership.role)
    || pendingTransfer?.toUserId === user.id

  return {
    household,
    requester: access.membership,
    entitlement,
    counts: counts.rows[0],
    pendingTransfer: canSeeTransfer ? pendingTransfer : null,
  }
}

export async function renameHouseholdForCurrentUser(clerkUserId, householdId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.name === undefined) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Provide a household name to update.', true)
  }
  const name = normalizeHouseholdName(payload.name)

  const access = await requireHouseholdRole(db, user.id, householdId, HOUSEHOLD_MANAGE_ROLES, {
    action: 'household:settings',
    resourceType: 'household',
    label: 'household:rename',
  })
  const before = await readHousehold(db, access.household.id)

  const result = await db.query(
    `
      update households
      set name = $2, updated_at = now()
      where id = $1
      returning
        id,
        name,
        primary_owner_user_id as "primaryOwnerUserId",
        billing_owner_user_id as "billingOwnerUserId",
        status,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [access.household.id, name],
  )

  await writeAuditLog(db, {
    action: 'household.renamed',
    entityType: 'household',
    entityId: access.household.id,
    actorUserId: user.id,
    householdId: access.household.id,
    before: { name: before.name },
    after: { name },
  })

  return {
    household: result.rows[0],
    requester: access.membership,
  }
}

export async function initiateOwnershipTransferForCurrentUser(clerkUserId, householdId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
  const memberId = normalizeUuid(payload.memberId, 'INVALID_MEMBER_ID', 'memberId must be a UUID.')

  // Only the owner initiates a transfer.
  const access = await requireHouseholdRole(db, user.id, householdId, ['owner'], {
    action: 'owner_transfer',
    resourceType: 'household',
    label: 'household:transfer-initiate',
  })

  const targetResult = await db.query(
    `
      select hm.id as "membershipId", hm.user_id as "userId", hm.email, hm.role, hm.status
      from household_members hm
      where hm.id = $1 and hm.household_id = $2
      limit 1
    `,
    [memberId, access.household.id],
  )
  const target = targetResult.rows[0]

  if (!target) {
    throw createHttpError(404, 'MEMBER_NOT_FOUND', 'Member was not found.', true)
  }
  if (target.userId === user.id) {
    throw createHttpError(409, 'CANNOT_TRANSFER_TO_SELF', 'You already own this household.', true)
  }
  if (target.status !== 'accepted') {
    throw createHttpError(409, 'MEMBER_NOT_ACCEPTED', 'Ownership can only be transferred to an accepted member.', true)
  }

  let transfer
  try {
    const inserted = await db.query(
      `
        insert into household_ownership_transfers (household_id, from_user_id, to_user_id)
        values ($1, $2, $3)
        returning ${transferProjection('household_ownership_transfers')}
      `,
      [access.household.id, user.id, target.userId],
    )
    transfer = inserted.rows[0]
  } catch (err) {
    if (err.code === '23505') {
      throw createHttpError(
        409,
        'TRANSFER_ALREADY_PENDING',
        'An ownership transfer is already pending for this household. Cancel it first.',
        true,
      )
    }
    throw err
  }

  await writeAuditLog(db, {
    action: 'household.ownership_transfer_initiated',
    entityType: 'household_ownership_transfer',
    entityId: transfer.id,
    actorUserId: user.id,
    householdId: access.household.id,
    targetUserId: target.userId,
    after: { toEmail: target.email, expiresAt: transfer.expiresAt },
  })

  const notification = await dispatchTransferInitiatedEmail({
    toEmail: target.email,
    householdName: access.household.name,
    initiatedByName: user.display_name,
    expiresAt: transfer.expiresAt,
    transferId: transfer.id,
  })

  return {
    household: access.household,
    requester: access.membership,
    transfer,
    notification,
  }
}

export async function acceptOwnershipTransferForCurrentUser(clerkUserId, householdId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, HOUSEHOLD_VIEW_ROLES, {
    action: 'owner_transfer',
    resourceType: 'household',
    label: 'household:transfer-accept',
  })
  const client = await db.connect()

  try {
    await client.query('begin')

    // Lock the pending transfer row to serialize accept/cancel races.
    const transferResult = await client.query(
      `
        select ${transferProjection('hot')}
        from household_ownership_transfers hot
        where hot.household_id = $1 and hot.status = 'pending'
        limit 1
        for update
      `,
      [access.household.id],
    )
    const transfer = transferResult.rows[0]

    if (!transfer) {
      throw createHttpError(404, 'TRANSFER_NOT_FOUND', 'No pending ownership transfer for this household.', true)
    }
    if (transfer.toUserId !== user.id) {
      throw createHttpError(403, 'TRANSFER_NOT_FOR_YOU', 'This transfer was issued to a different member.', true)
    }
    if (new Date(transfer.expiresAt).getTime() <= Date.now()) {
      await client.query(
        `update household_ownership_transfers set status = 'expired' where id = $1`,
        [transfer.id],
      )
      await client.query('commit')
      throw createHttpError(410, 'TRANSFER_EXPIRED', 'This ownership transfer has expired.', true)
    }

    const householdRow = await client.query(
      `select primary_owner_user_id as "primaryOwnerUserId" from households where id = $1 for update`,
      [access.household.id],
    )
    if (householdRow.rows[0].primaryOwnerUserId !== transfer.fromUserId) {
      throw createHttpError(409, 'TRANSFER_STALE', 'Household ownership changed since this transfer was created.', true)
    }

    // Swap: target becomes owner; previous owner becomes co-owner.
    await client.query(
      `update households
       set primary_owner_user_id = $2, billing_owner_user_id = $2, updated_at = now()
       where id = $1`,
      [access.household.id, user.id],
    )
    await client.query(
      `update household_members set role = 'co_owner', updated_at = now()
       where household_id = $1 and user_id = $2 and role = 'owner'`,
      [access.household.id, transfer.fromUserId],
    )
    await client.query(
      `update household_members set role = 'owner', updated_at = now()
       where household_id = $1 and user_id = $2`,
      [access.household.id, user.id],
    )
    const accepted = await client.query(
      `update household_ownership_transfers
       set status = 'accepted', accepted_at = now()
       where id = $1
       returning ${transferProjection('household_ownership_transfers')}`,
      [transfer.id],
    )

    await writeAuditLog(client, {
      action: 'household.ownership_transferred',
      entityType: 'household',
      entityId: access.household.id,
      actorUserId: user.id,
      householdId: access.household.id,
      targetUserId: transfer.fromUserId,
      before: { ownerUserId: transfer.fromUserId },
      after: { ownerUserId: user.id },
    })

    await client.query('commit')

    const household = await readHousehold(db, access.household.id)

    // Courtesy notification to the previous owner (best-effort, post-commit).
    const previousOwner = await db.query(
      'select email from app_users where id = $1 limit 1',
      [transfer.fromUserId],
    )
    const notification = await dispatchTransferAcceptedEmail({
      toEmail: previousOwner.rows[0]?.email,
      householdName: household.name,
      newOwnerName: user.display_name,
      transferId: transfer.id,
    })

    return {
      household,
      transfer: accepted.rows[0],
      notification,
    }
  } catch (err) {
    try { await client.query('rollback') } catch { /* keep original error */ }
    throw err
  } finally {
    client.release()
  }
}

export async function cancelOwnershipTransferForCurrentUser(clerkUserId, householdId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, ['owner'], {
    action: 'owner_transfer',
    resourceType: 'household',
    label: 'household:transfer-cancel',
  })
  const transfer = await readPendingTransfer(db, access.household.id)

  if (!transfer) {
    throw createHttpError(404, 'TRANSFER_NOT_FOUND', 'No pending ownership transfer for this household.', true)
  }

  const canceled = await db.query(
    `
      update household_ownership_transfers
      set status = 'canceled', canceled_at = now(), canceled_by = $2
      where id = $1 and status = 'pending'
      returning ${transferProjection('household_ownership_transfers')}
    `,
    [transfer.id, user.id],
  )

  if (canceled.rows.length === 0) {
    throw createHttpError(409, 'TRANSFER_NOT_PENDING', 'This transfer is no longer pending.', true)
  }

  await writeAuditLog(db, {
    action: 'household.ownership_transfer_canceled',
    entityType: 'household_ownership_transfer',
    entityId: transfer.id,
    actorUserId: user.id,
    householdId: access.household.id,
    targetUserId: transfer.toUserId,
  })

  return {
    household: access.household,
    requester: access.membership,
    transfer: canceled.rows[0],
  }
}
