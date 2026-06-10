import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import { listAuditLogForCurrentUser } from './auditLogService.js'

export function createAuditLogRouter() {
  const router = Router()

  // Household activity trail (owner / co-owner only).
  router.get(
    '/households/:householdId/audit-log',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await listAuditLogForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.query,
      )
      res.status(200).json(result)
    },
  )

  return router
}
