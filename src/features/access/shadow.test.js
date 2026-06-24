// =============================================================================
// shadow.test.js — Phase 2 shadow-mode harness tests.
// Run with `npm test`. Pure: no DB/env. Logging is silenced here so only the
// returned comparison is asserted.
// =============================================================================

process.env.ABAC_SHADOW = 'off'

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shadowCompare, householdRoleId, internalRoleId } from './shadow.js'

const tenant = (id) => ({ type: 'tenant', id })

test('role mappings resolve live roles to matrix ids', () => {
  assert.equal(householdRoleId('owner'), 'PL-069-HH')
  assert.equal(householdRoleId('caregiver'), 'PL-071-HH')
  assert.equal(householdRoleId('nope'), null)
  assert.equal(internalRoleId('super_admin'), 'PL-001-ADM')
})

test('generator allow path AGREES (legacy allows, PDP allows)', () => {
  const r = shadowCompare({
    role: 'caregiver',
    action: 'recipe:generate',
    scope: tenant('hh-1'),
    resource: { type: 'recipe', scope: tenant('hh-1') },
    legacyAllowed: true,
    label: 'recipe-brain:create',
  })
  assert.equal(r.status, 'agree')
  assert.equal(r.pdpAllow, true)
})

test('generator deny path AGREES (legacy denies viewer, PDP denies)', () => {
  const r = shadowCompare({
    role: 'viewer',
    action: 'recipe:generate',
    scope: tenant('hh-1'),
    resource: { type: 'recipe', scope: tenant('hh-1') },
    legacyAllowed: false,
    label: 'recipe-brain:create',
  })
  assert.equal(r.status, 'agree')
  assert.equal(r.pdpAllow, false)
})

test('recipe:delete DISAGREES on the live path (legacy allows owner, PDP denies — discrepancy #2)', () => {
  const r = shadowCompare({
    role: 'owner',
    action: 'recipe:delete',
    scope: tenant('hh-1'),
    resource: { type: 'recipe', scope: tenant('hh-1') },
    legacyAllowed: true,
    label: 'recipe:delete',
  })
  assert.equal(r.status, 'disagree')
  assert.equal(r.legacyAllowed, true)
  assert.equal(r.pdpAllow, false)
})

test('a hypothetical legacy over-grant DISAGREES (legacy allows viewer to generate, PDP denies)', () => {
  const r = shadowCompare({
    role: 'viewer',
    action: 'recipe:generate',
    scope: tenant('hh-1'),
    resource: { type: 'recipe', scope: tenant('hh-1') },
    legacyAllowed: true,
    label: 'hypothetical',
  })
  assert.equal(r.status, 'disagree')
})

test('unmapped role is skipped, not failed', () => {
  const r = shadowCompare({ role: 'employee_caregiver', action: 'recipe:generate', legacyAllowed: true })
  assert.equal(r.status, 'skip')
})

test('shadowCompare is total — degenerate input returns a result, never throws', () => {
  assert.doesNotThrow(() => shadowCompare({}))
  const r = shadowCompare({})
  assert.ok(['skip', 'agree', 'disagree', 'error'].includes(r.status))
})
