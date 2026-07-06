// =============================================================================
// platformRecipeService.test.js — pins the admin master-recipe edit doctrine.
// Run with `npm test` (node:test, no DB/env).
//
// PL-001: a changed recipe BODY has not cleared the Clinical Review Gate, so
// content edits re-gate; metadata (title/tags/photo/servings) applies live.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyAdminRecipeUpdates,
  normalizeAdminUpdatePayload,
} from './platformRecipeService.js'

// ---- classification ----------------------------------------------------------

test('outputMarkdown / sourceRecipeText edits are content changes', () => {
  assert.equal(classifyAdminRecipeUpdates({ outputMarkdown: '# New' }).contentChanged, true)
  assert.equal(classifyAdminRecipeUpdates({ sourceRecipeText: 'new text' }).contentChanged, true)
  assert.equal(classifyAdminRecipeUpdates({ title: 'x', outputMarkdown: '# y' }).contentChanged, true)
})

test('metadata-only edits never re-gate', () => {
  assert.equal(classifyAdminRecipeUpdates({
    title: 'Renamed', mealSlots: ['dinner'], recipeCategories: ['soup'],
    photoUrl: 'https://x/y.jpg', targetServings: 4, servingNotes: 'freezes well',
  }).contentChanged, false)
  assert.equal(classifyAdminRecipeUpdates({}).contentChanged, false)
  assert.equal(classifyAdminRecipeUpdates(undefined).contentChanged, false)
})

// ---- payload whitelist --------------------------------------------------------

test('empty update body is rejected', () => {
  assert.throws(() => normalizeAdminUpdatePayload({}), (err) => err.code === 'NO_RECIPE_UPDATES')
  assert.throws(() => normalizeAdminUpdatePayload(null), (err) => err.code === 'INVALID_REQUEST_BODY')
})

test('gate-owned and household-owned fields are silently outside the whitelist', () => {
  // Sending only non-whitelisted fields = no editable fields = 400.
  assert.throws(
    () => normalizeAdminUpdatePayload({
      clinicalReviewStatus: 'approved', scope: 'master', saved: true,
      careRecipientId: '00000000-0000-4000-8000-000000000000', isFavorite: true,
    }),
    (err) => err.code === 'NO_RECIPE_UPDATES',
  )
})

test('tags are lowercased and deduped; title and text are bounded', () => {
  const updates = normalizeAdminUpdatePayload({
    title: '  Lentil Soup  ',
    mealSlots: ['Dinner', 'dinner', ' Lunch '],
    recipeCategories: ['Soup'],
  })
  assert.equal(updates.title, 'Lentil Soup')
  assert.deepEqual(updates.mealSlots, ['dinner', 'lunch'])
  assert.deepEqual(updates.recipeCategories, ['soup'])

  assert.throws(() => normalizeAdminUpdatePayload({ title: '' }), (err) => err.code === 'INVALID_RECIPE_TITLE')
  assert.throws(() => normalizeAdminUpdatePayload({ outputMarkdown: '' }), (err) => err.code === 'INVALID_RECIPE_TEXT')
  assert.throws(() => normalizeAdminUpdatePayload({ outputMarkdown: 'x'.repeat(20001) }), (err) => err.code === 'INVALID_RECIPE_TEXT')
})

test('servings validate as 1–100 integers, null clears, photoUrl empty clears', () => {
  const updates = normalizeAdminUpdatePayload({
    targetServings: '6', originalServings: null, photoUrl: '  ', servingNotes: '',
  })
  assert.equal(updates.targetServings, 6)
  assert.equal(updates.originalServings, null)
  assert.equal(updates.photoUrl, null)
  assert.equal(updates.servingNotes, null)

  assert.throws(() => normalizeAdminUpdatePayload({ targetServings: 0 }), (err) => err.code === 'INVALID_SERVINGS')
  assert.throws(() => normalizeAdminUpdatePayload({ targetServings: 101 }), (err) => err.code === 'INVALID_SERVINGS')
})
