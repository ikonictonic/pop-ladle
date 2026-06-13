import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  getHydrationDayForCurrentUser,
  logHydrationForCurrentUser,
  removeHydrationLogForCurrentUser,
} from './hydrationService.js'

export function createHydrationRouter() {
  const router = Router()

  // The day's hydration: logs + total vs the Care Profile goal (?date= default today).
  router.get(
    '/households/:householdId/care-recipients/:careRecipientId/hydration',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await getHydrationDayForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
        req.query,
      )
      res.status(200).json(result)
    },
  )

  // Log an intake (two-tap: { amountMl, beverage? }).
  router.post(
    '/households/:householdId/care-recipients/:careRecipientId/hydration',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await logHydrationForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
        req.body,
      )
      res.status(201).json(result)
    },
  )

  router.delete(
    '/households/:householdId/hydration/:logId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await removeHydrationLogForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.logId,
      )
      res.status(200).json(result)
    },
  )

  return router
}
