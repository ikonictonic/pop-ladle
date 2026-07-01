/**
 * Hydration tracking (Application Brain A8).
 *
 * Per-care-recipient fluid logging against the daily goal stored in the Care
 * Profile (profile_data.dailyLimits.fluidMl / hydrationRules.dailyGoalMl). The
 * caregiver logs intake on the recipient's behalf. Available on every plan tier;
 * view = all roles, log = owner/co-owner/caregiver.
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
  requireHouseholdCapability,
} from '../households/householdAccess.js'

const VIEW_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']
const LOG_ROLES = ['owner', 'co_owner', 'caregiver']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_AMOUNT = 5000
const MAX_BEVERAGE = 80
const MAX_NOTES = 500

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeDate(value) {
  const v = normalizeText(value)
  if (!DATE_RE.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) {
    throw createHttpError(400, 'INVALID_DATE', 'date must be a valid YYYY-MM-DD date.', true)
  }
  return v
}

function firstDefined(...values) {
  for (const v of values) if (v !== undefined && v !== null) return v
  return null
}

// Extract the daily fluid goal (ml) from the structured Care Profile, mirroring
// the path recipe-brain uses. Returns null when no goal is set.
function extractFluidGoalMl(profileData = {}) {
  const dailyLimits = profileData?.dailyLimits ?? {}
  const hydrationRules = profileData?.hydrationRules ?? {}
  const goal = firstDefined(dailyLimits.fluidMl, dailyLimits.fluid_ml, hydrationRules.dailyGoalMl)
  const n = Number(goal)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

async function loadCareRecipientWithGoal(db, householdId, careRecipientId) {
  const result = await db.query(
    `
      select cr.id, cr.display_name as "displayName", cp.profile_data as "profileData"
      from care_recipients cr
      left join care_profiles cp on cp.care_recipient_id = cr.id
      where cr.id = $1 and cr.household_id = $2 and cr.status = 'active'
      limit 1
    `,
    [careRecipientId, householdId],
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'CARE_RECIPIENT_NOT_FOUND', 'Care recipient was not found for this household.', true)
  }
  const row = result.rows[0]
  return {
    id: row.id,
    displayName: row.displayName,
    goalMl: extractFluidGoalMl(row.profileData ?? {}),
  }
}

export async function getHydrationDayForCurrentUser(clerkUserId, householdId, careRecipientId, query = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedCareRecipientId = normalizeUuid(careRecipientId, 'INVALID_CARE_RECIPIENT_ID', 'careRecipientId must be a UUID.')
  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', { resourceType: 'hydration' })
  const careRecipient = await loadCareRecipientWithGoal(db, access.household.id, normalizedCareRecipientId)

  const date = query.date ? normalizeDate(query.date) : new Date().toISOString().slice(0, 10)

  const logs = await db.query(
    `
      select
        id, amount_ml as "amountMl", beverage, notes,
        logged_at as "loggedAt", logged_by as "loggedBy"
      from hydration_logs
      where care_recipient_id = $1 and log_date = $2::date
      order by logged_at desc
    `,
    [normalizedCareRecipientId, date],
  )

  const totalMl = logs.rows.reduce((sum, r) => sum + r.amountMl, 0)
  const goalMl = careRecipient.goalMl
  const remainingMl = goalMl !== null ? Math.max(goalMl - totalMl, 0) : null
  const percentOfGoal = goalMl !== null && goalMl > 0 ? Math.round((totalMl / goalMl) * 100) : null

  return {
    household: access.household,
    requester: access.membership,
    careRecipient: { id: careRecipient.id, displayName: careRecipient.displayName },
    date,
    goalMl,
    totalMl,
    remainingMl,
    percentOfGoal,
    goalMet: goalMl !== null ? totalMl >= goalMl : null,
    logs: logs.rows,
  }
}

function normalizeLogPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const amountMl = Number(payload.amountMl)
  if (!Number.isInteger(amountMl) || amountMl <= 0 || amountMl > MAX_AMOUNT) {
    throw createHttpError(400, 'INVALID_AMOUNT', `amountMl must be an integer between 1 and ${MAX_AMOUNT}.`, true)
  }

  const beverage = normalizeText(payload.beverage)
  if (beverage.length > MAX_BEVERAGE) {
    throw createHttpError(400, 'INVALID_BEVERAGE', `beverage must be ${MAX_BEVERAGE} characters or fewer.`, true)
  }
  const notes = normalizeText(payload.notes)
  if (notes.length > MAX_NOTES) {
    throw createHttpError(400, 'INVALID_NOTES', `notes must be ${MAX_NOTES} characters or fewer.`, true)
  }

  // Optional explicit timestamp (e.g. logging a drink from earlier). Defaults to now.
  let loggedAt = null
  if (payload.loggedAt !== undefined && payload.loggedAt !== null && payload.loggedAt !== '') {
    const t = new Date(payload.loggedAt)
    if (Number.isNaN(t.getTime())) {
      throw createHttpError(400, 'INVALID_TIMESTAMP', 'loggedAt must be an ISO timestamp.', true)
    }
    loggedAt = t.toISOString()
  }

  return { amountMl, beverage: beverage || null, notes: notes || null, loggedAt }
}

export async function logHydrationForCurrentUser(clerkUserId, householdId, careRecipientId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedCareRecipientId = normalizeUuid(careRecipientId, 'INVALID_CARE_RECIPIENT_ID', 'careRecipientId must be a UUID.')
  const entry = normalizeLogPayload(payload)
  const access = await requireHouseholdRole(db, user.id, householdId, LOG_ROLES, {
    action: 'hydration:log',
    resourceType: 'hydration',
    label: 'hydration:log',
  })
  const careRecipient = await loadCareRecipientWithGoal(db, access.household.id, normalizedCareRecipientId)

  // log_date follows logged_at's UTC date (default handles the now() case).
  const result = await db.query(
    `
      insert into hydration_logs (
        household_id, care_recipient_id, amount_ml, beverage, notes, logged_by,
        logged_at, log_date
      )
      values (
        $1, $2, $3, $4, $5, $6,
        coalesce($7::timestamptz, now()),
        (coalesce($7::timestamptz, now()) at time zone 'utc')::date
      )
      returning id, amount_ml as "amountMl", beverage, notes,
                logged_at as "loggedAt", log_date as "logDate", logged_by as "loggedBy"
    `,
    [
      access.household.id, normalizedCareRecipientId, entry.amountMl,
      entry.beverage, entry.notes, user.id, entry.loggedAt,
    ],
  )
  const log = result.rows[0]

  // Return the running day total so the UI can update the ring in one round-trip.
  const dayTotal = await db.query(
    `select coalesce(sum(amount_ml), 0)::int as "totalMl" from hydration_logs where care_recipient_id = $1 and log_date = $2::date`,
    [normalizedCareRecipientId, log.logDate],
  )
  const totalMl = dayTotal.rows[0].totalMl
  const goalMl = careRecipient.goalMl

  return {
    household: access.household,
    requester: access.membership,
    log,
    dayTotalMl: totalMl,
    goalMl,
    goalMet: goalMl !== null ? totalMl >= goalMl : null,
  }
}

export async function removeHydrationLogForCurrentUser(clerkUserId, householdId, logId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = getDatabasePool()
  if (!db) throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)

  const normalizedLogId = normalizeUuid(logId, 'INVALID_LOG_ID', 'Hydration log id must be a UUID.')
  const access = await requireHouseholdRole(db, user.id, householdId, LOG_ROLES, {
    action: 'hydration:log',
    resourceType: 'hydration',
    label: 'hydration:log',
  })

  const result = await db.query(
    `delete from hydration_logs where id = $1 and household_id = $2 returning id`,
    [normalizedLogId, access.household.id],
  )
  if (result.rows.length === 0) {
    throw createHttpError(404, 'HYDRATION_LOG_NOT_FOUND', 'Hydration log was not found.', true)
  }

  return { deleted: true, household: access.household, requester: access.membership, logId: normalizedLogId }
}
