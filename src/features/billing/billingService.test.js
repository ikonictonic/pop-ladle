// =============================================================================
// billingService.test.js — applyStripeEvent() behavior with a fake Stripe
// client and a fake pg pool. Run with `npm test` (node:test, no DB/env).
//
// Locks the webhook doctrine:
//   * duplicate deliveries ack without a second entitlement write
//   * comped/partner entitlements are skipped (clobber rule) and audited
//   * subscription.deleted resets to free-in-good-standing
//   * unknown prices skip instead of guessing a tier
//   * failures mark the ledger row 'error' and rethrow (Stripe retries)
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyStripeEvent } from './billingService.js'

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111'

function fakeSubscription(overrides = {}) {
  return {
    id: 'sub_1',
    status: 'active',
    customer: 'cus_1',
    items: {
      data: [{
        current_period_end: 1_790_000_000,
        price: { id: 'price_solo', product: 'prod_solo' },
      }],
    },
    metadata: { household_id: HOUSEHOLD_ID, tier_code: 'solo' },
    ...overrides,
  }
}

function fakeStripe(subscription = fakeSubscription()) {
  return {
    subscriptions: {
      retrieve: async () => {
        if (subscription instanceof Error) throw subscription
        return subscription
      },
    },
  }
}

/**
 * Substring-dispatch fake for the pg Pool + transaction client. Captures
 * entitlement upserts, audit inserts, and billing_events transitions.
 */
function createFakeDb({ entitlementRow = null, existingEventStatus = null, householdExists = true } = {}) {
  const writes = { entitlement: [], audit: [], eventUpdates: [], tx: [] }

  async function query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').toLowerCase().trim()

    if (s === 'begin' || s === 'commit' || s === 'rollback') {
      writes.tx.push(s)
      return { rows: [] }
    }
    if (s.startsWith('insert into billing_events')) {
      return existingEventStatus ? { rows: [] } : { rows: [{ id: params[0] }] }
    }
    if (s.startsWith('select status from billing_events')) {
      return { rows: existingEventStatus ? [{ status: existingEventStatus }] : [] }
    }
    if (s.startsWith('update billing_events')) {
      if (s.includes("set status = 'error'")) {
        writes.eventUpdates.push({ status: 'error', detail: params[1] })
      } else {
        writes.eventUpdates.push({ status: params[1], detail: params[2] })
      }
      return { rows: [] }
    }
    if (s.startsWith('select id from households')) {
      return { rows: householdExists ? [{ id: params[0] }] : [] }
    }
    if (s.includes('where external_subscription_id =')) {
      return { rows: entitlementRow?.externalSubscriptionId === params[0] ? [{ householdId: HOUSEHOLD_ID }] : [] }
    }
    if (s.includes('where external_customer_id =')) {
      return { rows: entitlementRow?.externalCustomerId === params[0] ? [{ householdId: HOUSEHOLD_ID }] : [] }
    }
    if (s.includes('from household_entitlements where household_id =')) {
      return { rows: entitlementRow ? [entitlementRow] : [] }
    }
    if (s.startsWith('insert into household_entitlements')) {
      writes.entitlement.push({ sql: s, params })
      if (s.includes("plan_tier = 'free'") || s.includes("values ($1, 'free'")) {
        return { rows: [{ planTier: 'free', planStatus: 'active' }] }
      }
      if (s.includes("plan_status = 'past_due'") || s.includes("'past_due'")) {
        return { rows: [{ planTier: entitlementRow?.planTier ?? 'solo', planStatus: 'past_due', gracePeriodEndsAt: params[3] }] }
      }
      return { rows: [{ planTier: params[1], planStatus: params[2], currentPeriodEndsAt: params[5] }] }
    }
    if (s.startsWith('select code, stripe_product_id')
      || (s.includes('from plan_definitions') && s.includes('stripe_product_id'))) {
      return { rows: [{ code: 'solo', productId: 'prod_solo', priceId: 'price_solo' }] }
    }
    if (s.startsWith('insert into admin_audit_logs')) {
      writes.audit.push({ action: params[4], metadata: JSON.parse(params[9]) })
      return { rows: [] }
    }
    throw new Error(`fake db has no handler for: ${s.slice(0, 90)}`)
  }

  const db = {
    query,
    connect: async () => ({ query, release: () => {} }),
    writes,
  }
  return db
}

function checkoutCompletedEvent() {
  return {
    id: 'evt_1',
    type: 'checkout.session.completed',
    created: 1_780_000_000,
    data: {
      object: {
        mode: 'subscription',
        subscription: 'sub_1',
        customer: 'cus_1',
        metadata: { household_id: HOUSEHOLD_ID, tier_code: 'solo' },
      },
    },
  }
}

// ---- happy path -------------------------------------------------------------

test('checkout.session.completed applies the subscription snapshot + audits', async () => {
  const db = createFakeDb()
  const result = await applyStripeEvent(db, fakeStripe(), checkoutCompletedEvent())

  assert.equal(result.status, 'processed')
  assert.equal(db.writes.entitlement.length, 1)
  assert.deepEqual(db.writes.entitlement[0].params.slice(0, 3), [HOUSEHOLD_ID, 'solo', 'active'])
  assert.equal(db.writes.audit.length, 1)
  assert.equal(db.writes.audit[0].action, 'billing.entitlement_updated')
  assert.equal(db.writes.audit[0].metadata.stripeEventId, 'evt_1')
  assert.deepEqual(db.writes.eventUpdates.at(-1), { status: 'processed', detail: null })
  assert.deepEqual(db.writes.tx, ['begin', 'commit'])
})

// ---- idempotency ------------------------------------------------------------

test('a duplicate delivery of a processed event acks without writing', async () => {
  const db = createFakeDb({ existingEventStatus: 'processed' })
  const result = await applyStripeEvent(db, fakeStripe(), checkoutCompletedEvent())

  assert.equal(result.status, 'duplicate')
  assert.equal(db.writes.entitlement.length, 0)
  assert.equal(db.writes.audit.length, 0)
})

test("an 'error' ledger row reprocesses on redelivery", async () => {
  const db = createFakeDb({ existingEventStatus: 'error' })
  const result = await applyStripeEvent(db, fakeStripe(), checkoutCompletedEvent())

  assert.equal(result.status, 'processed')
  assert.equal(db.writes.entitlement.length, 1)
})

// ---- clobber rule -----------------------------------------------------------

test('a comped household is never overwritten — skipped + audited', async () => {
  const db = createFakeDb({
    entitlementRow: {
      householdId: HOUSEHOLD_ID, planTier: 'family', planStatus: 'comped',
      billingSource: 'manual_comp', externalCustomerId: null, externalSubscriptionId: null,
      gracePeriodEndsAt: null,
    },
  })
  const result = await applyStripeEvent(db, fakeStripe(), checkoutCompletedEvent())

  assert.equal(result.status, 'skipped')
  assert.equal(result.detail, 'entitlement_owned_by_manual_comp')
  assert.equal(db.writes.entitlement.length, 0)
  assert.equal(db.writes.audit.length, 1)
  assert.equal(db.writes.audit[0].action, 'billing.webhook_skipped')
})

// ---- lifecycle --------------------------------------------------------------

test('customer.subscription.deleted resets to free-in-good-standing', async () => {
  const db = createFakeDb({
    entitlementRow: {
      householdId: HOUSEHOLD_ID, planTier: 'solo', planStatus: 'active',
      billingSource: 'web', externalCustomerId: 'cus_1', externalSubscriptionId: 'sub_1',
      gracePeriodEndsAt: null,
    },
  })
  const event = {
    id: 'evt_del',
    type: 'customer.subscription.deleted',
    created: 1_780_000_100,
    data: { object: fakeSubscription({ status: 'canceled' }) },
  }
  const result = await applyStripeEvent(db, fakeStripe(), event)

  assert.equal(result.status, 'processed')
  assert.equal(db.writes.entitlement.length, 1)
  assert.match(db.writes.entitlement[0].sql, /plan_tier = 'free'/)
  assert.match(db.writes.entitlement[0].sql, /plan_status = 'active'/)
  assert.match(db.writes.entitlement[0].sql, /external_subscription_id = null/)
})

test('invoice.payment_failed → past_due with a one-shot grace window', async () => {
  const db = createFakeDb({
    entitlementRow: {
      householdId: HOUSEHOLD_ID, planTier: 'solo', planStatus: 'active',
      billingSource: 'web', externalCustomerId: 'cus_1', externalSubscriptionId: 'sub_1',
      gracePeriodEndsAt: null,
    },
  })
  const event = {
    id: 'evt_fail',
    type: 'invoice.payment_failed',
    created: 1_780_000_200,
    data: { object: { customer: 'cus_1', subscription: 'sub_1' } },
  }
  const result = await applyStripeEvent(db, fakeStripe(), event)

  assert.equal(result.status, 'processed')
  assert.equal(db.writes.entitlement.length, 1)
  assert.match(db.writes.entitlement[0].sql, /past_due/)
  assert.ok(db.writes.entitlement[0].params[3] instanceof Date, 'grace period end is set')
})

// ---- guardrails --------------------------------------------------------------

test('an unknown price skips instead of guessing a tier', async () => {
  const sub = fakeSubscription()
  sub.items.data[0].price = { id: 'price_mystery', product: 'prod_mystery' }
  const db = createFakeDb()
  const result = await applyStripeEvent(db, fakeStripe(sub), checkoutCompletedEvent())

  assert.equal(result.status, 'skipped')
  assert.equal(result.detail, 'unknown_price')
  assert.equal(db.writes.entitlement.length, 0)
})

test('unresolvable household skips (acks 200 — no retry storm)', async () => {
  const db = createFakeDb({ householdExists: false })
  const result = await applyStripeEvent(db, fakeStripe(), checkoutCompletedEvent())

  assert.equal(result.status, 'skipped')
  assert.equal(result.detail, 'household_not_found')
})

test('a Stripe failure marks the ledger row error and rethrows', async () => {
  const db = createFakeDb()
  const boom = new Error('stripe unavailable')

  await assert.rejects(
    () => applyStripeEvent(db, fakeStripe(boom), checkoutCompletedEvent()),
    /stripe unavailable/,
  )
  assert.deepEqual(db.writes.eventUpdates.at(-1), { status: 'error', detail: 'stripe unavailable' })
  assert.equal(db.writes.entitlement.length, 0)
})
