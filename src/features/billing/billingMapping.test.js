// =============================================================================
// billingMapping.test.js — pins the Stripe→entitlement doctrine. Run with
// `npm test` (node:test, no external deps, no DB/env).
//
// Rules under lock:
//   1. STATUS map    — subscription.status → plan_status; canceled = FREE_RESET
//                      (never write plan_status='canceled': that is below free)
//   2. TIER          — product id wins over price id (prices are archived on
//                      price changes; products are stable per tier)
//   3. CLOBBER rule  — webhooks only write rows owned by the web channel
//   4. PATCH shape   — what a live subscription writes to household_entitlements
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FREE_RESET,
  GRACE_PERIOD_DAYS,
  SELLABLE_TIERS,
  canApplyWebhookWrite,
  computeGracePeriodEnd,
  entitlementPatchFromSubscription,
  extractCurrentPeriodEnd,
  resolveTierFromSubscription,
  subscriptionStatusToPlanStatus,
} from './billingMapping.js'

// ---- 1. Status map ---------------------------------------------------------

test('sellable tiers are exactly basic/solo/family (release decision)', () => {
  assert.deepEqual([...SELLABLE_TIERS], ['basic', 'solo', 'family'])
})

test('status map covers every Stripe subscription status', () => {
  assert.equal(subscriptionStatusToPlanStatus('trialing'), 'trialing')
  assert.equal(subscriptionStatusToPlanStatus('active'), 'active')
  assert.equal(subscriptionStatusToPlanStatus('past_due'), 'past_due')
  assert.equal(subscriptionStatusToPlanStatus('unpaid'), 'suspended')
  assert.equal(subscriptionStatusToPlanStatus('paused'), 'suspended')
  assert.equal(subscriptionStatusToPlanStatus('canceled'), FREE_RESET)
})

test('incomplete checkout states never write', () => {
  assert.equal(subscriptionStatusToPlanStatus('incomplete'), null)
  assert.equal(subscriptionStatusToPlanStatus('incomplete_expired'), null)
  assert.equal(subscriptionStatusToPlanStatus('something_new'), null)
})

// ---- 2. Tier resolution ----------------------------------------------------

const CATALOG_MAPS = {
  byProductId: new Map([['prod_basic', 'basic'], ['prod_solo', 'solo']]),
  byPriceId: new Map([['price_basic_v2', 'basic'], ['price_solo_v2', 'solo']]),
}

function subWithItems(items) {
  return { items: { data: items } }
}

test('tier resolves by product id first', () => {
  const sub = subWithItems([{ price: { id: 'price_unknown', product: 'prod_solo' } }])
  assert.equal(resolveTierFromSubscription(sub, CATALOG_MAPS), 'solo')
})

test('archived price still resolves via its product id', () => {
  // Subscription created on an old (now archived) price whose id is no longer
  // in the catalog — the product id still identifies the tier.
  const sub = subWithItems([{ price: { id: 'price_basic_v1_archived', product: 'prod_basic' } }])
  assert.equal(resolveTierFromSubscription(sub, CATALOG_MAPS), 'basic')
})

test('price id is the fallback when the product is not mapped', () => {
  const sub = subWithItems([{ price: { id: 'price_solo_v2', product: 'prod_unmapped' } }])
  assert.equal(resolveTierFromSubscription(sub, CATALOG_MAPS), 'solo')
})

test('expanded product objects resolve too', () => {
  const sub = subWithItems([{ price: { id: 'price_x', product: { id: 'prod_basic' } } }])
  assert.equal(resolveTierFromSubscription(sub, CATALOG_MAPS), 'basic')
})

test('unknown price and product → null (webhook marks event skipped)', () => {
  const sub = subWithItems([{ price: { id: 'price_nope', product: 'prod_nope' } }])
  assert.equal(resolveTierFromSubscription(sub, CATALOG_MAPS), null)
  assert.equal(resolveTierFromSubscription({}, CATALOG_MAPS), null)
})

// ---- 3. Clobber-protection rule --------------------------------------------

test('missing row and web/null sources are writable', () => {
  assert.equal(canApplyWebhookWrite(null).ok, true)
  assert.equal(canApplyWebhookWrite({ billingSource: null }).ok, true)
  assert.equal(canApplyWebhookWrite({ billingSource: 'web' }).ok, true)
})

test('every non-web billing source is protected from webhook writes', () => {
  for (const source of ['ios', 'android', 'partner', 'manual_comp', 'enterprise_contract']) {
    const verdict = canApplyWebhookWrite({ billingSource: source })
    assert.equal(verdict.ok, false, `${source} must not be clobbered`)
    assert.equal(verdict.reason, `entitlement_owned_by_${source}`)
  }
})

test('a comped household (manual_comp) is protected even when plan is canceled in Stripe', () => {
  const verdict = canApplyWebhookWrite({ billingSource: 'manual_comp', planStatus: 'comped' })
  assert.equal(verdict.ok, false)
})

// ---- 4. Grace period + patch shape -----------------------------------------

test('grace period is now + 14 days', () => {
  assert.equal(GRACE_PERIOD_DAYS, 14)
  const now = new Date('2026-07-01T00:00:00Z')
  assert.equal(
    computeGracePeriodEnd(now).toISOString(),
    new Date('2026-07-15T00:00:00Z').toISOString(),
  )
})

test('period end reads from subscription items (2025+ API shape)', () => {
  const sub = subWithItems([{ current_period_end: 1_790_000_000, price: {} }])
  assert.equal(extractCurrentPeriodEnd(sub).getTime(), 1_790_000_000 * 1000)
})

test('period end falls back to the top-level field (older API versions)', () => {
  const sub = { current_period_end: 1_780_000_000, items: { data: [{ price: {} }] } }
  assert.equal(extractCurrentPeriodEnd(sub).getTime(), 1_780_000_000 * 1000)
  assert.equal(extractCurrentPeriodEnd({}), null)
})

test('entitlement patch from a live subscription', () => {
  const sub = {
    id: 'sub_123',
    status: 'active',
    customer: 'cus_123',
    cancel_at_period_end: true, // does NOT change status — active until deleted
    items: { data: [{ current_period_end: 1_790_000_000, price: { id: 'price_solo_v2', product: 'prod_solo' } }] },
  }

  assert.deepEqual(entitlementPatchFromSubscription(sub, 'solo'), {
    planTier: 'solo',
    planStatus: 'active',
    externalCustomerId: 'cus_123',
    externalSubscriptionId: 'sub_123',
    currentPeriodEndsAt: new Date(1_790_000_000 * 1000),
    billingSource: 'web',
    gracePeriodEndsAt: null,
  })
})

test('patch accepts an expanded customer object', () => {
  const sub = {
    id: 'sub_9',
    status: 'trialing',
    customer: { id: 'cus_9' },
    items: { data: [] },
  }
  const patch = entitlementPatchFromSubscription(sub, 'basic')
  assert.equal(patch.externalCustomerId, 'cus_9')
  assert.equal(patch.planStatus, 'trialing')
  assert.equal(patch.currentPeriodEndsAt, null)
})

test('patch refuses canceled / incomplete statuses (caller contract)', () => {
  assert.throws(() => entitlementPatchFromSubscription({ status: 'canceled', items: { data: [] } }, 'solo'))
  assert.throws(() => entitlementPatchFromSubscription({ status: 'incomplete', items: { data: [] } }, 'solo'))
})
