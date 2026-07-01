import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  setMasterRecipeForCurrentUser,
  listRelationshipsForCurrentUser,
  createRelationshipForCurrentUser,
  deleteRelationshipForCurrentUser,
  listLinkablePeersForCurrentUser,
  listPairingsForCurrentUser,
  createPairingForCurrentUser,
  deletePairingForCurrentUser,
  suggestPairingsForCurrentUser,
} from './recipeRelationshipService.js'

export function createRecipeRelationshipRouter() {
  const router = Router()

  // Master flag / note / planned-over count.
  router.patch(
    '/households/:householdId/recipes/:recipeId/master',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await setMasterRecipeForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  // Directed relationships (planned_over / variation_of).
  router.get(
    '/households/:householdId/recipes/:recipeId/relationships',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await listRelationshipsForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
      )
      res.status(200).json(result)
    },
  )

  router.post(
    '/households/:householdId/recipes/:recipeId/relationships',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await createRelationshipForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.body,
      )
      res.status(201).json(result)
    },
  )

  router.delete(
    '/households/:householdId/recipes/:recipeId/relationships/:relationshipId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await deleteRelationshipForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.params.relationshipId,
      )
      res.status(200).json(result)
    },
  )

  // Picker: saved recipes in the household (excluding self).
  router.get(
    '/households/:householdId/recipes/:recipeId/linkable-peers',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await listLinkablePeersForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.query,
      )
      res.status(200).json(result)
    },
  )

  // Pairings (symmetric pairs_well_with), peer-normalized.
  router.get(
    '/households/:householdId/recipes/:recipeId/pairings',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await listPairingsForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
      )
      res.status(200).json(result)
    },
  )

  router.post(
    '/households/:householdId/recipes/:recipeId/pairings',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await createPairingForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.body,
      )
      res.status(201).json(result)
    },
  )

  router.delete(
    '/households/:householdId/recipes/:recipeId/pairings/:targetRecipeId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await deletePairingForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
        req.params.targetRecipeId,
      )
      res.status(200).json(result)
    },
  )

  router.get(
    '/households/:householdId/recipes/:recipeId/pairing-suggestions',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await suggestPairingsForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.recipeId,
      )
      res.status(200).json(result)
    },
  )

  return router
}
