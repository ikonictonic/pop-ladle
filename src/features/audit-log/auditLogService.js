/**
 * Audit log — the doctrine rule is "anything an admin can change must be logged".
 *
 * writeAuditLog() appends one row to admin_audit_logs recording actor, action,
 * target, before/after values, reason, and IP/device (read automatically from
 * the request context). Pass the transaction client where the mutation runs in
 * a transaction so the action and its audit record are atomic; pass the pool
 * for single-statement mutations.
 *
 * Reading is household-scoped per the customer roles matrix: Owner/Co-Owner
 * can view audit activity; Caregiver/Viewer cannot.
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { createHttpError, requireHouseholdRole } from '../households/householdAccess.js'
import { getRequestContext } from '../../app/requestContext.js'

const AUDIT_VIEW_ROLES = ['owner', 'co_owner']
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

/**
 * Append an audit row. Never throws business errors of its own shape — a
 * failed insert propagates so a transactional caller rolls back (an unlogged
 * admin action must not stand).
 *
 * @param {object} queryable  pg Pool or checked-out client (for transactions)
 * @param {object} entry
 * @param {string} entry.action       dot-namespaced, e.g. 'member.role_changed'
 * @param {string} [entry.entityType] e.g. 'household_member'
 * @param {string} [entry.entityId]
 * @param {string} [entry.actorUserId]
 * @param {string} [entry.householdId]
 * @param {string} [entry.targetUserId]
 * @param {object} [entry.before]     prior state (metadata.before)
 * @param {object} [entry.after]      new state (metadata.after)
 * @param {string} [entry.reason]
 * @param {object} [entry.extra]      any additional metadata fields
 */
export async function writeAuditLog(queryable, {
  action,
  entityType = null,
  entityId = null,
  actorUserId = null,
  actorAdminRole = null,
  householdId = null,
  targetUserId = null,
  before = null,
  after = null,
  reason = null,
  extra = null,
}) {
  const { ipAddress = null, userAgent = null } = getRequestContext()

  const metadata = {}
  if (before !== null && before !== undefined) metadata.before = before
  if (after !== null && after !== undefined) metadata.after = after
  if (reason) metadata.reason = reason
  if (extra && typeof extra === 'object') Object.assign(metadata, extra)

  await queryable.query(
    `
      insert into admin_audit_logs (
        actor_user_id, actor_admin_role, household_id, target_user_id, action,
        entity_type, entity_id, ip_address, user_agent, metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    `,
    [
      actorUserId, actorAdminRole, householdId, targetUserId, action,
      entityType, entityId, ipAddress, userAgent, JSON.stringify(metadata),
    ],
  )
}

export async function listAuditLogForCurrentUser(clerkUserId, householdId, query = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, AUDIT_VIEW_ROLES, {
    action: 'audit:read_scoped:household',
    resourceType: 'audit_log',
    label: 'audit-log:read',
  })

  const action = typeof query.action === 'string' && query.action.trim() ? query.action.trim() : null
  const requestedLimit = Number.parseInt(query.limit ?? `${DEFAULT_LIMIT}`, 10)
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT

  const result = await db.query(
    `
      select
        al.id,
        al.action,
        al.entity_type as "entityType",
        al.entity_id as "entityId",
        al.actor_user_id as "actorUserId",
        actor.email as "actorEmail",
        actor.display_name as "actorDisplayName",
        al.target_user_id as "targetUserId",
        target.email as "targetEmail",
        al.metadata,
        al.ip_address as "ipAddress",
        al.user_agent as "userAgent",
        al.created_at as "createdAt"
      from admin_audit_logs al
      left join app_users actor on actor.id = al.actor_user_id
      left join app_users target on target.id = al.target_user_id
      where al.household_id = $1
        and ($2::text is null or al.action = $2)
      order by al.created_at desc
      limit $3
    `,
    [access.household.id, action, limit],
  )

  return {
    household: access.household,
    requester: access.membership,
    entries: result.rows,
  }
}
