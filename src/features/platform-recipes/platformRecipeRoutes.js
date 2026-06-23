import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  copyPlatformRecipeToHousehold,
  getPlatformRecipeForCurrentUser,
  listPlatformRecipesForCurrentUser,
  listRecipeReviewQueueForAdmin,
  publishRecipeForAdmin,
  unpublishRecipeForAdmin,
} from './platformRecipeService.js'

export function createPlatformRecipeRouter() {
  const router = Router()

  // Browse the Master Recipe Library — any authenticated user.
  router.get('/platform-recipes', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await listPlatformRecipesForCurrentUser(req.authContext.userId, req.query))
  })

  router.get('/platform-recipes/:recipeId', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await getPlatformRecipeForCurrentUser(req.authContext.userId, req.params.recipeId))
  })

  // Copy a master into the household — owner/co-owner/caregiver, library_copy plan.
  router.post(
    '/households/:householdId/platform-recipes/:recipeId/copy',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await copyPlatformRecipeToHousehold(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.body,
      )
      res.status(201).json(result)
    },
  )

  // Recipe Review Queue — gate-cleared recipes awaiting library acceptance.
  router.get('/admin/recipe-review-queue', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await listRecipeReviewQueueForAdmin(req.authContext.userId, req.query))
  })

  // Accept a cleared recipe into the library (optionally with tags) / unpublish — admin.
  router.patch('/admin/recipes/:recipeId/publish', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await publishRecipeForAdmin(req.authContext.userId, req.params.recipeId, req.body))
  })

  router.patch('/admin/recipes/:recipeId/unpublish', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await unpublishRecipeForAdmin(req.authContext.userId, req.params.recipeId))
  })

  return router
}
