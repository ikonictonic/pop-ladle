// =============================================================================
// accountSaves.test.js — validation/normalization for account saves.
//
// Both the single PUT and the bulk adopt funnel every client save through
// normalizeSaveInput, so its rules (allowed types, required fields, length
// caps, key derivation, savedAt sanitizing) are the security + integrity
// boundary for this table. Pinned here without a live DB, matching the suite.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  __normalizeSaveInputForTests as normalizeSaveInput,
  __ITEM_TYPES_FOR_TESTS as ITEM_TYPES,
  saveKeyFor,
} from './accountSavesService.js'

function expectHttp(fn, code) {
  try {
    fn()
    assert.fail('expected an HTTP error to be thrown')
  } catch (err) {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}`)
    assert.equal(typeof err.statusCode, 'number')
  }
}

test('saveKeyFor mirrors the site key shape', () => {
  assert.equal(saveKeyFor('recipe', 'warm-oats'), 'recipe:warm-oats')
})

test('normalizes a valid save and derives the key', () => {
  const out = normalizeSaveInput({
    type: 'recipe',
    id: 'warm-oats',
    title: 'Warm oats',
    img: '/img/oats.jpg',
    savedAt: 1_700_000_000_000,
  })
  assert.deepEqual(out, {
    type: 'recipe',
    id: 'warm-oats',
    title: 'Warm oats',
    img: '/img/oats.jpg',
    savedAtMs: 1_700_000_000_000,
    key: 'recipe:warm-oats',
  })
})

test('accepts every allowed content type and only those', () => {
  for (const type of ITEM_TYPES) {
    const out = normalizeSaveInput({ type, id: 'x', title: 'T' })
    assert.equal(out.type, type)
  }
  expectHttp(() => normalizeSaveInput({ type: 'household_recipe', id: 'x', title: 'T' }), 'INVALID_SAVE_TYPE')
  expectHttp(() => normalizeSaveInput({ type: '', id: 'x', title: 'T' }), 'INVALID_SAVE_TYPE')
})

test('rejects a non-object, missing id, and missing title', () => {
  expectHttp(() => normalizeSaveInput(null), 'INVALID_SAVE')
  expectHttp(() => normalizeSaveInput([]), 'INVALID_SAVE')
  expectHttp(() => normalizeSaveInput({ type: 'recipe', id: '  ', title: 'T' }), 'INVALID_SAVE_ID')
  expectHttp(() => normalizeSaveInput({ type: 'recipe', id: 'x', title: '   ' }), 'INVALID_SAVE_TITLE')
})

test('trims fields and tolerates a missing image', () => {
  const out = normalizeSaveInput({ type: 'drink', id: '  lemon-mint ', title: '  Lemon mint  ' })
  assert.equal(out.id, 'lemon-mint')
  assert.equal(out.title, 'Lemon mint')
  assert.equal(out.img, '')
  assert.equal(out.key, 'drink:lemon-mint')
})

test('caps over-long id, title, and image', () => {
  expectHttp(
    () => normalizeSaveInput({ type: 'recipe', id: 'a'.repeat(201), title: 'T' }),
    'INVALID_SAVE_ID',
  )
  expectHttp(
    () => normalizeSaveInput({ type: 'recipe', id: 'x', title: 'T'.repeat(301) }),
    'INVALID_SAVE_TITLE',
  )
  const out = normalizeSaveInput({ type: 'recipe', id: 'x', title: 'T', img: 'u'.repeat(5000) })
  assert.equal(out.img.length, 2000)
})

test('sanitizes an untrusted savedAt to 0', () => {
  for (const bad of [undefined, 'nope', -5, 0, Number.NaN, Infinity]) {
    assert.equal(normalizeSaveInput({ type: 'recipe', id: 'x', title: 'T', savedAt: bad }).savedAtMs, 0)
  }
  assert.equal(normalizeSaveInput({ type: 'recipe', id: 'x', title: 'T', savedAt: 12.9 }).savedAtMs, 12)
})
