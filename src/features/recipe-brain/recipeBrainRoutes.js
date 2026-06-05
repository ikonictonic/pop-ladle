import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  getRecipeBrainRunForCurrentUser,
  listRecipeBrainRunsForCurrentUser,
  runRecipeBrainForCurrentUser,
} from './recipeBrainService.js'

export function createRecipeBrainRouter() {
  const router = Router()

  // Kick off a governed committee run (owner / co-owner / caregiver).
  router.post(
    '/households/:householdId/recipe-brain/runs',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await runRecipeBrainForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.body,
      )
      res.status(201).json(result)
    },
  )

  router.get(
    '/households/:householdId/recipe-brain/runs',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await listRecipeBrainRunsForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.query,
      )
      res.status(200).json(result)
    },
  )

  router.get(
    '/households/:householdId/recipe-brain/runs/:runId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await getRecipeBrainRunForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.runId,
      )
      res.status(200).json(result)
    },
  )

  return router
}
