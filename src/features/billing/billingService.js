/**
 * Billing — the Stripe writer of plan state (Architecture Plan Phase 6).
 *
 * Customer surface (owner-only): hosted Checkout to start a subscription,
 * hosted Billing Portal to manage/cancel it. The SPA never touches cards.
 *
 * Webhook surface: applyStripeEvent() is the ONLY writer of Stripe-driven
 * entitlement state. Every event is recorded in billing_events (PK = event id
 * → at-least-once dedupe); handlers re-retrieve the subscription fresh from
 * Stripe so out-of-order deliveries converge on current truth; the entitlement
 * row is locked FOR UPDATE; and the clobber rule (billingMapping.js) keeps
 * webhooks from overwriting comped/partner/app-store entitlements. Every
 * applied write is audited in the same transaction.
 *
 * Admin surface: billing overview (subscriptions by tier/status + event feed)
 * and the catalog→Stripe sync that creates Products/Prices from
 * plan_definitions and stores their ids (super admin only).
 */

import { env } from '../../config/env.js'
import { getDatabasePool } from '../../database/pool.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { createHttpError, normalizeHouseholdId, requireHouseholdRole } from '../households/householdAccess.js'
import { ANY_ADMIN, SUPER_ONLY, requireInternalAdmin } from '../super-admin/adminAccess.js'
import {
  FREE_RESET,
  SELLABLE_TIERS,
  canApplyWebhookWrite,
  computeGracePeriodEnd,
  entitlementPatchFromSubscription,
  extractCurrentPeriodEnd,
  resolveTierFromSubscription,
  subscriptionStatusToPlanStatus,
} from './billingMapping.js'
import { requireStripeClient } from './stripeClient.js'

const GOOD_STANDING_STATUSES = new Set(['active', 'trialing', 'comped'])

function requireDatabasePool() {
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }
  return db
}

async function readEntitlementRow(queryable, householdId, { forUpdate = false } = {}) {
  const result = await queryable.query(
    `
      select
        household_id as "householdId",
        plan_tier as "planTier",
        plan_status as "planStatus",
        billing_source as "billingSource",
        external_customer_id as "externalCustomerId",
        external_subscription_id as "externalSubscriptionId",
        trial_ends_at as "trialEndsAt",
        current_period_ends_at as "currentPeriodEndsAt",
        grace_period_ends_at as "gracePeriodEndsAt"
      from household_entitlements
      where household_id = $1
      ${forUpdate ? 'for update' : ''}
    `,
    [householdId],
  )
  return result.rows[0] ?? null
}

// ---------------------------------------------------------------------------
// Customer surface — Checkout + Billing Portal (household owner only)
// ---------------------------------------------------------------------------

export async function createCheckoutSessionForOwner(clerkUserId, payload = {}) {
  const stripe = requireStripeClient()
  const db = requireDatabasePool()
  const user = await getCurrentAppUser(clerkUserId)

  const householdId = normalizeHouseholdId(payload.householdId)
  const tierCode = typeof payload.tierCode === 'string' ? payload.tierCode.trim() : ''

  const access = await requireHouseholdRole(db, user.id, householdId, ['owner'])

  if (!SELLABLE_TIERS.includes(tierCode)) {
    throw createHttpError(
      400,
      'INVALID_PLAN_TIER',
      `tierCode must be one of: ${SELLABLE_TIERS.join(', ')}.`,
      true,
    )
  }

  const definition = await db.query(
    `select code, display_name as "displayName", stripe_price_id as "stripePriceId"
     from plan_definitions where code = $1::plan_tier and is_active = true`,
    [tierCode],
  )
  if (definition.rows.length === 0) {
    throw createHttpError(400, 'INVALID_PLAN_TIER', 'tierCode must be an active plan code.', true)
  }
  if (!definition.rows[0].stripePriceId) {
    throw createHttpError(
      409,
      'BILLING_CATALOG_NOT_SYNCED',
      'This plan has not been synced to Stripe yet. Please try again later.',
      true,
    )
  }

  const entitlement = await readEntitlementRow(db, householdId)

  const writable = canApplyWebhookWrite(entitlement)
  if (!writable.ok) {
    throw createHttpError(
      409,
      'BILLING_SOURCE_CONFLICT',
      'This household’s plan is managed outside self-serve billing. Contact support to make changes.',
      true,
    )
  }

  if (
    entitlement?.externalSubscriptionId
    && GOOD_STANDING_STATUSES.has(entitlement.planStatus)
    && entitlement.planTier !== 'free'
  ) {
    throw createHttpError(
      409,
      'SUBSCRIPTION_EXISTS',
      'This household already has an active subscription. Use Manage billing to change plans.',
      true,
    )
  }

  // One Stripe customer per HOUSEHOLD (not per user): reuse a stored id, else
  // create and persist it immediately so a second checkout attempt reuses it.
  let customerId = entitlement?.externalCustomerId ?? null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      name: access.household.name ?? undefined,
      metadata: { household_id: householdId },
    })
    customerId = customer.id

    await db.query(
      `
        insert into household_entitlements (household_id, external_customer_id, updated_by)
        values ($1, $2, $3)
        on conflict (household_id) do update set
          external_customer_id = coalesce(household_entitlements.external_customer_id, $2),
          updated_at = now()
      `,
      [householdId, customerId, user.id],
    )
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: definition.rows[0].stripePriceId, quantity: 1 }],
    client_reference_id: householdId,
    metadata: { household_id: householdId, tier_code: tierCode },
    subscription_data: { metadata: { household_id: householdId, tier_code: tierCode } },
    success_url: `${env.APP_BASE_URL}/account?billing=success`,
    cancel_url: `${env.APP_BASE_URL}/account?billing=canceled`,
    allow_promotion_codes: true,
  })

  await writeAuditLog(db, {
    action: 'billing.checkout_started',
    entityType: 'household_entitlement',
    entityId: householdId,
    actorUserId: user.id,
    householdId,
    after: { tierCode, stripeCustomerId: customerId, checkoutSessionId: session.id },
  })

  return { url: session.url }
}

export async function createPortalSessionForOwner(clerkUserId, payload = {}) {
  const stripe = requireStripeClient()
  const db = requireDatabasePool()
  const user = await getCurrentAppUser(clerkUserId)

  const householdId = normalizeHouseholdId(payload.householdId)
  await requireHouseholdRole(db, user.id, householdId, ['owner'])

  const entitlement = await readEntitlementRow(db, householdId)
  if (!entitlement?.externalCustomerId) {
    throw createHttpError(
      409,
      'NO_BILLING_ACCOUNT',
      'This household has no billing account yet. Upgrade to a paid plan first.',
      true,
    )
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: entitlement.externalCustomerId,
    return_url: `${env.APP_BASE_URL}/account?billing=portal-return`,
  })

  return { url: session.url }
}

// ---------------------------------------------------------------------------
// Webhook — the only Stripe-driven writer of household_entitlements
// ---------------------------------------------------------------------------

async function loadCatalogMaps(queryable) {
  const result = await queryable.query(
    `select code, stripe_product_id as "productId", stripe_price_id as "priceId"
     from plan_definitions
     where stripe_product_id is not null or stripe_price_id is not null`,
  )

  const byProductId = new Map()
  const byPriceId = new Map()
  for (const row of result.rows) {
    if (row.productId) byProductId.set(row.productId, row.code)
    if (row.priceId) byPriceId.set(row.priceId, row.code)
  }
  return { byProductId, byPriceId }
}

/**
 * Resolve which household an event belongs to: explicit metadata first, then
 * the stored subscription id, then the stored customer id (portal-driven
 * events carry no household metadata on the invoice).
 */
async function resolveHouseholdId(queryable, { metadataHouseholdId, subscriptionId, customerId }) {
  if (metadataHouseholdId) {
    const result = await queryable.query(
      `select id from households where id = $1`,
      [metadataHouseholdId],
    ).catch(() => ({ rows: [] })) // non-UUID metadata must not 500 the webhook
    if (result.rows.length > 0) return result.rows[0].id
  }

  if (subscriptionId) {
    const result = await queryable.query(
      `select household_id as "householdId" from household_entitlements where external_subscription_id = $1`,
      [subscriptionId],
    )
    if (result.rows.length > 0) return result.rows[0].householdId
  }

  if (customerId) {
    const result = await queryable.query(
      `select household_id as "householdId" from household_entitlements where external_customer_id = $1`,
      [customerId],
    )
    if (result.rows.length > 0) return result.rows[0].householdId
  }

  return null
}

// Invoices reference their subscription top-level on older API versions and
// under parent.subscription_details on newer ones.
function invoiceSubscriptionId(invoice) {
  const direct = invoice?.subscription
  if (typeof direct === 'string') return direct
  if (direct?.id) return direct.id
  const parented = invoice?.parent?.subscription_details?.subscription
  if (typeof parented === 'string') return parented
  return parented?.id ?? null
}

function asId(value) {
  if (typeof value === 'string') return value
  return value?.id ?? null
}

const HANDLED_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
])

/**
 * Apply one verified Stripe event. Returns { status, detail? } where status is
 * 'processed' | 'skipped' | 'duplicate'. Throws on genuine failures so the
 * route responds 500 and Stripe retries.
 *
 * @param {object} db     pg Pool
 * @param {object} stripe Stripe client (injected for testability)
 * @param {object} event  verified Stripe event
 */
export async function applyStripeEvent(db, stripe, event) {
  // 1. Ledger insert doubles as the idempotency gate. A previously processed/
  //    skipped event acks immediately; 'received'/'error' rows reprocess (a
  //    prior attempt died mid-flight or failed).
  const inserted = await db.query(
    `
      insert into billing_events (id, event_type, payload, stripe_created_at)
      values ($1, $2, $3::jsonb, to_timestamp($4))
      on conflict (id) do nothing
      returning id
    `,
    [event.id, event.type, JSON.stringify(event.data?.object ?? {}), event.created ?? null],
  )

  if (inserted.rows.length === 0) {
    const existing = await db.query(`select status from billing_events where id = $1`, [event.id])
    const status = existing.rows[0]?.status
    if (status === 'processed' || status === 'skipped') {
      return { status: 'duplicate' }
    }
  }

  const finish = async (status, detail = null, householdId = null) => {
    await db.query(
      `update billing_events
       set status = $2, detail = $3, household_id = coalesce($4, household_id), processed_at = now()
       where id = $1`,
      [event.id, status, detail, householdId],
    )
    return { status, detail: detail ?? undefined }
  }

  try {
    if (!HANDLED_EVENTS.has(event.type)) {
      return await finish('skipped', 'event_type_not_handled')
    }

    const object = event.data?.object ?? {}

    // 2. Work out the subscription + household this event is about.
    let subscriptionId = null
    let metadataHouseholdId = null
    let customerId = asId(object.customer)

    if (event.type === 'checkout.session.completed') {
      if (object.mode !== 'subscription') {
        return await finish('skipped', 'not_a_subscription_checkout')
      }
      subscriptionId = asId(object.subscription)
      metadataHouseholdId = object.metadata?.household_id ?? object.client_reference_id ?? null
    } else if (event.type.startsWith('customer.subscription.')) {
      subscriptionId = object.id
      metadataHouseholdId = object.metadata?.household_id ?? null
    } else {
      subscriptionId = invoiceSubscriptionId(object)
      metadataHouseholdId = object.subscription_details?.metadata?.household_id
        ?? object.parent?.subscription_details?.metadata?.household_id
        ?? null
    }

    const householdId = await resolveHouseholdId(db, { metadataHouseholdId, subscriptionId, customerId })
    if (!householdId) {
      return await finish('skipped', 'household_not_found')
    }

    // 3. Snapshot current truth. subscription.deleted events can't be
    //    re-retrieved meaningfully (retrieval returns the canceled sub — fine);
    //    for everything else the fresh retrieve makes handlers order-proof.
    let subscription = null
    if (event.type === 'customer.subscription.deleted') {
      subscription = object
    } else if (subscriptionId) {
      subscription = await stripe.subscriptions.retrieve(subscriptionId)
    }

    if (!subscription && event.type !== 'invoice.payment_failed') {
      return await finish('skipped', 'subscription_not_found')
    }

    // 4. Serialize against concurrent deliveries + apply under the clobber rule.
    const client = await db.connect()
    try {
      await client.query('begin')

      const before = await readEntitlementRow(client, householdId, { forUpdate: true })

      const writable = canApplyWebhookWrite(before)
      if (!writable.ok) {
        await writeAuditLog(client, {
          action: 'billing.webhook_skipped',
          entityType: 'household_entitlement',
          entityId: householdId,
          householdId,
          reason: writable.reason,
          extra: { stripeEventId: event.id, stripeEventType: event.type },
        })
        await client.query('commit')
        return await finish('skipped', writable.reason, householdId)
      }

      let after = null

      if (event.type === 'invoice.payment_failed') {
        // Tier unchanged; enter past_due and start the grace window once (do
        // not extend it on Stripe's dunning retries).
        const graceEnd = before?.gracePeriodEndsAt ?? computeGracePeriodEnd()
        const updated = await client.query(
          `
            insert into household_entitlements
              (household_id, plan_status, billing_source, external_customer_id, external_subscription_id, grace_period_ends_at)
            values ($1, 'past_due', 'web', $2, $3, $4)
            on conflict (household_id) do update set
              plan_status = 'past_due',
              grace_period_ends_at = coalesce(household_entitlements.grace_period_ends_at, $4),
              updated_at = now()
            returning plan_tier as "planTier", plan_status as "planStatus", grace_period_ends_at as "gracePeriodEndsAt"
          `,
          [householdId, customerId, subscriptionId, graceEnd],
        )
        after = updated.rows[0]
      } else {
        const planStatusSignal = subscriptionStatusToPlanStatus(subscription.status)

        if (planStatusSignal === null) {
          await client.query('commit')
          return await finish('skipped', `subscription_status_${subscription.status}`, householdId)
        }

        if (planStatusSignal === FREE_RESET) {
          // Subscription is gone: back to free-in-good-standing. Keep the
          // customer id for painless re-subscription.
          const updated = await client.query(
            `
              insert into household_entitlements
                (household_id, plan_tier, plan_status, billing_source, external_customer_id)
              values ($1, 'free', 'active', 'web', $2)
              on conflict (household_id) do update set
                plan_tier = 'free',
                plan_status = 'active',
                external_subscription_id = null,
                current_period_ends_at = null,
                grace_period_ends_at = null,
                updated_at = now()
              returning plan_tier as "planTier", plan_status as "planStatus"
            `,
            [householdId, customerId],
          )
          after = updated.rows[0]
        } else {
          const catalogMaps = await loadCatalogMaps(client)
          const tier = resolveTierFromSubscription(subscription, catalogMaps)

          if (!tier) {
            await client.query('commit')
            return await finish('skipped', 'unknown_price', householdId)
          }

          const patch = entitlementPatchFromSubscription(subscription, tier)
          const updated = await client.query(
            `
              insert into household_entitlements
                (household_id, plan_tier, plan_status, billing_source,
                 external_customer_id, external_subscription_id,
                 current_period_ends_at, grace_period_ends_at)
              values ($1, $2::plan_tier, $3::plan_status, 'web', $4, $5, $6, null)
              on conflict (household_id) do update set
                plan_tier = $2::plan_tier,
                plan_status = $3::plan_status,
                billing_source = 'web',
                external_customer_id = $4,
                external_subscription_id = $5,
                current_period_ends_at = $6,
                grace_period_ends_at = null,
                updated_at = now()
              returning plan_tier as "planTier", plan_status as "planStatus",
                        current_period_ends_at as "currentPeriodEndsAt"
            `,
            [
              householdId,
              patch.planTier,
              patch.planStatus,
              patch.externalCustomerId ?? customerId,
              patch.externalSubscriptionId,
              patch.currentPeriodEndsAt,
            ],
          )
          after = updated.rows[0]
        }
      }

      await writeAuditLog(client, {
        action: 'billing.entitlement_updated',
        entityType: 'household_entitlement',
        entityId: householdId,
        householdId,
        before: before
          ? { planTier: before.planTier, planStatus: before.planStatus }
          : null,
        after,
        extra: { stripeEventId: event.id, stripeEventType: event.type },
      })

      await client.query('commit')
    } catch (err) {
      try { await client.query('rollback') } catch { /* keep original error */ }
      throw err
    } finally {
      client.release()
    }

    return await finish('processed', null, householdId)
  } catch (err) {
    // Best-effort: mark the ledger row so the failure is visible in admin,
    // then rethrow → route responds 500 → Stripe retries the delivery.
    await db.query(
      `update billing_events set status = 'error', detail = $2, processed_at = now() where id = $1`,
      [event.id, String(err?.message ?? err).slice(0, 500)],
    ).catch(() => {})
    throw err
  }
}

// ---------------------------------------------------------------------------
// Admin surface
// ---------------------------------------------------------------------------

export async function getBillingOverviewForAdmin(clerkUserId) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, ANY_ADMIN)

  const [subscriptions, catalog, recentEvents] = await Promise.all([
    db.query(`
      select plan_tier as "planTier", plan_status as "planStatus", count(*)::int as "households"
      from household_entitlements
      where billing_source = 'web'
      group by plan_tier, plan_status
      order by plan_tier, plan_status
    `),
    db.query(`
      select code, display_name as "displayName", monthly_price_cents as "monthlyPriceCents",
             stripe_product_id as "stripeProductId", stripe_price_id as "stripePriceId",
             is_active as "isActive"
      from plan_definitions
      where code = any($1::plan_tier[])
      order by monthly_price_cents asc nulls last
    `, [SELLABLE_TIERS]),
    db.query(`
      select be.id, be.event_type as "eventType", be.household_id as "householdId",
             h.name as "householdName", be.status, be.detail,
             be.stripe_created_at as "stripeCreatedAt", be.created_at as "createdAt"
      from billing_events be
      left join households h on h.id = be.household_id
      order by be.created_at desc
      limit 50
    `),
  ])

  return {
    adminRole: admin.role,
    billingConfigured: Boolean(env.STRIPE_SECRET_KEY),
    webhookConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET),
    subscriptions: subscriptions.rows,
    catalog: catalog.rows,
    recentEvents: recentEvents.rows,
  }
}

export async function listBillingEventsForAdmin(clerkUserId, query = {}) {
  const { db, admin } = await requireInternalAdmin(clerkUserId, ANY_ADMIN)

  const limitParsed = Number.parseInt(query.limit ?? '50', 10)
  const limit = Number.isInteger(limitParsed) ? Math.min(Math.max(limitParsed, 1), 200) : 50
  const status = typeof query.status === 'string' && query.status.trim() ? query.status.trim() : null
  const householdId = typeof query.householdId === 'string' && query.householdId.trim()
    ? normalizeHouseholdId(query.householdId)
    : null

  const result = await db.query(
    `
      select be.id, be.event_type as "eventType", be.household_id as "householdId",
             h.name as "householdName", be.status, be.detail,
             be.stripe_created_at as "stripeCreatedAt", be.processed_at as "processedAt",
             be.created_at as "createdAt"
      from billing_events be
      left join households h on h.id = be.household_id
      where ($1::text is null or be.status = $1)
        and ($2::uuid is null or be.household_id = $2)
      order by be.created_at desc
      limit $3
    `,
    [status, householdId, limit],
  )

  return { adminRole: admin.role, events: result.rows }
}

/**
 * Create/update Stripe Products + Prices from plan_definitions and store the
 * ids. Prices are immutable in Stripe: an amount change archives the old price
 * and creates a new one (existing subscriptions keep the archived price; tier
 * mapping still resolves via the stable product id).
 */
export async function syncCatalogToStripeForAdmin(clerkUserId) {
  const stripe = requireStripeClient()
  const { db, user, admin } = await requireInternalAdmin(clerkUserId, SUPER_ONLY)

  const definitions = await db.query(
    `select code, display_name as "displayName", monthly_price_cents as "monthlyPriceCents",
            stripe_product_id as "stripeProductId", stripe_price_id as "stripePriceId"
     from plan_definitions
     where code = any($1::plan_tier[]) and is_active = true and monthly_price_cents > 0
     order by monthly_price_cents asc`,
    [SELLABLE_TIERS],
  )

  const results = []

  for (const def of definitions.rows) {
    const before = { productId: def.stripeProductId, priceId: def.stripePriceId }
    let productId = def.stripeProductId
    let priceId = def.stripePriceId
    let action = 'unchanged'

    if (!productId) {
      const product = await stripe.products.create({
        name: `Pop & Ladle ${def.displayName}`,
        metadata: { plan_code: def.code },
      })
      productId = product.id
      action = 'created'
    } else {
      await stripe.products.update(productId, { name: `Pop & Ladle ${def.displayName}` })
    }

    let currentAmount = null
    if (priceId) {
      const price = await stripe.prices.retrieve(priceId)
      currentAmount = price.unit_amount
    }

    if (!priceId || currentAmount !== def.monthlyPriceCents) {
      if (priceId) {
        await stripe.prices.update(priceId, { active: false })
        action = 'updated_price'
      }
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: def.monthlyPriceCents,
        currency: 'usd',
        recurring: { interval: 'month' },
        metadata: { plan_code: def.code },
      })
      priceId = price.id
      if (action === 'unchanged') action = 'created'
    }

    if (productId !== before.productId || priceId !== before.priceId) {
      await db.query(
        `update plan_definitions set stripe_product_id = $2, stripe_price_id = $3 where code = $1::plan_tier`,
        [def.code, productId, priceId],
      )
    }

    results.push({ code: def.code, productId, priceId, action })
  }

  await writeAuditLog(db, {
    action: 'billing.catalog_synced',
    entityType: 'plan_definitions',
    actorUserId: user.id,
    actorAdminRole: admin.role,
    after: { results },
  })

  return { adminRole: admin.role, results }
}
