// =============================================================================
// authorize.test.js — golden tests for the PDP (Phase 1).
// Run with `npm test`. Pure: no DB/env.
//
// This is the deterministic enforcement proof the client's concern #3 needs —
// every decision is a table lookup with an asserted outcome, not an LLM judgment.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { authorize, isAllowed, REASON } from './authorize.js'

const tenant = (id) => ({ type: 'tenant', id })
const subject = (roleId, scope) => ({ grants: [{ roleId, scope }] })
const recipeIn = (hhId, extra = {}) => ({ type: 'recipe', scope: tenant(hhId), ...extra })

// ---- Household capability decisions ----------------------------------------

test('Caregiver generates in their own household', () => {
  const d = authorize({
    subject: subject('PL-071-HH', tenant('hh-1')),
    action: 'recipe:generate',
    resource: recipeIn('hh-1'),
  })
  assert.equal(d.allow, true)
  assert.equal(d.reason, REASON.ALLOWED)
  // The caregiver's field-conditional deny is surfaced, not silently dropped.
  assert.ok(d.conditionalDenies.includes('care_profile:edit(beyond acceptance)'))
})

test('Viewer cannot generate (no capability → default deny)', () => {
  const d = authorize({
    subject: subject('PL-072-HH', tenant('hh-1')),
    action: 'recipe:generate',
    resource: recipeIn('hh-1'),
  })
  assert.equal(d.allow, false)
  assert.equal(d.reason, REASON.DEFAULT_DENY)
})

test('Caregiver is explicitly denied recipe:delete', () => {
  const d = authorize({
    subject: subject('PL-071-HH', tenant('hh-1')),
    action: 'recipe:delete',
    resource: recipeIn('hh-1'),
  })
  assert.equal(d.allow, false)
  assert.equal(d.reason, REASON.EXPLICIT_DENY)
})

test('Caregiver DENY:iam:* blocks iam:invite via prefix wildcard', () => {
  const d = authorize({
    subject: subject('PL-071-HH', tenant('hh-1')),
    action: 'iam:invite',
    resource: { type: 'household', scope: tenant('hh-1') },
  })
  assert.equal(d.allow, false)
  assert.equal(d.reason, REASON.EXPLICIT_DENY)
})

test('Co-Owner generates but is explicitly denied billing + delete', () => {
  const base = { subject: subject('PL-070-HH', tenant('hh-1')) }
  assert.equal(isAllowed({ ...base, action: 'recipe:generate', resource: recipeIn('hh-1') }), true)
  assert.equal(
    authorize({ ...base, action: 'billing:manage', resource: { type: 'household', scope: tenant('hh-1') } }).reason,
    REASON.EXPLICIT_DENY,
  )
  assert.equal(
    authorize({ ...base, action: 'household:delete', resource: { type: 'household', scope: tenant('hh-1') } }).reason,
    REASON.EXPLICIT_DENY,
  )
})

test('Owner deleting the household needs dual control (capability alone is not enough)', () => {
  const base = {
    subject: subject('PL-069-HH', tenant('hh-1')),
    action: 'household:delete',
    resource: { type: 'household', scope: tenant('hh-1') },
  }
  // Capable, but no second approver yet.
  const pending = authorize(base)
  assert.equal(pending.allow, false)
  assert.equal(pending.reason, REASON.DUAL_CONTROL_REQUIRED)
  // Second approver recorded → allowed.
  assert.equal(authorize({ ...base, env: { dualControlSatisfied: true } }).allow, true)
})

test('DISCREPANCY #2 RECONCILED: matrix now grants recipe:delete to Owner (and Co-Owner)', () => {
  // The inventory gap is closed: the CSV grants recipe:delete to owner (PL-069)
  // and co_owner (PL-070), so the PDP now agrees with legacy RBAC (which let
  // owner/co_owner delete). Caregiver keeps its explicit DENY (see above).
  const owner = authorize({
    subject: subject('PL-069-HH', tenant('hh-1')),
    action: 'recipe:delete',
    resource: recipeIn('hh-1'),
  })
  assert.equal(owner.allow, true)
  assert.equal(owner.reason, REASON.ALLOWED)

  const coOwner = authorize({
    subject: subject('PL-070-HH', tenant('hh-1')),
    action: 'recipe:delete',
    resource: recipeIn('hh-1'),
  })
  assert.equal(coOwner.allow, true)
})

// ---- Scope (multi-tenant) --------------------------------------------------

test('a grant does not reach a different household', () => {
  const d = authorize({
    subject: subject('PL-071-HH', tenant('hh-1')),
    action: 'recipe:generate',
    resource: recipeIn('hh-2'),
  })
  assert.equal(d.allow, false)
  assert.equal(d.reason, REASON.NO_APPLICABLE_GRANT)
})

test('multiple grants resolve per-tenant', () => {
  const multi = { grants: [
    { roleId: 'PL-071-HH', scope: tenant('hh-1') }, // caregiver here
    { roleId: 'PL-072-HH', scope: tenant('hh-2') }, // viewer there
  ] }
  assert.equal(isAllowed({ subject: multi, action: 'recipe:generate', resource: recipeIn('hh-1') }), true)
  assert.equal(isAllowed({ subject: multi, action: 'recipe:generate', resource: recipeIn('hh-2') }), false)
})

// ---- Clinical-gate guardrail (non-overridable) -----------------------------

test('Publishing Admin may publish a gate-cleared recipe', () => {
  const d = authorize({
    subject: subject('PL-007-ADM', { type: 'global' }),
    action: 'publish:public',
    resource: { type: 'recipe', clinicalGateStatus: 'approved' },
  })
  assert.equal(d.allow, true)
})

test('Publishing Admin is blocked from publishing a non-cleared recipe', () => {
  const d = authorize({
    subject: subject('PL-007-ADM', { type: 'global' }),
    action: 'publish:public',
    resource: { type: 'recipe', clinicalGateStatus: 'not_reviewed' },
  })
  assert.equal(d.allow, false)
  assert.equal(d.reason, REASON.CLINICAL_GATE_BLOCK)
})

test('THE INVARIANT: even root cannot publish a recipe that has not cleared the gate', () => {
  const d = authorize({
    subject: subject('PL-001-ADM', { type: 'global' }), // Global Super Admin, wildcard
    action: 'publish:public',
    resource: { type: 'recipe', clinicalGateStatus: 'not_reviewed' },
  })
  assert.equal(d.allow, false)
  assert.equal(d.reason, REASON.CLINICAL_GATE_BLOCK)
})

test('root may publish once the recipe is cleared', () => {
  const d = authorize({
    subject: subject('PL-001-ADM', { type: 'global' }),
    action: 'publish:public',
    resource: { type: 'recipe', clinicalGateStatus: 'approved_with_caveats' },
  })
  assert.equal(d.allow, true)
})

test('copy:recipe is gate-controlled too', () => {
  const owner = subject('PL-069-HH', tenant('hh-1'))
  assert.equal(isAllowed({ subject: owner, action: 'copy:recipe', resource: { type: 'recipe', clinicalGateStatus: 'approved' } }), true)
  assert.equal(
    authorize({ subject: owner, action: 'copy:recipe', resource: { type: 'recipe', clinicalGateStatus: 'denied' } }).reason,
    REASON.CLINICAL_GATE_BLOCK,
  )
})

// ---- Domain guardrail (Food vs Medical — concern #2) -----------------------

test('a Food/Editorial role cannot view a Clinical resource', () => {
  const d = authorize({
    subject: subject('PL-050-FOOD', { type: 'global' }), // Recipe Editor
    action: 'view',
    resource: { type: 'record', domains: ['CLINICAL'] },
  })
  assert.equal(d.allow, false)
  assert.equal(d.reason, REASON.DOMAIN_BOUNDARY)
})

test('a Clinical role can view a Clinical resource', () => {
  const d = authorize({
    subject: subject('PL-059-CLIN', { type: 'global' }), // Clinician Reviewer
    action: 'view:review-context',
    resource: { type: 'record', domains: ['CLINICAL'] },
  })
  assert.equal(d.allow, true)
})

test('root is cross-domain (wildcard exempts the domain boundary)', () => {
  const d = authorize({
    subject: subject('PL-001-ADM', { type: 'global' }),
    action: 'view',
    resource: { type: 'record', domains: ['CLINICAL', 'MEDICAL'] },
  })
  assert.equal(d.allow, true)
})

// ---- Dual control (Phase 6) ------------------------------------------------

test('dual control applies to deeper-qualified actions (iam:grant_role:household)', () => {
  const owner = subject('PL-069-HH', tenant('hh-1'))
  const resource = { type: 'household', scope: tenant('hh-1') }
  assert.equal(authorize({ subject: owner, action: 'iam:grant_role:household', resource }).reason, REASON.DUAL_CONTROL_REQUIRED)
  assert.equal(authorize({ subject: owner, action: 'iam:grant_role:household', resource, env: { dualControlSatisfied: true } }).allow, true)
})

test('a capability denial precedes dual control (co-owner delete is EXPLICIT_DENY, not dual-control)', () => {
  // Co-Owner is DENY:household:delete, so they never reach the dual-control gate.
  const d = authorize({
    subject: subject('PL-070-HH', tenant('hh-1')),
    action: 'household:delete',
    resource: { type: 'household', scope: tenant('hh-1') },
  })
  assert.equal(d.reason, REASON.EXPLICIT_DENY)
})

test('non-dual-control actions ignore env entirely', () => {
  const caregiver = subject('PL-071-HH', tenant('hh-1'))
  assert.equal(isAllowed({ subject: caregiver, action: 'recipe:generate', resource: recipeIn('hh-1') }), true)
  // Same decision with or without an env flag.
  assert.equal(isAllowed({ subject: caregiver, action: 'recipe:generate', resource: recipeIn('hh-1'), env: { dualControlSatisfied: true } }), true)
})

// ---- Degenerate inputs -----------------------------------------------------

test('unknown role / missing action default-deny safely', () => {
  assert.equal(authorize({ subject: subject('PL-999-XXX', tenant('hh-1')), action: 'view', resource: recipeIn('hh-1') }).reason, REASON.NO_APPLICABLE_GRANT)
  assert.equal(authorize({ subject: subject('PL-069-HH', tenant('hh-1')), action: '', resource: recipeIn('hh-1') }).allow, false)
  assert.equal(authorize({}).allow, false)
})
