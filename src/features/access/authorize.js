// =============================================================================
// access/authorize — the Policy Decision Point (PDP). Phase 1 of RBAC→ABAC.
//
// Pure and deterministic: authorize() takes already-resolved attributes and
// returns a decision. No DB, no clock, no I/O — so it is exhaustively testable
// (see authorize.test.js). This is the deterministic core the client's concern
// #3 demands: the LLM never decides access; this function does, and it is the
// single funnel every future call site will route through.
//
// STILL DORMANT: nothing in the request path imports this yet. Phase 2 runs it
// in shadow mode next to the legacy role checks; Phase 3 cuts call sites over.
//
// Contract:
//   authorize({ subject, action, resource, env }) -> { allow, reason, detail, ... }
//     subject  = { grants: [{ roleId, scope: { type, id } }] }
//     action   = capability token string, e.g. 'recipe:generate'
//     resource = { type, scope: { type, id }, domains: [...], clinicalGateStatus }
//     env      = reserved (dual-control, break-glass) — not yet consulted
//
// Evaluation order (deny-wins, default-deny):
//   1. Clinical-gate guardrail — non-overridable, applies even to root.
//   2. Scope — only grants that scope to the resource are considered.
//   3. Domain guardrail — Food vs Medical boundary; wildcard (root) is exempt.
//   4. Explicit deny among applicable grants wins over any allow.
//   5. A matching capability (or root wildcard) allows. Otherwise default-deny.
//
// Entitlements (plan tier: requireGeneratorAccess etc.) are deliberately NOT
// evaluated here — they are a separate axis ANDed at the call site. See
// INVENTORY.md.
// =============================================================================

import { resolveRoleGrants } from './policy.js'

export const REASON = Object.freeze({
  ALLOWED: 'ALLOWED',
  EXPLICIT_DENY: 'EXPLICIT_DENY',
  CLINICAL_GATE_BLOCK: 'CLINICAL_GATE_BLOCK',
  DOMAIN_BOUNDARY: 'DOMAIN_BOUNDARY',
  DUAL_CONTROL_REQUIRED: 'DUAL_CONTROL_REQUIRED',
  NO_APPLICABLE_GRANT: 'NO_APPLICABLE_GRANT',
  DEFAULT_DENY: 'DEFAULT_DENY',
})

// Actions that ship/expose a recipe and therefore require a gate-cleared recipe.
// Row 1 of the matrix: "Even root cannot publish a recipe that has not cleared
// the Clinical Review Gate."
export const GATE_CONTROLLED_ACTIONS = Object.freeze(['publish:public', 'copy:recipe', 'library:accept'])
const GATE_CONTROLLED = new Set(GATE_CONTROLLED_ACTIONS)
const GATE_CLEARED_STATUSES = new Set(['approved', 'approved_with_caveats'])

// Phase 6: high-risk capabilities that need a SECOND approver on top of the
// capability (the matrix "Dual Control" column). Even a capable subject is
// blocked until env.dualControlSatisfied is recorded. A pattern matches its
// exact action and any deeper-qualified form (iam:grant_role:household, ...).
export const DUAL_CONTROL_ACTIONS = Object.freeze([
  'household:delete',
  'owner_transfer',
  'iam:grant_role',
  'keys:rotate',
  'model:key_manage',
  'config:global',
  'retention:configure',
  'breakglass:approve',
])

function requiresDualControl(action) {
  return DUAL_CONTROL_ACTIONS.some((p) => action === p || action.startsWith(`${p}:`))
}

function decision(allow, reason, detail, matchedGrant = null, conditionalDenies = []) {
  return { allow, reason, detail, matchedGrant, conditionalDenies }
}

// Token match: exact, or a trailing-'*' prefix wildcard (e.g. 'iam:*', 'billing:*').
function tokenMatches(pattern, action) {
  if (pattern === action) return true
  if (pattern.endsWith('*')) return action.startsWith(pattern.slice(0, -1))
  return false
}

// A grant scopes to a resource if it is global, the resource is unscoped, or the
// scope type+id match exactly. (Hierarchical scopes land with the grants model.)
function scopeCovers(grantScope, resourceScope) {
  if (!grantScope || grantScope.type === 'global') return true
  if (!resourceScope) return true
  return grantScope.type === resourceScope.type && grantScope.id === resourceScope.id
}

// A grant may act on a resource's domain if the resource is undomained, the
// grant is a root wildcard (cross-domain), or their domains intersect.
function domainOk(grant, resource) {
  const resDomains = resource?.domains
  if (!resDomains || resDomains.length === 0) return true
  if (grant.hasWildcard) return true
  return grant.domains.some((d) => resDomains.includes(d))
}

// Parenthetical denies (e.g. 'care_profile:edit(beyond acceptance)') are field-
// conditional; the PDP cannot evaluate them without field context, so it
// surfaces them rather than hard-denying. Plain tokens are hard denies.
function classifyDenies(denies) {
  const hard = []
  const conditional = []
  for (const d of denies) (d.includes('(') ? conditional : hard).push(d)
  return { hard, conditional }
}

function hasCapability(grant, action) {
  if (grant.hasWildcard) return true
  for (const cap of grant.capabilities) if (tokenMatches(cap, action)) return true
  return false
}

export function authorize({ subject, action, resource = {}, env = {} } = {}) {
  if (!action || typeof action !== 'string') {
    return decision(false, REASON.DEFAULT_DENY, 'No action specified')
  }

  const rawGrants = Array.isArray(subject?.grants) ? subject.grants : []
  const grants = rawGrants
    .map((g) => {
      const resolved = resolveRoleGrants(g.roleId)
      if (!resolved) return null
      const { hard, conditional } = classifyDenies([...resolved.denies])
      return {
        roleId: g.roleId,
        scope: g.scope ?? { type: 'global' },
        capabilities: resolved.capabilities,
        hasWildcard: resolved.hasWildcard,
        domains: resolved.domains ?? [],
        hardDenies: hard,
        conditionalDenies: conditional,
      }
    })
    .filter(Boolean)

  // 1. Clinical-gate guardrail — non-overridable, ahead of everything else.
  if (GATE_CONTROLLED.has(action) && !GATE_CLEARED_STATUSES.has(resource.clinicalGateStatus)) {
    return decision(
      false,
      REASON.CLINICAL_GATE_BLOCK,
      `"${action}" requires a gate-cleared recipe (status: ${resource.clinicalGateStatus ?? 'none'})`,
    )
  }

  // 2. Scope.
  const scopeApplicable = grants.filter((g) => scopeCovers(g.scope, resource.scope))
  if (scopeApplicable.length === 0) {
    return decision(false, REASON.NO_APPLICABLE_GRANT, 'No grant scopes to this resource')
  }

  // 3. Domain guardrail.
  const applicable = scopeApplicable.filter((g) => domainOk(g, resource))
  const conditionalDenies = applicable.flatMap((g) => g.conditionalDenies)

  // 4. Explicit deny wins.
  const denier = applicable.find((g) => g.hardDenies.some((d) => tokenMatches(d, action)))
  if (denier) {
    return decision(
      false,
      REASON.EXPLICIT_DENY,
      `Role ${denier.roleId} explicitly denies "${action}"`,
      denier.roleId,
      conditionalDenies,
    )
  }

  // 5. A matching capability allows — but a dual-control action still needs a
  //    recorded second approver (this comes AFTER the capability check, so a
  //    subject who simply lacks the capability gets the capability denial, not a
  //    misleading "needs a second approver").
  const allower = applicable.find((g) => hasCapability(g, action))
  if (allower) {
    if (requiresDualControl(action) && env.dualControlSatisfied !== true) {
      return decision(
        false,
        REASON.DUAL_CONTROL_REQUIRED,
        `"${action}" requires a second approver (dual control)`,
        allower.roleId,
        conditionalDenies,
      )
    }
    return decision(
      true,
      REASON.ALLOWED,
      allower.hasWildcard
        ? `Root wildcard grant ${allower.roleId}`
        : `Role ${allower.roleId} grants "${action}"`,
      allower.roleId,
      conditionalDenies,
    )
  }

  // No allow: distinguish a domain-boundary block from a plain default-deny so
  // the failure is legible (and so concern #2 is observable).
  const blockedByDomain = scopeApplicable.some((g) => !domainOk(g, resource) && hasCapability(g, action))
  if (blockedByDomain) {
    return decision(
      false,
      REASON.DOMAIN_BOUNDARY,
      `Subject holds "${action}" but outside the resource domain ${JSON.stringify(resource.domains)}`,
    )
  }

  return decision(false, REASON.DEFAULT_DENY, `No grant provides "${action}"`)
}

/** Boolean convenience wrapper around authorize(). */
export function isAllowed(input) {
  return authorize(input).allow
}
