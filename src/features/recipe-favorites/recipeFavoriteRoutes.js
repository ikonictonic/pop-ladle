import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  listFavoriteRecipeIdsForCurrentUser,
  setRecipeFavoriteForCurrentUser,
} from './recipeFavoriteService.js'

export function createRecipeFavoriteRouter() {
  const router = Router()

  // The current user's favorited recipe ids in a household (drives star badges).
  router.get(
    '/households/:householdId/recipe-favorites',
    requireAuthenticatedRequest,
    async (req, res) => {
      res.status(200).json(await listFavoriteRecipeIdsForCurrentUser(
        req.authContext.userId, req.params.householdId,
      ))
    },
  )

  // Set/clear the current user's favorite on a recipe. Body: { isFavorite }.
  router.put(
    '/households/:householdId/recipes/:recipeId/favorite',
    requireAuthenticatedRequest,
    async (req, res) => {
      res.status(200).json(await setRecipeFavoriteForCurrentUser(
        req.authContext.userId, req.params.householdId, req.params.recipeId, req.body,
      ))
    },
  )

  return router
}
