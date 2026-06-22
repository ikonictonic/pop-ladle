/**
 * In-app notifications (Notification Service).
 *
 * Two halves:
 *  - Writers (createNotification / notifyHouseholdRoles) other features call to
 *    emit a notice. They accept a `queryable` (pool or a transaction client) and
 *    are best-effort by convention — callers should never let a notification
 *    failure break the underlying action (wrap in try/catch, like email).
 *  - Reader endpoints, scoped to the current user: a user only ever sees, reads,
 *    or dismisses their OWN notifications (recipient_user_id = them).
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { createHttpError, normalizeUuid } from '../households/householdAccess.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const MAX_TYPE = 64
const MAX_TITLE = 200
const MAX_BODY = 2000

function clip(value, max) {
  const v = typeof value === 'string' ? value.trim() : ''
  return v.length > max ? v.slice(0, max) : v
}

function projection(alias = 'n') {
  return `
    ${alias}.id,
    ${alias}.household_id as "householdId",
    ${alias}.type,
    ${alias}.title,
    ${alias}.body,
    ${alias}.entity_type as "entityType",
    ${alias}.entity_id as "entityId",
    ${alias}.read_at as "readAt",
    ${alias}.created_at as "createdAt"
  `
}

// ---------------------------------------------------------------------------
// Writers (called by other features)
// ---------------------------------------------------------------------------

/**
 * Insert one notification. Returns the row, or null if required fields are
 * missing (so a bad call degrades quietly rather than throwing into a caller's
 * transaction). `queryable` is a pg pool or a transaction client.
 */
export async function createNotification(queryable, {
  recipientUserId, householdId = null, type, title, body = null, entityType = null, entityId = null,
}) {
  if (!queryable || !recipientUserId || !type || !title) return null
  const result = await queryable.query(
    `
      insert into notifications (
        recipient_user_id, household_id, type, title, body, entity_type, entity_id
      )
      values ($1, $2, $3, $4, $5, $6, $7)
      returning ${projection('notifications')}
    `,
    [
      recipientUserId, householdId, clip(type, MAX_TYPE), clip(title, MAX_TITLE),
      body ? clip(body, MAX_BODY) : null, entityType, entityId,
    ],
  )
  return result.rows[0]
}

/**
 * Notify every accepted member of a household holding one of `roles`. Optionally
 * skip `excludeUserId` (e.g. the actor who triggered the event). Returns the
 * number of notifications created.
 */
export async function notifyHouseholdRoles(queryable, householdId, roles, payload, excludeUserId = null) {
  if (!queryable || !householdId || !Array.isArray(roles) || roles.length === 0) return 0
  const members = await queryable.query(
    `
      select user_id from household_members
      where household_id = $1 and status = 'accepted' and role = any($2::text[])
        and user_id is not null
        and ($3::uuid is null or user_id <> $3)
    `,
    [householdId, roles, excludeUserId],
  )
  let created = 0
  for (const row of members.rows) {
    const made = await createNotification(queryable, { ...payload, recipientUserId: row.user_id, householdId })
    if (made) created += 1
  }
  return created
}

// ---------------------------------------------------------------------------
// Reader endpoints (current user)
// ---------------------------------------------------------------------------

export async function listNotificationsForCurrentUser(clerkUserId, query = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const unreadOnly = query.unreadOnly === 'true' || query.unreadOnly === true
  const householdId = query.householdId
    ? normalizeUuid(query.householdId, 'INVALID_HOUSEHOLD_ID', 'householdId must be a UUID.')
    : null
  const requestedLimit = Number.parseInt(query.limit ?? `${DEFAULT_LIMIT}`, 10)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT

  const result = await db.query(
    `
      select ${projection('n')}
      from notifications n
      where n.recipient_user_id = $1
        and ($2::boolean is not true or n.read_at is null)
        and ($3::uuid is null or n.household_id = $3)
      order by n.created_at desc
      limit $4
    `,
    [user.id, unreadOnly, householdId, limit],
  )

  const unread = await db.query(
    `select count(*)::int as "count" from notifications where recipient_user_id = $1 and read_at is null`,
    [user.id],
  )

  return { notifications: result.rows, unreadCount: unread.rows[0].count }
}

export async function getUnreadCountForCurrentUser(clerkUserId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const result = await db.query(
    `select count(*)::int as "count" from notifications where recipient_user_id = $1 and read_at is null`,
    [user.id],
  )
  return { unreadCount: result.rows[0].count }
}

export async function markNotificationReadForCurrentUser(clerkUserId, notificationId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedId = normalizeUuid(notificationId, 'INVALID_NOTIFICATION_ID', 'Notification id must be a UUID.')
  const result = await db.query(
    `
      update notifications set read_at = coalesce(read_at, now())
      where id = $1 and recipient_user_id = $2
      returning ${projection('notifications')}
    `,
    [normalizedId, user.id],
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification was not found.', true)
  }
  return { notification: result.rows[0] }
}

export async function markAllNotificationsReadForCurrentUser(clerkUserId, body = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const householdId = body?.householdId
    ? normalizeUuid(body.householdId, 'INVALID_HOUSEHOLD_ID', 'householdId must be a UUID.')
    : null
  const result = await db.query(
    `
      update notifications set read_at = now()
      where recipient_user_id = $1 and read_at is null
        and ($2::uuid is null or household_id = $2)
      returning id
    `,
    [user.id, householdId],
  )
  return { marked: result.rows.length }
}

export async function dismissNotificationForCurrentUser(clerkUserId, notificationId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedId = normalizeUuid(notificationId, 'INVALID_NOTIFICATION_ID', 'Notification id must be a UUID.')
  const result = await db.query(
    `delete from notifications where id = $1 and recipient_user_id = $2 returning id`,
    [normalizedId, user.id],
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'NOTIFICATION_NOT_FOUND', 'Notification was not found.', true)
  }
  return { deleted: true, notificationId: normalizedId }
}
