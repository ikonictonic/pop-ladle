import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  getHouseholdSettingsForCurrentUser,
  saveHouseholdSettingsForCurrentUser,
} from './householdSettingsService.js'

export function createHouseholdSettingsRouter() {
  const router = Router()

  router.get('/households/:householdId/settings', requireAuthenticatedRequest, async (req, res) => {
    const result = await getHouseholdSettingsForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
    )
    res.status(200).json(result)
  })

  router.put('/households/:householdId/settings', requireAuthenticatedRequest, async (req, res) => {
    const result = await saveHouseholdSettingsForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
      req.body,
    )
    res.status(200).json(result)
  })

  return router
}
