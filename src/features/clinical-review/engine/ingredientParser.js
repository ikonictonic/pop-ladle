// =============================================================================
// ingredientParser.js  (ported verbatim from frontend recipeIngredientParser.js)
//
// Pulls structured ingredient names from raw source recipe text or a LOADOUT
// markdown table, and detects original servings. Pure, deterministic — no deps.
// Returns NORMALIZED ingredient nouns (e.g. "chicken breast", "garlic", "salt").
// =============================================================================

const UNIT_WORDS = new Set([
  'cup','cups','c',
  'tablespoon','tablespoons','tbsp','tbsps','tb',
  'teaspoon','teaspoons','tsp','tsps','t',
  'ounce','ounces','oz',
  'pound','pounds','lb','lbs',
  'gram','grams','g','kg','kilogram','kilograms',
  'ml','milliliter','milliliters','l','liter','liters','litre','litres',
  'pinch','pinches','dash','dashes','splash','splashes',
  'piece','pieces','slice','slices','stick','sticks',
  'can','cans','jar','jars','package','packages','pkg',
  'clove','cloves','head','heads','bunch','bunches','sprig','sprigs','stalk','stalks',
  'small','medium','large','xl','x-large',
  'whole','half','halved','quartered',
])

const FILLER_WORDS = new Set([
  'fresh','dried','frozen','canned','jarred','raw','cooked','prepared',
  'chopped','minced','sliced','diced','grated','shredded','crumbled',
  'crushed','ground','peeled','seeded','cored','trimmed','rinsed','drained',
  'softened','melted','cubed','julienned','smashed','mashed',
  'finely','coarsely','roughly','thinly','thickly','very',
  'optional','to','taste','for','garnish','serving','plus','more','about','approximately',
  'or','and','with','without','of','the','a','an','some','few','several',
  'low-sodium','low','reduced','no-salt-added','unsalted','salted','no',
  'good','quality','best','extra','virgin','dark','light','white','black',
  'kosher','sea','table','fine','flaky','coarse','rock',
  'plain','greek','nonfat','low-fat','whole','skim','2','percent','%',
  'large','medium','small','organic','free-range','grass-fed','wild','farm-raised',
])

const PHRASE_MAP = [
  // canonicalize multi-word phrases into shorter heads
  [/extra\s+virgin\s+olive\s+oil/gi, 'olive oil'],
  [/extra-virgin\s+olive\s+oil/gi, 'olive oil'],
  [/kosher\s+salt/gi, 'salt'],
  [/sea\s+salt/gi, 'salt'],
  [/table\s+salt/gi, 'salt'],
  [/fine\s+sea\s+salt/gi, 'salt'],
  [/freshly\s+ground\s+(black\s+)?pepper/gi, 'black pepper'],
  [/ground\s+pepper/gi, 'black pepper'],
  [/red\s+pepper\s+flakes/gi, 'red pepper flakes'],
  [/heavy\s+(whipping\s+)?cream/gi, 'heavy cream'],
  [/(low[\s-]?sodium\s+)?(chicken|beef|vegetable)\s+(broth|stock)/gi, '$2 broth'],
  [/boneless\s+(skinless\s+)?chicken\s+(breasts?|thighs?)/gi, 'chicken $2'],
  [/yellow\s+onions?/gi, 'onion'],
  [/red\s+onions?/gi, 'onion'],
  [/white\s+onions?/gi, 'onion'],
  [/green\s+onions?/gi, 'scallion'],
  [/spring\s+onions?/gi, 'scallion'],
  [/cherry\s+tomatoes?/gi, 'tomato'],
  [/roma\s+tomatoes?/gi, 'tomato'],
  [/plum\s+tomatoes?/gi, 'tomato'],
  [/grape\s+tomatoes?/gi, 'tomato'],
  [/garlic\s+cloves?/gi, 'garlic'],
  [/cloves?\s+(?:of\s+)?garlic/gi, 'garlic'],
  [/bell\s+peppers?/gi, 'bell pepper'],
  [/red\s+bell\s+peppers?/gi, 'bell pepper'],
  [/green\s+bell\s+peppers?/gi, 'bell pepper'],
  [/yellow\s+bell\s+peppers?/gi, 'bell pepper'],
  [/(red|white)\s+wine\s+vinegar/gi, 'wine vinegar'],
  [/balsamic\s+vinegar/gi, 'balsamic vinegar'],
  [/apple\s+cider\s+vinegar/gi, 'cider vinegar'],
  [/(parsley|cilantro|dill|basil|mint|chives|tarragon|thyme|oregano|rosemary)\s+leaves?/gi, '$1'],
  [/fresh\s+(parsley|cilantro|dill|basil|mint|chives|tarragon|thyme|oregano|rosemary)/gi, '$1'],
  [/dried\s+(oregano|thyme|rosemary|basil|sage|tarragon)/gi, '$1'],
]

/**
 * Parse a recipe text and return a deduplicated list of ingredient nouns.
 * Returns: string[] like ['chicken breast', 'garlic', 'lemon', 'olive oil']
 */
export function parseIngredients(text) {
  if (!text || typeof text !== 'string') return []

  const out = new Set()

  // 1. If the text contains a LOADOUT markdown table, parse it.
  const loadoutMatch = text.match(/\*\*LOADOUT\*\*[^\n]*\n([\s\S]+?)(?=\n\*\*[A-Z]|$)/i)
  if (loadoutMatch) {
    const tableBlock = loadoutMatch[1]
    for (const line of tableBlock.split('\n')) {
      const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/)
      if (!m) continue
      const ingredient = m[1].trim()
      if (!ingredient || /^[-:]+$/.test(ingredient) || /^INGREDIENT$/i.test(ingredient)) continue
      const normalized = normalizeIngredient(ingredient)
      if (normalized) out.add(normalized)
    }
    if (out.size > 0) return [...out]
  }

  // 2. Otherwise scan for bulleted/numbered lines that look like ingredients
  const lines = text.split('\n')
  let inIngredients = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // Heuristic: section heading
    if (/^(##+\s+)?ingredients?\b/i.test(line)) { inIngredients = true; continue }
    if (inIngredients && /^(##+\s+)?(instructions?|directions?|method|preparation|steps?)\b/i.test(line)) {
      inIngredients = false
      continue
    }

    // Skip headings that aren't bullets
    if (line.startsWith('#') || line.startsWith('>')) continue

    // Ingredient candidate: starts with bullet or digit, OR is in the ingredients section
    const looksLikeIngredient =
      inIngredients ||
      /^[-*•]\s/.test(line) ||
      /^\d+[.)]\s/.test(line) ||
      /^\d+\s*(\/\s*\d+)?\s+(cup|cups|tablespoon|tablespoons|tbsp|teaspoon|teaspoons|tsp|oz|ounce|ounces|pound|pounds|lb|lbs|gram|grams|g|kg|ml|l|piece|slice|clove|head|bunch|sprig|stalk|small|medium|large|whole)/i.test(line)

    if (!looksLikeIngredient) continue

    // Trim leading bullet/number
    const cleaned = line
      .replace(/^[-*•]\s*/, '')
      .replace(/^\d+[.)]\s*/, '')
      .replace(/^\d+\s*(\/\s*\d+)?\s*/, '') // leading quantity

    const normalized = normalizeIngredient(cleaned)
    if (normalized) out.add(normalized)
  }

  return [...out]
}

/**
 * Normalize a single ingredient string to a canonical noun head.
 */
export function normalizeIngredient(raw) {
  if (!raw) return ''
  let s = String(raw).toLowerCase().trim()

  // Drop parenthetical notes "(about 1 lb)", "(or to taste)"
  s = s.replace(/\([^)]*\)/g, ' ')

  // Drop trailing comma-led clauses ", chopped" etc.
  s = s.replace(/,.*$/, '')

  // Apply phrase canonicalization
  for (const [pat, sub] of PHRASE_MAP) {
    s = s.replace(pat, sub)
  }

  // Tokenize, remove numbers/fractions/units/fillers
  const tokens = s
    .split(/\s+/)
    .map((t) => t.replace(/[.,;:!]+$/, ''))
    .filter(Boolean)
    .filter((t) => !/^[\d/.-]+$/.test(t))  // pure numbers/fractions
    .filter((t) => !UNIT_WORDS.has(t))
    .filter((t) => !FILLER_WORDS.has(t))

  let result = tokens.join(' ').trim()
  // Collapse internal whitespace
  result = result.replace(/\s+/g, ' ')
  // Final filler scrub from phrase map results
  result = result.replace(/^(of|with|the|a|an)\s+/g, '')
  return result
}

/**
 * Detect the original serving count from raw source text. Returns:
 *   { servings: number | null, estimated: boolean }
 */
export function detectOriginalServings(text) {
  if (!text || typeof text !== 'string') return { servings: null, estimated: true }

  // Direct patterns
  const patterns = [
    /serves?\s*[:-]?\s*(\d+)\s*(?:to|-|–)\s*(\d+)/i, // "Serves 4-6"
    /serves?\s*[:-]?\s*(\d+)/i,                       // "Serves 4"
    /yields?\s*[:-]?\s*(\d+)\s*servings?/i,           // "Yields: 4 servings"
    /(\d+)\s*servings?\b/i,                            // "4 servings"
    /makes?\s*[:-]?\s*(\d+)\s*servings?/i,            // "Makes 4 servings"
    /(\d+)\s*portions?\b/i,                            // "4 portions"
    /for\s*(\d+)\s*(?:people|persons)/i,               // "for 4 people"
  ]

  for (const pat of patterns) {
    const m = text.match(pat)
    if (m) {
      const a = parseInt(m[1], 10)
      const b = m[2] ? parseInt(m[2], 10) : null
      if (!Number.isFinite(a) || a <= 0 || a > 50) continue
      if (b && Number.isFinite(b) && b > a) {
        // Range like "4-6" -> use the midpoint, rounded
        return { servings: Math.round((a + b) / 2), estimated: false }
      }
      return { servings: a, estimated: false }
    }
  }

  return { servings: null, estimated: true }
}

/**
 * Build the comparison object for the flavor-up pass.
 */
export function buildComparisonObject({ sourceText, currentMarkdown, hardRules }) {
  const originalIngredients = parseIngredients(sourceText || '')
  const adaptedIngredients = parseIngredients(currentMarkdown || '')

  const adaptedSet = new Set(adaptedIngredients)
  const removedForClinicalReasons = originalIngredients.filter((i) => !adaptedSet.has(i))

  const substitutionsAlreadyMade = []
  const subSection = (currentMarkdown || '').match(/\*\*SUBSTITUTIONS:?\*\*([\s\S]*?)(?=\n\*\*[A-Z]|$)/i)
  if (subSection) {
    for (const line of subSection[1].split('\n')) {
      const m = line.match(/^[-*]\s*(.+?)\s*(?:→|->|to)\s*(.+?)\s*(?:\(|$)/i)
      if (m) substitutionsAlreadyMade.push(`${m[1].trim()} → ${m[2].trim()}`)
    }
  }

  const FLAVOR_LEVERS = [
    'lemon zest', 'lemon juice', 'cider vinegar', 'wine vinegar', 'parsley',
    'dill', 'basil', 'thyme', 'rosemary', 'chives', 'scallion', 'black pepper',
    'paprika', 'smoked paprika', 'cumin', 'coriander', 'sumac', 'cinnamon',
    'toasted breadcrumbs', 'herb oil', 'yogurt sauce', 'olive oil drizzle',
  ]

  const ruleTriggerTerms = new Set()
  for (const r of (hardRules || [])) {
    if (!r.is_active) continue
    for (const t of (r.trigger_terms || [])) ruleTriggerTerms.add(String(t).toLowerCase())
  }

  const safeFlavorCandidates = []
  const blockedFlavorCandidates = []
  for (const lever of FLAVOR_LEVERS) {
    const lc = lever.toLowerCase()
    let blocked = false
    for (const t of ruleTriggerTerms) {
      if (lc.includes(t) || t.includes(lc.split(' ')[0])) { blocked = true; break }
    }
    if (blocked) blockedFlavorCandidates.push(lever)
    else safeFlavorCandidates.push(lever)
  }

  return {
    originalIngredients,
    adaptedIngredients,
    removedForClinicalReasons,
    substitutionsAlreadyMade,
    safeFlavorCandidates,
    blockedFlavorCandidates,
  }
}
