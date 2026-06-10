import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import { getHouseholdPlanForCurrentUser, listPlanCatalog } from './planService.js'

export function createPlanRouter() {
  const router = Router()

  // Plan catalog (pricing ladder).
  router.get('/plans', requireAuthenticatedRequest, async (_req, res) => {
    const result = await listPlanCatalog()
    res.status(200).json(result)
  })

  // The household's resolved entitlement: tier, status, limits, features, usage.
  router.get(
    '/households/:householdId/plan',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await getHouseholdPlanForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
      )
      res.status(200).json(result)
    },
  )

  return router
}
