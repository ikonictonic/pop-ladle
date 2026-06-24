// =============================================================================
// policy.generated.test.js — Phase 0 validation of the compiled ABAC artifact.
// Run with `npm test`. No DB/env: pure data assertions over policy.generated.js.
//
// Two jobs:
//   1. Structural integrity — the CSV compiled cleanly into 143 well-formed rows.
//   2. Doctrine anchors — the MVP household roles carry exactly the capabilities
//      the live RBAC code enforces today, so Phase 3 can swap role-arrays for
//      capability checks with a guaranteed-equivalent starting point.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { POLICY, ROLES, VOCABULARY, getRole, resolveRoleGrants, effectiveCapabilities } from './policy.js'

// ---- 1. Structural integrity ----------------------------------------------

test('artifact compiled the full 143-role matrix', () => {
  assert.equal(POLICY.roleCount, 143)
  assert.equal(ROLES.length, 143)
})

test('every role is well-formed and ids are unique', () => {
  const seen = new Set()
  for (const r of ROLES) {
    assert.match(r.roleId, /^PL-\d{3}-[A-Z]+$/, `bad role id: ${r.roleId}`)
    assert.ok(r.role.length > 0, `empty role name for ${r.roleId}`)
    assert.match(r.tier, /^(T\d|TC|TEN|O\d)$/, `bad tier for ${r.roleId}: ${r.tier}`)
    assert.ok(['Company', 'Customer'].includes(r.side), `bad side for ${r.roleId}`)
    assert.ok(Array.isArray(r.capabilities), `capabilities not array for ${r.roleId}`)
    assert.ok(!seen.has(r.roleId), `duplicate role id: ${r.roleId}`)
    seen.add(r.roleId)
  }
})

test('vocabulary captured capabilities and denies', () => {
  assert.ok(VOCABULARY.capabilities.includes('recipe:generate'))
  assert.ok(VOCABULARY.capabilities.includes('view'))
  assert.ok(VOCABULARY.denies.includes('household:delete'))
  assert.ok(VOCABULARY.denies.includes('billing:manage'))
  assert.ok(VOCABULARY.denies.includes('recipe:delete'))
  // Atomic domains underpin the Food-vs-Medical boundary (concern #2).
  assert.ok(VOCABULARY.domainsAtomic.includes('FOOD'))
  assert.ok(VOCABULARY.domainsAtomic.includes('CLINICAL'))
})

// ---- 2. MVP household-role doctrine anchors --------------------------------
// PL-069 Owner | PL-070 Co-Owner | PL-071 Caregiver | PL-072 Viewer | PL-073 Care Recipient

function grants(roleId) {
  const g = resolveRoleGrants(roleId)
  assert.ok(g, `missing role ${roleId}`)
  return g
}

test('Owner (PL-069) is the full tenant role', () => {
  const g = grants('PL-069-HH')
  for (const cap of ['recipe:generate', 'household:delete', 'billing:manage', 'recipe:edit_content']) {
    assert.ok(g.capabilities.has(cap), `Owner should hold ${cap}`)
  }
})

test('Co-Owner (PL-070) generates but is denied billing + delete + transfer', () => {
  const g = grants('PL-070-HH')
  assert.ok(g.capabilities.has('recipe:generate'))
  assert.ok(g.denies.has('billing:manage'))
  assert.ok(g.denies.has('household:delete'))
  assert.ok(g.denies.has('owner_transfer'))
  // The bug we flagged: Co-Owner must NOT be granted owner-only delete/billing.
  assert.ok(!g.capabilities.has('household:delete'))
  assert.ok(!g.capabilities.has('billing:manage'))
})

test('Caregiver (PL-071) generates but cannot delete recipes', () => {
  const g = grants('PL-071-HH')
  assert.ok(g.capabilities.has('recipe:generate'))
  assert.ok(g.denies.has('recipe:delete'))
})

test('Viewer (PL-072) cannot generate', () => {
  const g = grants('PL-072-HH')
  assert.ok(!g.capabilities.has('recipe:generate'))
  assert.ok(g.capabilities.has('view'))
})

test('recipe:generate doctrine: exactly Owner/Co-Owner/Caregiver among MVP household roles', () => {
  const householdMvp = ROLES.filter((r) => r.domainsAtomic.includes('HOUSEHOLD') && r.phase === 'MVP')
  const generators = householdMvp
    .filter((r) => resolveRoleGrants(r.roleId).capabilities.has('recipe:generate'))
    .map((r) => r.role)
    .sort()
  assert.deepEqual(generators, ['Caregiver', 'Co-Owner', 'Owner'])
})

test('Global Super Admin (PL-001) holds the wildcard but cannot bypass the clinical gate', () => {
  const g = grants('PL-001-ADM')
  assert.equal(g.hasWildcard, true)
  assert.equal(getRole('PL-001-ADM').clinicalGate, 'cannot_bypass_clinical_gate')
})

// ---- effectiveCapabilities (the /me UI capability set) ---------------------

test('effectiveCapabilities feeds the frontend the right per-role set', () => {
  const owner = effectiveCapabilities('PL-069-HH')
  assert.ok(owner.includes('recipe:generate'))
  assert.ok(owner.includes('household:delete'))

  const caregiver = effectiveCapabilities('PL-071-HH')
  assert.ok(caregiver.includes('recipe:generate'))

  const viewer = effectiveCapabilities('PL-072-HH')
  assert.ok(!viewer.includes('recipe:generate'))
  assert.ok(viewer.includes('view'))

  // Root collapses to the wildcard marker the frontend treats as allow-all.
  assert.deepEqual(effectiveCapabilities('PL-001-ADM'), ['*'])
  assert.equal(effectiveCapabilities('PL-999-XXX'), null)
})
