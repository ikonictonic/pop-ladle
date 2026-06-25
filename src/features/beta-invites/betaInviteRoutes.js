import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  createBetaInviteForAdmin,
  listBetaInvitesForAdmin,
  redeemBetaInviteForCurrentUser,
  revokeBetaInviteForAdmin,
} from './betaInviteService.js'

export function createBetaInviteRouter() {
  const router = Router()

  // ---- Super-admin management (gated inside the service) ----
  router.get('/admin/beta-invites', requireAuthenticatedRequest, async (req, res) => {
    const result = await listBetaInvitesForAdmin(req.authContext.userId)
    res.status(200).json(result)
  })

  router.post('/admin/beta-invites', requireAuthenticatedRequest, async (req, res) => {
    const result = await createBetaInviteForAdmin(req.authContext.userId, req.body)
    res.status(201).json(result)
  })

  router.post(
    '/admin/beta-invites/:inviteId/revoke',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await revokeBetaInviteForAdmin(req.authContext.userId, req.params.inviteId)
      res.status(200).json(result)
    },
  )

  // ---- Redemption: any signed-in user with a valid token ----
  router.post('/beta-invites/redeem', requireAuthenticatedRequest, async (req, res) => {
    const result = await redeemBetaInviteForCurrentUser(req.authContext.userId, req.body)
    res.status(200).json(result)
  })

  return router
}
