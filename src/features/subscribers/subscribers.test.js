// =============================================================================
// subscribers.test.js — the consent rules that do not need a live database.
//
// Signup input normalization is the public-input boundary; the webhook
// decision table decides when Plunk may change consent state; tokens and the
// webhook secret guard every link and webhook. Pinned here without a live DB,
// matching the suite.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  __CONSENT_TEXTS_FOR_TESTS as CONSENT_TEXTS,
  __decideWebhookActionForTests as decideWebhookAction,
  __normalizeInterestForTests as normalizeInterest,
  __normalizeSignupInputForTests as normalizeSignupInput,
  __readPlunkWebhookForTests as readPlunkWebhook,
} from './subscriberService.js'
import {
  createManageToken,
  createOpaqueToken,
  hashToken,
  isOpaqueToken,
  readManageToken,
} from './subscriberTokens.js'
import { __parseSenderForTests as parseSender, verifyPlunkWebhook } from '../../integrations/email/plunk.js'
import { createRateLimiter } from '../../shared/http/rateLimit.js'
import { __normalizeContactMessageForTests as normalizeContactMessage } from '../site-contact/siteContactService.js'

const SECRET = 'x'.repeat(40)
const SUBSCRIBER_ID = '6f1c1d3e-8a4b-4c55-9d2e-0b7a6c5d4e3f'
const CONSENT_VERSION = Object.keys(CONSENT_TEXTS)[0]

function expectHttp(fn, code) {
  try {
    fn()
    assert.fail('expected an HTTP error to be thrown')
  } catch (err) {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}`)
    assert.equal(typeof err.statusCode, 'number')
  }
}

const validSignup = { email: '  Ana@Example.COM ', marketingConsent: true, consentVersion: CONSENT_VERSION, sourcePage: '/contact' }

// ---- signup input ----

test('normalizes a valid signup and stores the exact consent wording', () => {
  const out = normalizeSignupInput(validSignup)
  assert.equal(out.email, 'ana@example.com')
  assert.equal(out.consentTextVersion, CONSENT_VERSION)
  assert.equal(out.consentText, CONSENT_TEXTS[CONSENT_VERSION])
  assert.equal(out.sourcePage, '/contact')
  assert.equal(out.isBot, false)
})

test('requires explicit marketing consent (boolean true only)', () => {
  for (const consent of [undefined, false, 'true', 1, null]) {
    expectHttp(() => normalizeSignupInput({ ...validSignup, marketingConsent: consent }), 'CONSENT_REQUIRED')
  }
})

test('rejects malformed and over-long email addresses', () => {
  for (const email of [undefined, '', 'not-an-email', 'a@b', 'a b@c.com', `${'a'.repeat(250)}@x.com`]) {
    expectHttp(() => normalizeSignupInput({ ...validSignup, email }), 'INVALID_EMAIL')
  }
})

test('rejects consent wording versions the server does not know', () => {
  expectHttp(() => normalizeSignupInput({ ...validSignup, consentVersion: 'made-up' }), 'UNKNOWN_CONSENT_VERSION')
  expectHttp(() => normalizeSignupInput({ ...validSignup, consentVersion: 'toString' }), 'UNKNOWN_CONSENT_VERSION')
})

test('falls back to the home page for unknown source pages and flags the honeypot', () => {
  assert.equal(normalizeSignupInput({ ...validSignup, sourcePage: '/evil' }).sourcePage, '/')
  assert.equal(normalizeSignupInput({ ...validSignup, company: 'Acme' }).isBot, true)
  assert.equal(normalizeSignupInput({ ...validSignup, company: '   ' }).isBot, false)
})

test('accepts only the five interest codes', () => {
  for (const code of ['meal_planning', 'hydration', 'food_preferences', 'time_saving', 'other']) {
    assert.equal(normalizeInterest(code), code)
  }
  for (const bad of [undefined, '', 'Meal_Planning', 'diabetes', ['meal_planning']]) {
    expectHttp(() => normalizeInterest(bad), 'INVALID_INTEREST')
  }
})

// ---- tokens ----

test('opaque tokens are 43-char base64url and hash deterministically', () => {
  const token = createOpaqueToken()
  assert.ok(isOpaqueToken(token))
  assert.equal(hashToken(token), hashToken(token))
  assert.notEqual(token, createOpaqueToken())
  assert.equal(isOpaqueToken('short'), false)
  assert.equal(isOpaqueToken(`${token}!`), false)
})

test('manage tokens round-trip and reject tampering, other secrets and short secrets', () => {
  const token = createManageToken(SUBSCRIBER_ID, SECRET)
  assert.equal(readManageToken(token, SECRET), SUBSCRIBER_ID)

  const [, signature] = token.split('.')
  const otherId = '00000000-0000-4000-8000-000000000000'
  assert.equal(readManageToken(`${otherId}.${signature}`, SECRET), null)
  assert.equal(readManageToken(token, 'y'.repeat(40)), null)
  assert.equal(readManageToken(token, 'short'), null)
  assert.equal(readManageToken(`${token}.extra`, SECRET), null)
  assert.equal(readManageToken(undefined, SECRET), null)
})

// ---- webhook decisions ----

const confirmedAt = new Date('2026-10-20T10:00:00Z')
const base = {
  consentStatus: 'confirmed',
  confirmedAt,
  withdrawnAt: null,
  suppressedAt: null,
}
const later = Date.parse('2026-10-21T10:00:00Z')
const earlier = Date.parse('2026-10-19T10:00:00Z')

test('an unsubscribe in Plunk withdraws a confirmed subscriber', () => {
  assert.deepEqual(
    decideWebhookAction(base, { type: 'contact.unsubscribed', eventTime: later }),
    { action: 'withdraw' },
  )
})

test('stale contact events older than the latest consent change are ignored', () => {
  assert.equal(
    decideWebhookAction(base, { type: 'contact.unsubscribed', eventTime: earlier }).reason,
    'stale',
  )
})

test('our own echoes leave the ledger alone', () => {
  assert.equal(decideWebhookAction(base, { type: 'contact.subscribed', eventTime: later }).action, 'ignore')
  const withdrawn = { ...base, consentStatus: 'withdrawn', withdrawnAt: new Date('2026-10-21T09:00:00Z') }
  assert.equal(decideWebhookAction(withdrawn, { type: 'contact.unsubscribed', eventTime: later }).action, 'ignore')
})

test('resubscribing in Plunk restores a previously confirmed subscriber only', () => {
  const withdrawn = { ...base, consentStatus: 'withdrawn', withdrawnAt: new Date('2026-10-20T12:00:00Z') }
  assert.equal(decideWebhookAction(withdrawn, { type: 'contact.subscribed', eventTime: later }).action, 'resubscribe')

  const pending = { ...base, consentStatus: 'pending', confirmedAt: null }
  assert.equal(decideWebhookAction(pending, { type: 'contact.subscribed', eventTime: later }).action, 'push_unsubscribed')

  const suppressed = { ...withdrawn, suppressedAt: new Date('2026-10-20T13:00:00Z') }
  assert.equal(decideWebhookAction(suppressed, { type: 'contact.subscribed', eventTime: later }).action, 'push_unsubscribed')
})

test('complaints, permanent bounces and Plunk auto-unsubscribes suppress once', () => {
  assert.deepEqual(decideWebhookAction(base, { type: 'email.complaint', eventTime: later }), { action: 'suppress', reason: 'complaint' })
  assert.deepEqual(decideWebhookAction(base, { type: 'email.bounce', bounceType: 'Permanent', eventTime: later }), { action: 'suppress', reason: 'bounce' })
  for (const reason of ['bounce', 'complaint']) {
    // Even an event older than the last consent change: a suppression is never stale.
    assert.deepEqual(decideWebhookAction(base, { type: 'contact.unsubscribed', reason, eventTime: earlier }), { action: 'suppress', reason })
  }
  const suppressed = { ...base, suppressedAt: confirmedAt }
  assert.equal(decideWebhookAction(suppressed, { type: 'email.complaint', eventTime: later }).reason, 'already_suppressed')
})

test('transient bounces and unhandled events are ignored', () => {
  assert.equal(decideWebhookAction(base, { type: 'email.bounce', bounceType: 'Transient', eventTime: later }).reason, 'transient_bounce')
  assert.equal(decideWebhookAction(base, { type: 'email.open', eventTime: later }).reason, 'unhandled_event')
  assert.equal(decideWebhookAction(base, { type: null, eventTime: later }).reason, 'unhandled_event')
})

test('reads the trigger from ?event= and the rest from the default webhook body', () => {
  const body = {
    contact: { email: ' Ana@Example.com ', subscribed: false, data: {} },
    workflow: { id: 'wf_1', name: 'Unsubscribes' },
    execution: { id: 'exec_1', startedAt: '2026-10-21T10:00:00.000Z' },
    event: { reason: 'bounce' },
  }
  assert.deepEqual(readPlunkWebhook(body, { event: 'contact.unsubscribed' }), {
    type: 'contact.unsubscribed',
    email: 'ana@example.com',
    executionId: 'exec_1',
    eventTime: later,
    reason: 'bounce',
    bounceType: undefined,
  })
  assert.equal(readPlunkWebhook(body, { event: 'contact.updated' }).type, null)
  assert.equal(readPlunkWebhook(body, {}).type, null)
  assert.equal(readPlunkWebhook({}, { event: 'email.bounce' }).email, null)
  assert.ok(Number.isNaN(readPlunkWebhook({}, {}).eventTime))
})

// ---- Plunk webhook secret and sender ----

const WEBHOOK_SECRET = 'w'.repeat(40)

test('accepts only the exact Bearer webhook secret', () => {
  assert.equal(verifyPlunkWebhook({ headers: { authorization: `Bearer ${WEBHOOK_SECRET}` }, secret: WEBHOOK_SECRET }), true)
  assert.equal(verifyPlunkWebhook({ headers: { authorization: `Bearer ${WEBHOOK_SECRET}x` }, secret: WEBHOOK_SECRET }), false)
  assert.equal(verifyPlunkWebhook({ headers: { authorization: WEBHOOK_SECRET }, secret: WEBHOOK_SECRET }), false)
  assert.equal(verifyPlunkWebhook({ headers: {}, secret: WEBHOOK_SECRET }), false)
  // A short or missing server secret never matches, not even itself.
  assert.equal(verifyPlunkWebhook({ headers: { authorization: 'Bearer short' }, secret: 'short' }), false)
  assert.equal(verifyPlunkWebhook({ headers: { authorization: 'Bearer ' }, secret: '' }), false)
})

test('splits a display-name sender into the object Plunk expects', () => {
  assert.deepEqual(parseSender('Pop & Ladle <hello@popladle.com>'), { name: 'Pop & Ladle', email: 'hello@popladle.com' })
  assert.deepEqual(parseSender('"Pop & Ladle" <hello@popladle.com>'), { name: 'Pop & Ladle', email: 'hello@popladle.com' })
  assert.equal(parseSender('<hello@popladle.com>'), 'hello@popladle.com')
  assert.equal(parseSender('hello@popladle.com'), 'hello@popladle.com')
})

// ---- rate limiting ----

test('rate limiter allows max hits per window and resets after it', () => {
  const hit = createRateLimiter({ max: 2, windowMs: 1000 })
  assert.equal(hit('a', 0), true)
  assert.equal(hit('a', 10), true)
  assert.equal(hit('a', 20), false)
  assert.equal(hit('b', 20), true)
  assert.equal(hit('a', 1000), true)
})

// ---- contact form ----

test('contact form requires every field, a listed topic and a valid email', () => {
  const valid = { name: ' Ana ', email: 'Ana@Example.com', reason: 'Press and media', message: ' Hello ' }
  assert.deepEqual(normalizeContactMessage(valid), {
    name: 'Ana', email: 'ana@example.com', reason: 'Press and media', message: 'Hello', isBot: false,
  })
  expectHttp(() => normalizeContactMessage({ ...valid, name: ' ' }), 'INVALID_CONTACT_NAME')
  expectHttp(() => normalizeContactMessage({ ...valid, email: 'nope' }), 'INVALID_CONTACT_EMAIL')
  expectHttp(() => normalizeContactMessage({ ...valid, reason: 'Anything' }), 'INVALID_CONTACT_REASON')
  expectHttp(() => normalizeContactMessage({ ...valid, message: 'x'.repeat(4001) }), 'INVALID_CONTACT_MESSAGE')
})
