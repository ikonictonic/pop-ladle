import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import { listHouseholdMembersForCurrentUser } from './memberService.js'

export function createMemberRouter() {
  const router = Router()

  router.get('/households/:householdId/members', requireAuthenticatedRequest, async (req, res) => {
    const result = await listHouseholdMembersForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
    )
    res.status(200).json(result)
  })

  return router
}
