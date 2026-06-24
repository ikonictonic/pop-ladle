// =============================================================================
// access/roleMap — bridge from the live code's role strings to matrix role ids.
//
// Foundational: imported by both the observability layer (shadow.js) and the
// enforcement layer (requireHouseholdCapability). Until the Phase 4 grants model
// lands, a user's grant is derived from their single household_members.role (or
// internal_admin_users.role), scoped to that one tenant.
// =============================================================================

const HOUSEHOLD_ROLE_TO_PL = {
  owner: 'PL-069-HH',
  co_owner: 'PL-070-HH',
  caregiver: 'PL-071-HH',
  viewer: 'PL-072-HH',
}

const INTERNAL_ROLE_TO_PL = {
  super_admin: 'PL-001-ADM',
  clinical_admin: 'PL-004-ADM',
  support_admin: 'PL-011-ADM',
}

export function householdRoleId(role) {
  return HOUSEHOLD_ROLE_TO_PL[role] ?? null
}

export function internalRoleId(role) {
  return INTERNAL_ROLE_TO_PL[role] ?? null
}
