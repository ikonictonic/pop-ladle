// =============================================================================
// sourceRegistry.js  (ported verbatim from frontend clinicalNutritionSourceRegistry.js)
//
// Local registry of approved clinical nutrition references used as a support
// layer for the accuracy check. Static data + pure matching. No deps.
// =============================================================================

export const REGISTRY_VERSION = 'v6.0.0'

export const CLINICAL_NUTRITION_SOURCES = [
  {
    id: 'ckd_sodium',
    topic: 'CKD sodium guidance',
    plain_language_rule:
      'For chronic kidney disease (CKD), most care plans use a sodium ceiling set by the renal team. Common targets are well under the general 2300 mg/day adult ceiling. Track sodium per meal and per day. Watch out for processed/cured items, packaged sauces, canned soups, and deli meats.',
    source_name: 'National Kidney Foundation — sodium and CKD',
    source_url: 'https://www.kidney.org/atoz/content/sodiumckd',
    last_reviewed: '2026-05-15',
    use_in_prompt: true,
    requires_clinician_confirmation: true,
    triggers: ['ckd', 'kidney disease', 'sodium', 'salt'],
  },
  {
    id: 'ckd_potassium',
    topic: 'CKD potassium guidance',
    plain_language_rule:
      'For CKD with elevated potassium risk, limit high-potassium foods: avocado, banana, potato, sweet potato, orange (whole), spinach in volume, dried fruit, tomato paste/sauce in volume, and beans. Use lower-K alternatives: cauliflower in place of potato; bell pepper instead of heavy tomato; berries instead of banana.',
    source_name: 'National Kidney Foundation — potassium and your CKD diet',
    source_url: 'https://www.kidney.org/atoz/content/potassium',
    last_reviewed: '2026-05-15',
    use_in_prompt: true,
    requires_clinician_confirmation: true,
    triggers: ['ckd', 'potassium', 'hyperkalemia', 'banana', 'avocado', 'potato'],
  },
  {
    id: 'hyperkalemia_caution',
    topic: 'Hyperkalemia food caution',
    plain_language_rule:
      'When the patient takes a potassium binder (e.g., Lokelma / sodium zirconium cyclosilicate) or has had elevated serum potassium, treat the daily potassium ceiling as active. Flag every high-potassium ingredient even if a single portion is small. Sodium context still matters: many low-K substitutes are higher in sodium.',
    source_name: 'American Kidney Fund — hyperkalemia and diet',
    source_url: 'https://www.kidneyfund.org/all-about-kidneys/other-kidney-diseases/hyperkalemia-high-potassium',
    last_reviewed: '2026-05-15',
    use_in_prompt: true,
    requires_clinician_confirmation: true,
    triggers: ['lokelma', 'hyperkalemia', 'potassium binder'],
  },
  {
    id: 'parkinsons_levodopa_protein',
    topic: "Parkinson's and protein timing around levodopa",
    plain_language_rule:
      'Dietary protein competes with levodopa (carbidopa-levodopa) at the gut and the blood-brain barrier. Significant protein loads should come at least 30 minutes after a levodopa dose; avoid heavy protein within the 30 minutes before a dose. Many patients do well concentrating protein at dinner if daytime motor function matters most.',
    source_name: "Parkinson's Foundation — protein and Parkinson's medications",
    source_url: 'https://www.parkinson.org/Living-with-Parkinsons/Managing-Parkinsons/Diet-Nutrition',
    last_reviewed: '2026-05-15',
    use_in_prompt: true,
    requires_clinician_confirmation: true,
    triggers: ['parkinson', 'levodopa', 'carbidopa', 'sinemet', 'protein timing'],
  },
  {
    id: 'hydration_support',
    topic: 'Hydration support',
    plain_language_rule:
      'For an older adult with a history of dehydration, offer a cold beverage with every meal and snack. Plain water is often refused; acceptable alternatives include diluted juice (half juice / half water), broth, milk with meals, coffee in moderation, and hydrating foods (melon, cucumber, citrus segments — mind potassium). Set the drink on the table before the plate arrives.',
    source_name: 'Academy of Nutrition and Dietetics — fluids for older adults',
    source_url: 'https://www.eatright.org/health/wellness/healthful-habits/water-go-with-the-flow',
    last_reviewed: '2026-05-15',
    use_in_prompt: true,
    requires_clinician_confirmation: false,
    triggers: ['dehydration', 'hydration', 'fluid', 'water', 'drink'],
  },
  {
    id: 'food_safety_temps',
    topic: 'Food safety cooking temperatures',
    plain_language_rule:
      'Use safe minimum internal cooking temperatures: poultry 165°F (74°C); ground meats 160°F (71°C); beef/pork/lamb steaks/chops/roasts 145°F (63°C) with a 3-minute rest; fish 145°F (63°C); eggs cooked until both yolk and white are firm. Use a food thermometer rather than visual judgment.',
    source_name: 'FDA — safe minimum internal cooking temperatures',
    source_url: 'https://www.fda.gov/food/buy-store-serve-safe-food/safe-food-handling',
    last_reviewed: '2026-05-15',
    use_in_prompt: true,
    requires_clinician_confirmation: false,
    triggers: ['cook', 'chicken', 'beef', 'pork', 'fish', 'egg', 'ground meat', 'temperature'],
  },
  {
    id: 'grapefruit_atorvastatin',
    topic: 'Grapefruit and atorvastatin caution',
    plain_language_rule:
      'Grapefruit and grapefruit juice can raise blood levels of atorvastatin (Lipitor) and increase the risk of side effects. The drug label says small amounts may be acceptable but significant or routine grapefruit intake should be avoided. Pomelo can have a similar effect. Confirm exact tolerance with the prescribing physician or pharmacist.',
    source_name: 'FDA — grapefruit juice and some medicines',
    source_url: 'https://www.fda.gov/consumers/consumer-updates/grapefruit-juice-and-some-drugs-dont-mix',
    last_reviewed: '2026-05-15',
    use_in_prompt: true,
    requires_clinician_confirmation: true,
    triggers: ['atorvastatin', 'lipitor', 'statin', 'grapefruit', 'pomelo'],
  },
  {
    id: 'texture_swallowing',
    topic: 'Texture and swallowing caution language',
    plain_language_rule:
      'For older adults with tremor, mouth dryness, or any swallowing concern, prefer soft textures, moist preparations, and smaller-size pieces. Avoid sticky breads, large dry chunks, and skins on fruits. If the care team has identified a specific dysphagia level (IDDSI level), match the texture to that level — do not improvise.',
    source_name: 'Academy of Nutrition and Dietetics — IDDSI framework summary',
    source_url: 'https://www.eatright.org/health/wellness/preventing-illness/swallowing-disorder-basics',
    last_reviewed: '2026-05-15',
    use_in_prompt: true,
    requires_clinician_confirmation: true,
    triggers: ['swallow', 'dysphagia', 'texture', 'soft food', 'iddsi'],
  },
  {
    id: 'caregiver_disclaimer',
    topic: 'Caregiver-friendly nutrition disclaimer language',
    plain_language_rule:
      'When in doubt about a clinical claim, soften the language and recommend clinician confirmation. Preferred phrases: "Designed to better fit the saved kidney-related limits, based on the current profile.", "Confirm with the clinician or renal dietitian when the limits change.", "This recipe may need adjustment before serving." Avoid absolute medical claims like "kidney safe", "renal safe", or "medically optimized".',
    source_name: 'App policy — caregiver-friendly language guide',
    source_url: '',
    last_reviewed: '2026-05-15',
    use_in_prompt: true,
    requires_clinician_confirmation: false,
    triggers: ['kidney safe', 'renal safe', 'medically', 'clinically proven', 'guaranteed'],
  },
  {
    id: 'usda_fooddata',
    topic: 'USDA FoodData Central nutrition database',
    plain_language_rule:
      'When exact mg/g nutrient values are needed (sodium, potassium, phosphorus, protein per ingredient), the USDA FoodData Central database is the recognized reference. Until a nutrition database integration is added to this app, output uses qualitative bands (lower / moderate / higher) rather than exact numbers.',
    source_name: 'USDA FoodData Central',
    source_url: 'https://fdc.nal.usda.gov/',
    last_reviewed: '2026-05-15',
    use_in_prompt: false,
    requires_clinician_confirmation: false,
    triggers: ['mg', 'milligrams', 'grams', 'sodium content', 'potassium content', 'phosphorus content'],
  },
]

/**
 * Pick registry entries whose triggers match anything in the supplied context.
 */
export function pickRelevantSources({ profileText = '', hardRules = [], recipeText = '' } = {}) {
  const haystack = [
    String(profileText || '').toLowerCase(),
    ...(hardRules || []).map((r) => String(r.rule_text || '').toLowerCase()),
    ...(hardRules || []).flatMap((r) => (r.trigger_terms || []).map((t) => String(t).toLowerCase())),
    String(recipeText || '').toLowerCase(),
  ].join(' \n ')

  const picked = []
  for (const entry of CLINICAL_NUTRITION_SOURCES) {
    const triggers = entry.triggers || []
    const hit = triggers.some((t) => haystack.includes(String(t).toLowerCase()))
    if (hit) picked.push(entry)
  }
  return picked
}

/**
 * Format a list of registry entries as a plain-text block for prompt context.
 */
export function formatSourcesForPrompt(entries) {
  if (!entries || entries.length === 0) return '(no source notes selected for this generation)'
  return entries.map((e) => {
    const conf = e.requires_clinician_confirmation ? ' [clinician confirmation recommended]' : ''
    return `- [${e.topic}]${conf}: ${e.plain_language_rule}\n  (source: ${e.source_name}${e.source_url ? ` — ${e.source_url}` : ''}; last reviewed ${e.last_reviewed})`
  }).join('\n')
}
