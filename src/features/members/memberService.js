import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'
import { assertWithinHouseholdMemberLimit } from '../plans/planService.js'
import { dispatchInviteEmail } from './inviteNotifications.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
} from '../households/householdAccess.js'

const MEMBER_MANAGER_ROLES = ['owner', 'co_owner']
const INVITABLE_MEMBER_ROLES = ['co_owner', 'caregiver', 'viewer']
const DEFAULT_INVITE_EXPIRY_DAYS = 14
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVITE_TOKEN_MAX_LENGTH = 200

function sortRoleExpression() {
  return `
    case hm.role
      when 'owner' then 1
      when 'co_owner' then 2
      when 'caregiver' then 3
      when 'viewer' then 4
      else 5
    end
  `
}

function normalizeInvitePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''

  if (!email || !EMAIL_PATTERN.test(email)) {
    throw createHttpError(400, 'INVALID_INVITE_EMAIL', 'Enter a valid invite email.', true)
  }

  const role = payload.role ?? 'caregiver'

  if (!INVITABLE_MEMBER_ROLES.includes(role)) {
    throw createHttpError(
      400,
      'INVALID_INVITE_ROLE',
      `Invite role must be one of: ${INVITABLE_MEMBER_ROLES.join(', ')}.`,
      true,
    )
  }

  return {
    email,
    role,
  }
}

function normalizeAcceptInvitePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const inviteToken = typeof payload.inviteToken === 'string' ? payload.inviteToken.trim() : ''

  if (!inviteToken) {
    throw createHttpError(400, 'INVALID_INVITE_TOKEN', 'Invite token is required.', true)
  }

  if (inviteToken.length > INVITE_TOKEN_MAX_LENGTH) {
    throw createHttpError(400, 'INVALID_INVITE_TOKEN', 'Invite token is too long.', true)
  }

  return {
    inviteToken,
  }
}

function createInvitePayload(row, created) {
  return {
    created,
    invite: {
      ...row,
      invitePath: `/?invite=${row.inviteToken}`,
    },
  }
}

function toEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeInviteId(value) {
  return normalizeUuid(value, 'INVALID_INVITE_ID', 'Invite id must be a UUID.')
}

function normalizeMemberId(value) {
  return normalizeUuid(value, 'INVALID_MEMBER_ID', 'Member id must be a UUID.')
}

function normalizeMemberRolePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  if (!INVITABLE_MEMBER_ROLES.includes(payload.role)) {
    throw createHttpError(
      400,
      'INVALID_MEMBER_ROLE',
      `Member role must be one of: ${INVITABLE_MEMBER_ROLES.join(', ')}.`,
      true,
    )
  }

  return {
    role: payload.role,
  }
}

export async function listHouseholdMembersForCurrentUser(clerkUserId, householdId) {
  const requester = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const access = await requireHouseholdRole(db, requester.id, householdId, MEMBER_MANAGER_ROLES)
  const result = await db.query(
    `
      select
        hm.id as "membershipId",
        hm.household_id as "householdId",
        hm.user_id as "userId",
        hm.email,
        hm.role,
        hm.status,
        hm.invited_by as "invitedByUserId",
        inviter.email as "invitedByEmail",
        hm.invited_at as "invitedAt",
        hm.accepted_at as "acceptedAt",
        hm.revoked_at as "revokedAt",
        hm.suspended_at as "suspendedAt",
        hm.onboarding_email_sent_at as "onboardingEmailSentAt",
        hm.created_at as "createdAt",
        hm.updated_at as "updatedAt",
        u.clerk_user_id as "clerkUserId",
        u.email as "accountEmail",
        u.display_name as "displayName",
        u.image_url as "imageUrl",
        u.status as "userStatus"
      from household_members hm
      join app_users u on u.id = hm.user_id
      left join app_users inviter on inviter.id = hm.invited_by
      where hm.household_id = $1
      order by ${sortRoleExpression()}, hm.created_at asc
    `,
    [access.household.id],
  )

  return {
    household: access.household,
    requester: access.membership,
    members: result.rows,
  }
}

export async function listHouseholdInvitesForCurrentUser(clerkUserId, householdId) {
  const requester = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const access = await requireHouseholdRole(db, requester.id, householdId, MEMBER_MANAGER_ROLES)
  const result = await db.query(
    `
      select
        hi.id,
        hi.household_id as "householdId",
        hi.email,
        hi.role,
        hi.invite_token as "inviteToken",
        hi.created_by as "createdByUserId",
        creator.email as "createdByEmail",
        hi.expires_at as "expiresAt",
        hi.accepted_at as "acceptedAt",
        hi.accepted_by as "acceptedByUserId",
        accepter.email as "acceptedByEmail",
        hi.revoked_at as "revokedAt",
        hi.revoked_by as "revokedByUserId",
        revoker.email as "revokedByEmail",
        hi.created_at as "createdAt",
        case
          when hi.accepted_at is not null then 'accepted'
          when hi.revoked_at is not null then 'revoked'
          when hi.expires_at <= now() then 'expired'
          else 'pending'
        end as status
      from household_invites hi
      left join app_users creator on creator.id = hi.created_by
      left join app_users accepter on accepter.id = hi.accepted_by
      left join app_users revoker on revoker.id = hi.revoked_by
      where hi.household_id = $1
      order by hi.created_at desc
      limit 100
    `,
    [access.household.id],
  )

  return {
    household: access.household,
    requester: access.membership,
    invites: result.rows.map((invite) => ({
      ...invite,
      invitePath: `/?invite=${invite.inviteToken}`,
    })),
  }
}

function memberProjection(alias = 'hm') {
  return `
    ${alias}.id as "membershipId",
    ${alias}.household_id as "householdId",
    ${alias}.user_id as "userId",
    ${alias}.email,
    ${alias}.role,
    ${alias}.status,
    ${alias}.invited_by as "invitedByUserId",
    ${alias}.invited_at as "invitedAt",
    ${alias}.accepted_at as "acceptedAt",
    ${alias}.revoked_at as "revokedAt",
    ${alias}.revoked_by as "revokedByUserId",
    ${alias}.suspended_at as "suspendedAt",
    ${alias}.suspended_by as "suspendedByUserId",
    ${alias}.onboarding_email_sent_at as "onboardingEmailSentAt",
    ${alias}.created_at as "createdAt",
    ${alias}.updated_at as "updatedAt"
  `
}

async function readMemberById(db, householdId, memberId) {
  const result = await db.query(
    `
      select
        ${memberProjection('hm')}
      from household_members hm
      where hm.id = $1
        and hm.household_id = $2
      limit 1
    `,
    [memberId, householdId],
  )

  return result.rows[0] ?? null
}

function assertMemberCanBeManaged(targetMember, requester, action) {
  if (!targetMember) {
    throw createHttpError(404, 'MEMBER_NOT_FOUND', 'Member was not found.', true)
  }

  if (targetMember.userId === requester.id) {
    throw createHttpError(409, 'CANNOT_MANAGE_SELF', 'You cannot manage your own membership.', true)
  }

  if (targetMember.role === 'owner') {
    throw createHttpError(403, 'OWNER_MEMBER_PROTECTED', 'The owner membership cannot be managed here.', true)
  }

  if (action === 'remove' && targetMember.status === 'revoked') {
    return
  }

  if (action === 'remove' && targetMember.status === 'suspended') {
    return
  }

  if (action === 'suspend' && targetMember.status === 'suspended') {
    return
  }

  if (targetMember.status !== 'accepted') {
    throw createHttpError(
      409,
      'MEMBER_NOT_ACCEPTED',
      'Only accepted household members can be managed with this action.',
      true,
    )
  }
}

async function updateMemberRole(db, memberId, role) {
  const result = await db.query(
    `
      update household_members hm
      set
        role = $2,
        updated_at = now()
      where hm.id = $1
      returning
        ${memberProjection('hm')}
    `,
    [memberId, role],
  )

  return result.rows[0]
}

async function suspendMember(db, memberId, requesterId) {
  const result = await db.query(
    `
      update household_members hm
      set
        status = 'suspended',
        suspended_at = coalesce(suspended_at, now()),
        suspended_by = coalesce(suspended_by, $2),
        updated_at = now()
      where hm.id = $1
      returning
        ${memberProjection('hm')}
    `,
    [memberId, requesterId],
  )

  return result.rows[0]
}

async function removeMember(db, memberId, requesterId) {
  const result = await db.query(
    `
      update household_members hm
      set
        status = 'revoked',
        revoked_at = coalesce(revoked_at, now()),
        revoked_by = coalesce(revoked_by, $2),
        suspended_at = null,
        suspended_by = null,
        updated_at = now()
      where hm.id = $1
      returning
        ${memberProjection('hm')}
    `,
    [memberId, requesterId],
  )

  return result.rows[0]
}

export async function updateHouseholdMemberRoleForCurrentUser(
  clerkUserId,
  householdId,
  memberId,
  payload,
) {
  const requester = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedMemberId = normalizeMemberId(memberId)
  const { role } = normalizeMemberRolePayload(payload)
  const access = await requireHouseholdRole(db, requester.id, householdId, MEMBER_MANAGER_ROLES)
  const targetMember = await readMemberById(db, access.household.id, normalizedMemberId)

  assertMemberCanBeManaged(targetMember, requester, 'update_role')

  if (targetMember.role === role) {
    return {
      changed: false,
      household: access.household,
      requester: access.membership,
      member: targetMember,
    }
  }

  const member = await updateMemberRole(db, normalizedMemberId, role)

  await writeAuditLog(db, {
    action: 'member.role_changed',
    entityType: 'household_member',
    entityId: member.membershipId,
    actorUserId: requester.id,
    householdId: access.household.id,
    targetUserId: member.userId,
    before: { role: targetMember.role },
    after: { role: member.role },
  })

  return {
    changed: true,
    household: access.household,
    requester: access.membership,
    member,
  }
}

export async function suspendHouseholdMemberForCurrentUser(clerkUserId, householdId, memberId) {
  const requester = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedMemberId = normalizeMemberId(memberId)
  const access = await requireHouseholdRole(db, requester.id, householdId, MEMBER_MANAGER_ROLES)
  const targetMember = await readMemberById(db, access.household.id, normalizedMemberId)

  assertMemberCanBeManaged(targetMember, requester, 'suspend')

  if (targetMember.status === 'suspended') {
    return {
      suspended: false,
      household: access.household,
      requester: access.membership,
      member: targetMember,
    }
  }

  const member = await suspendMember(db, normalizedMemberId, requester.id)

  await writeAuditLog(db, {
    action: 'member.suspended',
    entityType: 'household_member',
    entityId: member.membershipId,
    actorUserId: requester.id,
    householdId: access.household.id,
    targetUserId: member.userId,
    before: { status: targetMember.status },
    after: { status: member.status },
  })

  return {
    suspended: true,
    household: access.household,
    requester: access.membership,
    member,
  }
}

export async function removeHouseholdMemberForCurrentUser(clerkUserId, householdId, memberId) {
  const requester = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedMemberId = normalizeMemberId(memberId)
  const access = await requireHouseholdRole(db, requester.id, householdId, MEMBER_MANAGER_ROLES)
  const targetMember = await readMemberById(db, access.household.id, normalizedMemberId)

  assertMemberCanBeManaged(targetMember, requester, 'remove')

  if (targetMember.status === 'revoked') {
    return {
      removed: false,
      household: access.household,
      requester: access.membership,
      member: targetMember,
    }
  }

  const member = await removeMember(db, normalizedMemberId, requester.id)

  await writeAuditLog(db, {
    action: 'member.removed',
    entityType: 'household_member',
    entityId: member.membershipId,
    actorUserId: requester.id,
    householdId: access.household.id,
    targetUserId: member.userId,
    before: { status: targetMember.status, role: targetMember.role },
    after: { status: member.status },
  })

  return {
    removed: true,
    household: access.household,
    requester: access.membership,
    member,
  }
}

async function findAcceptedMemberByEmail(db, householdId, email) {
  const result = await db.query(
    `
      select
        hm.id as "membershipId",
        hm.email,
        hm.role,
        hm.status,
        hm.accepted_at as "acceptedAt"
      from household_members hm
      where hm.household_id = $1
        and hm.email = $2::citext
        and hm.status = 'accepted'
      limit 1
    `,
    [householdId, email],
  )

  return result.rows[0] ?? null
}

async function findPendingInviteByEmail(db, householdId, email) {
  const result = await db.query(
    `
      select
        id,
        household_id as "householdId",
        email,
        role,
        invite_token as "inviteToken",
        created_by as "createdByUserId",
        expires_at as "expiresAt",
        accepted_at as "acceptedAt",
        accepted_by as "acceptedByUserId",
        revoked_at as "revokedAt",
        revoked_by as "revokedByUserId",
        created_at as "createdAt"
      from household_invites
      where household_id = $1
        and email = $2::citext
        and accepted_at is null
        and revoked_at is null
        and expires_at > now()
      order by created_at desc
      limit 1
    `,
    [householdId, email],
  )

  return result.rows[0] ?? null
}

async function updatePendingInviteRole(db, inviteId, role, requesterId) {
  const result = await db.query(
    `
      update household_invites
      set
        role = $2,
        created_by = $3,
        expires_at = now() + ($4::text || ' days')::interval
      where id = $1
      returning
        id,
        household_id as "householdId",
        email,
        role,
        invite_token as "inviteToken",
        created_by as "createdByUserId",
        expires_at as "expiresAt",
        accepted_at as "acceptedAt",
        accepted_by as "acceptedByUserId",
        revoked_at as "revokedAt",
        revoked_by as "revokedByUserId",
        created_at as "createdAt"
    `,
    [inviteId, role, requesterId, DEFAULT_INVITE_EXPIRY_DAYS],
  )

  return result.rows[0]
}

async function createHouseholdInvite(db, householdId, email, role, requesterId) {
  const result = await db.query(
    `
      insert into household_invites (
        household_id,
        email,
        role,
        created_by,
        expires_at
      )
      values ($1, $2, $3, $4, now() + ($5::text || ' days')::interval)
      returning
        id,
        household_id as "householdId",
        email,
        role,
        invite_token as "inviteToken",
        created_by as "createdByUserId",
        expires_at as "expiresAt",
        accepted_at as "acceptedAt",
        accepted_by as "acceptedByUserId",
        revoked_at as "revokedAt",
        revoked_by as "revokedByUserId",
        created_at as "createdAt"
    `,
    [householdId, email, role, requesterId, DEFAULT_INVITE_EXPIRY_DAYS],
  )

  return result.rows[0]
}

async function lockInviteAcceptance(client, inviteToken) {
  await client.query('select pg_advisory_xact_lock(827120403, hashtext($1))', [inviteToken])
}

async function readInviteForAcceptance(client, inviteToken) {
  const result = await client.query(
    `
      select
        hi.id,
        hi.household_id as "householdId",
        hi.email,
        hi.role,
        hi.invite_token as "inviteToken",
        hi.created_by as "createdByUserId",
        hi.expires_at as "expiresAt",
        hi.accepted_at as "acceptedAt",
        hi.accepted_by as "acceptedByUserId",
        hi.revoked_at as "revokedAt",
        hi.revoked_by as "revokedByUserId",
        hi.created_at as "createdAt",
        h.name as "householdName",
        h.status as "householdStatus"
      from household_invites hi
      join households h on h.id = hi.household_id
      where hi.invite_token = $1
      limit 1
    `,
    [inviteToken],
  )

  return result.rows[0] ?? null
}

function assertInviteCanBeAccepted(invite, user) {
  if (!invite) {
    throw createHttpError(404, 'INVITE_NOT_FOUND', 'Invite was not found.', true)
  }

  if (invite.householdStatus !== 'active') {
    throw createHttpError(409, 'HOUSEHOLD_NOT_ACTIVE', 'This household is not active.', true)
  }

  if (invite.revokedAt) {
    throw createHttpError(410, 'INVITE_REVOKED', 'This invite has been revoked.', true)
  }

  if (invite.acceptedByUserId && invite.acceptedByUserId !== user.id) {
    throw createHttpError(409, 'INVITE_ALREADY_ACCEPTED', 'This invite has already been accepted.', true)
  }

  if (toEmail(invite.email) !== toEmail(user.email)) {
    throw createHttpError(
      403,
      'INVITE_EMAIL_MISMATCH',
      'This invite was issued to a different email address.',
      true,
    )
  }

  if (invite.acceptedByUserId === user.id) {
    return
  }

  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    throw createHttpError(410, 'INVITE_EXPIRED', 'This invite has expired.', true)
  }
}

async function readMembershipByUser(client, householdId, userId) {
  const result = await client.query(
    `
      select
        hm.id as "membershipId",
        hm.household_id as "householdId",
        hm.user_id as "userId",
        hm.email,
        hm.role,
        hm.status,
        hm.invited_by as "invitedByUserId",
        hm.invited_at as "invitedAt",
        hm.accepted_at as "acceptedAt",
        hm.revoked_at as "revokedAt",
        hm.suspended_at as "suspendedAt",
        hm.created_at as "createdAt",
        hm.updated_at as "updatedAt"
      from household_members hm
      where hm.household_id = $1
        and hm.user_id = $2
      limit 1
    `,
    [householdId, userId],
  )

  return result.rows[0] ?? null
}

async function createMembershipFromInvite(client, invite, user) {
  const result = await client.query(
    `
      insert into household_members (
        household_id,
        user_id,
        email,
        role,
        status,
        invited_by,
        invited_at,
        accepted_at
      )
      values ($1, $2, $3, $4, 'accepted', $5, $6, now())
      on conflict (household_id, user_id)
      do update set
        email = excluded.email,
        role = excluded.role,
        status = 'accepted',
        invited_by = coalesce(household_members.invited_by, excluded.invited_by),
        invited_at = coalesce(household_members.invited_at, excluded.invited_at),
        accepted_at = coalesce(household_members.accepted_at, now()),
        revoked_at = null,
        revoked_by = null,
        suspended_at = null,
        suspended_by = null,
        updated_at = now()
      returning
        id as "membershipId",
        household_id as "householdId",
        user_id as "userId",
        email,
        role,
        status,
        invited_by as "invitedByUserId",
        invited_at as "invitedAt",
        accepted_at as "acceptedAt",
        revoked_at as "revokedAt",
        suspended_at as "suspendedAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      invite.householdId,
      user.id,
      user.email,
      invite.role,
      invite.createdByUserId,
      invite.createdAt,
    ],
  )

  return result.rows[0]
}

async function markInviteAccepted(client, inviteId, userId) {
  const result = await client.query(
    `
      update household_invites
      set
        accepted_at = coalesce(accepted_at, now()),
        accepted_by = coalesce(accepted_by, $2)
      where id = $1
      returning
        id,
        household_id as "householdId",
        email,
        role,
        invite_token as "inviteToken",
        created_by as "createdByUserId",
        expires_at as "expiresAt",
        accepted_at as "acceptedAt",
        accepted_by as "acceptedByUserId",
        revoked_at as "revokedAt",
        revoked_by as "revokedByUserId",
        created_at as "createdAt"
    `,
    [inviteId, userId],
  )

  return result.rows[0]
}

async function readInviteById(db, householdId, inviteId) {
  const result = await db.query(
    `
      select
        id,
        household_id as "householdId",
        email,
        role,
        invite_token as "inviteToken",
        created_by as "createdByUserId",
        expires_at as "expiresAt",
        accepted_at as "acceptedAt",
        accepted_by as "acceptedByUserId",
        revoked_at as "revokedAt",
        revoked_by as "revokedByUserId",
        created_at as "createdAt"
      from household_invites
      where id = $1
        and household_id = $2
      limit 1
    `,
    [inviteId, householdId],
  )

  return result.rows[0] ?? null
}

async function markInviteRevoked(db, inviteId, requesterId) {
  const result = await db.query(
    `
      update household_invites
      set
        revoked_at = coalesce(revoked_at, now()),
        revoked_by = coalesce(revoked_by, $2)
      where id = $1
      returning
        id,
        household_id as "householdId",
        email,
        role,
        invite_token as "inviteToken",
        created_by as "createdByUserId",
        expires_at as "expiresAt",
        accepted_at as "acceptedAt",
        accepted_by as "acceptedByUserId",
        revoked_at as "revokedAt",
        revoked_by as "revokedByUserId",
        created_at as "createdAt"
    `,
    [inviteId, requesterId],
  )

  return result.rows[0]
}

export async function createHouseholdInviteForCurrentUser(clerkUserId, householdId, payload) {
  const requester = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const { email, role } = normalizeInvitePayload(payload)
  const access = await requireHouseholdRole(db, requester.id, householdId, MEMBER_MANAGER_ROLES)
  const existingMember = await findAcceptedMemberByEmail(db, access.household.id, email)

  if (existingMember) {
    throw createHttpError(
      409,
      'MEMBER_ALREADY_EXISTS',
      'This email is already an accepted member of the household.',
      true,
    )
  }

  const existingInvite = await findPendingInviteByEmail(db, access.household.id, email)

  if (existingInvite) {
    const updatedInvite = await updatePendingInviteRole(db, existingInvite.id, role, requester.id)

    await writeAuditLog(db, {
      action: 'invite.updated',
      entityType: 'household_invite',
      entityId: updatedInvite.id,
      actorUserId: requester.id,
      householdId: access.household.id,
      before: { role: existingInvite.role },
      after: { role: updatedInvite.role },
      extra: { email },
    })

    const emailDelivery = await dispatchInviteEmail(db, {
      invite: updatedInvite,
      householdName: access.household.name,
      invitedByName: requester.display_name,
    })

    return {
      household: access.household,
      requester: access.membership,
      emailDelivery,
      ...createInvitePayload(updatedInvite, false),
    }
  }

  // Entitlement gate: member seats (accepted members + open invites) per plan.
  await assertWithinHouseholdMemberLimit(db, access.household.id)

  const invite = await createHouseholdInvite(db, access.household.id, email, role, requester.id)

  await writeAuditLog(db, {
    action: 'invite.created',
    entityType: 'household_invite',
    entityId: invite.id,
    actorUserId: requester.id,
    householdId: access.household.id,
    after: { role: invite.role },
    extra: { email },
  })

  const emailDelivery = await dispatchInviteEmail(db, {
    invite,
    householdName: access.household.name,
    invitedByName: requester.display_name,
  })

  return {
    household: access.household,
    requester: access.membership,
    emailDelivery,
    ...createInvitePayload(invite, true),
  }
}

export async function revokeHouseholdInviteForCurrentUser(clerkUserId, householdId, inviteId) {
  const requester = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedInviteId = normalizeInviteId(inviteId)
  const access = await requireHouseholdRole(db, requester.id, householdId, MEMBER_MANAGER_ROLES)
  const invite = await readInviteById(db, access.household.id, normalizedInviteId)

  if (!invite) {
    throw createHttpError(404, 'INVITE_NOT_FOUND', 'Invite was not found.', true)
  }

  if (invite.acceptedAt) {
    throw createHttpError(409, 'INVITE_ALREADY_ACCEPTED', 'Accepted invites cannot be revoked.', true)
  }

  if (invite.revokedAt) {
    return {
      revoked: false,
      household: access.household,
      requester: access.membership,
      invite: {
        ...invite,
        invitePath: `/?invite=${invite.inviteToken}`,
      },
    }
  }

  const revokedInvite = await markInviteRevoked(db, normalizedInviteId, requester.id)

  await writeAuditLog(db, {
    action: 'invite.revoked',
    entityType: 'household_invite',
    entityId: revokedInvite.id,
    actorUserId: requester.id,
    householdId: access.household.id,
    before: { role: invite.role },
    extra: { email: invite.email },
  })

  return {
    revoked: true,
    household: access.household,
    requester: access.membership,
    invite: {
      ...revokedInvite,
      invitePath: `/?invite=${revokedInvite.inviteToken}`,
    },
  }
}

export async function resendHouseholdInviteForCurrentUser(clerkUserId, householdId, inviteId) {
  const requester = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const normalizedInviteId = normalizeInviteId(inviteId)
  const access = await requireHouseholdRole(db, requester.id, householdId, MEMBER_MANAGER_ROLES)
  const invite = await readInviteById(db, access.household.id, normalizedInviteId)

  if (!invite) {
    throw createHttpError(404, 'INVITE_NOT_FOUND', 'Invite was not found.', true)
  }

  if (invite.acceptedAt) {
    throw createHttpError(409, 'INVITE_ALREADY_ACCEPTED', 'Accepted invites cannot be resent.', true)
  }

  if (invite.revokedAt) {
    throw createHttpError(409, 'INVITE_REVOKED', 'Revoked invites cannot be resent.', true)
  }

  if (new Date(invite.expiresAt).getTime() <= Date.now()) {
    throw createHttpError(410, 'INVITE_EXPIRED', 'This invite has expired. Create a new invite.', true)
  }

  const emailDelivery = await dispatchInviteEmail(db, {
    invite,
    householdName: access.household.name,
    invitedByName: requester.display_name,
  })

  await writeAuditLog(db, {
    action: 'invite.email_resent',
    entityType: 'household_invite',
    entityId: invite.id,
    actorUserId: requester.id,
    householdId: access.household.id,
    after: { delivered: emailDelivery.delivered, transport: emailDelivery.transport },
    extra: { email: invite.email },
  })

  return {
    household: access.household,
    requester: access.membership,
    emailDelivery,
    invite: {
      ...invite,
      invitePath: `/?invite=${invite.inviteToken}`,
    },
  }
}

export async function acceptHouseholdInviteForCurrentUser(clerkUserId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const { inviteToken } = normalizeAcceptInvitePayload(payload)
  const client = await db.connect()

  try {
    await client.query('begin')
    await lockInviteAcceptance(client, inviteToken)

    const invite = await readInviteForAcceptance(client, inviteToken)
    assertInviteCanBeAccepted(invite, user)

    const existingMembership = await readMembershipByUser(client, invite.householdId, user.id)

    if (existingMembership?.status === 'accepted') {
      const acceptedInvite = await markInviteAccepted(client, invite.id, user.id)
      await client.query('commit')

      return {
        accepted: false,
        household: {
          id: invite.householdId,
          name: invite.householdName,
          status: invite.householdStatus,
        },
        membership: existingMembership,
        invite: acceptedInvite,
      }
    }

    if (existingMembership?.status === 'suspended') {
      throw createHttpError(403, 'MEMBERSHIP_SUSPENDED', 'This household membership is suspended.', true)
    }

    const membership = await createMembershipFromInvite(client, invite, user)
    const acceptedInvite = await markInviteAccepted(client, invite.id, user.id)

    await writeAuditLog(client, {
      action: 'invite.accepted',
      entityType: 'household_invite',
      entityId: invite.id,
      actorUserId: user.id,
      householdId: invite.householdId,
      targetUserId: user.id,
      after: { role: membership.role, status: membership.status },
      extra: { email: invite.email },
    })

    await client.query('commit')

    return {
      accepted: true,
      household: {
        id: invite.householdId,
        name: invite.householdName,
        status: invite.householdStatus,
      },
      membership,
      invite: acceptedInvite,
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
