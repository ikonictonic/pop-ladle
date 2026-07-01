/**
 * Favorites — per-user recipe bookmarks on top of recipe_favorites.
 *
 * Replaces the Supabase recipeFavoriteService (recipe_user_flags). A favorite is
 * keyed by (recipe, user), so it is personal and works for any recipe the user
 * can see — the household's own recipes and shared master/platform recipes
 * alike. Every household role may favorite (it needs no write access to the
 * recipe), which is the whole reason favorites live in their own table rather
 * than on recipe_adaptations.is_favorite.
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { createHttpError, normalizeUuid, requireHouseholdRole } from '../households/householdAccess.js'

// View/favorite/copy/print is open to every role.
const FAVORITE_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']

function getDb() {
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }
  return db
}

/** The recipe ids the current user has favorited within this household. */
export async function listFavoriteRecipeIdsForCurrentUser(clerkUserId, householdId) {
  const db = getDb()
  const user = await getCurrentAppUser(clerkUserId)
  const access = await requireHouseholdRole(db, user.id, householdId, FAVORITE_ROLES, {
    action: 'favorite:recipe',
    resourceType: 'recipe',
    label: 'favorite:list',
  })

  const result = await db.query(
    `
      select recipe_adaptation_id as "recipeId"
      from recipe_favorites
      where user_id = $1 and household_id = $2 and is_favorite = true
    `,
    [user.id, access.household.id],
  )

  return {
    household: access.household,
    requester: access.membership,
    recipeIds: result.rows.map((row) => row.recipeId),
  }
}

/**
 * Set or clear the current user's favorite on a recipe (upsert on the
 * (recipe, user) unique). Returns the new boolean state.
 */
export async function setRecipeFavoriteForCurrentUser(clerkUserId, householdId, recipeId, payload) {
  const db = getDb()
  const user = await getCurrentAppUser(clerkUserId)
  const access = await requireHouseholdRole(db, user.id, householdId, FAVORITE_ROLES, {
    action: 'favorite:recipe',
    resourceType: 'recipe',
    label: 'favorite:set',
  })
  const normalizedRecipeId = normalizeUuid(recipeId, 'INVALID_RECIPE_ID', 'recipeId must be a UUID.')

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
  const isFavorite = Boolean(payload.isFavorite)

  let result
  try {
    result = await db.query(
      `
        insert into recipe_favorites (household_id, recipe_adaptation_id, user_id, is_favorite)
        values ($1, $2, $3, $4)
        on conflict (recipe_adaptation_id, user_id)
        do update set
          is_favorite = excluded.is_favorite,
          household_id = excluded.household_id,
          updated_at = now()
        returning is_favorite as "isFavorite"
      `,
      [access.household.id, normalizedRecipeId, user.id, isFavorite],
    )
  } catch (err) {
    // FK violation = the recipe id doesn't exist.
    if (err?.code === '23503') {
      throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
    }
    throw err
  }

  return {
    household: access.household,
    requester: access.membership,
    isFavorite: result.rows[0]?.isFavorite ?? isFavorite,
  }
}
