import express, { Router } from 'express'
import { env } from '../../config/env.js'
import { getDatabasePool } from '../../database/pool.js'
import { requireAuthenticatedRequest } from '../auth/clerk.js'
import {
  applyStripeEvent,
  createCheckoutSessionForOwner,
  createPortalSessionForOwner,
  getBillingOverviewForAdmin,
  listBillingEventsForAdmin,
  syncCatalogToStripeForAdmin,
} from './billingService.js'
import { getStripeClient } from './stripeClient.js'

export function createBillingRouter() {
  const router = Router()

  // Start a Stripe Checkout session for a paid tier (household owner only).
  router.post('/billing/checkout-session', requireAuthenticatedRequest, async (req, res) => {
    const result = await createCheckoutSessionForOwner(req.authContext.userId, req.body ?? {})
    res.status(201).json(result)
  })

  // Open the Stripe Billing Portal (manage / switch / cancel; owner only).
  router.post('/billing/portal-session', requireAuthenticatedRequest, async (req, res) => {
    const result = await createPortalSessionForOwner(req.authContext.userId, req.body ?? {})
    res.status(201).json(result)
  })

  // Admin billing surface (internal-admin gated inside the service).
  router.get('/admin/billing/overview', requireAuthenticatedRequest, async (req, res) => {
    const result = await getBillingOverviewForAdmin(req.authContext.userId)
    res.status(200).json(result)
  })

  router.get('/admin/billing/events', requireAuthenticatedRequest, async (req, res) => {
    const result = await listBillingEventsForAdmin(req.authContext.userId, req.query)
    res.status(200).json(result)
  })

  router.post('/admin/billing/sync-catalog', requireAuthenticatedRequest, async (req, res) => {
    const result = await syncCatalogToStripeForAdmin(req.authContext.userId)
    res.status(200).json(result)
  })

  return router
}

/**
 * The Stripe webhook needs the RAW request body for signature verification, so
 * this router must be mounted BEFORE the global express.json() middleware.
 * No Clerk auth — authenticity comes from the signature check.
 */
export function createBillingWebhookRouter() {
  const router = Router()

  router.post(
    '/billing/webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const stripe = getStripeClient()
      if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
        res.status(503).json({
          error: {
            code: 'BILLING_NOT_CONFIGURED',
            message: 'Stripe webhook is not configured on this server.',
          },
        })
        return
      }

      const db = getDatabasePool()
      if (!db) {
        res.status(503).json({
          error: { code: 'DATABASE_NOT_CONFIGURED', message: 'DATABASE_URL is not set.' },
        })
        return
      }

      let event
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          req.get('stripe-signature'),
          env.STRIPE_WEBHOOK_SECRET,
        )
      } catch {
        res.status(400).json({
          error: {
            code: 'WEBHOOK_SIGNATURE_INVALID',
            message: 'Stripe webhook signature verification failed.',
          },
        })
        return
      }

      const result = await applyStripeEvent(db, stripe, event)
      res.status(200).json({ received: true, status: result.status })
    },
  )

  return router
}
