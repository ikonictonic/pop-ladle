import { shadowCompare } from '../access/shadow.js'
import { authorize, REASON } from '../access/authorize.js'
import { resolveSubjectGrants } from '../access/grants.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function createHttpError(statusCode, code, message, expose = true) {
  const err = new Error(message)
  err.statusCode = statusCode
  err.code = code
  err.expose = expose
  return err
}

export function normalizeUuid(value, code, message) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw createHttpError(400, code, message, true)
  }

  return value.toLowerCase()
}

export function normalizeHouseholdId(value) {
  return normalizeUuid(value, 'INVALID_HOUSEHOLD_ID', 'Household id must be a UUID.')
}

// Load + validate an active household membership for this user. Throws 404 if
// the household is missing/inactive, 403 if the user is not an accepted member.
// No capability/role gate here — that is the caller's job (requireHouseholdRole
// for legacy role-arrays, requireHouseholdCapability for the PDP).
async function loadHouseholdMembership(db, userId, householdId) {
  const normalizedHouseholdId = normalizeHouseholdId(householdId)
  const result = await db.query(
    `
      select
        h.id as "householdId",
        h.name as "householdName",
        h.status as "householdStatus",
        hm.id as "membershipId",
        hm.role,
        hm.status as "membershipStatus",
        hm.accepted_at as "acceptedAt"
      from households h
      left join household_members hm
        on hm.household_id = h.id
       and hm.user_id = $2
       and hm.status = 'accepted'
      where h.id = $1
        and h.status = 'active'
      limit 1
    `,
    [normalizedHouseholdId, userId],
  )

  const access = result.rows[0]

  if (!access) {
    throw createHttpError(404, 'HOUSEHOLD_NOT_FOUND', 'Household was not found.', true)
  }
  if (!access.membershipId) {
    throw createHttpError(403, 'HOUSEHOLD_ACCESS_DENIED', 'You do not have access to this household.', true)
  }

  return access
}

// Shape the raw membership row into the access object callers consume.
function shapeAccess(access) {
  return {
    household: {
      id: access.householdId,
      name: access.householdName,
      status: access.householdStatus,
    },
    membership: {
      id: access.membershipId,
      role: access.role,
      status: access.membershipStatus,
      acceptedAt: access.acceptedAt,
    },
  }
}

export async function requireHouseholdRole(db, userId, householdId, allowedRoles, shadowOpts) {
  const access = await loadHouseholdMembership(db, userId, householdId)

  // Phase 2 shadow mode (opt-in): compare the PDP against this RBAC decision
  // without affecting it. Observes both the allow and deny paths. Never throws.
  if (shadowOpts) {
    shadowCompare({
      role: access.role,
      action: shadowOpts.action,
      scope: { type: 'tenant', id: access.householdId },
      resource: shadowOpts.resource
        ?? { type: shadowOpts.resourceType ?? 'resource', scope: { type: 'tenant', id: access.householdId } },
      legacyAllowed: allowedRoles.includes(access.role),
      label: shadowOpts.label ?? 'requireHouseholdRole',
    })
  }

  if (!allowedRoles.includes(access.role)) {
    throw createHttpError(
      403,
      'HOUSEHOLD_ROLE_REQUIRED',
      `This action requires one of these household roles: ${allowedRoles.join(', ')}.`,
      true,
    )
  }

  return shapeAccess(access)
}

// Phase 3: PDP-enforced household gate. The capability (not a role-array) is the
// decision. Same membership/404/403 semantics as requireHouseholdRole, then the
// PDP authorizes `action` against the member's matrix grant. Use this for
// migrated call sites; pass opts.resource to supply domain / clinical-gate
// attributes when the action needs them. Entitlement checks stay separate.
export async function requireHouseholdCapability(db, userId, householdId, action, opts = {}) {
  // Membership gate first: precise 404 (no household) / 403 (not a member). This
  // also confirms the subject can touch this tenant at all.
  const access = await loadHouseholdMembership(db, userId, householdId)
  const resource = opts.resource
    ?? { type: opts.resourceType ?? 'resource', scope: { type: 'tenant', id: access.householdId } }

  // Decide against the member's FULL grant set (Phase 4). Scope in the PDP keeps
  // only the grants that reach this household; additive subject_grants apply too.
  // opts.env carries governance context (e.g. dual-control approval, Phase 6).
  const subject = await resolveSubjectGrants(db, userId)
  const decision = authorize({ subject, action, resource, env: opts.env ?? {} })

  if (!decision.allow) {
    // Dual control is a distinct outcome: the subject CAN do this, it just needs
    // a second approver — surface a code the client can act on differently.
    if (decision.reason === REASON.DUAL_CONTROL_REQUIRED) {
      throw createHttpError(403, 'DUAL_CONTROL_REQUIRED', 'This action requires a second approver.', true)
    }
    throw createHttpError(
      403,
      'CAPABILITY_REQUIRED',
      `This action requires the "${action}" capability.`,
      true,
    )
  }

  return shapeAccess(access)
}
