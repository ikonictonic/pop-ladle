// =============================================================================
// access/grants — Phase 4: resolve a user into the PDP's subject (their grants).
//
// A user's authorization is the SET of grants they hold, each scoped to one
// entity. This is the single place that builds that set, UNIONing three sources
// (each canonical for its own grants — no duplication):
//   - household_members  → one tenant-scoped household grant per accepted membership
//   - internal_admin_users → one global-scoped staff grant
//   - subject_grants     → additive grants (pro / cross-tenant / comped / future)
//
// The result plugs straight into authorize({ subject, ... }). Because a user can
// hold many scoped grants, multi-tenant access needs no new role strings — the
// fix for role explosion lives here.
// =============================================================================

import { householdRoleId, internalRoleId } from './roleMap.js'

function warnUnmapped(source, role) {
  console.warn(JSON.stringify({ tag: 'abac-grants', kind: 'unmapped-role', source, role }))
}

/**
 * Resolve every grant a user holds across all sources into the PDP subject:
 *   { grants: [{ roleId, scope: { type, id } }, ...] }
 * Roles with no matrix mapping are skipped (and logged) rather than guessed.
 */
export async function resolveSubjectGrants(db, userId) {
  const grants = []

  const households = await db.query(
    `select household_id as "householdId", role
       from household_members
      where user_id = $1 and status = 'accepted'`,
    [userId],
  )
  for (const row of households.rows) {
    const roleId = householdRoleId(row.role)
    if (roleId) grants.push({ roleId, scope: { type: 'tenant', id: row.householdId } })
    else warnUnmapped('household', row.role)
  }

  const admins = await db.query(
    `select role from internal_admin_users where user_id = $1 and status = 'active'`,
    [userId],
  )
  for (const row of admins.rows) {
    const roleId = internalRoleId(row.role)
    if (roleId) grants.push({ roleId, scope: { type: 'global' } })
    else warnUnmapped('internal', row.role)
  }

  // subject_grants is additive and optional. Tolerate it not existing yet
  // (code deployed before migration 019) — but ONLY the undefined_table error;
  // anything else is a real fault and must surface.
  let extraRows = []
  try {
    const extra = await db.query(
      `select role_id as "roleId", scope_type as "scopeType", scope_id as "scopeId"
         from subject_grants
        where user_id = $1
          and status = 'active'
          and (expires_at is null or expires_at > now())`,
      [userId],
    )
    extraRows = extra.rows
  } catch (err) {
    if (err?.code !== '42P01') throw err // 42P01 = undefined_table
    console.warn(JSON.stringify({ tag: 'abac-grants', kind: 'subject-grants-table-absent' }))
  }
  for (const row of extraRows) {
    grants.push({
      roleId: row.roleId,
      scope: { type: row.scopeType, id: row.scopeId ?? undefined },
    })
  }

  return { grants }
}
