import { Router } from 'express'
import { listPublicRecipes, getPublicRecipe } from './publicContentService.js'

/**
 * Public content router — the marketing site's read-only data source.
 *
 * Mounted BEFORE the Clerk middleware and (during private beta) BEHIND the
 * frontend gate, so these routes carry no Clerk session and must never read
 * req.authContext. They serve published master-library recipes only; see
 * publicContentService.js for the guarantees.
 */
export function createPublicContentRouter() {
  const router = Router()

  router.get('/public/recipes', async (req, res) => {
    res.status(200).json(await listPublicRecipes(req.query))
  })

  router.get('/public/recipes/:recipeId', async (req, res) => {
    res.status(200).json(await getPublicRecipe(req.params.recipeId))
  })

  return router
}
