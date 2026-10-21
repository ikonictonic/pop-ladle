import express, { Router } from 'express'
import { clientKey } from '../../shared/http/rateLimit.js'
import {
  applyResendWebhook,
  confirmSubscriberEmail,
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
 * session, the emailed confirmation token, or the signed manage token.
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

  return router
}

/**
 * Resend webhook (contact.updated, email.bounced, email.complained,
 * email.suppressed). Needs the RAW body for the Svix signature check, so this
 * router is mounted BEFORE express.json(). No gate or Clerk: authenticity
 * comes from the signature.
 */
export function createSubscriberWebhookRouter() {
  const router = Router()

  router.post(
    '/subscriber/resend-events',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      res.status(200).json(await applyResendWebhook({ rawBody: req.body, headers: req.headers }))
    },
  )

  return router
}
