/**
 * Billing mapping doctrine — pure functions, no DB, no Stripe client.
 *
 * Everything that decides HOW a Stripe subscription translates into a
 * household_entitlements row lives here so it can be unit-tested exhaustively:
 * status mapping, tier resolution, the clobber-protection rule, and the
 * entitlement patch a subscription implies.
 */

// Tiers purchasable via self-serve Stripe Checkout in this release. Pro/
// Clinician stay admin-comped; Enterprise is contract-priced.
export const SELLABLE_TIERS = Object.freeze(['basic', 'solo', 'family'])

// Days of continued access after a failed renewal before the household is
// treated as out of good standing by an operator decision.
export const GRACE_PERIOD_DAYS = 14

// Sentinel returned by subscriptionStatusToPlanStatus for Stripe's `canceled`:
// the caller must reset the household to the free tier (tier free + status
// active) rather than write plan_status='canceled', which would put the
// household BELOW free (canceled is not a good-standing status, so enforcement
// would deny even free-tier features).
export const FREE_RESET = 'free_reset'

const STATUS_MAP = Object.freeze({
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  unpaid: 'suspended',
  paused: 'suspended',
  canceled: FREE_RESET,
})

/**
 * Stripe subscription.status -> plan_status. Returns FREE_RESET for canceled
 * and null for statuses that must not write at all (incomplete checkout that
 * never charged).
 */
export function subscriptionStatusToPlanStatus(stripeStatus) {
  return STATUS_MAP[stripeStatus] ?? null
}

/**
 * Resolve the plan tier a subscription pays for. Product id wins over price
 * id: products are stable per tier while prices get archived and replaced on
 * price changes, and existing subscriptions keep referencing archived prices.
 *
 * @param {object} subscription Stripe subscription (expanded or not)
 * @param {object} catalogMaps { byProductId: Map<string,string>, byPriceId: Map<string,string> }
 * @returns {string|null} tier code, or null when no catalog row matches
 */
export function resolveTierFromSubscription(subscription, catalogMaps) {
  const items = subscription?.items?.data ?? []

  for (const item of items) {
    const price = item?.price
    if (!price) continue

    const productId = typeof price.product === 'string' ? price.product : price.product?.id
    if (productId && catalogMaps.byProductId.has(productId)) {
      return catalogMaps.byProductId.get(productId)
    }
  }

  for (const item of items) {
    const priceId = item?.price?.id
    if (priceId && catalogMaps.byPriceId.has(priceId)) {
      return catalogMaps.byPriceId.get(priceId)
    }
  }

  return null
}

/**
 * The clobber-protection rule: a webhook may only write entitlements the web
 * billing channel owns. Comped, partner, app-store, and enterprise-contract
 * entitlements are managed by operators/other systems — a stale or canceled
 * Stripe subscription must never silently downgrade them.
 *
 * @param {object|null} entitlementRow row with billingSource, or null (no row yet)
 * @returns {{ ok: boolean, reason?: string }}
 */
export function canApplyWebhookWrite(entitlementRow) {
  if (!entitlementRow) return { ok: true }

  const source = entitlementRow.billingSource ?? null
  if (source === null || source === 'web') return { ok: true }

  return { ok: false, reason: `entitlement_owned_by_${source}` }
}

export function computeGracePeriodEnd(now = new Date()) {
  return new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)
}

function toDate(epochSeconds) {
  return Number.isFinite(epochSeconds) ? new Date(epochSeconds * 1000) : null
}

/**
 * Period end lives on the subscription item since Stripe API 2025-03-31
 * (items.data[].current_period_end); older API versions expose it top-level.
 */
export function extractCurrentPeriodEnd(subscription) {
  const itemEnd = subscription?.items?.data?.[0]?.current_period_end
  if (Number.isFinite(itemEnd)) return toDate(itemEnd)
  return toDate(subscription?.current_period_end)
}

/**
 * The household_entitlements patch a live subscription implies. Only valid for
 * writable statuses — callers must handle FREE_RESET / null from
 * subscriptionStatusToPlanStatus() before calling this. cancel_at_period_end
 * does NOT change the status: the subscription stays active until Stripe
 * deletes it at period end, we just keep the stored period end.
 */
export function entitlementPatchFromSubscription(subscription, tier) {
  const planStatus = subscriptionStatusToPlanStatus(subscription.status)

  if (!planStatus || planStatus === FREE_RESET) {
    throw new Error(`entitlementPatchFromSubscription called for non-writable status: ${subscription.status}`)
  }

  return {
    planTier: tier,
    planStatus,
    externalCustomerId: typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer?.id ?? null,
    externalSubscriptionId: subscription.id,
    currentPeriodEndsAt: extractCurrentPeriodEnd(subscription),
    billingSource: 'web',
    gracePeriodEndsAt: null,
  }
}
