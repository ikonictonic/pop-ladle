import { env } from '../../config/env.js'
import { getDatabasePool } from '../../database/pool.js'
import { createHttpError } from '../households/householdAccess.js'
import { getEmailTransport, sendEmail } from '../../integrations/email/emailClient.js'
import {
  sendResendEvent,
  updateResendContact,
  upsertResendContact,
} from '../../integrations/email/resendContacts.js'
import { verifyResendWebhook } from '../../integrations/email/resendWebhook.js'
import {
  renderSubscriberConfirmEmail,
  renderWelcomePlannerEmail,
} from '../../integrations/email/templates/subscriberEmails.js'
import { createRateLimiter } from '../../shared/http/rateLimit.js'
import {
  createManageToken,
  createOpaqueToken,
  hashToken,
  isOpaqueToken,
  readManageToken,
} from './subscriberTokens.js'

// =============================================================================
// subscriberService — early-access email signups from popladle.com
// (Subscriber Preference Capture handoff, October 2026).
//
//   signup ──► pending ──(emailed link)──► confirmed ──► withdrawn
//
//   * Double opt-in everywhere. A pending address never reaches Resend; the
//     Resend contact (broadcasts, automations) is created on confirmation.
//   * email_subscribers is the consent source of truth. Every change appends
//     to email_subscriber_events with the exact consent wording and versions.
//   * Withdrawals and suppressions survive repeated signups and preference
//     edits. Only a new confirmation can undo a withdrawal, and nothing undoes
//     a suppression (bounce/complaint).
//   * Repeats are idempotent: duplicate signups within a minute reuse the
//     pending link, a confirmation token works once, the welcome email is sent
//     once, and webhook deliveries are de-duplicated by svix-id.
//   * The interest question is optional, about kitchen help, never medical.
// =============================================================================

// Exact signup checkbox wording by version. The site sends the version it
// rendered; add a new entry (never edit an old one) when the wording changes.
const CONSENT_TEXTS = Object.freeze({
  'footer-v17/2026-10-20':
    "I'd like to receive Pop & Ladle emails with recipes, care ideas, and launch updates. I can unsubscribe anytime. See the Privacy Notice.",
})
const PRIVACY_NOTICE_VERSION = 'draft/2026-10-20'
const CONSENT_SOURCE = 'early_access_landing'
const SIGNUP_LOCALE = 'en-US'
const SOURCE_PAGES = new Set(['/', '/contact', '/privacy'])
const INTEREST_CODES = Object.freeze(['meal_planning', 'hydration', 'food_preferences', 'time_saving', 'other'])

const MAX_EMAIL_LENGTH = 254
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CONFIRMATION_TTL_HOURS = 48
const SIGNUP_SESSION_TTL_HOURS = 2
const DUPLICATE_WINDOW_SECONDS = 60
const MEAL_PLANNING_EVENT = 'meal_planning.started'
const PLANNER_PATH = '/Everyday-Kitchen-Planner.pdf'

const signupsPerClient = createRateLimiter({ max: 10, windowMs: 60 * 60 * 1000 })
const confirmationsPerAddress = createRateLimiter({ max: 5, windowMs: 24 * 60 * 60 * 1000 })

const SUBSCRIBER_COLUMNS = `
  id,
  email,
  consent_status as "consentStatus",
  submitted_at as "submittedAt",
  confirmed_at as "confirmedAt",
  withdrawn_at as "withdrawnAt",
  suppressed_at as "suppressedAt",
  confirmation_token_hash as "confirmationTokenHash",
  confirmation_expires_at as "confirmationExpiresAt",
  primary_interest as "primaryInterest",
  preference_updated_at as "preferenceUpdatedAt",
  welcome_sent_at as "welcomeSentAt",
  meal_planning_started_at as "mealPlanningStartedAt"
`

// ---- Input normalization (the public-input security boundary) ----

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    throw createHttpError(400, 'INVALID_EMAIL', 'Enter a valid email address.', true)
  }
  const email = value.trim().toLowerCase()
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw createHttpError(400, 'INVALID_EMAIL', 'Enter a valid email address.', true)
  }
  return email
}

function normalizeSignupInput(payload) {
  const body = payload && typeof payload === 'object' ? payload : {}
  const email = normalizeEmail(body.email)

  if (body.marketingConsent !== true) {
    throw createHttpError(400, 'CONSENT_REQUIRED', 'Marketing consent is required to join the list.', true)
  }

  const consentTextVersion = body.consentVersion
  if (typeof consentTextVersion !== 'string' || !Object.hasOwn(CONSENT_TEXTS, consentTextVersion)) {
    throw createHttpError(400, 'UNKNOWN_CONSENT_VERSION', 'Unrecognized consent wording version.', true)
  }

  return {
    email,
    consentTextVersion,
    consentText: CONSENT_TEXTS[consentTextVersion],
    sourcePage: SOURCE_PAGES.has(body.sourcePage) ? body.sourcePage : '/',
    // Hidden field humans never see. Bots that fill it get a normal-looking reply.
    isBot: typeof body.company === 'string' && body.company.trim() !== '',
  }
}

function normalizeInterest(value) {
  if (!INTEREST_CODES.includes(value)) {
    throw createHttpError(400, 'INVALID_INTEREST', `primary_interest must be one of: ${INTEREST_CODES.join(', ')}.`, true)
  }
  return value
}

// ---- Shared helpers ----

function requireSubscriberService() {
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }
  // In production a console email transport would silently drop confirmations.
  if (!env.SUBSCRIBER_TOKEN_SECRET || (env.NODE_ENV === 'production' && getEmailTransport() !== 'resend')) {
    throw createHttpError(503, 'SUBSCRIBERS_NOT_CONFIGURED', 'The subscriber service is not configured.', true)
  }
  return db
}

async function inTransaction(db, work) {
  const client = await db.connect()
  try {
    await client.query('begin')
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}

async function recordEvent(queryable, subscriberId, eventType, detail = {}) {
  await queryable.query(
    'insert into email_subscriber_events (subscriber_id, event_type, detail) values ($1, $2, $3::jsonb)',
    [subscriberId, eventType, JSON.stringify(detail)],
  )
}

// Resend sync runs after the consent change commits. A failure is logged and
// recorded, never surfaced: the ledger is already correct.
async function recordSyncFailure(db, subscriberId, step, err) {
  console.error(JSON.stringify({
    level: 'error',
    message: 'Subscriber sync to Resend failed',
    subscriberId,
    step,
    error: err?.message ?? String(err),
  }))
  await recordEvent(db, subscriberId, 'resend_sync_failed', {
    step,
    error: String(err?.message ?? err).slice(0, 300),
  }).catch(() => {})
}

function siteUrl(path) {
  return `${env.MARKETING_SITE_URL.replace(/\/+$/, '')}${path}`
}

function subscriberEmailFrom() {
  return env.SUBSCRIBER_EMAIL_FROM || undefined
}

function interestProperties(interest, source, updatedAt) {
  return {
    primary_interest: interest,
    interest_source: source,
    interest_updated_at: new Date(updatedAt).toISOString(),
  }
}

async function cleanUpExpiredTokens(db) {
  await db.query('delete from email_signup_sessions where expires_at < now()')
  await db.query(`
    update email_subscribers
    set confirmation_token_hash = null, confirmation_expires_at = null, updated_at = now()
    where confirmation_token_hash is not null and confirmation_expires_at < now()
  `)
}

// ---- POST /early-access ----

export async function submitEarlyAccessSignup(payload, { clientKey }) {
  const db = requireSubscriberService()
  const input = normalizeSignupInput(payload)

  if (input.isBot) return { signup_session: null }

  if (!signupsPerClient(clientKey)) {
    throw createHttpError(429, 'SIGNUP_RATE_LIMITED', 'Too many signups from this connection. Please try again later.', true)
  }

  const confirmationToken = createOpaqueToken()
  const sessionToken = createOpaqueToken()

  const { subscriber, outcome } = await inTransaction(db, async (client) => {
    const inserted = await client.query(
      `
        insert into email_subscribers (email, consent_text_version, privacy_notice_version, consent_source, submitted_at)
        values ($1, $2, $3, $4, now())
        on conflict (email) do nothing
        returning id
      `,
      [input.email, input.consentTextVersion, PRIVACY_NOTICE_VERSION, CONSENT_SOURCE],
    )
    const isNew = inserted.rowCount === 1

    const current = await client.query(
      `
        select ${SUBSCRIBER_COLUMNS},
          submitted_at > now() - make_interval(secs => $2) as "submittedRecently"
        from email_subscribers where email = $1 for update
      `,
      [input.email, DUPLICATE_WINDOW_SECONDS],
    )
    const row = current.rows[0]

    // The response is the same for every outcome so the form never reveals
    // whether an address is already on the list.
    let decided
    if (row.suppressedAt) decided = 'suppressed'
    else if (row.consentStatus === 'confirmed') decided = 'already_confirmed'
    else if (!isNew && row.confirmationTokenHash && row.submittedRecently) decided = 'duplicate'
    else if (!confirmationsPerAddress(input.email)) decided = 'address_rate_limited'
    else decided = 'confirmation_sent'

    if (decided === 'confirmation_sent') {
      await client.query(
        `
          update email_subscribers
          set consent_text_version = $2,
              privacy_notice_version = $3,
              consent_source = $4,
              submitted_at = now(),
              confirmation_token_hash = $5,
              confirmation_expires_at = now() + make_interval(hours => $6),
              updated_at = now()
          where id = $1
        `,
        [row.id, input.consentTextVersion, PRIVACY_NOTICE_VERSION, CONSENT_SOURCE, hashToken(confirmationToken), CONFIRMATION_TTL_HOURS],
      )
    }

    await recordEvent(client, row.id, 'signup_submitted', {
      outcome: decided,
      consentTextVersion: input.consentTextVersion,
      consentText: input.consentText,
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
      consentSource: CONSENT_SOURCE,
      sourcePage: input.sourcePage,
    })

    await client.query(
      `
        insert into email_signup_sessions (token_hash, subscriber_id, expires_at)
        values ($1, $2, now() + make_interval(hours => $3))
      `,
      [hashToken(sessionToken), row.id, SIGNUP_SESSION_TTL_HOURS],
    )

    return { subscriber: row, outcome: decided }
  })

  await cleanUpExpiredTokens(db).catch(() => {})

  if (outcome === 'confirmation_sent') {
    const content = renderSubscriberConfirmEmail({
      confirmUrl: siteUrl(`/confirm-email?token=${confirmationToken}`),
    })
    try {
      const result = await sendEmail({ to: input.email, from: subscriberEmailFrom(), ...content })
      await recordEvent(db, subscriber.id, 'confirmation_email_sent', { transport: result.transport })
    } catch (err) {
      await recordEvent(db, subscriber.id, 'confirmation_email_failed', {
        error: String(err?.message ?? err).slice(0, 300),
      })
      throw createHttpError(502, 'CONFIRMATION_EMAIL_FAILED', 'We could not send the confirmation email. Please try again shortly.', true)
    }
  }

  return { signup_session: sessionToken }
}

// ---- POST /subscriber/preference ----

async function resolvePreferenceSubscriber(client, payload) {
  if (typeof payload.manage_token === 'string') {
    const subscriberId = readManageToken(payload.manage_token, env.SUBSCRIBER_TOKEN_SECRET)
    if (subscriberId) return { subscriberId, source: 'preferences_page' }
  } else if (isOpaqueToken(payload.signup_session)) {
    const session = await client.query(
      'select subscriber_id from email_signup_sessions where token_hash = $1 and expires_at > now()',
      [hashToken(payload.signup_session)],
    )
    if (session.rows[0]) return { subscriberId: session.rows[0].subscriber_id, source: 'thank_you_page' }
  }
  throw createHttpError(401, 'SUBSCRIBER_SESSION_INVALID', 'This page has expired. Your signup still went through.', true)
}

export async function saveSubscriberPreference(payload) {
  const db = requireSubscriberService()
  const body = payload && typeof payload === 'object' ? payload : {}
  const interest = normalizeInterest(body.primary_interest)

  const { row, source, startMealPlanning } = await inTransaction(db, async (client) => {
    const { subscriberId, source: interestSource } = await resolvePreferenceSubscriber(client, body)

    const current = await client.query(`select ${SUBSCRIBER_COLUMNS} from email_subscribers where id = $1 for update`, [subscriberId])
    const subscriber = current.rows[0]
    if (!subscriber) {
      throw createHttpError(401, 'SUBSCRIBER_SESSION_INVALID', 'This page has expired. Your signup still went through.', true)
    }

    const start = interest === 'meal_planning'
      && subscriber.consentStatus === 'confirmed'
      && !subscriber.suppressedAt
      && !subscriber.mealPlanningStartedAt

    const updated = await client.query(
      `
        update email_subscribers
        set primary_interest = $2,
            preference_updated_at = now(),
            meal_planning_started_at = case when $3 then now() else meal_planning_started_at end,
            updated_at = now()
        where id = $1
        returning ${SUBSCRIBER_COLUMNS}
      `,
      [subscriberId, interest, start],
    )

    await recordEvent(client, subscriberId, 'preference_saved', { primaryInterest: interest, source: interestSource })
    return { row: updated.rows[0], source: interestSource, startMealPlanning: start }
  })

  // Interests reach Resend only for confirmed, unsuppressed contacts; a pending
  // subscriber's answer is sent along when they confirm.
  if (row.consentStatus === 'confirmed' && !row.suppressedAt) {
    try {
      await updateResendContact({
        email: row.email,
        properties: interestProperties(interest, source, row.preferenceUpdatedAt),
      })
    } catch (err) {
      await recordSyncFailure(db, row.id, 'preference', err)
    }
    if (startMealPlanning) await startMealPlanningSequence(db, row)
  }

  return { saved: true, primary_interest: interest }
}

async function startMealPlanningSequence(db, subscriber) {
  try {
    await sendResendEvent({ event: MEAL_PLANNING_EVENT, email: subscriber.email })
    await recordEvent(db, subscriber.id, 'meal_planning_sequence_started')
  } catch (err) {
    // Release the claim so a later confirmation or preference save retries.
    await db.query('update email_subscribers set meal_planning_started_at = null where id = $1', [subscriber.id])
    await recordSyncFailure(db, subscriber.id, 'meal_planning_sequence', err)
  }
}

// ---- POST /subscriber/confirm (behind the site's GET /confirm-email) ----

export async function confirmSubscriberEmail(payload) {
  const db = requireSubscriberService()
  const token = payload?.token
  if (!isOpaqueToken(token)) return { status: 'invalid' }

  const outcome = await inTransaction(db, async (client) => {
    const current = await client.query(
      `
        select ${SUBSCRIBER_COLUMNS}, confirmation_expires_at <= now() as "isExpired"
        from email_subscribers where confirmation_token_hash = $1 for update
      `,
      [hashToken(token)],
    )
    const row = current.rows[0]
    if (!row) return { status: 'invalid' }

    const clearToken = () => client.query(
      `
        update email_subscribers
        set confirmation_token_hash = null, confirmation_expires_at = null, updated_at = now()
        where id = $1
      `,
      [row.id],
    )

    if (row.isExpired) {
      await clearToken()
      await recordEvent(client, row.id, 'confirmation_expired')
      return { status: 'expired' }
    }
    if (row.suppressedAt) {
      await clearToken()
      await recordEvent(client, row.id, 'confirmation_blocked', { reason: 'suppressed' })
      return { status: 'invalid' }
    }
    if (row.withdrawnAt && row.withdrawnAt > row.submittedAt) {
      await clearToken()
      await recordEvent(client, row.id, 'confirmation_blocked', { reason: 'withdrawn_after_signup' })
      return { status: 'invalid' }
    }

    const startMealPlanning = row.primaryInterest === 'meal_planning' && !row.mealPlanningStartedAt
    const updated = await client.query(
      `
        update email_subscribers
        set consent_status = 'confirmed',
            confirmed_at = now(),
            confirmation_token_hash = null,
            confirmation_expires_at = null,
            meal_planning_started_at = case when $2 then now() else meal_planning_started_at end,
            updated_at = now()
        where id = $1
        returning ${SUBSCRIBER_COLUMNS}
      `,
      [row.id, startMealPlanning],
    )
    await recordEvent(client, row.id, 'confirmed', { previousStatus: row.consentStatus })

    return {
      status: 'confirmed',
      subscriber: updated.rows[0],
      sendWelcome: !row.welcomeSentAt,
      startMealPlanning,
    }
  })

  if (outcome.status !== 'confirmed') return { status: outcome.status }

  const { subscriber } = outcome
  try {
    await upsertResendContact({
      email: subscriber.email,
      unsubscribed: false,
      properties: {
        signup_source: CONSENT_SOURCE,
        signup_locale: SIGNUP_LOCALE,
        onboarding_stage: 'subscribed',
        ...(subscriber.primaryInterest
          ? interestProperties(subscriber.primaryInterest, 'thank_you_page', subscriber.preferenceUpdatedAt)
          : {}),
      },
    })
  } catch (err) {
    await recordSyncFailure(db, subscriber.id, 'contact_subscribe', err)
  }

  if (outcome.sendWelcome) await sendWelcomeEmail(db, subscriber)
  if (outcome.startMealPlanning) await startMealPlanningSequence(db, subscriber)

  return { status: 'confirmed' }
}

async function sendWelcomeEmail(db, subscriber) {
  const manageToken = createManageToken(subscriber.id, env.SUBSCRIBER_TOKEN_SECRET)
  const content = renderWelcomePlannerEmail({
    plannerUrl: siteUrl(PLANNER_PATH),
    preferencesUrl: siteUrl(`/preferences?token=${manageToken}`),
    mailingAddress: env.MAILING_ADDRESS,
  })

  try {
    await sendEmail({
      to: subscriber.email,
      from: subscriberEmailFrom(),
      ...content,
      headers: {
        'List-Unsubscribe': `<${siteUrl(`/api/subscriber/withdraw?token=${manageToken}`)}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      idempotencyKey: `welcome-${subscriber.id}`,
    })
    await db.query(
      'update email_subscribers set welcome_sent_at = now(), updated_at = now() where id = $1 and welcome_sent_at is null',
      [subscriber.id],
    )
    await recordEvent(db, subscriber.id, 'welcome_email_sent')
  } catch (err) {
    await recordEvent(db, subscriber.id, 'welcome_email_failed', {
      error: String(err?.message ?? err).slice(0, 300),
    }).catch(() => {})
    console.error(JSON.stringify({
      level: 'error',
      message: 'Welcome email failed',
      subscriberId: subscriber.id,
      error: err?.message ?? String(err),
    }))
  }
}

// ---- POST /subscriber/withdraw (preferences page and one-click List-Unsubscribe) ----

export async function withdrawSubscriber(payload, query) {
  const db = requireSubscriberService()
  const token = payload?.token ?? query?.token
  const subscriberId = readManageToken(token, env.SUBSCRIBER_TOKEN_SECRET)
  if (!subscriberId) {
    throw createHttpError(400, 'INVALID_MANAGE_TOKEN', 'This unsubscribe link is not valid.', true)
  }
  const source = payload?.['List-Unsubscribe'] === 'One-Click' ? 'one_click_unsubscribe' : 'preferences_page'

  const outcome = await inTransaction(db, async (client) => {
    const current = await client.query(`select ${SUBSCRIBER_COLUMNS} from email_subscribers where id = $1 for update`, [subscriberId])
    const row = current.rows[0]
    if (!row || row.consentStatus === 'withdrawn') return { changed: false, row }

    await client.query(
      `
        update email_subscribers
        set consent_status = 'withdrawn',
            withdrawn_at = now(),
            confirmation_token_hash = null,
            confirmation_expires_at = null,
            updated_at = now()
        where id = $1
      `,
      [subscriberId],
    )
    await recordEvent(client, subscriberId, 'withdrawn', { source, previousStatus: row.consentStatus })
    return { changed: true, row }
  })

  if (outcome.changed && outcome.row.confirmedAt) {
    try {
      await updateResendContact({
        email: outcome.row.email,
        unsubscribed: true,
        properties: { onboarding_stage: 'withdrawn' },
      })
    } catch (err) {
      await recordSyncFailure(db, subscriberId, 'contact_unsubscribe', err)
    }
  }

  return { status: 'withdrawn' }
}

// ---- POST /subscriber/resend-events (Resend webhook) ----

/**
 * Pure decision for one webhook event against one subscriber row.
 * Returns { action, ... } where action is withdraw | resubscribe | suppress |
 * push_unsubscribed | ignore.
 */
function decideWebhookAction(subscriber, { type, unsubscribed, eventTime }) {
  if (type === 'email.bounced' || type === 'email.complained' || type === 'email.suppressed') {
    if (subscriber.suppressedAt) return { action: 'ignore', reason: 'already_suppressed' }
    return { action: 'suppress', reason: type.slice('email.'.length) }
  }

  if (type !== 'contact.updated' || typeof unsubscribed !== 'boolean') {
    return { action: 'ignore', reason: 'unhandled_event' }
  }

  // Our own Resend updates echo back here; anything older than the latest
  // consent change in the ledger is stale.
  const lastChange = Math.max(
    subscriber.confirmedAt ? new Date(subscriber.confirmedAt).getTime() : 0,
    subscriber.withdrawnAt ? new Date(subscriber.withdrawnAt).getTime() : 0,
  )
  if (Number.isFinite(eventTime) && eventTime <= lastChange) return { action: 'ignore', reason: 'stale' }

  if (unsubscribed) {
    return subscriber.consentStatus === 'confirmed'
      ? { action: 'withdraw' }
      : { action: 'ignore', reason: 'already_unsubscribed' }
  }

  if (subscriber.consentStatus === 'confirmed') return { action: 'ignore', reason: 'in_sync' }
  // Opted back in on Resend's preference page after an earlier confirmation.
  if (subscriber.consentStatus === 'withdrawn' && subscriber.confirmedAt && !subscriber.suppressedAt) {
    return { action: 'resubscribe' }
  }
  // Resend marked an unconfirmed or suppressed address subscribed: undo it.
  return { action: 'push_unsubscribed' }
}

function webhookRecipients(event) {
  const data = event?.data ?? {}
  const raw = event?.type === 'contact.updated' ? [data.email] : Array.isArray(data.to) ? data.to : [data.to]
  return [...new Set(raw.filter((v) => typeof v === 'string').map((v) => v.trim().toLowerCase()))]
}

export async function applyResendWebhook({ rawBody, headers }) {
  if (!env.RESEND_WEBHOOK_SECRET) {
    throw createHttpError(503, 'WEBHOOK_NOT_CONFIGURED', 'RESEND_WEBHOOK_SECRET is not set.', true)
  }
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }
  if (!Buffer.isBuffer(rawBody) || !verifyResendWebhook({ rawBody, headers, secret: env.RESEND_WEBHOOK_SECRET })) {
    throw createHttpError(400, 'WEBHOOK_SIGNATURE_INVALID', 'Resend webhook signature verification failed.', true)
  }

  let event
  try {
    event = JSON.parse(rawBody.toString('utf8'))
  } catch {
    throw createHttpError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Webhook body is not JSON.', true)
  }

  const type = typeof event?.type === 'string' ? event.type : 'unknown'
  const eventTime = Date.parse(event?.data?.updated_at ?? event?.created_at ?? '')
  const unsubscribed = event?.data?.unsubscribed

  const outcome = await inTransaction(db, async (client) => {
    const receipt = await client.query(
      'insert into email_webhook_receipts (webhook_id, event_type) values ($1, $2) on conflict do nothing',
      [headers['svix-id'], type],
    )
    if (receipt.rowCount === 0) return { status: 'duplicate', pushUnsubscribed: [] }

    const pushUnsubscribed = []
    for (const email of webhookRecipients(event)) {
      const current = await client.query(`select ${SUBSCRIBER_COLUMNS} from email_subscribers where email = $1 for update`, [email])
      const row = current.rows[0]
      if (!row) continue

      const decision = decideWebhookAction(row, { type, unsubscribed, eventTime })
      if (decision.action === 'withdraw') {
        await client.query(
          `
            update email_subscribers
            set consent_status = 'withdrawn', withdrawn_at = now(),
                confirmation_token_hash = null, confirmation_expires_at = null, updated_at = now()
            where id = $1
          `,
          [row.id],
        )
        await recordEvent(client, row.id, 'withdrawn', { source: 'resend', webhookType: type })
      } else if (decision.action === 'resubscribe') {
        await client.query(
          "update email_subscribers set consent_status = 'confirmed', updated_at = now() where id = $1",
          [row.id],
        )
        await recordEvent(client, row.id, 'resubscribed', { source: 'resend' })
      } else if (decision.action === 'suppress') {
        await client.query(
          'update email_subscribers set suppressed_at = now(), suppression_reason = $2, updated_at = now() where id = $1',
          [row.id, decision.reason],
        )
        await recordEvent(client, row.id, 'suppressed', { reason: decision.reason, source: 'resend' })
        pushUnsubscribed.push(row)
      } else if (decision.action === 'push_unsubscribed') {
        await recordEvent(client, row.id, 'resend_out_of_sync', { consentStatus: row.consentStatus })
        pushUnsubscribed.push(row)
      }
    }
    return { status: 'processed', pushUnsubscribed }
  })

  for (const row of outcome.pushUnsubscribed) {
    try {
      await updateResendContact({ email: row.email, unsubscribed: true })
    } catch (err) {
      await recordSyncFailure(db, row.id, 'webhook_unsubscribe', err)
    }
  }

  return { status: outcome.status }
}

export const __normalizeSignupInputForTests = normalizeSignupInput
export const __normalizeInterestForTests = normalizeInterest
export const __decideWebhookActionForTests = decideWebhookAction
export const __webhookRecipientsForTests = webhookRecipients
export const __CONSENT_TEXTS_FOR_TESTS = CONSENT_TEXTS
