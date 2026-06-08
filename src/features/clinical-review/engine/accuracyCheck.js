// =============================================================================
// accuracyCheck.js  (ported verbatim from frontend clinicalAccuracyCheckService.js)
//
// runClinicalAccuracyCheck() is a DETERMINISTIC, code-only check (no LLM) that
// returns a structured report. 7 stages: input completeness, clinical-profile
// alignment, hard-rule check, ingredient truth, serving/portion, clinical
// claims, practical cooking. Pure — no deps beyond the sibling engine modules.
// =============================================================================

import { parseIngredients, detectOriginalServings } from './ingredientParser.js'
import { postflightAudit } from './ruleEngine.js'
import { CLINICAL_NUTRITION_SOURCES, pickRelevantSources } from './sourceRegistry.js'

export const ACCURACY_CHECK_VERSION = 'accuracy-v6.0.0'

// Banned claim phrases that need to be replaced or softened
const UNSUPPORTED_CLAIM_PATTERNS = [
  /\bkidney[- ]safe\b/i,
  /\brenal[- ]safe\b/i,
  /\bmedically[- ]optimized\b/i,
  /\bclinically[- ]proven\b/i,
  /\bdoctor[- ]approved\b/i,
  /\bguaranteed\b/i,
  /\bnegligible\s+potassium\b/i,
  /\bessential\s+for\s+renal\s+protection\b/i,
  /\bdoes\s+not\s+compete\s+with\s+levodopa\b/i,
]

/**
 * Main entry point. Returns a result object matching the spec.
 */
export function runClinicalAccuracyCheck({
  sourceRecipeText = '',
  generatedRecipe = '',
  clinicalProfile = '',
  hardRules = [],
  targetServings = null,
  originalServings = null,
  generationMode = 'adapt_clinically',
  recipeTaxonomy = [],
  sourceIngredientList = null,
  adaptedIngredientList = null,
} = {}) {
  void recipeTaxonomy
  const issues = []
  const requiredCorrections = []
  const clinicianReviewFlags = []
  const sourceRegistryTopicsUsed = []

  const sourceIngredients = sourceIngredientList || parseIngredients(sourceRecipeText)
  void (adaptedIngredientList || parseIngredients(generatedRecipe))

  // STAGE 1 — Input completeness
  const inputComplete = {
    profile: Boolean((clinicalProfile || '').trim()),
    hard_rules_loaded: Array.isArray(hardRules),
    target_servings: Number.isFinite(targetServings) && targetServings > 0,
    generation_mode: ['adapt_clinically', 'preserve_original'].includes(generationMode),
    source_recipe: Boolean((sourceRecipeText || '').trim()),
    taxonomy_loaded: Array.isArray(recipeTaxonomy),
  }
  for (const [k, v] of Object.entries(inputComplete)) {
    if (!v) {
      issues.push({
        severity: 'medium',
        section: 'input',
        issue: `Input missing or invalid: ${k}`,
        why_it_matters: 'Accuracy check needs complete inputs to verify the draft.',
        required_correction: 'Caller must supply this input.',
        source_basis: 'uncertain',
      })
    }
  }

  // STAGE 2 — Clinical Profile alignment
  const profileText = (clinicalProfile || '').toLowerCase()
  const profileUsed = profileText.length > 0
  const adaptedText = (generatedRecipe || '').toLowerCase()

  const profileMentionsPotassium = /hyperkalemia|potassium\s+(?:ceiling|limit|restriction|max)|lokelma/i.test(profileText)
  void /sodium\s+(?:ceiling|limit|under|less\s+than)|low[- ]sodium|cad|cardiovascular/i.test(profileText) // reserved
  const profileMentionsLevodopa = /levodopa|carbidopa|sinemet|parkinson/i.test(profileText)
  const profileMentionsGarlic = /garlic\s+trigger|avoid\s+garlic|garlic.*metallic/i.test(profileText)
  const profileMentionsGrapefruit = /grapefruit/i.test(profileText) && /atorvastatin|statin|lipitor/i.test(profileText)

  if (profileMentionsPotassium) {
    const HIGH_K = ['banana','bananas','avocado','potato','sweet potato','spinach','tomato paste','dried fruit','dried apricot','orange juice']
    for (const ing of HIGH_K) {
      const re = new RegExp(`(?<![A-Za-z])${ing}(?![A-Za-z])`, 'i')
      if (re.test(adaptedText)) {
        issues.push({
          severity: 'high',
          section: 'ingredients',
          issue: `Potassium-sensitive: "${ing}" appears in the recipe; profile names a potassium ceiling.`,
          why_it_matters: 'Hyperkalemia management is active in this profile.',
          required_correction: `Replace or portion-limit ${ing}, or move it to a clearly per-serving controlled amount.`,
          source_basis: 'clinical_profile',
        })
        requiredCorrections.push(`Address potassium-sensitive ingredient: ${ing}`)
      }
    }
    sourceRegistryTopicsUsed.push('ckd_potassium', 'hyperkalemia_caution')
  }

  if (profileMentionsGarlic && /(?<![A-Za-z])garlic(?![A-Za-z])/i.test(adaptedText)) {
    issues.push({
      severity: 'high',
      section: 'ingredients',
      issue: 'Garlic appears in the adapted recipe; profile lists garlic as a metallic-taste trigger to avoid.',
      why_it_matters: 'Patient taste trigger should be respected.',
      required_correction: 'Remove garlic or swap for shallot or a safer aromatic.',
      source_basis: 'clinical_profile',
    })
    requiredCorrections.push('Remove garlic per clinical profile.')
  }

  if (profileMentionsGrapefruit && /(?<![A-Za-z])grapefruit(?![A-Za-z])/i.test(adaptedText)) {
    issues.push({
      severity: 'high',
      section: 'ingredients',
      issue: 'Grapefruit appears in the adapted recipe; profile flags grapefruit + statin interaction.',
      why_it_matters: 'Statin interaction with grapefruit can raise drug levels.',
      required_correction: 'Remove grapefruit or swap for lemon or orange (modest amount).',
      source_basis: 'clinical_profile',
    })
    sourceRegistryTopicsUsed.push('grapefruit_atorvastatin')
    requiredCorrections.push('Remove grapefruit per clinical profile.')
  }

  // STAGE 3 — Hard Rule check (deterministic; the rule engine is authoritative)
  let hardRulesUsed = false
  let hardRuleViolations = []
  if (Array.isArray(hardRules) && hardRules.length > 0) {
    hardRulesUsed = true
    const audit = postflightAudit(generatedRecipe, hardRules)
    hardRuleViolations = audit.substitutions || []
    for (const v of hardRuleViolations) {
      issues.push({
        severity: 'high',
        section: 'ingredients',
        issue: `Hard rule violation: "${v.term}" appears in output (rule: ${v.ruleText}).`,
        why_it_matters: 'Hard rules are absolute constraints; the rule engine will rewrite this term.',
        required_correction: `Use "${v.replacement}" instead of "${v.term}".`,
        source_basis: 'hard_rule',
      })
      requiredCorrections.push(`Replace ${v.term} → ${v.replacement} (hard rule).`)
    }
  }

  // STAGE 4 — Ingredient truth check (substitution + addition correctness)
  const subSection = (generatedRecipe || '').match(/\*\*SUBSTITUTIONS:?\*\*([\s\S]*?)(?=\n\*\*[A-Z]|\n##|$)/i)
  const subLines = []
  if (subSection) {
    for (const line of subSection[1].split('\n')) {
      const m = line.match(/^[-*•]\s*(.+?)\s*(?:→|->|to\b)\s*(.+?)(?:\s*\(|$)/i)
      if (!m) continue
      const from = m[1].trim().toLowerCase()
      if (/^(none|n\/a|added)/i.test(from)) continue
      subLines.push({ from, to: m[2].trim(), raw: line.trim() })
    }
  }

  const lowerSource = (sourceRecipeText || '').toLowerCase()
  for (const s of subLines) {
    const presentInParsed = sourceIngredients.some((ing) =>
      ing.toLowerCase().includes(s.from) || s.from.includes(ing.toLowerCase()))
    const presentRaw = new RegExp(`(?<![A-Za-z])${s.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i').test(lowerSource)
    const ruleReplaced = hardRuleViolations.some((v) => v.term.toLowerCase() === s.from)
    if (!presentInParsed && !presentRaw && !ruleReplaced) {
      issues.push({
        severity: 'medium',
        section: 'substitutions',
        issue: `Substitution claim "${s.raw}" lists "${s.from}" but it is not present in the source recipe.`,
        why_it_matters: 'Substitutions must reflect real source ingredients. Phantom substitutions confuse the caregiver.',
        required_correction: `Drop the substitution line, or move "${s.to}" to FLAVOR ADDITIONS if it was added rather than substituted.`,
        source_basis: 'uncertain',
      })
      requiredCorrections.push(`Drop phantom substitution: ${s.raw}`)
    }
  }

  const substitutionCheckPassed = subLines.length === 0 || issues.every((i) => i.section !== 'substitutions')

  const removedSection = (generatedRecipe || '').match(/\*\*INGREDIENTS REMOVED:?\*\*([\s\S]*?)(?=\n\*\*[A-Z]|\n##|$)/i)
  if (removedSection) {
    for (const line of removedSection[1].split('\n')) {
      const m = line.match(/^[-*•]\s*(.+?)(?:\s+\(|$)/)
      if (!m) continue
      const removed = m[1].trim().toLowerCase()
      if (/^(none|n\/a)/i.test(removed)) continue
      const presentInParsed = sourceIngredients.some((ing) =>
        ing.toLowerCase().includes(removed) || removed.includes(ing.toLowerCase()))
      const presentRaw = new RegExp(`(?<![A-Za-z])${removed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i').test(lowerSource)
      if (!presentInParsed && !presentRaw) {
        issues.push({
          severity: 'low',
          section: 'substitutions',
          issue: `INGREDIENTS REMOVED lists "${removed}" but it was not in the source.`,
          why_it_matters: 'Removed list should mirror actual source ingredients.',
          required_correction: 'Drop this line.',
          source_basis: 'uncertain',
        })
      }
    }
  }

  const ingredientCheckPassed = !issues.some((i) => i.section === 'ingredients' && i.severity === 'high')

  // STAGE 5 — Serving / portion check
  const detected = detectOriginalServings(sourceRecipeText)
  let servingCheckPassed = true

  const summaryBlock = generatedRecipe.match(/\*\*SERVING SUMMARY\*\*([\s\S]*?)(?=\n\*\*[A-Z]|\n##|$)/i)
  const targetMentioned = targetServings && (
    new RegExp(`adjusted for[^\\d]*${targetServings}\\b`, 'i').test(summaryBlock?.[1] || '') ||
    new RegExp(`target servings[^\\d]*${targetServings}\\b`, 'i').test(generatedRecipe) ||
    new RegExp(`for\\s+${targetServings}\\s+(?:people|servings|portions)`, 'i').test(generatedRecipe)
  )
  if (targetServings && !targetMentioned) {
    issues.push({
      severity: 'medium',
      section: 'servings',
      issue: `Target servings (${targetServings}) is not clearly stated in the SERVING SUMMARY.`,
      why_it_matters: 'Caregiver needs to see the target serving count to portion correctly.',
      required_correction: 'Add the target serving count to the SERVING SUMMARY section.',
      source_basis: 'hard_rule',
    })
    requiredCorrections.push(`Surface target servings (${targetServings}) in SERVING SUMMARY.`)
    servingCheckPassed = false
  }

  if (originalServings || detected.servings) {
    const orig = originalServings || detected.servings
    const origMentioned = new RegExp(`(original|source)\\b[^\\d]*${orig}\\b`, 'i').test(generatedRecipe)
    if (!origMentioned && !detected.estimated) {
      issues.push({
        severity: 'low',
        section: 'servings',
        issue: `Original servings (${orig}) not surfaced in the SERVING SUMMARY.`,
        why_it_matters: 'Helps the caregiver see what scaling was applied.',
        required_correction: 'Add original servings to the SERVING SUMMARY section.',
        source_basis: 'hard_rule',
      })
      servingCheckPassed = false
    }
  }

  if (generationMode === 'preserve_original' && targetServings && originalServings && targetServings !== originalServings) {
    const mismatchSurfaced = /serving\s+mismatch|differs\s+from\s+original|do not scale|no scaling/i.test(generatedRecipe)
    if (!mismatchSurfaced) {
      issues.push({
        severity: 'high',
        section: 'servings',
        issue: 'Preserve mode + serving mismatch but the output does not flag it.',
        why_it_matters: 'In preserve mode, the caregiver must see when target ≠ original servings, since ingredients are not scaled.',
        required_correction: 'Add a clear serving-mismatch warning to CLINICAL CONCERNS.',
        source_basis: 'hard_rule',
      })
      requiredCorrections.push('Surface serving mismatch in CLINICAL CONCERNS (preserve mode).')
      servingCheckPassed = false
    }
  }

  // STAGE 6 — Clinical claim check
  let dietaryClaimCheckPassed = true
  let medicationFoodCheckPassed = true
  for (const pat of UNSUPPORTED_CLAIM_PATTERNS) {
    const m = generatedRecipe.match(pat)
    if (m) {
      issues.push({
        severity: 'medium',
        section: 'clinical_fit',
        issue: `Unsupported clinical claim: "${m[0]}"`,
        why_it_matters: 'Absolute medical claims should be softened per caregiver-friendly language guidance.',
        required_correction:
          `Replace "${m[0]}" with softer language, e.g. "designed to better fit the saved kidney-related limits, based on the current profile. Confirm with clinician or renal dietitian when limits change."`,
        source_basis: 'source_registry',
      })
      requiredCorrections.push(`Soften unsupported claim: ${m[0]}`)
      sourceRegistryTopicsUsed.push('caregiver_disclaimer')
      dietaryClaimCheckPassed = false
    }
  }

  if (profileMentionsLevodopa) {
    const claimsNoCompetition = /does\s+not\s+compete\s+with\s+levodopa/i.test(generatedRecipe)
    if (claimsNoCompetition) {
      medicationFoodCheckPassed = false
      issues.push({
        severity: 'high',
        section: 'clinical_fit',
        issue: 'Unsupported medication-food claim: states protein does not compete with levodopa.',
        why_it_matters: 'Protein-levodopa competition is established; recipe should respect timing, not deny competition.',
        required_correction: 'Replace with: "Serve 30-45 minutes after the next levodopa dose."',
        source_basis: 'source_registry',
      })
      sourceRegistryTopicsUsed.push('parkinsons_levodopa_protein')
    }
  }

  // STAGE 7 — Practical cooking check
  let caregiverPracticalityPassed = true

  const loadout = (generatedRecipe.match(/\*\*LOADOUT\*\*([\s\S]+?)(?=\*\*[A-Z]|$)/i) || [])[1] || ''
  const execution = (generatedRecipe.match(/\*\*EXECUTION\*\*([\s\S]+?)(?=\*\*[A-Z]|$)/i) || [])[1] || ''
  void loadout

  if (!execution.trim()) {
    issues.push({
      severity: 'high',
      section: 'method',
      issue: 'EXECUTION section is empty or missing.',
      why_it_matters: 'Caregiver needs actionable cooking steps.',
      required_correction: 'Add concrete imperative cooking steps.',
      source_basis: 'hard_rule',
    })
    caregiverPracticalityPassed = false
  }

  const awkwardQty = generatedRecipe.match(/\b\d+\.\d{3,}\s*(tsp|teaspoon|tbsp|tablespoon|cup|oz|ounce|lb|pound|gram|g\b)/i)
  if (awkwardQty) {
    issues.push({
      severity: 'low',
      section: 'ingredients',
      issue: `Awkward fractional quantity: "${awkwardQty[0]}".`,
      why_it_matters: 'Caregivers need practical kitchen measurements.',
      required_correction: 'Round to a practical amount (1/8, 1/4, 1/3, 1/2 tsp etc).',
      source_basis: 'hard_rule',
    })
    caregiverPracticalityPassed = false
  }

  // Relevant registry topics (always surfaced when triggered)
  const relevantRegistry = pickRelevantSources({
    profileText: clinicalProfile,
    hardRules,
    recipeText: generatedRecipe,
  })
  for (const r of relevantRegistry) {
    if (!sourceRegistryTopicsUsed.includes(r.id)) sourceRegistryTopicsUsed.push(r.id)
    if (r.requires_clinician_confirmation) {
      const note = `Confirm with clinician: ${r.topic}`
      if (!clinicianReviewFlags.includes(note)) clinicianReviewFlags.push(note)
    }
  }

  // Aggregate result
  const highSeverityCount = issues.filter((i) => i.severity === 'high').length
  const mediumSeverityCount = issues.filter((i) => i.severity === 'medium').length
  const passed = highSeverityCount === 0

  let confidence = 'high'
  if (highSeverityCount > 0) confidence = 'low'
  else if (mediumSeverityCount > 1) confidence = 'medium'
  else if (mediumSeverityCount === 1) confidence = 'medium'

  let finalSafetySummary
  if (passed && issues.length === 0) {
    finalSafetySummary = 'No automated issues found. Caregiver should still confirm portions and timing with their clinical team when limits change.'
  } else if (passed) {
    finalSafetySummary = `Passed with ${issues.length} low/medium item(s) noted. Review the issue list below.`
  } else {
    finalSafetySummary = `Needs review — ${highSeverityCount} high-severity issue(s) detected. The app will attempt one automatic correction pass before showing the recipe.`
  }

  return {
    passed,
    confidence,
    clinicalProfileUsed: profileUsed,
    hardRulesUsed,
    servingCheckPassed,
    ingredientCheckPassed,
    substitutionCheckPassed,
    dietaryClaimCheckPassed,
    medicationFoodCheckPassed,
    caregiverPracticalityPassed,
    issues,
    requiredCorrections,
    clinicianReviewFlags,
    sourceRegistryTopicsUsed,
    finalSafetySummary,
    checkVersion: ACCURACY_CHECK_VERSION,
  }
}

/**
 * Format the result for a small caregiver-facing status panel.
 */
export function formatAccuracyStatusForUI(result) {
  if (!result) return null
  return {
    status: result.passed ? 'Passed' : 'Needs review',
    confidence: capitalize(result.confidence || 'medium'),
    profileUsed: result.clinicalProfileUsed ? 'yes' : 'no',
    rulesUsed: result.hardRulesUsed ? 'yes' : 'no',
    servingCheck: result.servingCheckPassed ? 'passed' : 'needs review',
    ingredientCheck: result.ingredientCheckPassed ? 'passed' : 'needs review',
    issueCount: (result.issues || []).length,
    highCount: (result.issues || []).filter((i) => i.severity === 'high').length,
    clinicianReviewFlags: result.clinicianReviewFlags || [],
  }
}

function capitalize(s) {
  if (!s) return ''
  return String(s).charAt(0).toUpperCase() + String(s).slice(1)
}

export { CLINICAL_NUTRITION_SOURCES }
