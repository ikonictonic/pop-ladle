import { Router } from 'express'
import { getCurrentUserContext } from './currentUserService.js'
import { requireAuthenticatedRequest } from './clerk.js'

export function createCurrentUserRouter() {
  const router = Router()

  router.get('/me', requireAuthenticatedRequest, async (req, res) => {
    const context = await getCurrentUserContext(req.authContext.userId)
    res.status(200).json(context)
  })

  return router
}
