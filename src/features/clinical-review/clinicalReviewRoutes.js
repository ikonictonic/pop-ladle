import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import { runAccuracyCheckForCurrentUser } from './accuracyCheckService.js'
import {
  applyReviewDecisionForCurrentUser,
  getRecipeReviewForCurrentUser,
  listRecipesForReviewForCurrentUser,
} from './clinicalReviewService.js'

export function createClinicalReviewRouter() {
  const router = Router()

  // Review queue (all roles can view).
  router.get(
    '/households/:householdId/clinical-review',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await listRecipesForReviewForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.query,
      )
      res.status(200).json(result)
    },
  )

  // Per-recipe review detail: status, accuracy, and full history.
  router.get(
    '/households/:householdId/clinical-review/:recipeId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await getRecipeReviewForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
      )
      res.status(200).json(result)
    },
  )

  // Set a verdict (owner / co-owner only).
  router.post(
    '/households/:householdId/clinical-review/:recipeId/decision',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await applyReviewDecisionForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.body,
      )
      res.status(201).json(result)
    },
  )

  // (Re)run the deterministic accuracy check on a saved recipe.
  router.post(
    '/households/:householdId/clinical-review/:recipeId/accuracy-check',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await runAccuracyCheckForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
      )
      res.status(201).json(result)
    },
  )

  return router
}
