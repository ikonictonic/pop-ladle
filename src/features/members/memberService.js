import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { createHttpError, requireHouseholdRole } from '../households/householdAccess.js'

const MEMBER_MANAGER_ROLES = ['owner', 'co_owner']

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
