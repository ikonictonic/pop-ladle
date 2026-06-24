// =============================================================================
// recipeInputGate — the pre-committee "is this a real recipe?" gate.
//
// The committee ADAPTS a recipe the caregiver pasted; it is not a from-scratch
// generator. So a vague prompt ("make a cake recipe") is both wasteful AND out
// of scope — it would fan out to every specialist + the Chairwoman for nothing.
// This validator parses the pasted text into a structured recipe and enforces
// the Minimum Acceptance + Care Team Dispatch rules from
// business/recipe_text_intake_validation_rules.md, DETERMINISTICALLY (no LLM —
// that would defeat the point) BEFORE the roster load / fan-out in
// recipeBrainService.runRecipeBrainForCurrentUser.
//
// Hard gate (Care Team Dispatch Rule) — all required before we call the Care
// Team: a title, >= 3 ingredients (>= 2 with an amount, recognizable foods),
// >= 3 preparation steps that include a cooking action, a serving/yield, and a
// doneness cue (or enough cooking detail to infer completion). Description is
// RECOMMENDED, not a hard blocker (it is absent from both the 10 Minimum
// Acceptance rules and the Care Team Dispatch list), so paste-from-web recipes
// without an intro paragraph still pass.
//
// validateRecipeText() returns the doc's contract plus the parsed object:
//   { allowed, reason, missingFields, message, careTeamDispatchAllowed,
//     structured, fieldMessages, recommendations }
// The service maps !allowed to a 422 NOT_A_VALID_RECIPE carrying missingFields.
//
// Pure + dependency-free (like generationPolicy.js): unit-tests with no DB, and
// the frontend mirrors it (frontend/src/lib/recipeInputGate.js — keep in sync).
// English-only heuristics for now; tune the constants below against real input.
// =============================================================================

export const MIN_RECIPE_CHARS = 80
export const MIN_INGREDIENTS = 3
export const MIN_QUANTIFIED_INGREDIENTS = 2
export const MIN_INSTRUCTION_STEPS = 3

// The hard fields that gate Care Team dispatch (description is recommended only).
export const REQUIRED_FIELDS = Object.freeze([
  'title',
  'ingredients',
  'instructions',
  'servings',
  'what done looks like',
])

// Per-field correction copy, lifted from the doc's "Recommended Missing Field
// Messages". `weak` is shown when the field is present but insufficient.
const FIELD_MESSAGES = {
  title: { missing: 'Please add the recipe title.' },
  description: { missing: 'Please add a short description of the recipe.' },
  ingredients: {
    missing: 'Please add the ingredients, including amounts where possible.',
    weak: 'Please add a complete ingredient list with at least 3 ingredients.',
  },
  instructions: {
    missing: 'Please add the cooking or preparation steps.',
    weak: 'Please add enough steps to explain how the recipe is made.',
  },
  servings: { missing: 'Please add the number of servings or the recipe yield.' },
  'what done looks like': {
    missing:
      'Please add what done looks like, such as golden brown, tender, thickened, chilled, or cooked through.',
  },
}

const PROMPT_MESSAGE =
  'This looks like a recipe request, not a recipe. Please paste the full recipe with title, ingredients, instructions, servings, and what done looks like.'

const CORRECTION_MESSAGE =
  'Please enter the full recipe before submitting. I need the title, description, ingredients, instructions, servings, and what done looks like so the Care Team has enough information to review and adapt it safely.'

const VALID_MESSAGE = 'Recipe structure is complete.'

// ---------------------------------------------------------------------------
// Lexicons
// ---------------------------------------------------------------------------

const UNIT_WORDS = [
  'cup', 'cups', 'tbsp', 'tbsps', 'tablespoon', 'tablespoons', 'tsp', 'tsps', 'teaspoon', 'teaspoons',
  'g', 'gram', 'grams', 'kg', 'mg', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds',
  'ml', 'l', 'liter', 'liters', 'litre', 'litres', 'qt', 'quart', 'quarts', 'pt', 'pint', 'pints',
  'gallon', 'gallons', 'inch', 'inches', 'cm', 'mm',
]

const PORTION_WORDS = [
  'pinch', 'dash', 'handful', 'clove', 'cloves', 'slice', 'slices', 'can', 'cans',
  'package', 'packages', 'pkg', 'stick', 'sticks', 'splash', 'drizzle', 'sprig', 'sprigs',
  'scoop', 'knob', 'bunch', 'head', 'strip', 'strips', 'piece', 'pieces', 'to taste', 'as needed',
]

// Cooking / preparation actions (rule 6 — the doc's list plus common synonyms).
const COOKING_VERBS = [
  'cook', 'cooks', 'cooked', 'mix', 'mixes', 'mixed', 'chill', 'chilled', 'bake', 'baked', 'baking',
  'blend', 'blended', 'simmer', 'simmered', 'saute', 'sauté', 'sauteed', 'sautéed', 'assemble', 'assembled',
  'reheat', 'reheated', 'serve', 'serves', 'served', 'stir', 'stirred', 'whisk', 'whisked', 'fold', 'folded',
  'pour', 'poured', 'preheat', 'preheated', 'roast', 'roasted', 'fry', 'fried', 'grill', 'grilled',
  'boil', 'boiled', 'knead', 'kneaded', 'combine', 'combined', 'season', 'seasoned', 'drain', 'drained',
  'melt', 'melted', 'beat', 'beaten', 'steam', 'steamed', 'broil', 'broiled', 'poach', 'poached',
  'braise', 'braised', 'spread', 'sprinkle', 'sprinkled', 'garnish', 'garnished', 'marinate', 'marinated',
  'chop', 'chopped', 'dice', 'diced', 'mince', 'minced', 'grate', 'grated', 'add', 'added', 'heat', 'heated',
  'cover', 'covered', 'toss', 'tossed', 'coat', 'coated', 'layer', 'layered', 'top', 'fill', 'filled',
  'wrap', 'wrapped', 'dissolve', 'dissolved', 'reduce', 'reduced', 'transfer', 'transferred', 'place', 'placed',
  'cut', 'remove', 'removed', 'bring', 'set',
]

// Doneness / completion cues (rule 8).
const DONENESS_WORDS = [
  'golden', 'brown', 'browned', 'firm', 'tender', 'thickened', 'thicken', 'chilled', 'set',
  'cooked through', 'toothpick', 'bubbling', 'bubbly', 'crispy', 'crisp', 'until done', 'springs back',
  'fork-tender', 'caramelized', 'caramelised', 'melted', 'dissolved', 'reduced', 'fragrant', 'translucent',
  'opaque', 'flaky', 'risen', 'doubled', 'until soft', 'until tender', 'internal temperature', 'cooked',
]

// Imperative requests aimed at the AI rather than a pasted recipe.
const COMMAND_PATTERNS = [
  /^(?:please\s+)?(?:can|could|would|will)\s+you\b/i,
  /^(?:please\s+)?i(?:'?d| would| will)?\s*(?:want|need|like)\b/i,
  /^(?:please\s+)?(?:need|give|get)\s+(?:me\s+)?a\b/i,
  /^(?:please\s+)?(?:make|create|generate|write|build|cook|bake|prepare|suggest|design|invent|recommend|whip|throw|come)\b/i,
]

const FRACTION_RE = /[½¼¾⅓⅔⅛⅜⅝⅞]|\b\d+\s*\/\s*\d+\b/
const NUMBER_RE = /\d/
const UNIT_RE = new RegExp(`\\b(?:${UNIT_WORDS.join('|')})\\b`, 'i')
const PORTION_RE = new RegExp(`\\b(?:${PORTION_WORDS.join('|')})\\b`, 'i')
const VERB_RE = new RegExp(`\\b(?:${COOKING_VERBS.join('|')})\\b`, 'i')
const DONENESS_RE = new RegExp(`\\b(?:${DONENESS_WORDS.join('|')})\\b`, 'i')
const NUMBERED_LINE_RE = /^\s*\d+[.)]\s+/
const LIST_MARKER_RE = /^\s*[-*•·]\s+/
// Temperature or time detail counts as a completion cue (rule 8).
const COOKING_DETAIL_RE = /\b\d+\s*(?:°|degrees?|deg\b|[fc]\b)|\b\d+\s*(?:to\s*\d+\s*)?(?:second|sec|minute|min|hour|hr)s?\b/i

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const SECTION_LABELS = [
  { key: 'title', re: /^(?:#+\s*)?title\b\s*[:.\-—]?\s*/i },
  { key: 'description', re: /^(?:#+\s*)?(?:description|summary|about)\b\s*[:.\-—]?\s*/i },
  { key: 'servings', re: /^(?:#+\s*)?(?:servings?|serves|yield|yields|makes|portions?)\b\s*[:.\-—]?\s*/i },
  { key: 'ingredients', re: /^(?:#+\s*)?ingredients?\b\s*[:.\-—]?\s*/i },
  { key: 'instructions', re: /^(?:#+\s*)?(?:instructions?|directions?|method|steps?|preparation|procedure)\b\s*[:.\-—]?\s*/i },
  { key: 'whatDoneLooksLike', re: /^(?:#+\s*)?(?:what\s+done\s+looks\s+like|doneness|done\s+when|when\s+done)\b\s*[:.\-—]?\s*/i },
  { key: 'notes', re: /^(?:#+\s*)?notes?\b\s*[:.\-—]?\s*/i },
]

const STRING_SECTIONS = new Set(['title', 'description', 'servings', 'whatDoneLooksLike', 'notes'])

function matchSectionLabel(line) {
  for (const label of SECTION_LABELS) {
    const m = line.match(label.re)
    if (m) return { key: label.key, length: m[0].length }
  }
  return null
}

function stripMarker(line) {
  return line.replace(LIST_MARKER_RE, '').replace(NUMBERED_LINE_RE, '').trim()
}

function parseRecipe(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const sections = {
    title: '',
    description: '',
    servings: '',
    ingredients: [],
    instructions: [],
    whatDoneLooksLike: '',
    notes: '',
  }
  const preamble = []
  let current = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      // A blank line ends an inline single-value section (Servings:, Title:).
      if (current && STRING_SECTIONS.has(current) && sections[current]) current = null
      continue
    }

    const matched = matchSectionLabel(line)
    if (matched) {
      current = matched.key
      const rest = line.slice(matched.length).trim()
      if (rest) appendSection(sections, current, rest)
      continue
    }

    // A markdown heading with no known label → the recipe title (first wins).
    const heading = line.match(/^#{1,6}\s+(.*\S)\s*$/)
    if (heading && !sections.title) {
      sections.title = heading[1].trim()
      current = null
      continue
    }

    if (current) appendSection(sections, current, line)
    else preamble.push(line)
  }

  return inferStructure(sections, preamble, text)
}

function appendSection(sections, key, value) {
  if (STRING_SECTIONS.has(key)) {
    sections[key] = sections[key] ? `${sections[key]} ${value}` : value
  } else {
    sections[key].push(stripMarker(value))
  }
}

// Fill gaps that were not explicitly labeled, by inferring from the preamble and
// a whole-text scan. Labeled content always wins over inference.
function inferStructure(sections, preamble, text) {
  const title = sections.title || inferTitle(preamble)
  const description = sections.description || inferDescription(preamble, title)
  const servings = sections.servings || inferServings(text)
  const ingredients = sections.ingredients.length ? sections.ingredients : inferIngredients(preamble)
  const instructions = sections.instructions.length ? sections.instructions : inferInstructions(preamble)

  return {
    title: title.trim(),
    description: description.trim(),
    servings: servings.trim(),
    ingredients,
    instructions,
    whatDoneLooksLike: sections.whatDoneLooksLike.trim(),
    notes: sections.notes.trim(),
  }
}

function inferTitle(preamble) {
  const candidate = preamble.find((line) => line.length >= 2 && line.length <= 120 && !line.endsWith(':'))
  return candidate ?? (preamble[0] ?? '')
}

function inferDescription(preamble, title) {
  // A prose sentence near the top that is not the title and not a list item.
  const candidate = preamble.find(
    (line) =>
      line !== title &&
      !LIST_MARKER_RE.test(line) &&
      !NUMBERED_LINE_RE.test(line) &&
      line.split(/\s+/).length >= 6,
  )
  return candidate ?? ''
}

function inferServings(text) {
  const m = text.match(
    /\b(?:serves?|servings?|yield|yields|makes|portions?)\b[^.\n]*?\d+[^.\n]*|\b\d+\s+(?:servings?|portions?|people)\b/i,
  )
  return m ? m[0].trim() : ''
}

function inferIngredients(lines) {
  return lines
    .filter((line) => !NUMBERED_LINE_RE.test(line))
    .filter((line) => LIST_MARKER_RE.test(line) || (NUMBER_RE.test(line.charAt(0)) && hasQuantityCue(line)))
    .map(stripMarker)
    .filter(Boolean)
}

function inferInstructions(lines) {
  const numbered = lines.filter((line) => NUMBERED_LINE_RE.test(line)).map(stripMarker)
  if (numbered.length) return numbered
  // Fall back to prose sentences that contain a cooking action.
  return lines
    .filter((line) => !LIST_MARKER_RE.test(line))
    .flatMap(splitSentences)
    .filter((s) => VERB_RE.test(s))
}

function splitSentences(block) {
  return block
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

function hasQuantityCue(line) {
  return FRACTION_RE.test(line) || NUMBER_RE.test(line) || UNIT_RE.test(line) || PORTION_RE.test(line)
}

// Lenient "recognizable food" check (rule 3): an ingredient carries a word that
// is not just a number/unit/portion token. Catches real foods without a brittle
// dictionary; rejects empty or quantity-only lines.
function looksLikeFood(line) {
  const tokens = line.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []
  return tokens.some(
    (token) => !UNIT_WORDS.includes(token) && !PORTION_WORDS.includes(token) && !['and', 'the', 'with', 'for'].includes(token),
  )
}

function countInstructionSteps(instructions) {
  if (!instructions.length) return 0
  const numbered = instructions.length // each captured line is already a step
  const sentenceSteps = instructions.flatMap(splitSentences).filter((s) => VERB_RE.test(s)).length
  return Math.max(numbered, sentenceSteps)
}

function looksLikeCommand(text) {
  const head = text.trimStart()
  return COMMAND_PATTERNS.some((re) => re.test(head))
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function evaluateFields(structured, fullText) {
  const status = {}

  status.title = structured.title && structured.title.length >= 2 && !looksLikeCommand(structured.title)
    ? 'ok'
    : 'missing'

  const ingredientCount = structured.ingredients.length
  const quantified = structured.ingredients.filter(hasQuantityCue).length
  const hasFood = structured.ingredients.some(looksLikeFood)
  if (ingredientCount === 0) status.ingredients = 'missing'
  else if (ingredientCount < MIN_INGREDIENTS || quantified < MIN_QUANTIFIED_INGREDIENTS || !hasFood)
    status.ingredients = 'weak'
  else status.ingredients = 'ok'

  const stepCount = countInstructionSteps(structured.instructions)
  const instructionText = structured.instructions.join('\n')
  const hasAction = VERB_RE.test(instructionText)
  if (stepCount === 0) status.instructions = 'missing'
  else if (stepCount < MIN_INSTRUCTION_STEPS || !hasAction) status.instructions = 'weak'
  else status.instructions = 'ok'

  status.servings = structured.servings ? 'ok' : 'missing'

  // Doneness cue OR enough cooking detail (temp/time) to infer completion.
  const donenessText = `${structured.whatDoneLooksLike}\n${instructionText}`
  status['what done looks like'] =
    structured.whatDoneLooksLike || DONENESS_RE.test(donenessText) || COOKING_DETAIL_RE.test(instructionText)
      ? 'ok'
      : 'missing'

  // Description is recommended, never a hard blocker.
  status.description = structured.description ? 'ok' : 'missing'

  return status
}

/**
 * Validate pasted recipe text BEFORE the committee runs. Pure. Returns:
 *   { allowed, reason, missingFields, message, careTeamDispatchAllowed,
 *     structured, fieldMessages, recommendations }
 * `reason` is the doc's contract value (VALID_RECIPE_STRUCTURE / NOT_A_VALID_
 * RECIPE). `message` is caregiver-readable and safe to expose.
 */
export function validateRecipeText(rawText) {
  const text = typeof rawText === 'string' ? rawText.trim() : ''
  const structured = parseRecipe(text)
  const status = evaluateFields(structured, text)

  const missingFields = REQUIRED_FIELDS.filter((field) => status[field] !== 'ok')
  const fieldMessages = {}
  for (const field of missingFields) {
    fieldMessages[field] = FIELD_MESSAGES[field]?.[status[field]] ?? FIELD_MESSAGES[field]?.missing ?? null
  }

  const recommendations = {}
  if (status.description !== 'ok') recommendations.description = FIELD_MESSAGES.description.missing

  // A pure prompt: a command-shaped input with essentially no recipe structure.
  const isPrompt =
    looksLikeCommand(text) && structured.ingredients.length === 0 && structured.instructions.length === 0
  const tooShort = text.length < MIN_RECIPE_CHARS

  const allowed = missingFields.length === 0 && !isPrompt && !tooShort

  if (allowed) {
    return {
      allowed: true,
      reason: 'VALID_RECIPE_STRUCTURE',
      missingFields: [],
      message: VALID_MESSAGE,
      careTeamDispatchAllowed: true,
      structured,
      fieldMessages: {},
      recommendations,
    }
  }

  return {
    allowed: false,
    reason: 'NOT_A_VALID_RECIPE',
    missingFields,
    message: isPrompt ? PROMPT_MESSAGE : CORRECTION_MESSAGE,
    careTeamDispatchAllowed: false,
    structured,
    fieldMessages,
    recommendations,
  }
}
