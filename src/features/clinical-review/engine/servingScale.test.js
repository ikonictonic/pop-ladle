// =============================================================================
// servingScale.test.js — the deterministic "did anything actually scale?" guard.
//
// Regression origin: a run with targetServings=2 against a "Serves 4" source
// returned the 4-serving amounts (1.5 lb chicken, 1/2 cup soy sauce) under the
// heading "Target servings: 2". The old serving check only asserted that the
// number 2 appeared *somewhere in the text*, so it passed. Per-serving sodium
// and potassium were double the care recipient's limits.
//
// The guard flags only when nothing moved by the expected factor AND at least
// two shared ingredients are byte-identical — seasonings and searing oil
// legitimately don't scale, and a unit change ("4 thighs" -> "1.5 lb") isn't a
// scale either, so neither alone may trip it.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseQuantity, parseSourceQuantities, parseLoadoutQuantities } from './ingredientParser.js'

test('parseQuantity handles decimals, fractions and mixed numbers', () => {
  assert.equal(parseQuantity('2 tablespoons olive oil'), 2)
  assert.equal(parseQuantity('1.5 lb'), 1.5)
  assert.equal(parseQuantity('1/2 cup soy sauce'), 0.5)
  assert.equal(parseQuantity('1 1/2 cups rice'), 1.5)
  assert.equal(parseQuantity('Salt to taste'), null)
  assert.equal(parseQuantity(''), null)
})

test('parses quantities out of a source recipe and a LOADOUT table', () => {
  const source = ['- 1 cup fresh grapefruit juice', '- 1/2 cup soy sauce'].join('\n')
  const output = [
    '**LOADOUT**',
    '| ingredient | quantity |',
    '|---|---|',
    '| soy sauce | 1/2 cup |',
  ].join('\n')

  assert.equal(parseSourceQuantities(source).get('soy sauce'), 0.5)
  assert.equal(parseLoadoutQuantities(output).get('soy sauce'), 0.5)
})

// Mirror of the guard in accuracyCheck.js STAGE 5.
function scalingLooksApplied({ sourceText, generated, targetServings, originalServings }) {
  const sourceQty = parseSourceQuantities(sourceText)
  const outputQty = parseLoadoutQuantities(generated)
  const ratio = targetServings / originalServings

  const shared = [...outputQty.keys()].filter((k) => sourceQty.has(k))
  const unchanged = shared.filter((k) => Math.abs(sourceQty.get(k) - outputQty.get(k)) < 1e-9)
  const scaled = shared.filter((k) => {
    const expected = sourceQty.get(k) * ratio
    return Math.abs(outputQty.get(k) - expected) <= Math.abs(expected) * 0.1
  })

  const flagged = shared.length >= 2 && unchanged.length >= 2 && scaled.length === 0
  return !flagged
}

const SOURCE = [
  '- 4 boneless chicken thighs (about 1.5 lb)',
  '- 1 cup fresh grapefruit juice',
  '- 1/2 cup soy sauce',
  '- 3 tablespoons brown sugar',
  '- 2 tablespoons olive oil',
].join('\n')

test('flags the real regression: amounts unchanged but relabelled 2 servings', () => {
  const generated = [
    '**SERVING SUMMARY**',
    '- Target servings: 2',
    '**LOADOUT**',
    '| ingredient | quantity |',
    '|---|---|',
    '| boneless chicken thighs | 1.5 lb |',
    '| low-sodium soy sauce | 1/2 cup |',
    '| brown sugar | 3 tablespoons |',
    '| olive oil | 2 tablespoons |',
  ].join('\n')

  assert.equal(
    scalingLooksApplied({ sourceText: SOURCE, generated, targetServings: 2, originalServings: 4 }),
    false,
    'an unscaled recipe must be flagged',
  )
})

test('does not flag a properly halved recipe', () => {
  const generated = [
    '**LOADOUT**',
    '| ingredient | quantity |',
    '|---|---|',
    '| soy sauce | 1/4 cup |',
    '| brown sugar | 1.5 tablespoons |',
    '| olive oil | 2 tablespoons |',
  ].join('\n')

  assert.equal(
    scalingLooksApplied({ sourceText: SOURCE, generated, targetServings: 2, originalServings: 4 }),
    true,
    'seasonings/oil that stay put must not trip the guard when bulk items scaled',
  )
})

test('does not flag when only one shared ingredient is unchanged', () => {
  const generated = [
    '**LOADOUT**',
    '| ingredient | quantity |',
    '|---|---|',
    '| olive oil | 2 tablespoons |',
    '| soy sauce | 1/4 cup |',
  ].join('\n')

  assert.equal(
    scalingLooksApplied({ sourceText: SOURCE, generated, targetServings: 2, originalServings: 4 }),
    true,
  )
})
