import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  acceptHouseholdInviteForCurrentUser,
  createHouseholdInviteForCurrentUser,
  listHouseholdInvitesForCurrentUser,
  listHouseholdMembersForCurrentUser,
  removeHouseholdMemberForCurrentUser,
  resendHouseholdInviteForCurrentUser,
  revokeHouseholdInviteForCurrentUser,
  suspendHouseholdMemberForCurrentUser,
  updateHouseholdMemberRoleForCurrentUser,
} from './memberService.js'

export function createMemberRouter() {
  const router = Router()

  router.get('/households/:householdId/members', requireAuthenticatedRequest, async (req, res) => {
    const result = await listHouseholdMembersForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
    )
    res.status(200).json(result)
  })

  router.patch(
    '/households/:householdId/members/:memberId/role',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await updateHouseholdMemberRoleForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.memberId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  router.post(
    '/households/:householdId/members/:memberId/suspend',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await suspendHouseholdMemberForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.memberId,
      )
      res.status(200).json(result)
    },
  )

  router.post(
    '/households/:householdId/members/:memberId/remove',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await removeHouseholdMemberForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.memberId,
      )
      res.status(200).json(result)
    },
  )

  router.get('/households/:householdId/invites', requireAuthenticatedRequest, async (req, res) => {
    const result = await listHouseholdInvitesForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
    )
    res.status(200).json(result)
  })

  router.post('/households/:householdId/invites', requireAuthenticatedRequest, async (req, res) => {
    const result = await createHouseholdInviteForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
      req.body,
    )
    res.status(result.created ? 201 : 200).json(result)
  })

  router.post(
    '/households/:householdId/invites/:inviteId/revoke',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await revokeHouseholdInviteForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.inviteId,
      )
      res.status(200).json(result)
    },
  )

  router.post(
    '/households/:householdId/invites/:inviteId/resend',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await resendHouseholdInviteForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.inviteId,
      )
      res.status(200).json(result)
    },
  )

  router.post('/invites/accept', requireAuthenticatedRequest, async (req, res) => {
    const result = await acceptHouseholdInviteForCurrentUser(req.authContext.userId, req.body)
    res.status(200).json(result)
  })

  return router
}
