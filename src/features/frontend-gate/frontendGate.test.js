import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createFrontendGateToken,
  frontendGatePasswordsMatch,
  readCookie,
  verifyFrontendGateToken,
} from './frontendGate.js'

test('frontend gate password comparison accepts only an exact match', () => {
  assert.equal(frontendGatePasswordsMatch('temporary secret', 'temporary secret'), true)
  assert.equal(frontendGatePasswordsMatch('Temporary secret', 'temporary secret'), false)
  assert.equal(frontendGatePasswordsMatch('', 'temporary secret'), false)
  assert.equal(frontendGatePasswordsMatch('temporary secret', ''), false)
})

test('frontend gate tokens expire and are invalidated by a password change', () => {
  const password = 'temporary secret'
  const sessionSecret = 'a-test-session-secret-that-is-at-least-32-characters'
  const token = createFrontendGateToken({ password, sessionSecret, now: 1_000, ttlMs: 5_000 })

  assert.equal(verifyFrontendGateToken(token, { password, sessionSecret, now: 5_999 }), true)
  assert.equal(verifyFrontendGateToken(token, { password, sessionSecret, now: 6_000 }), false)
  assert.equal(verifyFrontendGateToken(token, { password: 'new temporary secret', sessionSecret, now: 2_000 }), false)
  assert.equal(verifyFrontendGateToken(token, { password, sessionSecret: `${sessionSecret}-changed`, now: 2_000 }), false)
})

test('frontend gate tokens reject tampering and malformed values', () => {
  const password = 'temporary secret'
  const sessionSecret = 'a-test-session-secret-that-is-at-least-32-characters'
  const token = createFrontendGateToken({ password, sessionSecret, now: 1_000, ttlMs: 5_000 })
  const tampered = token.replace('6000', '7000')

  assert.equal(verifyFrontendGateToken(tampered, { password, sessionSecret, now: 2_000 }), false)
  assert.equal(verifyFrontendGateToken('not-a-token', { password, sessionSecret, now: 2_000 }), false)
  assert.equal(verifyFrontendGateToken(null, { password, sessionSecret, now: 2_000 }), false)
})

test('readCookie finds and decodes the requested cookie', () => {
  assert.equal(readCookie('first=one; pop_ladle_frontend_gate=v1%2E123%2Eabc; last=three', 'pop_ladle_frontend_gate'), 'v1.123.abc')
  assert.equal(readCookie('first=one', 'pop_ladle_frontend_gate'), null)
})
