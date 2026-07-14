// =============================================================================
// publicContent.test.js — the marketing site's read surface.
//
// This is the only unauthenticated data path in the API, so its two jobs are
// pinned here:
//
//   1. SECURITY (enforced in SQL, asserted by shape here): master + published +
//      not-denied only. Household recipes are care-recipient data and must never
//      be public.
//   2. CURATION: the live library is real production data and contains rows that
//      are fine for a signed-in caregiver but not fine as marketing — a body that
//      is still a raw ```json envelope (the Chairwoman parse failure, fixed
//      forward but never backfilled), a stub body of "x", and titles carrying
//      authoring artifacts ("Title: Lemon Yogurt Cake") or naming the very
//      ingredient the recipe removed for safety.
//
// Run with `npm test` (node:test, no DB/env).
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  __isPresentableForTests as isPresentable,
  __displayTitleForTests as displayTitle,
  PUBLIC_REVIEW_STATUSES,
} from './publicContentService.js'

const GOOD_BODY = [
  '# Mediterranean Beef and Veggie Skillet',
  '**SERVING SUMMARY**',
  '- Target servings: 2',
  '**LOADOUT**',
  '| ingredient | quantity |',
  '|---|---|',
  '| Ground beef | 1/2 pound |',
  '**EXECUTION**',
  '1. Heat the oil in a large skillet over medium heat and brown the beef.',
].join('\n')

// --- security posture --------------------------------------------------------

test('denied recipes are never public', () => {
  assert.ok(!PUBLIC_REVIEW_STATUSES.includes('denied'))
})

test('public statuses are exactly the non-denied ones', () => {
  assert.deepEqual(
    [...PUBLIC_REVIEW_STATUSES].sort(),
    ['approved', 'approved_with_caveats', 'needs_review', 'not_reviewed'].sort(),
  )
})

// --- curation ----------------------------------------------------------------

test('a real adapted recipe is presentable', () => {
  assert.equal(isPresentable({ outputMarkdown: GOOD_BODY }), true)
})

test('withholds a body that is still a raw ```json envelope', () => {
  const body = '```json\n{\n  "recipe_markdown": "\n# Adapted Baked Lemon Chicken\n...",\n  "verdict": "approved"\n}\n```'
  assert.equal(isPresentable({ outputMarkdown: body }), false)
})

test('withholds a bare JSON envelope with no fence', () => {
  const body = '{"recipe_markdown": "# Something", "verdict": "approved", "caveats": []}'
  assert.equal(isPresentable({ outputMarkdown: body }), false)
})

test('withholds stub and empty bodies', () => {
  assert.equal(isPresentable({ outputMarkdown: 'x' }), false)
  assert.equal(isPresentable({ outputMarkdown: '' }), false)
  assert.equal(isPresentable({ outputMarkdown: null }), false)
  assert.equal(isPresentable({}), false)
})

test('prefers the adapted body heading over a stale stored title', () => {
  // The stored title names the two foods the recipe removed for safety.
  const recipe = {
    title: 'Grapefruit Glazed Chicken with Smashed Potatoes and Banana Salad',
    outputMarkdown: '# Lemon Glazed Chicken with Green Beans and Apples\n\n**LOADOUT**\n| a | b |',
  }
  assert.equal(displayTitle(recipe), 'Lemon Glazed Chicken with Green Beans and Apples')
})

test('strips a stray "Title:" label', () => {
  assert.equal(
    displayTitle({ title: 'Title: Lemon Yogurt Cake', outputMarkdown: 'no heading here' }),
    'Lemon Yogurt Cake',
  )
})

test('falls back to the stored title when the body has no heading', () => {
  assert.equal(displayTitle({ title: 'Caregiver Soup', outputMarkdown: 'plain text' }), 'Caregiver Soup')
})

test('never returns an empty title', () => {
  assert.equal(displayTitle({ title: '', outputMarkdown: '' }), 'Untitled recipe')
  assert.equal(displayTitle({ title: 'Title:', outputMarkdown: '' }), 'Untitled recipe')
})
