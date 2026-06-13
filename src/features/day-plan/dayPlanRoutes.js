import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  addDayPlanEntryForCurrentUser,
  getDayPlanForCurrentUser,
  removeDayPlanEntryForCurrentUser,
  updateDayPlanEntryForCurrentUser,
} from './dayPlanService.js'

export function createDayPlanRouter() {
  const router = Router()

  // The day view: ?date=YYYY-MM-DD (default today) or ?from=&to= for a range.
  router.get(
    '/households/:householdId/care-recipients/:careRecipientId/day-plan',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await getDayPlanForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
        req.query,
      )
      res.status(200).json(result)
    },
  )

  // Plan a recipe (or free-text item) into a meal slot.
  router.post(
    '/households/:householdId/care-recipients/:careRecipientId/day-plan',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await addDayPlanEntryForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
        req.body,
      )
      res.status(201).json(result)
    },
  )

  // Edit an entry — including marking completed/skipped + Food Acceptance Record.
  router.patch(
    '/households/:householdId/day-plan/:entryId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await updateDayPlanEntryForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.entryId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  router.delete(
    '/households/:householdId/day-plan/:entryId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await removeDayPlanEntryForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.entryId,
      )
      res.status(200).json(result)
    },
  )

  return router
}
