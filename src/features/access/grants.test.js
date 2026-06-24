// =============================================================================
// grants.test.js — Phase 4: resolveSubjectGrants unions the three sources into
// the PDP subject. Run with `npm test`. Hermetic: fake db routes by SQL.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveSubjectGrants } from './grants.js'

// Route each resolver query to its configured rows by table name in the SQL.
function fakeDb({ households = [], admins = [], extra = [] } = {}) {
  return {
    async query(sql) {
      if (sql.includes('from household_members')) return { rows: households }
      if (sql.includes('internal_admin_users')) return { rows: admins }
      if (sql.includes('subject_grants')) return { rows: extra }
      return { rows: [] }
    },
  }
}

test('a user with no grants resolves to an empty subject', async () => {
  const { grants } = await resolveSubjectGrants(fakeDb(), 'u-1')
  assert.deepEqual(grants, [])
})

test('multiple household memberships become multiple tenant-scoped grants (role explosion fix)', async () => {
  const { grants } = await resolveSubjectGrants(fakeDb({
    households: [
      { householdId: 'hh-1', role: 'caregiver' },
      { householdId: 'hh-2', role: 'owner' },
    ],
  }), 'u-1')
  assert.deepEqual(grants, [
    { roleId: 'PL-071-HH', scope: { type: 'tenant', id: 'hh-1' } },
    { roleId: 'PL-069-HH', scope: { type: 'tenant', id: 'hh-2' } },
  ])
})

test('internal admin rows become global-scoped staff grants', async () => {
  const { grants } = await resolveSubjectGrants(fakeDb({
    admins: [{ role: 'super_admin' }],
  }), 'u-1')
  assert.deepEqual(grants, [{ roleId: 'PL-001-ADM', scope: { type: 'global' } }])
})

test('subject_grants rows pass through with their stored scope', async () => {
  const { grants } = await resolveSubjectGrants(fakeDb({
    extra: [{ roleId: 'PL-077-PRO', scopeType: 'client', scopeId: 'client-9' }],
  }), 'u-1')
  assert.deepEqual(grants, [{ roleId: 'PL-077-PRO', scope: { type: 'client', id: 'client-9' } }])
})

test('all three sources union into one subject', async () => {
  const { grants } = await resolveSubjectGrants(fakeDb({
    households: [{ householdId: 'hh-1', role: 'caregiver' }],
    admins: [{ role: 'clinical_admin' }],
    extra: [{ roleId: 'PL-096-SL', scopeType: 'tenant', scopeId: 'facility-3' }],
  }), 'u-1')
  assert.equal(grants.length, 3)
  assert.ok(grants.some((g) => g.roleId === 'PL-071-HH' && g.scope.id === 'hh-1'))
  assert.ok(grants.some((g) => g.roleId === 'PL-004-ADM' && g.scope.type === 'global'))
  assert.ok(grants.some((g) => g.roleId === 'PL-096-SL' && g.scope.id === 'facility-3'))
})

test('tolerates subject_grants not existing yet (code before migration 019)', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('from household_members')) return { rows: [{ householdId: 'hh-1', role: 'owner' }] }
      if (sql.includes('internal_admin_users')) return { rows: [] }
      if (sql.includes('subject_grants')) { const e = new Error('relation "subject_grants" does not exist'); e.code = '42P01'; throw e }
      return { rows: [] }
    },
  }
  const { grants } = await resolveSubjectGrants(db, 'u-1')
  assert.deepEqual(grants, [{ roleId: 'PL-069-HH', scope: { type: 'tenant', id: 'hh-1' } }])
})

test('a non-undefined-table db error still propagates', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('subject_grants')) { const e = new Error('connection reset'); e.code = '08006'; throw e }
      return { rows: [] }
    },
  }
  await assert.rejects(resolveSubjectGrants(db, 'u-1'))
})

test('an unmapped household role is skipped, not guessed', async () => {
  const { grants } = await resolveSubjectGrants(fakeDb({
    households: [
      { householdId: 'hh-1', role: 'caregiver' },
      { householdId: 'hh-2', role: 'employee_caregiver' }, // not in the MVP map
    ],
  }), 'u-1')
  assert.deepEqual(grants, [{ roleId: 'PL-071-HH', scope: { type: 'tenant', id: 'hh-1' } }])
})
