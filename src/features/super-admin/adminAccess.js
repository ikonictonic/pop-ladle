/**
 * Internal admin access gate.
 *
 * Internal admins are company staff rows in internal_admin_users (separate
 * from household roles — the two permission layers never mix). Roles from the
 * 001 enum: super_admin, support_admin, clinical_admin, and (029)
 * content_admin — the ABAC doc's PL-005 "Recipe Library Admin", who authors
 * and curates Master Library content but is denied billing and IAM.
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

// Deliberately WITHOUT content_admin: gates billing/privacy/registries, which
// PL-005 denies to content staff.
export const ANY_ADMIN = ['super_admin', 'support_admin', 'clinical_admin']
export const SUPER_ONLY = ['super_admin']
export const SUPPORT_ADMINS = ['super_admin', 'support_admin']
export const CLINICAL_ADMINS = ['super_admin', 'clinical_admin']
// Master Library authoring: generate + edit master recipe content (PL-005).
// clinical_admin is excluded — reviewers judge content, they don't write it.
export const CONTENT_ADMINS = ['super_admin', 'content_admin']
// Master Library curation: publish/unpublish/queue/review decisions. Both the
// clinical reviewer and the content author may curate; publish itself remains
// structurally gated on an approved Clinical Review verdict (PL-001).
export const LIBRARY_ADMINS = ['super_admin', 'clinical_admin', 'content_admin']
// Every internal admin role — dashboard overview only.
export const ALL_ADMINS = [...ANY_ADMIN, 'content_admin']

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
