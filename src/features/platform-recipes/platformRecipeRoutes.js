import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  copyPlatformRecipeToHousehold,
  getPlatformRecipeForCurrentUser,
  listPlatformRecipesForCurrentUser,
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

  // Publish / unpublish — internal admin (super or clinical).
  router.patch('/admin/recipes/:recipeId/publish', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await publishRecipeForAdmin(req.authContext.userId, req.params.recipeId))
  })

  router.patch('/admin/recipes/:recipeId/unpublish', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await unpublishRecipeForAdmin(req.authContext.userId, req.params.recipeId))
  })

  return router
}
