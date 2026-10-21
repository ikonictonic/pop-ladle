// =============================================================================
// subscribers.test.js — the consent rules that do not need a live database.
//
// Signup input normalization is the public-input boundary; the webhook
// decision table decides when Resend may change consent state; tokens and the
// Svix signature check guard every link and webhook. Pinned here without a
// live DB, matching the suite.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'

import {
  __CONSENT_TEXTS_FOR_TESTS as CONSENT_TEXTS,
  __decideWebhookActionForTests as decideWebhookAction,
  __normalizeInterestForTests as normalizeInterest,
  __normalizeSignupInputForTests as normalizeSignupInput,
  __webhookRecipientsForTests as webhookRecipients,
} from './subscriberService.js'
import {
  createManageToken,
  createOpaqueToken,
  hashToken,
  isOpaqueToken,
  readManageToken,
} from './subscriberTokens.js'
import { verifyResendWebhook } from '../../integrations/email/resendWebhook.js'
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

test('an unsubscribe in Resend withdraws a confirmed subscriber', () => {
  assert.deepEqual(
    decideWebhookAction(base, { type: 'contact.updated', unsubscribed: true, eventTime: later }),
    { action: 'withdraw' },
  )
})

test('stale contact events older than the latest consent change are ignored', () => {
  assert.equal(
    decideWebhookAction(base, { type: 'contact.updated', unsubscribed: true, eventTime: earlier }).reason,
    'stale',
  )
})

test('our own echoes leave the ledger alone', () => {
  assert.equal(decideWebhookAction(base, { type: 'contact.updated', unsubscribed: false, eventTime: later }).action, 'ignore')
  const withdrawn = { ...base, consentStatus: 'withdrawn', withdrawnAt: new Date('2026-10-21T09:00:00Z') }
  assert.equal(decideWebhookAction(withdrawn, { type: 'contact.updated', unsubscribed: true, eventTime: later }).action, 'ignore')
})

test('opting back in on Resend restores a previously confirmed subscriber only', () => {
  const withdrawn = { ...base, consentStatus: 'withdrawn', withdrawnAt: new Date('2026-10-20T12:00:00Z') }
  assert.equal(decideWebhookAction(withdrawn, { type: 'contact.updated', unsubscribed: false, eventTime: later }).action, 'resubscribe')

  const pending = { ...base, consentStatus: 'pending', confirmedAt: null }
  assert.equal(decideWebhookAction(pending, { type: 'contact.updated', unsubscribed: false, eventTime: later }).action, 'push_unsubscribed')

  const suppressed = { ...withdrawn, suppressedAt: new Date('2026-10-20T13:00:00Z') }
  assert.equal(decideWebhookAction(suppressed, { type: 'contact.updated', unsubscribed: false, eventTime: later }).action, 'push_unsubscribed')
})

test('bounces, complaints and Resend suppressions suppress once', () => {
  for (const type of ['email.bounced', 'email.complained', 'email.suppressed']) {
    const out = decideWebhookAction(base, { type, eventTime: later })
    assert.equal(out.action, 'suppress')
    assert.equal(out.reason, type.slice('email.'.length))
  }
  const suppressed = { ...base, suppressedAt: confirmedAt }
  assert.equal(decideWebhookAction(suppressed, { type: 'email.bounced', eventTime: later }).action, 'ignore')
})

test('unhandled events are ignored', () => {
  assert.equal(decideWebhookAction(base, { type: 'email.opened', eventTime: later }).action, 'ignore')
  assert.equal(decideWebhookAction(base, { type: 'contact.updated', eventTime: later }).action, 'ignore')
})

test('webhook recipients are normalized from contact and email events', () => {
  assert.deepEqual(webhookRecipients({ type: 'contact.updated', data: { email: ' Ana@Example.com ' } }), ['ana@example.com'])
  assert.deepEqual(webhookRecipients({ type: 'email.bounced', data: { to: ['A@x.com', 'a@x.com', 5] } }), ['a@x.com'])
  assert.deepEqual(webhookRecipients({ type: 'email.complained', data: { to: 'b@x.com' } }), ['b@x.com'])
  assert.deepEqual(webhookRecipients({}), [])
})

// ---- Resend (Svix) signatures ----

const WEBHOOK_SECRET = `whsec_${Buffer.from('test-signing-key-0123456789').toString('base64')}`

function sign(id, timestamp, body, secret = WEBHOOK_SECRET) {
  const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`
}

test('verifies a correctly signed Resend webhook', () => {
  const body = '{"type":"contact.updated"}'
  const now = Date.now()
  const timestamp = String(Math.floor(now / 1000))
  const headers = { 'svix-id': 'msg_1', 'svix-timestamp': timestamp, 'svix-signature': `v1,bm9wZQ== ${sign('msg_1', timestamp, body)}` }
  assert.equal(verifyResendWebhook({ rawBody: Buffer.from(body), headers, secret: WEBHOOK_SECRET, now }), true)
})

test('rejects tampered bodies, wrong secrets, old timestamps and missing headers', () => {
  const body = '{"type":"contact.updated"}'
  const now = Date.now()
  const timestamp = String(Math.floor(now / 1000))
  const headers = { 'svix-id': 'msg_1', 'svix-timestamp': timestamp, 'svix-signature': sign('msg_1', timestamp, body) }

  assert.equal(verifyResendWebhook({ rawBody: Buffer.from(`${body} `), headers, secret: WEBHOOK_SECRET, now }), false)
  assert.equal(verifyResendWebhook({ rawBody: Buffer.from(body), headers, secret: `whsec_${Buffer.from('other').toString('base64')}`, now }), false)
  assert.equal(verifyResendWebhook({ rawBody: Buffer.from(body), headers, secret: WEBHOOK_SECRET, now: now + 10 * 60 * 1000 }), false)
  assert.equal(verifyResendWebhook({ rawBody: Buffer.from(body), headers: { ...headers, 'svix-id': undefined }, secret: WEBHOOK_SECRET, now }), false)
  assert.equal(verifyResendWebhook({ rawBody: Buffer.from(body), headers, secret: '', now }), false)
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
