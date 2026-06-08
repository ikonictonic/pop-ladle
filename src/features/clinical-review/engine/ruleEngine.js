// =============================================================================
// ruleEngine.js  (ported verbatim from frontend recipeRuleEngine.js, v6)
//
// Deterministic preflight + postflight + substitution audit. Pure JS.
// =============================================================================

import { parseIngredients } from './ingredientParser.js'

// -----------------------------------------------------------------------------
// PREFLIGHT
// -----------------------------------------------------------------------------

export function preflightScan(sourceText, rules) {
  if (!sourceText || !rules) return []
  const plan = []
  const lcSource = sourceText.toLowerCase()

  for (const rule of rules) {
    if (!rule.is_active) continue
    if (rule.rule_type === 'require') continue
    const terms = rule.trigger_terms || []
    if (terms.length === 0) continue

    for (const term of terms) {
      const lcTerm = String(term).toLowerCase()
      if (!lcTerm) continue
      if (lcSource.includes(lcTerm)) {
        plan.push({
          ruleId: rule.id,
          ruleText: rule.rule_text,
          matchedTerm: term,
          replacement: rule.replacement_text || '(remove)',
          ruleType: rule.rule_type,
        })
      }
    }
  }
  return plan
}

export function buildSubstitutionDirective(plan, rules) {
  const sections = []
  const active = (rules || []).filter((r) => r.is_active)
  if (active.length > 0) {
    sections.push('PATIENT HARD RULES (these override every other instruction):')
    for (const r of active) {
      const terms = (r.trigger_terms || []).filter(Boolean)
      const triggerText = terms.length ? ` Trigger terms: ${terms.join(', ')}.` : ''
      const repl = r.replacement_text
        ? ` Replacement: ${r.replacement_text}.`
        : (r.rule_type === 'remove' ? ' Remove entirely.' : '')
      sections.push(`- [${r.rule_type.toUpperCase()}] ${r.rule_text}.${triggerText}${repl}`)
    }
  }
  if (plan.length > 0) {
    sections.push('')
    sections.push('THIS SOURCE RECIPE TRIGGERS THESE RULES - apply these exact substitutions:')
    for (const p of plan) {
      sections.push(`- Replace "${p.matchedTerm}" with "${p.replacement}". Apply everywhere in ingredients and instructions.`)
    }
  }
  return sections.join('\n')
}

// -----------------------------------------------------------------------------
// POSTFLIGHT
// -----------------------------------------------------------------------------

export function postflightAudit(outputMarkdown, rules) {
  if (!outputMarkdown) {
    return { passed: true, violations: [], substitutions: [], correctedMarkdown: '' }
  }

  const { protectedRegions, scannable } = splitOutputSections(outputMarkdown)
  let working = scannable
  const violations = []
  const substitutions = []

  const placeholders = []
  const placeholderFor = (idx) => `[[RS:${idx}]]`

  for (const rule of (rules || [])) {
    if (!rule.is_active) continue
    if (rule.rule_type === 'require') continue
    const terms = (rule.trigger_terms || []).filter(Boolean)
    if (terms.length === 0) continue

    // Longest term first so "kosher salt" replaces before "salt"
    const sortedTerms = [...terms].sort((a, b) => b.length - a.length)
    for (const term of sortedTerms) {
      const re = makeWordBoundaryRegex(term, rule.replacement_text)
      if (!re.test(working)) continue
      let count = 0
      const idx = placeholders.length
      placeholders.push(rule.replacement_text || '')
      working = working.replace(re, () => { count += 1; return placeholderFor(idx) })
      if (count > 0) {
        substitutions.push({
          ruleId: rule.id,
          ruleText: rule.rule_text,
          term,
          replacement: rule.replacement_text || '(removed)',
          count,
        })
        violations.push({
          ruleId: rule.id,
          ruleText: rule.rule_text,
          term,
          where: 'recipe body',
          count,
          autoCorrected: true,
        })
      }
    }
  }

  for (let i = 0; i < placeholders.length; i += 1) {
    working = working.split(placeholderFor(i)).join(placeholders[i])
  }

  let correctedMarkdown = working + protectedRegions
  if (substitutions.length > 0) {
    correctedMarkdown = mergeSubstitutionLog(correctedMarkdown, substitutions)
  }

  return { passed: substitutions.length === 0, violations, substitutions, correctedMarkdown }
}

// -----------------------------------------------------------------------------
// PHANTOM SUBSTITUTION SCRUB
// -----------------------------------------------------------------------------

export function scrubPhantomSubstitutions({ markdown, sourceText, engineSubstitutions = [] }) {
  if (!markdown) return markdown

  const sourceTokens = new Set()
  for (const ing of parseIngredients(sourceText || '')) {
    sourceTokens.add(ing.toLowerCase())
    for (const w of ing.toLowerCase().split(/\s+/)) {
      if (w.length >= 3) sourceTokens.add(w)
    }
  }
  // Always add anything the engine actually replaced in output
  for (const sub of engineSubstitutions) {
    if (sub.term) sourceTokens.add(String(sub.term).toLowerCase())
  }
  const rawLowerSource = (sourceText || '').toLowerCase()

  return replaceSection(markdown, 'SUBSTITUTIONS', (body) => {
    const lines = body.split('\n')
    const keep = []

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) { keep.push(line); continue }
      if (!/^[-*•]/.test(trimmed)) { keep.push(line); continue }

      const m = trimmed.match(/^[-*•]\s*(.+?)\s*(?:→|->|to\b)\s*(.+?)(?:\s*\(|$)/i)
      const isNoneLine = /^[-*•]\s*(none|n\/a)\b/i.test(trimmed)
      const isAddedLine = /^[-*•]\s*added\b/i.test(trimmed)
      if (isNoneLine || isAddedLine) { keep.push(line); continue }
      if (!m) { keep.push(line); continue }

      const fromName = m[1].trim().toLowerCase()
      const presentInParsed = anyTokenInSet(fromName, sourceTokens)
      const presentInRaw = rawSubstringPresent(fromName, rawLowerSource)
      if (presentInParsed || presentInRaw) {
        keep.push(line)
      }
      // else: drop the line silently
    }

    const cleaned = keep.join('\n').trim()
    if (!cleaned || /^(none|n\/a)/i.test(cleaned)) {
      return '\n\n- none - source recipe already fit the basis\n'
    }
    return `\n\n${cleaned}\n`
  })
}

function rawSubstringPresent(fromName, lowerSource) {
  if (!fromName || !lowerSource) return false
  const lc = fromName.toLowerCase()
  const phraseRe = new RegExp(`(?<![A-Za-z])${escapeRe(lc)}(?![A-Za-z])`, 'i')
  if (phraseRe.test(lowerSource)) return true
  const tokens = lc.split(/\s+/).filter(Boolean)
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const tok = tokens[i]
    if (tok.length < 4) continue
    const tokRe = new RegExp(`(?<![A-Za-z])${escapeRe(tok)}(?![A-Za-z])`, 'i')
    if (tokRe.test(lowerSource)) return true
  }
  return false
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function anyTokenInSet(name, set) {
  const lc = name.toLowerCase()
  if (set.has(lc)) return true
  for (const w of lc.split(/\s+/)) {
    if (w.length >= 3 && set.has(w)) return true
  }
  for (const tok of set) {
    if (tok.length >= 4 && (lc.includes(tok) || tok.includes(lc))) return true
  }
  return false
}

function replaceSection(markdown, headingName, transformBody) {
  const inlinePattern = new RegExp(
    `(\\*\\*${headingName}[: ]?\\*\\*)([\\s\\S]*?)(?=\\n\\*\\*[A-Z]|\\n##|$)`,
    'i',
  )
  if (inlinePattern.test(markdown)) {
    return markdown.replace(inlinePattern, (full, header, body) => {
      const newBody = transformBody(body || '')
      return `${header}${newBody}`
    })
  }
  const headingPattern = new RegExp(
    `(##+\\s+${headingName}[^\\n]*)([\\s\\S]*?)(?=\\n##|$)`,
    'i',
  )
  if (headingPattern.test(markdown)) {
    return markdown.replace(headingPattern, (full, header, body) => {
      const newBody = transformBody(body || '')
      return `${header}${newBody}`
    })
  }
  return markdown
}

// -----------------------------------------------------------------------------
// FULL ENFORCEMENT PIPELINE
// -----------------------------------------------------------------------------

export function enforceRules({ sourceText, rules, rawOutput }) {
  const preflight = preflightScan(sourceText, rules)
  const audit = postflightAudit(rawOutput, rules)
  const scrubbed = scrubPhantomSubstitutions({
    markdown: audit.correctedMarkdown || rawOutput,
    sourceText,
    engineSubstitutions: audit.substitutions,
  })

  return {
    finalMarkdown: scrubbed,
    auditRecord: {
      passed: audit.passed,
      violations: audit.violations,
      substitutions: audit.substitutions,
      preflight_substitutions: preflight.map((p) => ({
        ruleId: p.ruleId,
        ruleText: p.ruleText,
        term: p.matchedTerm,
        replacement: p.replacement,
      })),
    },
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeWordBoundaryRegex(term, replacement = null) {
  const escaped = String(term).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (replacement) {
    const lcTerm = String(term).trim().toLowerCase()
    const lcRepl = String(replacement).trim().toLowerCase()
    if (lcRepl.startsWith(lcTerm + ' ') || lcRepl.startsWith(lcTerm + '-')) {
      const suffix = lcRepl.slice(lcTerm.length)
      const suffixEscaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(`(?<![A-Za-z])${escaped}(?!${suffixEscaped})(?![A-Za-z])`, 'gi')
    }
  }
  return new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'gi')
}

function splitOutputSections(markdown) {
  const subRegex = /(\n\*\*SUBSTITUTIONS[: ]?\*\*|\n##+\s+SUBSTITUTIONS|\n##+\s+Substitutions\b)/i
  const match = subRegex.exec(markdown)
  if (!match) return { protectedRegions: '', scannable: markdown }
  return {
    scannable: markdown.slice(0, match.index),
    protectedRegions: markdown.slice(match.index),
  }
}

export function mergeSubstitutionLog(markdown, substitutions) {
  if (!substitutions || substitutions.length === 0) return markdown
  const newLines = substitutions
    .map((s) => `- ${s.term} → ${s.replacement} (rule: ${s.ruleText}; auto-applied by rule engine)`)
    .join('\n')

  const inlineHeader = /(\*\*SUBSTITUTIONS[: ]?\*\*)([\s\S]*?)(\n\n|$)/i
  if (inlineHeader.test(markdown)) {
    return markdown.replace(inlineHeader, (full, header, body, tail) => {
      const trimmed = body.trim()
      return `${header}${trimmed ? '\n' + trimmed : ''}\n${newLines}${tail}`
    })
  }
  const headingHeader = /(##+\s+SUBSTITUTIONS[^\n]*|##+\s+Substitutions[^\n]*)([\s\S]*?)(\n##|\n$|$)/i
  if (headingHeader.test(markdown)) {
    return markdown.replace(headingHeader, (full, header, body, tail) => {
      const trimmed = body.trim()
      return `${header}\n\n${trimmed ? trimmed + '\n' : ''}${newLines}${tail}`
    })
  }
  return `${markdown.trimEnd()}\n\n**SUBSTITUTIONS APPLIED BY RULE ENGINE:**\n${newLines}\n`
}
