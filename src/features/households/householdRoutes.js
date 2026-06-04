import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import { createHouseholdForCurrentUser } from './householdService.js'

export function createHouseholdRouter() {
  const router = Router()

  router.post('/households', requireAuthenticatedRequest, async (req, res) => {
    const result = await createHouseholdForCurrentUser(req.authContext.userId, req.body)
    res.status(result.created ? 201 : 200).json(result)
  })

  return router
}
