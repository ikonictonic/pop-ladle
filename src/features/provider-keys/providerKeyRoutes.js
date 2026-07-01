import { Router } from 'express'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  deleteProviderKeyForAdmin,
  listProviderKeysForAdmin,
  setProviderKeyForAdmin,
} from './providerKeyService.js'

export function createProviderKeyRouter() {
  const router = Router()

  // Provider-wide keys (RecipeBrainSection). Super admin only (enforced in the
  // service). Reads never return a raw key.
  router.get('/admin/provider-keys', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(await listProviderKeysForAdmin(req.authContext.userId))
  })

  router.put('/admin/provider-keys/:provider', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(
      await setProviderKeyForAdmin(req.authContext.userId, req.params.provider, req.body),
    )
  })

  router.delete('/admin/provider-keys/:provider', requireAuthenticatedRequest, async (req, res) => {
    res.status(200).json(
      await deleteProviderKeyForAdmin(req.authContext.userId, req.params.provider),
    )
  })

  return router
}
