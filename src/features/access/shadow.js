// =============================================================================
// access/shadow — Phase 2 shadow mode for the RBAC→ABAC migration.
//
// Runs the PDP next to the live RBAC checks, compares the two decisions, and
// LOGS disagreements. It enforces nothing and never throws: the legacy check is
// still the only thing that decides access. This is the safety net that flushes
// out the INVENTORY.md discrepancies against real call paths before any cutover.
//
// Opt-in per call site: pass `shadowOpts` to requireHouseholdRole(...). The hook
// fires where the role is known and `legacyAllowed` is computed, so it observes
// both the allow and the deny paths.
//
// Toggle: ABAC_SHADOW=off silences logging (comparison still returns, for tests).
//         ABAC_SHADOW_VERBOSE=1 also logs agreements (default: only disagreements).
// =============================================================================

import { authorize } from './authorize.js'
import { householdRoleId, internalRoleId } from './roleMap.js'

// Re-export so existing shadow.js importers keep working.
export { householdRoleId, internalRoleId }

function logShadow(kind, fields) {
  if (process.env.ABAC_SHADOW === 'off') return
  if (kind === 'agree' && process.env.ABAC_SHADOW_VERBOSE !== '1') return
  const line = JSON.stringify({ tag: 'abac-shadow', kind, ...fields })
  if (kind === 'DISAGREE' || kind === 'error') console.warn(line)
  else console.log(line)
}

/**
 * Compare the legacy RBAC decision against the PDP for one access check.
 * Pure + total: always returns a structured result, never throws, never logs an
 * exception up the stack. Returns:
 *   { status: 'agree'|'disagree'|'skip'|'error', role, roleId, action,
 *     legacyAllowed, pdpAllow, reason }
 */
export function shadowCompare({ role, roleId, action, scope, resource, legacyAllowed, label }) {
  try {
    const rid = roleId ?? householdRoleId(role)
    if (!rid) {
      const result = { status: 'skip', role, roleId: null, action, legacyAllowed, note: 'no matrix mapping' }
      logShadow('skip', { label, ...result })
      return result
    }
    const subject = { grants: [{ roleId: rid, scope: scope ?? { type: 'global' } }] }
    const decision = authorize({ subject, action, resource: resource ?? {} })
    const status = decision.allow === legacyAllowed ? 'agree' : 'disagree'
    const result = {
      status,
      role,
      roleId: rid,
      action,
      legacyAllowed,
      pdpAllow: decision.allow,
      reason: decision.reason,
    }
    logShadow(status === 'disagree' ? 'DISAGREE' : 'agree', { label, ...result, detail: decision.detail })
    return result
  } catch (err) {
    const result = { status: 'error', role, action, legacyAllowed, error: err?.message }
    logShadow('error', { label, ...result })
    return result
  }
}
