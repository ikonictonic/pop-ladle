import { getDatabasePool } from '../../database/pool.js'
import { getClerkClient } from './clerk.js'

function createHttpError(statusCode, code, message, expose = true) {
  const err = new Error(message)
  err.statusCode = statusCode
  err.code = code
  err.expose = expose
  return err
}

function getPrimaryEmailAddress(clerkUser) {
  return clerkUser.primaryEmailAddress ?? clerkUser.emailAddresses?.[0] ?? null
}

function getDisplayName(clerkUser, fallbackEmail) {
  const joinedName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim()

  return clerkUser.fullName || joinedName || clerkUser.username || fallbackEmail.split('@')[0]
}

function getEmailVerifiedAt(emailAddress) {
  if (emailAddress.verification?.status !== 'verified') {
    return null
  }

  return new Date().toISOString()
}

async function fetchClerkUser(clerkUserId) {
  try {
    return await getClerkClient().users.getUser(clerkUserId)
  } catch (err) {
    const lookupError = createHttpError(
      502,
      'CLERK_USER_LOOKUP_FAILED',
      'Could not read the current Clerk user.',
      true,
    )
    lookupError.cause = err
    throw lookupError
  }
}

async function upsertAppUser(db, clerkUserId, clerkUser) {
  const emailAddress = getPrimaryEmailAddress(clerkUser)

  if (!emailAddress?.emailAddress) {
    throw createHttpError(
      422,
      'CLERK_EMAIL_REQUIRED',
      'The current Clerk user does not have an email address.',
      true,
    )
  }

  const email = emailAddress.emailAddress
  const displayName = getDisplayName(clerkUser, email)
  const emailVerifiedAt = getEmailVerifiedAt(emailAddress)

  const result = await db.query(
    `
      insert into app_users (
        clerk_user_id,
        email,
        display_name,
        image_url,
        email_verified_at,
        last_seen_at
      )
      values ($1, $2, $3, $4, $5, now())
      on conflict (clerk_user_id)
      do update set
        email = excluded.email,
        display_name = excluded.display_name,
        image_url = excluded.image_url,
        email_verified_at = coalesce(app_users.email_verified_at, excluded.email_verified_at),
        last_seen_at = now(),
        updated_at = now()
      returning
        id,
        clerk_user_id as "clerkUserId",
        email,
        display_name as "displayName",
        image_url as "imageUrl",
        status,
        email_verified_at as "emailVerifiedAt",
        last_seen_at as "lastSeenAt",
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [clerkUserId, email, displayName, clerkUser.imageUrl || null, emailVerifiedAt],
  )

  return result.rows[0]
}

async function listHouseholdMemberships(db, userId) {
  const result = await db.query(
    `
      select
        hm.id as "membershipId",
        hm.household_id as "householdId",
        h.name as "householdName",
        hm.role,
        hm.status,
        hm.accepted_at as "acceptedAt",
        hm.created_at as "createdAt",
        hm.updated_at as "updatedAt"
      from household_members hm
      join households h on h.id = hm.household_id
      where hm.user_id = $1
        and hm.status = 'accepted'
        and h.status = 'active'
      order by hm.created_at asc
    `,
    [userId],
  )

  return result.rows
}

async function getInternalAdminAccess(db, userId) {
  const result = await db.query(
    `
      select
        id,
        role,
        status,
        created_at as "createdAt",
        updated_at as "updatedAt"
      from internal_admin_users
      where user_id = $1
      limit 1
    `,
    [userId],
  )

  return result.rows[0] ?? null
}

export async function getCurrentAppUser(clerkUserId) {
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const clerkUser = await fetchClerkUser(clerkUserId)
  const appUser = await upsertAppUser(db, clerkUserId, clerkUser)

  if (appUser.status !== 'active') {
    throw createHttpError(403, 'USER_NOT_ACTIVE', 'This account is not active.', true)
  }

  return appUser
}

export async function getCurrentUserContext(clerkUserId) {
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const appUser = await getCurrentAppUser(clerkUserId)

  const [households, internalAdmin] = await Promise.all([
    listHouseholdMemberships(db, appUser.id),
    getInternalAdminAccess(db, appUser.id),
  ])

  return {
    user: appUser,
    households,
    internalAdmin,
  }
}
