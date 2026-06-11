import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  acceptOwnershipTransferForCurrentUser,
  cancelOwnershipTransferForCurrentUser,
  createHouseholdForCurrentUser,
  getHouseholdForCurrentUser,
  initiateOwnershipTransferForCurrentUser,
  renameHouseholdForCurrentUser,
} from './householdService.js'

export function createHouseholdRouter() {
  const router = Router()

  router.post('/households', requireAuthenticatedRequest, async (req, res) => {
    const result = await createHouseholdForCurrentUser(req.authContext.userId, req.body)
    res.status(result.created ? 201 : 200).json(result)
  })

  // Household detail: entitlement summary, counts, pending transfer (managers/target).
  router.get('/households/:householdId', requireAuthenticatedRequest, async (req, res) => {
    const result = await getHouseholdForCurrentUser(req.authContext.userId, req.params.householdId)
    res.status(200).json(result)
  })

  // Rename (owner / co-owner).
  router.patch('/households/:householdId', requireAuthenticatedRequest, async (req, res) => {
    const result = await renameHouseholdForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
      req.body,
    )
    res.status(200).json(result)
  })

  // Ownership transfer — owner initiates, target accepts, owner cancels.
  router.post(
    '/households/:householdId/transfer-ownership',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await initiateOwnershipTransferForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.body,
      )
      res.status(201).json(result)
    },
  )

  router.post(
    '/households/:householdId/transfer-ownership/accept',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await acceptOwnershipTransferForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
      )
      res.status(200).json(result)
    },
  )

  router.post(
    '/households/:householdId/transfer-ownership/cancel',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await cancelOwnershipTransferForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
      )
      res.status(200).json(result)
    },
  )

  return router
}
