import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  createRecipeForCurrentUser,
  deleteRecipeForCurrentUser,
  getRecipeForCurrentUser,
  listRecipesForCurrentUser,
  updateRecipeForCurrentUser,
} from './recipeService.js'

export function createRecipeRouter() {
  const router = Router()

  router.get('/households/:householdId/recipes', requireAuthenticatedRequest, async (req, res) => {
    const result = await listRecipesForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
      req.query,
    )
    res.status(200).json(result)
  })

  router.post('/households/:householdId/recipes', requireAuthenticatedRequest, async (req, res) => {
    const result = await createRecipeForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
      req.body,
    )
    res.status(201).json(result)
  })

  router.get(
    '/households/:householdId/recipes/:recipeId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await getRecipeForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
      )
      res.status(200).json(result)
    },
  )

  router.patch(
    '/households/:householdId/recipes/:recipeId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await updateRecipeForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  router.delete(
    '/households/:householdId/recipes/:recipeId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await deleteRecipeForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
      )
      res.status(200).json(result)
    },
  )

  return router
}
