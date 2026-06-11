/**
 * Internal admin access gate.
 *
 * Internal admins are company staff rows in internal_admin_users (separate
 * from household roles — the two permission layers never mix). Roles from the
 * 001 enum: super_admin, support_admin, clinical_admin.
 *
 * Bootstrap: the first super admin is granted by SQL (there is deliberately no
 * unauthenticated path to admin):
 *   insert into internal_admin_users (user_id, role)
 *   select id, 'super_admin' from app_users where email = '<you>';
 * After that, super admins manage admins via the /admin/admins endpoints.
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { createHttpError } from '../households/householdAccess.js'

export const ANY_ADMIN = ['super_admin', 'support_admin', 'clinical_admin']
export const SUPER_ONLY = ['super_admin']
export const SUPPORT_ADMINS = ['super_admin', 'support_admin']
export const CLINICAL_ADMINS = ['super_admin', 'clinical_admin']

/**
 * Resolve the current user and require an active internal admin row with one
 * of the allowed roles. Returns { user, admin: { id, role, status } }.
 */
export async function requireInternalAdmin(clerkUserId, allowedRoles = ANY_ADMIN) {
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  const user = await getCurrentAppUser(clerkUserId)
  const result = await db.query(
    `
      select id, role, status
      from internal_admin_users
      where user_id = $1
      limit 1
    `,
    [user.id],
  )
  const admin = result.rows[0]

  if (!admin || admin.status !== 'active') {
    throw createHttpError(403, 'ADMIN_ACCESS_REQUIRED', 'Internal admin access is required.', true)
  }

  if (!allowedRoles.includes(admin.role)) {
    throw createHttpError(
      403,
      'ADMIN_ROLE_REQUIRED',
      `This action requires one of these admin roles: ${allowedRoles.join(', ')}.`,
      true,
    )
  }

  return { db, user, admin }
}
