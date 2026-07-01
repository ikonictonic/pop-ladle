import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'
import {
  createHttpError,
  normalizeUuid,
  requireHouseholdRole,
  requireHouseholdCapability,
} from '../households/householdAccess.js'

// =============================================================================
// recipe-relationships — server port of the Supabase recipeRelationshipService
// + recipePairingService.
//
//   * Master flag/note/count live on the recipe_adaptations row.
//   * Directed edges (planned_over) and symmetric pairs (pairs_well_with) live
//     in recipe_relationships. Pairs are normalized (source < target) on write
//     so the unique index rejects symmetric duplicates; reads use an OR match.
//
// Access control mirrors recipeService.js: reads gate on the 'view' capability
// (PDP, Phase 3), writes gate on the same owner role-set as recipe writes with
// the shadow hook wired in.
// =============================================================================

const RELATIONSHIP_WRITE_ROLES = ['owner', 'co_owner', 'caregiver']

const REL_PLANNED_OVER = 'planned_over'
const REL_PAIRS_WELL_WITH = 'pairs_well_with'
const REL_VARIATION_OF = 'variation_of'

const LINKABLE_PEERS_LIMIT = 200
const PAIRING_SUGGESTION_LIMIT = 6
const PAIRING_CANDIDATE_LIMIT = 50
const MAX_SEARCH_LENGTH = 120
const MAX_NOTE_LENGTH = 500

const UNIQUE_VIOLATION = '23505'

function normalizeRecipeId(value) {
  return normalizeUuid(value, 'INVALID_RECIPE_ID', 'Recipe id must be a UUID.')
}

function normalizeRelationshipId(value) {
  return normalizeUuid(value, 'INVALID_RELATIONSHIP_ID', 'Relationship id must be a UUID.')
}

function normalizeTargetRecipeId(value) {
  return normalizeUuid(value, 'INVALID_TARGET_RECIPE_ID', 'targetRecipeId must be a UUID.')
}

function assertObjectBody(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
}

function requireDatabase() {
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }
  return db
}

function normalizeBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw createHttpError(400, 'INVALID_BOOLEAN', `${fieldName} must be a boolean.`, true)
  }
  return value
}

function normalizeOptionalNote(value) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') {
    throw createHttpError(400, 'INVALID_MASTER_NOTE', 'masterNote must be a string.', true)
  }
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > MAX_NOTE_LENGTH) {
    throw createHttpError(
      400,
      'INVALID_MASTER_NOTE',
      `masterNote must be ${MAX_NOTE_LENGTH} characters or fewer.`,
      true,
    )
  }
  return trimmed
}

function normalizeOptionalCount(value) {
  if (value === undefined || value === null || value === '') return null
  const numberValue = Number(value)
  if (!Number.isInteger(numberValue) || numberValue < 0) {
    throw createHttpError(
      400,
      'INVALID_PLANNED_OVER_COUNT',
      'plannedOverCount must be a non-negative integer.',
      true,
    )
  }
  return numberValue
}

function normalizeRelationshipType(value) {
  const type = typeof value === 'string' ? value.trim() : ''
  // Pairings own their own normalized path; this directed-edge endpoint only
  // accepts directed types.
  if (![REL_PLANNED_OVER, REL_VARIATION_OF].includes(type)) {
    throw createHttpError(
      400,
      'INVALID_RELATIONSHIP_TYPE',
      `relationshipType must be one of: ${[REL_PLANNED_OVER, REL_VARIATION_OF].join(', ')}.`,
      true,
    )
  }
  return type
}

function normalizeSearch(value) {
  const search = typeof value === 'string' ? value.trim() : ''
  if (search.length > MAX_SEARCH_LENGTH) {
    throw createHttpError(
      400,
      'INVALID_RECIPE_SEARCH',
      `Search must be ${MAX_SEARCH_LENGTH} characters or fewer.`,
      true,
    )
  }
  return search || null
}

// Light recipe projection shared by every relationship read (peer/target/source
// display rows). Keeps parity with the fields the Supabase services embedded.
// The id is aliased "relatedRecipeId" so it never collides with the relationship
// row's own `id` in the same SELECT.
function peerProjection(alias) {
  return `
    ${alias}.id as "relatedRecipeId",
    ${alias}.title as "relatedTitle",
    ${alias}.photo_url as "relatedPhotoUrl",
    ${alias}.target_servings as "relatedTargetServings",
    ${alias}.generation_mode as "relatedGenerationMode",
    ${alias}.current_version_label as "relatedCurrentVersionLabel",
    ${alias}.clinical_review_status as "relatedClinicalReviewStatus",
    ${alias}.is_master_recipe as "relatedIsMasterRecipe",
    ${alias}.saved_at as "relatedSavedAt"
  `
}

function shapeRelatedRecipe(row) {
  return {
    id: row.relatedRecipeId,
    title: row.relatedTitle,
    photoUrl: row.relatedPhotoUrl,
    targetServings: row.relatedTargetServings,
    generationMode: row.relatedGenerationMode,
    currentVersionLabel: row.relatedCurrentVersionLabel,
    clinicalReviewStatus: row.relatedClinicalReviewStatus,
    isMasterRecipe: row.relatedIsMasterRecipe,
    savedAt: row.relatedSavedAt,
  }
}

async function readRecipeRow(db, householdId, recipeId) {
  const result = await db.query(
    `
      select
        ra.id,
        ra.household_id as "householdId",
        ra.meal_slots as "mealSlots",
        ra.recipe_categories as "recipeCategories",
        ra.is_master_recipe as "isMasterRecipe",
        ra.master_recipe_note as "masterRecipeNote",
        ra.planned_over_count as "plannedOverCount",
        ra.saved_at as "savedAt",
        ra.deleted_at as "deletedAt"
      from recipe_adaptations ra
      where ra.id = $1
        and ra.household_id = $2
        and ra.deleted_at is null
      limit 1
    `,
    [recipeId, householdId],
  )
  return result.rows[0] ?? null
}

async function requireRecipe(db, householdId, recipeId) {
  const recipe = await readRecipeRow(db, householdId, recipeId)
  if (!recipe) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
  }
  return recipe
}

// ---------------------------------------------------------------------------
// Master flag / note / count
// ---------------------------------------------------------------------------

export async function setMasterRecipeForCurrentUser(clerkUserId, householdId, recipeId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = requireDatabase()

  assertObjectBody(payload)
  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const isMaster = normalizeBoolean(payload.isMaster, 'isMaster')
  const masterNote = normalizeOptionalNote(payload.masterNote)
  const plannedOverCount = normalizeOptionalCount(payload.plannedOverCount)

  const access = await requireHouseholdRole(db, user.id, householdId, RELATIONSHIP_WRITE_ROLES, {
    action: 'recipe:update',
    resourceType: 'recipe',
    label: 'recipe:master',
  })

  await requireRecipe(db, access.household.id, normalizedRecipeId)

  const result = await db.query(
    `
      update recipe_adaptations
      set
        is_master_recipe = $3,
        master_recipe_note = $4,
        planned_over_count = $5,
        updated_by = $6,
        updated_at = now()
      where id = $1
        and household_id = $2
        and deleted_at is null
      returning
        id,
        household_id as "householdId",
        title,
        is_master_recipe as "isMasterRecipe",
        master_recipe_note as "masterRecipeNote",
        planned_over_count as "plannedOverCount"
    `,
    [normalizedRecipeId, access.household.id, isMaster, masterNote, plannedOverCount, user.id],
  )

  const recipe = result.rows[0] ?? null
  if (!recipe) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
  }

  await writeAuditLog(db, {
    action: 'recipe.master_flag_set',
    entityType: 'recipe_adaptation',
    entityId: normalizedRecipeId,
    actorUserId: user.id,
    householdId: access.household.id,
    after: { isMasterRecipe: isMaster, plannedOverCount },
  })

  return { recipe }
}

// ---------------------------------------------------------------------------
// Directed relationships (planned_over, variation_of)
// ---------------------------------------------------------------------------

export async function listRelationshipsForCurrentUser(clerkUserId, householdId, recipeId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = requireDatabase()

  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', {
    resourceType: 'recipe',
  })

  await requireRecipe(db, access.household.id, normalizedRecipeId)

  const [outboundResult, inboundResult] = await Promise.all([
    db.query(
      `
        select
          rr.id,
          rr.relationship_type as "relationshipType",
          rr.note,
          rr.created_at as "createdAt",
          ${peerProjection('target')}
        from recipe_relationships rr
        join recipe_adaptations target
          on target.id = rr.target_recipe_id
         and target.deleted_at is null
        where rr.household_id = $1
          and rr.source_recipe_id = $2
          and rr.relationship_type <> $3
        order by rr.created_at asc
      `,
      [access.household.id, normalizedRecipeId, REL_PAIRS_WELL_WITH],
    ),
    db.query(
      `
        select
          rr.id,
          rr.relationship_type as "relationshipType",
          rr.note,
          rr.created_at as "createdAt",
          ${peerProjection('source')}
        from recipe_relationships rr
        join recipe_adaptations source
          on source.id = rr.source_recipe_id
         and source.deleted_at is null
        where rr.household_id = $1
          and rr.target_recipe_id = $2
          and rr.relationship_type <> $3
        order by rr.created_at asc
      `,
      [access.household.id, normalizedRecipeId, REL_PAIRS_WELL_WITH],
    ),
  ])

  return {
    outbound: outboundResult.rows.map(shapeDirectedRow),
    inbound: inboundResult.rows.map(shapeDirectedRow),
  }
}

function shapeDirectedRow(row) {
  const recipe = shapeRelatedRecipe(row)
  return {
    id: row.id,
    relatedRecipeId: recipe.id,
    relatedTitle: recipe.title,
    relationshipType: row.relationshipType,
    note: row.note,
    createdAt: row.createdAt,
    recipe,
  }
}

export async function createRelationshipForCurrentUser(clerkUserId, householdId, recipeId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = requireDatabase()

  assertObjectBody(payload)
  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const targetRecipeId = normalizeTargetRecipeId(payload.targetRecipeId)
  const relationshipType = normalizeRelationshipType(payload.relationshipType)

  if (normalizedRecipeId === targetRecipeId) {
    throw createHttpError(400, 'INVALID_RELATIONSHIP', 'A recipe cannot relate to itself.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, RELATIONSHIP_WRITE_ROLES, {
    action: 'recipe:update',
    resourceType: 'recipe',
    label: 'recipe:relationship',
  })

  // Both endpoints of the edge must be real, non-deleted recipes in this household.
  await requireRecipe(db, access.household.id, normalizedRecipeId)
  await requireRecipe(db, access.household.id, targetRecipeId)

  const relationship = await insertRelationship(db, {
    householdId: access.household.id,
    sourceRecipeId: normalizedRecipeId,
    targetRecipeId,
    relationshipType,
    createdBy: user.id,
  })

  return { relationship }
}

// Idempotent insert: a duplicate edge (unique index) is a no-op that returns the
// existing row, matching the Supabase 23505 → null contract but surfacing the row
// so the client always gets a usable relationship.
async function insertRelationship(db, { householdId, sourceRecipeId, targetRecipeId, relationshipType, createdBy, note = null }) {
  try {
    const result = await db.query(
      `
        insert into recipe_relationships (
          household_id, source_recipe_id, target_recipe_id, relationship_type, note, created_by
        )
        values ($1, $2, $3, $4, $5, $6)
        returning
          id,
          household_id as "householdId",
          source_recipe_id as "sourceRecipeId",
          target_recipe_id as "targetRecipeId",
          relationship_type as "relationshipType",
          note,
          created_at as "createdAt"
      `,
      [householdId, sourceRecipeId, targetRecipeId, relationshipType, note, createdBy],
    )
    return result.rows[0]
  } catch (err) {
    if (err?.code !== UNIQUE_VIOLATION) throw err
    const existing = await db.query(
      `
        select
          id,
          household_id as "householdId",
          source_recipe_id as "sourceRecipeId",
          target_recipe_id as "targetRecipeId",
          relationship_type as "relationshipType",
          note,
          created_at as "createdAt"
        from recipe_relationships
        where household_id = $1
          and source_recipe_id = $2
          and target_recipe_id = $3
          and relationship_type = $4
        limit 1
      `,
      [householdId, sourceRecipeId, targetRecipeId, relationshipType],
    )
    return existing.rows[0] ?? null
  }
}

export async function deleteRelationshipForCurrentUser(clerkUserId, householdId, recipeId, relationshipId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = requireDatabase()

  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const normalizedRelationshipId = normalizeRelationshipId(relationshipId)

  const access = await requireHouseholdRole(db, user.id, householdId, RELATIONSHIP_WRITE_ROLES, {
    action: 'recipe:update',
    resourceType: 'recipe',
    label: 'recipe:relationship',
  })

  // Scope the delete to this recipe (either endpoint) so callers can only remove
  // edges touching a recipe they addressed.
  const result = await db.query(
    `
      delete from recipe_relationships
      where id = $1
        and household_id = $2
        and (source_recipe_id = $3 or target_recipe_id = $3)
      returning id
    `,
    [normalizedRelationshipId, access.household.id, normalizedRecipeId],
  )

  if (result.rowCount === 0) {
    throw createHttpError(404, 'RELATIONSHIP_NOT_FOUND', 'Relationship was not found.', true)
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Linkable peers (picker)
// ---------------------------------------------------------------------------

export async function listLinkablePeersForCurrentUser(clerkUserId, householdId, recipeId, query = {}) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = requireDatabase()

  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const search = normalizeSearch(query.search)

  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', {
    resourceType: 'recipe',
  })

  const result = await db.query(
    `
      select
        ${peerProjection('ra')}
      from recipe_adaptations ra
      where ra.household_id = $1
        and ra.deleted_at is null
        and ra.saved_at is not null
        and ra.id <> $2
        and ($3::text is null or ra.title ilike '%' || $3 || '%')
      order by ra.saved_at desc
      limit $4
    `,
    [access.household.id, normalizedRecipeId, search, LINKABLE_PEERS_LIMIT],
  )

  return { peers: result.rows.map(shapeRelatedRecipe) }
}

// ---------------------------------------------------------------------------
// Pairings (symmetric pairs_well_with)
// ---------------------------------------------------------------------------

function orderPair(a, b) {
  return a < b ? [a, b] : [b, a]
}

export async function listPairingsForCurrentUser(clerkUserId, householdId, recipeId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = requireDatabase()

  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', {
    resourceType: 'recipe',
  })

  await requireRecipe(db, access.household.id, normalizedRecipeId)

  const pairings = await readPairings(db, access.household.id, normalizedRecipeId)
  return { pairings }
}

// Peer-normalized read: the recipe can be on either side of the stored (source,
// target) row, so match both and project the OTHER side as the peer.
async function readPairings(db, householdId, recipeId) {
  const result = await db.query(
    `
      select
        rr.id,
        rr.note,
        rr.created_at as "createdAt",
        rr.source_recipe_id as "sourceRecipeId",
        rr.target_recipe_id as "targetRecipeId",
        ${peerProjection('peer')}
      from recipe_relationships rr
      join recipe_adaptations peer
        on peer.id = case
             when rr.source_recipe_id = $2 then rr.target_recipe_id
             else rr.source_recipe_id
           end
       and peer.deleted_at is null
      where rr.household_id = $1
        and rr.relationship_type = $3
        and (rr.source_recipe_id = $2 or rr.target_recipe_id = $2)
      order by rr.created_at asc
    `,
    [householdId, recipeId, REL_PAIRS_WELL_WITH],
  )

  return result.rows.map(shapePairingRow)
}

function shapePairingRow(row) {
  return {
    id: row.id,
    note: row.note,
    createdAt: row.createdAt,
    peer: shapeRelatedRecipe(row),
  }
}

export async function createPairingForCurrentUser(clerkUserId, householdId, recipeId, payload) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = requireDatabase()

  assertObjectBody(payload)
  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const targetRecipeId = normalizeTargetRecipeId(payload.targetRecipeId)

  if (normalizedRecipeId === targetRecipeId) {
    throw createHttpError(400, 'INVALID_PAIRING', 'A recipe cannot pair with itself.', true)
  }

  const access = await requireHouseholdRole(db, user.id, householdId, RELATIONSHIP_WRITE_ROLES, {
    action: 'recipe:update',
    resourceType: 'recipe',
    label: 'recipe:pairing',
  })

  await requireRecipe(db, access.household.id, normalizedRecipeId)
  await requireRecipe(db, access.household.id, targetRecipeId)

  // Normalize the pair (source < target) so symmetric duplicates collide on the
  // unique index regardless of which side the caller addressed.
  const [sourceRecipeId, orderedTargetId] = orderPair(normalizedRecipeId, targetRecipeId)

  const pairing = await insertRelationship(db, {
    householdId: access.household.id,
    sourceRecipeId,
    targetRecipeId: orderedTargetId,
    relationshipType: REL_PAIRS_WELL_WITH,
    createdBy: user.id,
  })

  return { pairing }
}

export async function deletePairingForCurrentUser(clerkUserId, householdId, recipeId, targetRecipeId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = requireDatabase()

  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const normalizedTargetId = normalizeTargetRecipeId(targetRecipeId)

  const access = await requireHouseholdRole(db, user.id, householdId, RELATIONSHIP_WRITE_ROLES, {
    action: 'recipe:update',
    resourceType: 'recipe',
    label: 'recipe:pairing',
  })

  const [sourceRecipeId, orderedTargetId] = orderPair(normalizedRecipeId, normalizedTargetId)

  const result = await db.query(
    `
      delete from recipe_relationships
      where household_id = $1
        and relationship_type = $2
        and source_recipe_id = $3
        and target_recipe_id = $4
      returning id
    `,
    [access.household.id, REL_PAIRS_WELL_WITH, sourceRecipeId, orderedTargetId],
  )

  if (result.rowCount === 0) {
    throw createHttpError(404, 'PAIRING_NOT_FOUND', 'Pairing was not found.', true)
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Pairing suggestions
// ---------------------------------------------------------------------------

export async function suggestPairingsForCurrentUser(clerkUserId, householdId, recipeId) {
  const user = await getCurrentAppUser(clerkUserId)
  const db = requireDatabase()

  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', {
    resourceType: 'recipe',
  })

  const seed = await requireRecipe(db, access.household.id, normalizedRecipeId)
  const seedSlots = Array.isArray(seed.mealSlots) ? seed.mealSlots : []
  const seedCats = Array.isArray(seed.recipeCategories) ? seed.recipeCategories : []

  // No taxonomy overlap to rank on → no suggestions (parity with the client).
  if (seedSlots.length === 0 && seedCats.length === 0) {
    return { suggestions: [] }
  }

  // Exclude self + already-paired peers.
  const existing = await readPairings(db, access.household.id, normalizedRecipeId)
  const excludeIds = new Set([normalizedRecipeId, ...existing.map((p) => p.peer?.id).filter(Boolean)])

  const result = await db.query(
    `
      select
        ra.id,
        ra.title,
        ra.photo_url as "photoUrl",
        ra.target_servings as "targetServings",
        ra.generation_mode as "generationMode",
        ra.current_version_label as "currentVersionLabel",
        ra.clinical_review_status as "clinicalReviewStatus",
        ra.is_master_recipe as "isMasterRecipe",
        ra.saved_at as "savedAt",
        ra.meal_slots as "mealSlots",
        ra.recipe_categories as "recipeCategories"
      from recipe_adaptations ra
      where ra.household_id = $1
        and ra.deleted_at is null
        and ra.saved_at is not null
        and ra.id <> $2
        and coalesce(ra.clinical_review_status, '') <> 'denied'
        and (
          ($3::text[] is not null and ra.meal_slots && $3::text[])
          or ($4::text[] is not null and ra.recipe_categories && $4::text[])
        )
      order by ra.saved_at desc
      limit $5
    `,
    [
      access.household.id,
      normalizedRecipeId,
      seedSlots.length > 0 ? seedSlots : null,
      seedCats.length > 0 ? seedCats : null,
      PAIRING_CANDIDATE_LIMIT,
    ],
  )

  const ranked = result.rows
    .filter((r) => !excludeIds.has(r.id))
    .map((r) => ({
      recipe: r,
      score:
        cleanStatusScore(r.clinicalReviewStatus) * 10 +
        overlapCount(r.mealSlots, seedSlots) +
        overlapCount(r.recipeCategories, seedCats),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, PAIRING_SUGGESTION_LIMIT)
    .map(({ recipe }) => ({
      id: recipe.id,
      title: recipe.title,
      photoUrl: recipe.photoUrl,
      targetServings: recipe.targetServings,
      generationMode: recipe.generationMode,
      currentVersionLabel: recipe.currentVersionLabel,
      clinicalReviewStatus: recipe.clinicalReviewStatus,
      isMasterRecipe: recipe.isMasterRecipe,
      savedAt: recipe.savedAt,
      mealSlots: recipe.mealSlots,
      recipeCategories: recipe.recipeCategories,
    }))

  return { suggestions: ranked }
}

function cleanStatusScore(status) {
  if (status === 'not_required' || status === 'approved') return 3
  if (status === 'approved_with_caveats') return 2
  if (status === 'needs_review') return 1
  return 0
}

function overlapCount(candidate, seed) {
  if (!Array.isArray(candidate)) return 0
  let n = 0
  for (const item of candidate) if (seed.includes(item)) n += 1
  return n
}
