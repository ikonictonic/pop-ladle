/**
 * AES-256-GCM at-rest encryption for platform LLM provider API keys.
 *
 * The encryption key is derived from PROVIDER_KEY_ENC_SECRET (any length secret
 * string) via SHA-256 to a fixed 32-byte key. If that env var is unset we FAIL
 * CLOSED: write endpoints must return 503 and nothing is ever stored in
 * plaintext. Reads of already-stored ciphertext also fail closed on decrypt.
 *
 * Wire format in the DB is three columns: ciphertext, iv (12 bytes), auth_tag
 * (16 bytes). We never store the plaintext; a separate last4 hint column lets a
 * read render "sk-…1234" without decrypting.
 */

import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

/**
 * True when a usable encryption secret is configured. Callers use this to fail
 * closed (503) before attempting any write.
 */
export function isProviderKeyEncryptionConfigured() {
  const secret = process.env.PROVIDER_KEY_ENC_SECRET
  return typeof secret === 'string' && secret.trim().length > 0
}

function deriveKey() {
  const secret = process.env.PROVIDER_KEY_ENC_SECRET
  if (!secret || !secret.trim()) {
    throw new Error('PROVIDER_KEY_ENC_SECRET is not set.')
  }
  // Normalize any secret length to a 32-byte key.
  return crypto.createHash('sha256').update(secret, 'utf8').digest()
}

/**
 * Encrypt a plaintext API key.
 * @param {string} plaintext
 * @returns {{ ciphertext: Buffer, iv: Buffer, authTag: Buffer, last4: string }}
 */
export function encryptProviderKey(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('Cannot encrypt an empty API key.')
  }
  const key = deriveKey()
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return { ciphertext, iv, authTag, last4: plaintext.slice(-4) }
}

/**
 * Decrypt stored material back to the plaintext API key.
 * @param {{ ciphertext: Buffer, iv: Buffer, authTag: Buffer }} stored
 * @returns {string}
 */
export function decryptProviderKey({ ciphertext, iv, authTag }) {
  const key = deriveKey()
  const decipher = crypto.createDecipheriv(ALGORITHM, key, toBuffer(iv))
  decipher.setAuthTag(toBuffer(authTag))
  const plaintext = Buffer.concat([
    decipher.update(toBuffer(ciphertext)),
    decipher.final(),
  ])
  return plaintext.toString('utf8')
}

/**
 * Render a masked display value for a read: "sk-…1234". Never derived from
 * ciphertext — uses the stored last4 hint.
 */
export function maskFromLast4(last4) {
  const tail = typeof last4 === 'string' && last4 ? last4 : '••••'
  return `sk-…${tail}`
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  // pg returns bytea as Buffer already, but be defensive for tests / drivers.
  return Buffer.from(value)
}

// Exported for guard checks and constants.
export const ENCRYPTION_KEY_BYTES = KEY_BYTES
