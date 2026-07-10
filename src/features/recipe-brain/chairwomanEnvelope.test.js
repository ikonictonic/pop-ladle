// =============================================================================
// chairwomanEnvelope.test.js — locks the Chairwoman envelope parser and the
// synthesis-failure fallback.
//
// Regression origin: a published Master Library recipe ("Baked Lemon Chicken &
// Rice") was stored with a raw ```json blob as its body and a clinical_review_
// status of `approved`. Two independent defects combined:
//
//   1. The model emitted markdown with literal newlines inside a JSON string,
//      which is invalid JSON, so parseChairwomanEnvelope() returned null and
//      the real verdict (approved_with_caveats, 5 caveats, 3 warning items) was
//      thrown away.
//   2. rollUpFallback() then persisted the raw model text as the recipe body
//      and derived `approved` from the specialist votes — but those votes were
//      cast on the *source* recipe, which nobody had adapted.
//
// Run with `npm test` (node:test, no DB/env).
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseChairwomanEnvelope } from './prompts.js'
import { __rollUpFallbackForTests as rollUpFallback } from './recipeBrainService.js'

// The exact shape the model produced in production: fenced, and with real
// newlines inside the recipe_markdown string literal.
const MALFORMED_BUT_RECOVERABLE = [
  '```json',
  '{',
  '  "recipe_markdown": "',
  '# Adapted Baked Lemon Chicken',
  '',
  '**LOADOUT**',
  '| ingredient | quantity |',
  '|---|---|',
  '| Chicken | 4 |",',
  '  "verdict": "approved_with_caveats",',
  '  "verdict_summary": "Lower the sodium.",',
  '  "caveats": ["Confirm potassium"],',
  '  "warning_items": ["High sodium"],',
  '  "clinician_flags": []',
  '}',
  '```',
].join('\n')

test('parses a well-formed envelope', () => {
  const env = parseChairwomanEnvelope(
    '{"recipe_markdown":"# Ok","verdict":"approved","verdict_summary":"s","caveats":[],"warning_items":[],"clinician_flags":[]}',
  )
  assert.equal(env.verdict, 'approved')
  assert.equal(env.recipe_markdown, '# Ok')
})

test('recovers an envelope with raw newlines inside a JSON string literal', () => {
  const env = parseChairwomanEnvelope(MALFORMED_BUT_RECOVERABLE)

  assert.notEqual(env, null, 'envelope must survive unescaped newlines')
  assert.equal(env.verdict, 'approved_with_caveats')
  assert.match(env.recipe_markdown, /# Adapted Baked Lemon Chicken/)
  assert.deepEqual(env.caveats, ['Confirm potassium'])
  assert.deepEqual(env.warning_items, ['High sodium'])
})

test('recovers tabs and carriage returns inside string literals', () => {
  const env = parseChairwomanEnvelope('{"recipe_markdown":"a\tb\r\nc","verdict":"denied"}')
  assert.notEqual(env, null)
  assert.equal(env.recipe_markdown, 'a\tb\r\nc')
  assert.equal(env.verdict, 'denied')
})

test('does not corrupt already-escaped sequences', () => {
  const env = parseChairwomanEnvelope(String.raw`{"recipe_markdown":"line\nnext \"quoted\" \\ done","verdict":"approved"}`)
  assert.equal(env.recipe_markdown, 'line\nnext "quoted" \\ done')
})

test('returns null on genuinely unparseable output', () => {
  assert.equal(parseChairwomanEnvelope('the model refused to answer'), null)
  assert.equal(parseChairwomanEnvelope(''), null)
  assert.equal(parseChairwomanEnvelope(null), null)
})

// --- the fallback must never publish an unreviewed recipe --------------------

const APPROVE_ALL = [
  { displayName: 'NephAI', verdict: 'approve', ok: true },
  { displayName: 'CardAI', verdict: 'approve', ok: true },
]

test('fallback never auto-approves, even when every specialist approved', () => {
  const out = rollUpFallback(APPROVE_ALL, '```json\n{"broken"\n```')

  assert.equal(out.verdict, 'needs_review', 'a failed synthesis must not publish as approved')
  assert.notEqual(out.verdict, 'approved')
})

test('fallback keeps a specialist deny as a hard block', () => {
  const out = rollUpFallback(
    [...APPROVE_ALL, { displayName: 'PCPAI', verdict: 'deny', verdictRationale: 'grapefruit', ok: true }],
    'garbage',
  )
  assert.equal(out.verdict, 'denied')
  assert.ok(out.caveats.some((c) => c.includes('grapefruit')))
})

test('fallback never persists raw model output as the recipe body', () => {
  const raw = '```json\n{"recipe_markdown": "\n# Real Recipe"}\n```'
  const out = rollUpFallback(APPROVE_ALL, raw)

  assert.ok(!out.recipe_markdown.includes('recipe_markdown'), 'raw JSON must not become the body')
  assert.ok(!out.recipe_markdown.includes('```'), 'raw fence must not become the body')
  assert.match(out.recipe_markdown, /Recipe unavailable/)
  assert.ok(out.warning_items.length > 0, 'the failure must be surfaced to the caregiver')
})
