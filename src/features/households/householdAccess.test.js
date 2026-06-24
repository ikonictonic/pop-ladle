// =============================================================================
// householdAccess.test.js — Phase 3 cutover lock for requireHouseholdCapability.
// Run with `npm test`. Hermetic: the membership query is served by a fake db.
//
// Proves the PDP-enforced gate preserves the legacy 404/403 membership
// semantics AND decides recipe:generate identically to GENERATE_ROLES
// (owner/co_owner/caregiver allow, viewer deny) — the equivalence Phase 2 shadow
// observed, now asserted on the enforcement path.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { requireHouseholdCapability } from './householdAccess.js'

const HH_ID = '00000000-0000-4000-8000-000000000001'

// A SQL-aware fake db. requireHouseholdCapability runs the membership-gate query
// plus the three resolveSubjectGrants() queries; this routes each to the right
// rows. `null` row → household not found.
function fakeDb(row) {
  return {
    async query(sql) {
      if (sql.includes('from households h')) return { rows: row ? [row] : [] } // membership gate
      if (sql.includes('from household_members')) { // resolver: household grants
        return { rows: row && row.role ? [{ householdId: row.householdId, role: row.role }] : [] }
      }
      if (sql.includes('internal_admin_users')) return { rows: [] }
      if (sql.includes('subject_grants')) return { rows: [] }
      return { rows: [] }
    },
  }
}

function memberRow(role) {
  return {
    householdId: HH_ID,
    householdName: 'Test Household',
    householdStatus: 'active',
    membershipId: role ? 'm-1' : null,
    role: role ?? null,
    membershipStatus: role ? 'accepted' : null,
    acceptedAt: role ? '2026-01-01T00:00:00Z' : null,
  }
}

async function rejectsWith(promise, code, statusCode) {
  await assert.rejects(promise, (err) => err.code === code && err.statusCode === statusCode)
}

test('owner / co_owner / caregiver are granted recipe:generate', async () => {
  for (const role of ['owner', 'co_owner', 'caregiver']) {
    const access = await requireHouseholdCapability(fakeDb(memberRow(role)), 'u-1', HH_ID, 'recipe:generate', { resourceType: 'recipe' })
    assert.equal(access.membership.role, role)
    assert.equal(access.household.id, HH_ID)
  }
})

test('viewer is denied recipe:generate with CAPABILITY_REQUIRED', async () => {
  await rejectsWith(
    requireHouseholdCapability(fakeDb(memberRow('viewer')), 'u-1', HH_ID, 'recipe:generate', { resourceType: 'recipe' }),
    'CAPABILITY_REQUIRED',
    403,
  )
})

test('non-member still gets HOUSEHOLD_ACCESS_DENIED (membership semantics preserved)', async () => {
  await rejectsWith(
    requireHouseholdCapability(fakeDb(memberRow(null)), 'u-1', HH_ID, 'recipe:generate'),
    'HOUSEHOLD_ACCESS_DENIED',
    403,
  )
})

test('missing household still gets HOUSEHOLD_NOT_FOUND', async () => {
  await rejectsWith(
    requireHouseholdCapability(fakeDb(null), 'u-1', HH_ID, 'recipe:generate'),
    'HOUSEHOLD_NOT_FOUND',
    404,
  )
})

test('the cutover matches the legacy GENERATE_ROLES set exactly', async () => {
  const allowed = []
  for (const role of ['owner', 'co_owner', 'caregiver', 'viewer']) {
    try {
      await requireHouseholdCapability(fakeDb(memberRow(role)), 'u-1', HH_ID, 'recipe:generate', { resourceType: 'recipe' })
      allowed.push(role)
    } catch { /* denied */ }
  }
  assert.deepEqual(allowed, ['owner', 'co_owner', 'caregiver'])
})
