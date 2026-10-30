import { Router } from 'express'
import { clientKey } from '../../shared/http/rateLimit.js'
import {
  applyPlunkWebhook,
  confirmSubscriberEmail,
  resolveGuideDownload,
  saveSubscriberPreference,
  submitEarlyAccessSignup,
  withdrawSubscriber,
} from './subscriberService.js'

function noStore(res) {
  res.setHeader('Cache-Control', 'no-store')
}

/**
 * Early-access subscriber routes for the public site (popladle.com proxies
 * /api/early-access and /api/subscriber/* here).
 *
 * Mounted BEFORE the frontend gate and Clerk: the public landing page must be
 * able to sign people up while the app is still behind the beta password.
 * Nothing here reads req.authContext; access comes from the opaque signup
 * session, the emailed confirmation token, the signed manage or guide token,
 * or the Plunk webhook secret.
 */
export function createSubscriberRouter() {
  const router = Router()

  router.post('/early-access', async (req, res) => {
    noStore(res)
    res.status(200).json(await submitEarlyAccessSignup(req.body, { clientKey: clientKey(req) }))
  })

  router.post('/subscriber/preference', async (req, res) => {
    noStore(res)
    res.status(200).json(await saveSubscriberPreference(req.body))
  })

  router.post('/subscriber/confirm', async (req, res) => {
    noStore(res)
    res.status(200).json(await confirmSubscriberEmail(req.body))
  })

  // JSON from the preferences page, or the form-encoded one-click POST mail
  // clients send to the List-Unsubscribe URL (token in the query string).
  router.post('/subscriber/withdraw', async (req, res) => {
    noStore(res)
    res.status(200).json(await withdrawSubscriber(req.body, req.query))
  })

  // The personal link in the welcome email, opened in a browser: it redirects
  // to the file, or to a page on the site if the link is dead.
  router.get('/subscriber/guide', async (req, res) => {
    noStore(res)
    res.redirect(302, await resolveGuideDownload(req.query.token))
  })

  // Plunk workflow Webhook steps (contact.subscribed, contact.unsubscribed,
  // email.bounce, email.complaint), each with ?event=<trigger>. Plunk does not
  // sign them; the shared secret arrives as a Bearer token.
  router.post('/subscriber/plunk-events', async (req, res) => {
    noStore(res)
    res.status(200).json(await applyPlunkWebhook({ body: req.body, query: req.query, headers: req.headers }))
  })

  return router
}
