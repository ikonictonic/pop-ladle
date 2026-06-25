import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  createCmsApiKeyForCurrentUser,
  listCmsApiKeysForCurrentUser,
  renameCmsApiKeyForCurrentUser,
  revokeCmsApiKeyForCurrentUser,
} from './cmsApiKeyService.js'

export function createCmsApiKeyRouter() {
  const router = Router()

  router.get('/households/:householdId/cms-api-keys', requireAuthenticatedRequest, async (req, res) => {
    const result = await listCmsApiKeysForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
    )
    res.status(200).json(result)
  })

  router.post('/households/:householdId/cms-api-keys', requireAuthenticatedRequest, async (req, res) => {
    const result = await createCmsApiKeyForCurrentUser(
      req.authContext.userId,
      req.params.householdId,
      req.body,
    )
    res.status(201).json(result)
  })

  router.patch(
    '/households/:householdId/cms-api-keys/:keyId',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await renameCmsApiKeyForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.keyId,
        req.body,
      )
      res.status(200).json(result)
    },
  )

  router.post(
    '/households/:householdId/cms-api-keys/:keyId/revoke',
    requireAuthenticatedRequest,
    async (req, res) => {
      const result = await revokeCmsApiKeyForCurrentUser(
        req.authContext.userId,
        req.params.householdId,
        req.params.keyId,
      )
      res.status(200).json(result)
    },
  )

  return router
}
