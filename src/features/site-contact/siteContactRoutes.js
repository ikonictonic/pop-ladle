import { Router } from 'express'
import { clientKey } from '../../shared/http/rateLimit.js'
import { submitSiteContactMessage } from './siteContactService.js'

/**
 * Public contact form (popladle.com proxies /api/contact here). Mounted before
 * the frontend gate and Clerk, like the subscriber routes.
 */
export function createSiteContactRouter() {
  const router = Router()

  router.post('/contact', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json(await submitSiteContactMessage(req.body, { clientKey: clientKey(req) }))
  })

  return router
}
