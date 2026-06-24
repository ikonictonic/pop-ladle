// =============================================================================
// recipeInputGate.test.js — locks the structured recipe-intake validator
// against business/recipe_text_intake_validation_rules.md.
//
// Run with `npm test` (node:test, no external deps, no DB/env). Pins the parser
// (a full recipe is accepted, prompts/incomplete inputs are blocked with the
// right missingFields) and the WIRING (the run path validates before the roster
// load, so blocked inputs never spend upstream tokens).
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  validateRecipeText,
  REQUIRED_FIELDS,
  MIN_INGREDIENTS,
  MIN_INSTRUCTION_STEPS,
} from './recipeInputGate.js'

// The doc's canonical valid example.
const VALID_RECIPE = `Title: Lemon Yogurt Cake

Description: A soft lemon cake made with yogurt, lemon zest, eggs, flour, and a light glaze.

Servings: 8

Ingredients:
- 1 cup plain Greek yogurt
- 2 eggs
- 1/2 cup sugar
- 1/3 cup olive oil
- 1 1/2 cups flour
- 2 teaspoons baking powder
- 1 tablespoon lemon zest
- 2 tablespoons lemon juice

Instructions:
1. Preheat oven to 350F.
2. Whisk yogurt, eggs, sugar, oil, lemon zest, and lemon juice.
3. Stir in flour and baking powder.
4. Pour into a greased loaf pan.
5. Bake for 35 to 45 minutes.

What done looks like:
The cake is golden, firm in the center, and a toothpick comes out clean.`

// ---- 1. A complete recipe is accepted and parsed --------------------------

test("the doc's valid example is accepted with a clean structure", () => {
  const result = validateRecipeText(VALID_RECIPE)
  assert.equal(result.allowed, true)
  assert.equal(result.reason, 'VALID_RECIPE_STRUCTURE')
  assert.equal(result.careTeamDispatchAllowed, true)
  assert.deepEqual(result.missingFields, [])
  assert.equal(result.structured.title, 'Lemon Yogurt Cake')
  assert.equal(result.structured.servings, '8')
  assert.equal(result.structured.ingredients.length, 8)
  assert.equal(result.structured.instructions.length, 5)
  assert.ok(result.structured.whatDoneLooksLike.length > 0)
})

test('a paste-from-web recipe with headings but no description/doneness label passes', () => {
  const web = `Banana Pancakes
Yield: 4 servings

Ingredients
2 ripe bananas
1 cup flour
1 cup milk
1 egg
2 tablespoons sugar

Directions
Mash the bananas in a bowl.
Whisk in the milk and egg.
Stir in the flour and sugar until combined.
Cook on a griddle for 3 minutes per side until golden brown.`
  const result = validateRecipeText(web)
  assert.equal(result.allowed, true)
  // Description is recommended, not a hard blocker.
  assert.ok(!REQUIRED_FIELDS.includes('description'))
  assert.equal(result.recommendations.description !== undefined, true)
})

// ---- 2. Prompts and food-wishes are blocked -------------------------------

test("the doc's invalid prompts are all blocked as NOT_A_VALID_RECIPE", () => {
  const prompts = [
    'Make me a cake.',
    'Make a lemon dessert.',
    'Create a healthy chicken recipe.',
    'Give me a soft dinner.',
    'I want soup.',
    'Make this low sodium.',
    'Can you make something with rice?',
    'Need a recipe for breakfast.',
  ]
  for (const prompt of prompts) {
    const result = validateRecipeText(prompt)
    assert.equal(result.allowed, false, `should block: ${prompt}`)
    assert.equal(result.reason, 'NOT_A_VALID_RECIPE')
    assert.equal(result.careTeamDispatchAllowed, false)
  }
})

test('a pure prompt gets the prompt-specific message; an incomplete recipe gets the correction message', () => {
  const prompt = validateRecipeText('make a cake recipe')
  assert.match(prompt.message, /recipe request, not a recipe/i)

  const partial = validateRecipeText(
    'Veggie Soup\nIngredients\n- 2 carrots\n- 1 onion\n- 3 cups broth\nChop and simmer everything.',
  )
  assert.equal(partial.allowed, false)
  assert.match(partial.message, /enter the full recipe/i)
})

// ---- 3. Field-level rules -------------------------------------------------

test('fewer than 3 ingredients is flagged weak on ingredients', () => {
  const result = validateRecipeText(`Toast
Servings: 1
Ingredients:
- 1 slice bread
Instructions:
1. Toast the bread until golden.
2. Spread butter.
3. Serve warm.
What done looks like: golden and crisp.`)
  assert.equal(result.allowed, false)
  assert.ok(result.missingFields.includes('ingredients'))
  assert.ok(MIN_INGREDIENTS === 3)
})

test('missing servings is reported in missingFields with the doc message', () => {
  const result = validateRecipeText(`Quick Omelette
Ingredients:
- 3 eggs
- 1 tablespoon butter
- 2 tablespoons milk
Instructions:
1. Whisk the eggs and milk.
2. Melt butter in a pan.
3. Pour in eggs and cook until set.
What done looks like: set and no longer runny.`)
  assert.equal(result.allowed, false)
  assert.ok(result.missingFields.includes('servings'))
  assert.match(result.fieldMessages.servings, /servings or the recipe yield/i)
})

test('missing a doneness cue is reported as "what done looks like"', () => {
  // No doneness words and no time/temperature detail to infer completion.
  const result = validateRecipeText(`Fruit Bowl
Servings: 2
Ingredients:
- 1 apple
- 1 banana
- 1 cup grapes
Instructions:
1. Chop the apple.
2. Slice the banana.
3. Combine all the fruit in a bowl.`)
  assert.equal(result.allowed, false)
  assert.ok(result.missingFields.includes('what done looks like'))
})

test('fewer than 3 steps is flagged weak on instructions', () => {
  const result = validateRecipeText(`Buttered Rice
Servings: 4
Ingredients:
- 2 cups rice
- 4 cups water
- 2 tablespoons butter
Instructions:
1. Boil until tender and fluffy.
What done looks like: tender and fluffy.`)
  assert.equal(result.allowed, false)
  assert.ok(result.missingFields.includes('instructions'))
  assert.ok(MIN_INSTRUCTION_STEPS === 3)
})

// ---- 4. Wiring: the gate must run before the committee fans out -----------

test('runRecipeBrainForCurrentUser validates input before the roster load', async () => {
  const source = await readFile(new URL('./recipeBrainService.js', import.meta.url), 'utf8')

  assert.match(source, /import \{ validateRecipeText \} from '\.\/recipeInputGate\.js'/)

  const gateCall = source.indexOf('validateRecipeText(')
  const rosterLoad = source.indexOf('loadActiveRoster(db)')

  assert.ok(gateCall !== -1, 'run path must call validateRecipeText')
  assert.ok(rosterLoad !== -1, 'run path must load the roster')
  assert.ok(gateCall < rosterLoad, 'validation must run before any LLM fan-out')
})
