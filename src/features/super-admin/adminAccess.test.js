// =============================================================================
// adminAccess.test.js — pins the internal-admin role groups to the ABAC
// doctrine (business/…/pop_ladle_abac_role_matrix.csv). Run with `npm test`
// (node:test, no DB/env).
//
// PL-005 "Recipe Library Admin" (content_admin): authors + curates the Master
// Library, DENIED billing and admin-personnel management. PL-001: no role may
// bypass the Clinical Review Gate — enforced structurally in publish, not here.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ALL_ADMINS,
  ANY_ADMIN,
  CLINICAL_ADMINS,
  CONTENT_ADMINS,
  LIBRARY_ADMINS,
  SUPER_ONLY,
  SUPPORT_ADMINS,
} from './adminAccess.js'

test('CONTENT_ADMINS: authoring is super + content only (reviewers do not write)', () => {
  assert.deepEqual([...CONTENT_ADMINS], ['super_admin', 'content_admin'])
})

test('LIBRARY_ADMINS: curation includes clinical reviewer and content author', () => {
  assert.deepEqual([...LIBRARY_ADMINS], ['super_admin', 'clinical_admin', 'content_admin'])
})

test('ANY_ADMIN still excludes content_admin (billing/privacy/registries stay denied)', () => {
  assert.deepEqual([...ANY_ADMIN], ['super_admin', 'support_admin', 'clinical_admin'])
  assert.equal(ANY_ADMIN.includes('content_admin'), false)
})

test('SUPER_ONLY and legacy groups are untouched', () => {
  assert.deepEqual([...SUPER_ONLY], ['super_admin'])
  assert.deepEqual([...SUPPORT_ADMINS], ['super_admin', 'support_admin'])
  assert.deepEqual([...CLINICAL_ADMINS], ['super_admin', 'clinical_admin'])
})

test('ALL_ADMINS covers every role exactly once (dashboard overview)', () => {
  assert.deepEqual(
    [...ALL_ADMINS].sort(),
    ['clinical_admin', 'content_admin', 'super_admin', 'support_admin'],
  )
  assert.equal(new Set(ALL_ADMINS).size, ALL_ADMINS.length)
})
