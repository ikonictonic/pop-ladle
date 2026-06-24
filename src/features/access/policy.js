// =============================================================================
// access/policy — Phase 0 loader over the generated ABAC policy artifact.
//
// Read-only shaping of the compiled matrix (policy.generated.js). There is NO
// authorize() here yet: Phase 0 is inventory + vocabulary only, evaluated by
// nothing. The Policy Decision Point (PDP) lands in Phase 1 and will consume
// these helpers. See INVENTORY.md for how today's RBAC checks map onto the
// capabilities exposed here.
// =============================================================================

import { ABAC_POLICY } from './policy.generated.js'

export const POLICY = ABAC_POLICY
export const ROLES = ABAC_POLICY.roles
export const VOCABULARY = ABAC_POLICY.vocabulary

const ROLES_BY_ID = new Map(ROLES.map((r) => [r.roleId, r]))
const ROLES_BY_NAME = new Map(ROLES.map((r) => [r.role.toLowerCase(), r]))

/** Look up a role record by its PL-NNN-XXX id. Null if unknown. */
export function getRole(roleId) {
  return ROLES_BY_ID.get(roleId) ?? null
}

/** Look up a role record by its human name (case-insensitive). Null if unknown. */
export function getRoleByName(name) {
  return ROLES_BY_NAME.get((name ?? '').toLowerCase()) ?? null
}

/** Role ids whose Phase column equals the given phase (e.g. 'MVP'). */
export function roleIdsForPhase(phase) {
  return ROLES.filter((r) => r.phase === phase).map((r) => r.roleId)
}

/**
 * Normalize a role's effective grants into sets, for the future PDP. Returns
 * { capabilities, denies, hasWildcard }; hasWildcard means a "* (all zones)"
 * grant (root) that the PDP will treat as allow-all (still subject to the
 * non-overridable clinical-gate + domain guardrails). Null if role unknown.
 */
export function resolveRoleGrants(roleId) {
  const role = getRole(roleId)
  if (!role) return null
  const grants = [...role.capabilities, ...role.customGrants]
  return {
    capabilities: new Set(grants.filter((t) => !t.startsWith('*'))),
    denies: new Set(role.denies),
    hasWildcard: grants.some((t) => t.startsWith('*')),
    domains: role.domainsAtomic,
  }
}

/**
 * The capability tokens a role effectively grants, as a sorted array — for UI
 * hinting only (the server stays the enforcement layer; this just lets the
 * frontend hide what the user can't do). capabilities ∪ customGrants minus hard
 * (non-conditional) denies; a wildcard/root role returns ['*']. Null if unknown.
 */
export function effectiveCapabilities(roleId) {
  const resolved = resolveRoleGrants(roleId)
  if (!resolved) return null
  if (resolved.hasWildcard) return ['*']
  const denies = [...resolved.denies].filter((d) => !d.includes('('))
  const isDenied = (cap) =>
    denies.some((d) => d === cap || (d.endsWith('*') && cap.startsWith(d.slice(0, -1))))
  return [...resolved.capabilities].filter((c) => !isDenied(c)).sort()
}
