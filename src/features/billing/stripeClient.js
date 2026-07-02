/**
 * Stripe client — lazy singleton, degradable like the S3/Resend integrations.
 *
 * A missing STRIPE_SECRET_KEY must not crash boot: customer billing endpoints
 * return 503 BILLING_NOT_CONFIGURED instead, so the API stays fully usable
 * for households on the free tier and admin comps.
 */

import Stripe from 'stripe'
import { env } from '../../config/env.js'
import { createHttpError } from '../households/householdAccess.js'

let client = null

export function isBillingConfigured() {
  return Boolean(env.STRIPE_SECRET_KEY)
}

export function getStripeClient() {
  if (!isBillingConfigured()) return null

  if (!client) {
    client = new Stripe(env.STRIPE_SECRET_KEY, {
      ...(env.STRIPE_API_VERSION ? { apiVersion: env.STRIPE_API_VERSION } : {}),
    })
  }

  return client
}

export function requireStripeClient() {
  const stripe = getStripeClient()

  if (!stripe) {
    throw createHttpError(
      503,
      'BILLING_NOT_CONFIGURED',
      'Billing is not configured on this server (STRIPE_SECRET_KEY is not set).',
      true,
    )
  }

  return stripe
}
