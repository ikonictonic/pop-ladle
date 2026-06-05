import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  createCareRecipientForCurrentUser,
  getCareProfileForCurrentUser,
  getCareRecipientForCurrentUser,
  listCareRecipientsForCurrentUser,
  updateCareProfileForCurrentUser,
  updateCareRecipientForCurrentUser,
} from './careRecipientService.js'

export function createCareRecipientRouter() {
  const router = Router()

  router.get(
    '/households/:householdId/care-recipients',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await listCareRecipientsForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.query,
      )
      res.status(200).json(result)
    },
  )

  router.post(
    '/households/:householdId/care-recipients',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await createCareRecipientForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.body,
      )
      res.status(201).json(result)
    },
  )

  router.get(
    '/households/:householdId/care-recipients/:careRecipientId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await getCareRecipientForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
      )
      res.status(200).json(result)
    },
  )

  router.patch(
    '/households/:householdId/care-recipients/:careRecipientId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await updateCareRecipientForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  router.get(
    '/households/:householdId/care-recipients/:careRecipientId/profile',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await getCareProfileForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
      )
      res.status(200).json(result)
    },
  )

  router.patch(
    '/households/:householdId/care-recipients/:careRecipientId/profile',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await updateCareProfileForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.careRecipientId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  return router
}
