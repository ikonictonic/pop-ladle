const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function createHttpError(statusCode, code, message, expose = true) {
  const err = new Error(message)
  err.statusCode = statusCode
  err.code = code
  err.expose = expose
  return err
}

export function normalizeHouseholdId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw createHttpError(400, 'INVALID_HOUSEHOLD_ID', 'Household id must be a UUID.', true)
  }

  return value.toLowerCase()
}

export async function requireHouseholdRole(db, userId, householdId, allowedRoles) {
  const normalizedHouseholdId = normalizeHouseholdId(householdId)
  const result = await db.query(
    `
      select
        h.id as "householdId",
        h.name as "householdName",
        h.status as "householdStatus",
        hm.id as "membershipId",
        hm.role,
        hm.status as "membershipStatus",
        hm.accepted_at as "acceptedAt"
      from households h
      left join household_members hm
        on hm.household_id = h.id
       and hm.user_id = $2
       and hm.status = 'accepted'
      where h.id = $1
        and h.status = 'active'
      limit 1
    `,
    [normalizedHouseholdId, userId],
  )

  const access = result.rows[0]

  if (!access) {
    throw createHttpError(404, 'HOUSEHOLD_NOT_FOUND', 'Household was not found.', true)
  }

  if (!access.membershipId) {
    throw createHttpError(403, 'HOUSEHOLD_ACCESS_DENIED', 'You do not have access to this household.', true)
  }

  if (!allowedRoles.includes(access.role)) {
    throw createHttpError(
      403,
      'HOUSEHOLD_ROLE_REQUIRED',
      `This action requires one of these household roles: ${allowedRoles.join(', ')}.`,
      true,
    )
  }

  return {
    household: {
      id: access.householdId,
      name: access.householdName,
      status: access.householdStatus,
    },
    membership: {
      id: access.membershipId,
      role: access.role,
      status: access.membershipStatus,
      acceptedAt: access.acceptedAt,
    },
  }
}
