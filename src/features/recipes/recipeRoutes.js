import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  createRecipeForCurrentUser,
  deleteRecipeForCurrentUser,
  getRecipeForCurrentUser,
  listRecipesForCurrentUser,
  modifyRecipeVersionForCurrentUser,
  restoreRecipeVersionForCurrentUser,
  updateRecipeForCurrentUser,
} from './recipeService.js'
import {
  confirmRecipePhotoUpload,
  getRecipePhotoUrl,
  removeRecipePhoto,
  requestRecipePhotoUpload,
} from './recipePhotoService.js'

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

  // In-place versioning: modify pushes the current output into history and
  // replaces it; restore reinstates a prior version.
  router.post(
    '/households/:householdId/recipes/:recipeId/modify',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await modifyRecipeVersionForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  router.post(
    '/households/:householdId/recipes/:recipeId/restore',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await restoreRecipeVersionForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  // Recipe photos (private object storage, presigned URLs).
  // 1) request a presigned upload URL, 2) client PUTs to the bucket,
  // 3) confirm to persist, GET for a view URL, DELETE to remove.
  router.post(
    '/households/:householdId/recipes/:recipeId/photo/upload-url',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await requestRecipePhotoUpload(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.body,
      )
      res.status(201).json(result)
    },
  )

  router.put(
    '/households/:householdId/recipes/:recipeId/photo',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await confirmRecipePhotoUpload(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  router.get(
    '/households/:householdId/recipes/:recipeId/photo',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await getRecipePhotoUrl(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
      )
      res.status(200).json(result)
    },
  )

  router.delete(
    '/households/:householdId/recipes/:recipeId/photo',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await removeRecipePhoto(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
      )
      res.status(200).json(result)
    },
  )

  return router
}
