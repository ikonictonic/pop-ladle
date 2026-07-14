/**
 * Public content — the unauthenticated read surface behind the marketing site.
 *
 * This is the ONLY place the API serves data to a caller with no Clerk session,
 * so the rules are deliberately narrow and enforced here rather than trusted to
 * the caller:
 *
 *   - Master library recipes only (`scope = 'master'`), never household recipes.
 *     Household content is care-recipient data and must never be public.
 *   - Published only (`published_at is not null`, `deleted_at is null`), so an
 *     admin's unpublished draft cannot leak.
 *   - Denied recipes are withheld. A `denied` verdict is the Clinical Review
 *     Gate's only hard block, and marketing is exactly where an unsafe recipe
 *     must not surface.
 *   - A curated projection: no clinical review internals, no household ids, no
 *     authorship. Only what a public recipe card/detail page needs.
 *
 * Everything served here is already public-by-design library content, but the
 * projection is explicit so widening it is a deliberate act, not an accident.
 */

import { getDatabasePool } from '../../database/pool.js'
import { createHttpError, normalizeUuid } from '../households/householdAccess.js'

const DEFAULT_LIMIT = 24
const MAX_LIMIT = 60
const MAX_SEARCH = 120

// Denied recipes never reach the public site. Anything else that is published
// carries the "AI-reviewed · not clinically verified" badge on the client.
export const PUBLIC_REVIEW_STATUSES = ['approved', 'approved_with_caveats', 'needs_review', 'not_reviewed']

function publicProjection(alias = 'ra') {
  return `
    ${alias}.id,
    ${alias}.title,
    ${alias}.output_markdown as "outputMarkdown",
    ${alias}.meal_slots as "mealSlots",
    ${alias}.recipe_categories as "recipeCategories",
    ${alias}.photo_url as "photoUrl",
    ${alias}.target_servings as "targetServings",
    ${alias}.clinical_review_status as "clinicalReviewStatus",
    ${alias}.published_at as "publishedAt"
  `
}

function requireDb() {
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }
  return db
}

// Minimum body length for a recipe to be worth showing a stranger. Guards
// against placeholder rows (the library currently holds one whose entire body is
// the string "x").
const MIN_BODY_LENGTH = 120

/**
 * Is this row presentable on a public marketing page?
 *
 * The library is real production data and currently contains rows that are fine
 * for a signed-in caregiver — who sees them in context, with a clinical-review
 * panel — but not fine as marketing:
 *
 *   - Bodies that are a raw ```json envelope, from the Chairwoman parse failure
 *     (fixed forward, but the already-published rows were never backfilled).
 *   - Placeholder/stub bodies.
 *
 * Rather than publish those to strangers, withhold them. This is a display
 * filter, not a security boundary — the security guarantees are in the SQL.
 */
function isPresentable(recipe) {
  const body = typeof recipe.outputMarkdown === 'string' ? recipe.outputMarkdown.trim() : ''
  if (body.length < MIN_BODY_LENGTH) return false
  // A body that is really a JSON envelope (```json / bare {"recipe_markdown").
  if (/^```\s*json/i.test(body)) return false
  if (/^\{\s*"?recipe_markdown"?\s*:/i.test(body)) return false
  return true
}

/**
 * The stored title is the caregiver-facing name and can carry authoring
 * artifacts ("Title: Lemon Yogurt Cake"). Prefer the adapted body's own H1,
 * which is what the recipe actually is, and strip a stray "Title:" label.
 */
function displayTitle(recipe) {
  const body = typeof recipe.outputMarkdown === 'string' ? recipe.outputMarkdown : ''
  const heading = body.split('\n').map((l) => l.trim()).find((l) => /^#{1,6}\s+/.test(l))
  const fromBody = heading ? heading.replace(/^#{1,6}\s+/, '').trim() : ''
  const raw = fromBody || recipe.title || 'Untitled recipe'
  return raw.replace(/^title\s*[:\-–]\s*/i, '').trim() || 'Untitled recipe'
}

function toPublicRecipe(recipe) {
  return { ...recipe, title: displayTitle(recipe) }
}

// Exported for publicContent.test.js — this is the only unauthenticated read
// path, so its curation rules are pinned by tests rather than left to review.
export { isPresentable as __isPresentableForTests, displayTitle as __displayTitleForTests }

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toLowerArray(value) {
  if (value === undefined || value === null || value === '') return null
  const list = Array.isArray(value) ? value : String(value).split(',')
  const out = list.map((v) => String(v).trim().toLowerCase()).filter(Boolean)
  return out.length > 0 ? out : null
}

/** List published master recipes. No auth. */
export async function listPublicRecipes(query = {}) {
  const db = requireDb()

  const search = normalizeText(query.search)
  if (search.length > MAX_SEARCH) {
    throw createHttpError(400, 'INVALID_SEARCH', `Search must be ${MAX_SEARCH} characters or fewer.`, true)
  }

  const mealSlots = toLowerArray(query.mealSlots ?? query.mealSlot)
  const categories = toLowerArray(query.recipeCategories ?? query.categories ?? query.category)

  const requestedLimit = Number.parseInt(query.limit ?? `${DEFAULT_LIMIT}`, 10)
  const limit = Number.isInteger(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT

  const result = await db.query(
    `
      select ${publicProjection('ra')}
      from recipe_adaptations ra
      where ra.scope = 'master'
        and ra.deleted_at is null
        and ra.published_at is not null
        and ra.clinical_review_status = any($4::text[])
        and ($1::text is null or ra.title ilike '%' || $1 || '%')
        and ($2::text[] is null or ra.meal_slots && $2::text[])
        and ($3::text[] is null or ra.recipe_categories && $3::text[])
      order by ra.published_at desc
      limit $5
    `,
    // Over-fetch: isPresentable() drops rows in JS, so ask for headroom to still
    // fill a page of `limit` after filtering.
    [search || null, mealSlots, categories, PUBLIC_REVIEW_STATUSES, Math.min(limit * 3, MAX_LIMIT * 3)],
  )

  const recipes = result.rows.filter(isPresentable).slice(0, limit).map(toPublicRecipe)

  return { recipes }
}

/** Read one published master recipe. No auth. */
export async function getPublicRecipe(recipeId) {
  const db = requireDb()

  // Reject a malformed id as a clean 400 rather than letting Postgres throw on
  // an invalid uuid cast.
  const id = normalizeUuid(recipeId, 'INVALID_RECIPE_ID', 'Recipe id must be a UUID.')

  const result = await db.query(
    `
      select ${publicProjection('ra')}
      from recipe_adaptations ra
      where ra.id = $1
        and ra.scope = 'master'
        and ra.deleted_at is null
        and ra.published_at is not null
        and ra.clinical_review_status = any($2::text[])
      limit 1
    `,
    [id, PUBLIC_REVIEW_STATUSES],
  )

  // Not presentable == not on the public site, so a direct link to one 404s just
  // like an unpublished recipe. Otherwise the list could hide a row that its own
  // detail page would happily render.
  if (result.rows.length === 0 || !isPresentable(result.rows[0])) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
  }

  return { recipe: toPublicRecipe(result.rows[0]) }
}
