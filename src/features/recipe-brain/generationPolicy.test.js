// =============================================================================
// generationPolicy.test.js — Phase 1 regression lock for the recipe-generation
// capability. Run with `npm test` (node:test, no external deps, no DB/env).
//
// Three independent gates protect generation; this file pins all three so they
// can't silently drift from the doctrine
// (business/Pop_Ladle_Actual_Person_10_Step_Paths.md):
//   1. ROLE gate     — GENERATE_ROLES / canRoleGenerate (this folder)
//   2. ENTITLEMENT   — requireGeneratorAccess: Solo+ and good standing (plans/)
//   3. WIRING        — POST /recipe-brain/runs runs BOTH gates, in order
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { GENERATE_ROLES, canRoleGenerate } from './generationPolicy.js'
import { requireGeneratorAccess } from '../plans/planService.js'

// ---- 1. Role gate ---------------------------------------------------------

test('GENERATE_ROLES is exactly the doctrine set (owner, co_owner, caregiver)', () => {
  assert.deepEqual([...GENERATE_ROLES], ['owner', 'co_owner', 'caregiver'])
})

test('canRoleGenerate: Operate/Execute roles may generate', () => {
  assert.equal(canRoleGenerate('owner'), true)
  assert.equal(canRoleGenerate('co_owner'), true)
  assert.equal(canRoleGenerate('caregiver'), true)
})

test('canRoleGenerate: viewer / care-recipient / unknown are denied', () => {
  assert.equal(canRoleGenerate('viewer'), false) // view, favorite, copy, print only
  assert.equal(canRoleGenerate(null), false) // care recipient never logs in (no role)
  assert.equal(canRoleGenerate(undefined), false)
  assert.equal(canRoleGenerate(''), false)
  assert.equal(canRoleGenerate('superadmin'), false) // staff curate, they do not generate
})

// ---- 2. Entitlement gate (Solo+ & good standing) --------------------------
//
// requireGeneratorAccess only touches db.query(), so a tiny dispatching fake
// exercises the real logic with no Postgres. household_entitlements drives
// tier + status; plan_definitions drives the feature map.

function fakeDb({ entitlement, definition }) {
  return {
    async query(sql) {
      if (sql.includes('household_entitlements')) {
        return { rows: entitlement ? [entitlement] : [] }
      }
      if (sql.includes('plan_definitions')) {
        return { rows: definition ? [definition] : [] }
      }
      throw new Error(`unexpected query in test: ${sql}`)
    },
  }
}

const SOLO_ACTIVE = {
  entitlement: { planTier: 'solo', planStatus: 'active', usageLimits: {}, featureFlags: {} },
  definition: { code: 'solo', features: { generator_access: true } },
}
const FREE_ACTIVE = {
  entitlement: { planTier: 'free', planStatus: 'active', usageLimits: {}, featureFlags: {} },
  definition: { code: 'free', features: { generator_access: false } },
}
const SOLO_PAST_DUE = {
  entitlement: { planTier: 'solo', planStatus: 'past_due', usageLimits: {}, featureFlags: {} },
  definition: { code: 'solo', features: { generator_access: true } },
}
// Comp path: a Free-tier household with generator_access force-enabled via the
// per-household feature_flags override, marked comped (good standing).
const COMPED_OVERRIDE = {
  entitlement: {
    planTier: 'free',
    planStatus: 'comped',
    usageLimits: {},
    featureFlags: { generator_access: true },
  },
  definition: { code: 'free', features: { generator_access: false } },
}

test('requireGeneratorAccess: Solo+ in good standing is allowed', async () => {
  const context = await requireGeneratorAccess(fakeDb(SOLO_ACTIVE), 'hh-1')
  assert.equal(context.features.generator_access, true)
})

test('requireGeneratorAccess: comped household with feature override is allowed', async () => {
  const context = await requireGeneratorAccess(fakeDb(COMPED_OVERRIDE), 'hh-comp')
  assert.equal(context.features.generator_access, true)
})

test('requireGeneratorAccess: Free tier is upgrade-gated', async () => {
  await assert.rejects(
    () => requireGeneratorAccess(fakeDb(FREE_ACTIVE), 'hh-2'),
    (err) => err.statusCode === 403 && err.code === 'PLAN_UPGRADE_REQUIRED',
  )
})

test('requireGeneratorAccess: not-in-good-standing is blocked before feature check', async () => {
  await assert.rejects(
    () => requireGeneratorAccess(fakeDb(SOLO_PAST_DUE), 'hh-3'),
    (err) => err.statusCode === 403 && err.code === 'PLAN_NOT_IN_GOOD_STANDING',
  )
})

// ---- 3. Wiring: the run path must invoke BOTH gates ------------------------
//
// A structural lock: if a refactor drops either gate from the create-run path,
// the role-only or entitlement-only build would silently ship. Cheaper and more
// durable than booting the whole service to assert behaviour.

test('runRecipeBrainForCurrentUser wires the capability gate then the entitlement gate', async () => {
  const source = await readFile(new URL('./recipeBrainService.js', import.meta.url), 'utf8')

  // Phase 3 cutover: the create path is now PDP-enforced on the recipe:generate
  // capability (the read/list paths still use the legacy GENERATE_ROLES array).
  const capabilityGate = source.indexOf("requireHouseholdCapability(db, user.id, householdId, 'recipe:generate'")
  const entitlementGate = source.indexOf('requireGeneratorAccess(db, access.household.id)')

  assert.ok(capabilityGate !== -1, 'create-run path must gate on the recipe:generate capability')
  assert.ok(entitlementGate !== -1, 'create-run path must call requireGeneratorAccess')
  assert.ok(capabilityGate < entitlementGate, 'capability gate should run before the entitlement gate')
})
