import crypto from 'node:crypto'
import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { requireInternalAdmin, SUPER_ONLY } from '../super-admin/adminAccess.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'
import { createHttpError, normalizeUuid } from '../households/householdAccess.js'
import { createHouseholdForCurrentUser } from '../households/householdService.js'
import { sendEmail } from '../../integrations/email/emailClient.js'

// =============================================================================
// betaInviteService — private-beta sign-up links.
//
// Two surfaces:
//   * Super-admin management (list / create / revoke) — gated by
//     requireInternalAdmin(SUPER_ONLY).
//   * Authenticated redemption — any signed-in Clerk user with a valid token
//     gets provisioned as the owner of a new household (reusing
//     createHouseholdForCurrentUser), and the link is stamped used.
//
// Replaces the Supabase beta_invites table + redeem_beta_invite RPC. Tokens are
// minted server-side; bound links validate the caller's verified email.
// =============================================================================

const DEFAULT_EXPIRES_DAYS = 30
const MAX_EXPIRES_DAYS = 365
const TOKEN_BYTES = 24
const MAX_NOTE_LENGTH = 200
const MAX_EMAIL_LENGTH = 200

function getDbOrThrow() {
  const db = getDatabasePool()

  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }

  return db
}

function generateInviteToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url')
}

function normalizeEmail(value) {
  if (value === undefined || value === null) return null

  if (typeof value !== 'string') {
    throw createHttpError(400, 'INVALID_BETA_EMAIL', 'email must be a string.', true)
  }

  const email = value.trim().toLowerCase()
  if (!email) return null

  if (email.length > MAX_EMAIL_LENGTH || !email.includes('@')) {
    throw createHttpError(400, 'INVALID_BETA_EMAIL', 'email must be a valid address.', true)
  }

  return email
}

function normalizeNote(value) {
  if (value === undefined || value === null) return null

  if (typeof value !== 'string') {
    throw createHttpError(400, 'INVALID_BETA_NOTE', 'note must be a string.', true)
  }

  const note = value.trim()
  if (!note) return null

  if (note.length > MAX_NOTE_LENGTH) {
    throw createHttpError(400, 'INVALID_BETA_NOTE', `note must be ${MAX_NOTE_LENGTH} characters or fewer.`, true)
  }

  return note
}

function normalizeExpiresDays(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_EXPIRES_DAYS

  const days = Number(value)

  if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRES_DAYS) {
    throw createHttpError(
      400,
      'INVALID_EXPIRES_DAYS',
      `expiresDays must be an integer between 1 and ${MAX_EXPIRES_DAYS}.`,
      true,
    )
  }

  return days
}

function inviteProjection(alias = 'b') {
  return `
    ${alias}.id,
    ${alias}.email,
    ${alias}.note,
    ${alias}.invite_token as "inviteToken",
    ${alias}.expires_at as "expiresAt",
    ${alias}.used_at as "usedAt",
    ${alias}.used_by as "usedBy",
    ${alias}.revoked_at as "revokedAt",
    ${alias}.created_at as "createdAt"
  `
}

async function readInviteById(db, id) {
  const result = await db.query(
    `select ${inviteProjection('b')} from beta_invites b where b.id = $1 limit 1`,
    [id],
  )
  return result.rows[0] ?? null
}

async function readInviteByToken(db, token) {
  const result = await db.query(
    `select ${inviteProjection('b')} from beta_invites b where b.invite_token = $1 limit 1`,
    [token],
  )
  return result.rows[0] ?? null
}

function betaInviteUrl(siteUrl, token) {
  const origin = typeof siteUrl === 'string' ? siteUrl.replace(/\/+$/, '') : ''
  return `${origin}/?beta=${token}`
}

// Best-effort: a missing/failing email transport must not block link creation —
// the super admin can always copy the link instead.
async function sendBetaInviteEmail(email, token, siteUrl) {
  const link = betaInviteUrl(siteUrl, token)
  const subject = "You're invited to Pop & Ladle"
  const text =
    `You've been invited to Pop & Ladle.\n\n` +
    `Open this link to set up your household:\n${link}\n\n` +
    `This link is one-time and may expire.`
  const html =
    `<p>You've been invited to <strong>Pop &amp; Ladle</strong>.</p>` +
    `<p><a href="${link}">Set up your household</a></p>` +
    `<p>This link is one-time and may expire.</p>`

  try {
    const result = await sendEmail({ to: email, subject, html, text })
    return { sent: Boolean(result?.delivered), error: result?.error ?? null }
  } catch (err) {
    return { sent: false, error: err?.message ?? 'Email could not be sent.' }
  }
}

export async function listBetaInvitesForAdmin(clerkUserId) {
  const { db } = await requireInternalAdmin(clerkUserId, SUPER_ONLY)
  const result = await db.query(
    `select ${inviteProjection('b')} from beta_invites b order by b.created_at desc`,
  )
  return { betaInvites: result.rows }
}

export async function createBetaInviteForAdmin(clerkUserId, payload = {}) {
  const { db, user } = await requireInternalAdmin(clerkUserId, SUPER_ONLY)
  const email = normalizeEmail(payload.email)
  const note = normalizeNote(payload.note)
  const expiresDays = normalizeExpiresDays(payload.expiresDays)
  const token = generateInviteToken()

  const inserted = await db.query(
    `
      insert into beta_invites (email, note, invite_token, expires_at, created_by)
      values ($1, $2, $3, now() + make_interval(days => $4), $5)
      returning id
    `,
    [email, note, token, expiresDays, user.id],
  )

  const invite = await readInviteById(db, inserted.rows[0].id)

  await writeAuditLog(db, {
    action: 'beta_invite.created',
    entityType: 'beta_invite',
    entityId: invite.id,
    actorUserId: user.id,
    after: { email, note },
  })

  // Email the link only when bound to an address; open links stay copy-only.
  let emailSent = false
  let emailError = null
  if (email) {
    const result = await sendBetaInviteEmail(email, token, payload.siteUrl)
    emailSent = result.sent
    emailError = result.error
  }

  return { invite, emailSent, emailError }
}

export async function revokeBetaInviteForAdmin(clerkUserId, inviteId) {
  const { db, user } = await requireInternalAdmin(clerkUserId, SUPER_ONLY)
  const normalizedId = normalizeUuid(inviteId, 'INVALID_BETA_INVITE_ID', 'Beta invite id must be a UUID.')

  const result = await db.query(
    `update beta_invites set revoked_at = coalesce(revoked_at, now()) where id = $1 returning id`,
    [normalizedId],
  )

  if (!result.rows[0]) {
    throw createHttpError(404, 'BETA_INVITE_NOT_FOUND', 'Beta link was not found.', true)
  }

  const invite = await readInviteById(db, normalizedId)

  await writeAuditLog(db, {
    action: 'beta_invite.revoked',
    entityType: 'beta_invite',
    entityId: normalizedId,
    actorUserId: user.id,
  })

  return { invite }
}

export async function redeemBetaInviteForCurrentUser(clerkUserId, payload = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDbOrThrow()
  const token = typeof payload?.token === 'string' ? payload.token.trim() : ''

  if (!token) {
    throw createHttpError(400, 'INVALID_BETA_TOKEN', 'A beta link token is required.', true)
  }

  const invite = await readInviteByToken(db, token)

  if (!invite) {
    throw createHttpError(404, 'BETA_INVITE_NOT_FOUND', 'This beta link is not valid.', true)
  }
  if (invite.revokedAt) {
    throw createHttpError(409, 'BETA_INVITE_REVOKED', 'This beta link has been revoked.', true)
  }
  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    throw createHttpError(409, 'BETA_INVITE_EXPIRED', 'This beta link has expired.', true)
  }
  // Already claimed by someone else.
  if (invite.usedAt && invite.usedBy && invite.usedBy !== user.id) {
    throw createHttpError(409, 'BETA_INVITE_USED', 'This beta link has already been used.', true)
  }
  // Bound links must match the signed-in user's verified email.
  if (invite.email && invite.email.toLowerCase() !== (user.email || '').toLowerCase()) {
    throw createHttpError(
      403,
      'BETA_EMAIL_MISMATCH',
      `This beta link was issued to ${invite.email}. Sign in with that email to redeem it.`,
      true,
    )
  }

  // Provision (idempotent: returns the existing owned household if any), THEN
  // stamp the link used. This ordering means the user always ends up with a
  // household even if the stamp races; a re-redeem is a no-op.
  const provision = await createHouseholdForCurrentUser(clerkUserId, {})

  await db.query(
    `
      update beta_invites
      set used_at = coalesce(used_at, now()), used_by = coalesce(used_by, $2)
      where id = $1 and used_at is null
    `,
    [invite.id, user.id],
  )

  await writeAuditLog(db, {
    action: 'beta_invite.redeemed',
    entityType: 'beta_invite',
    entityId: invite.id,
    actorUserId: user.id,
    householdId: provision.household?.id ?? null,
    after: { householdId: provision.household?.id ?? null },
  })

  return {
    redeemed: true,
    household: provision.household,
    membership: provision.membership,
  }
}
