/**
 * Recipe photo lifecycle on top of object storage (private bucket + presigned
 * URLs). Flow:
 *   1. requestUpload  -> issue a presigned PUT URL (nothing persisted yet)
 *   2. client PUTs the file straight to the bucket
 *   3. confirmUpload  -> persist photo_storage_path, drop the previous object
 *   4. getPhotoUrl    -> short-lived presigned GET URL for viewing
 *   5. removePhoto    -> delete the object and clear the columns
 *
 * Storage key is namespaced per household + recipe so a confirm can only point
 * at an object inside this recipe's own prefix.
 */

import { randomUUID } from 'node:crypto'
import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { writeAuditLog } from '../audit-log/auditLogService.js'
import { createHttpError, requireHouseholdRole, requireHouseholdCapability } from '../households/householdAccess.js'
import { readRecipeById } from './recipeService.js'
import {
  isStorageConfigured,
  createPresignedUploadUrl,
  createPresignedDownloadUrl,
  deleteObject,
  headObject,
} from '../../integrations/storage/storageClient.js'

const RECIPE_READ_ROLES = ['owner', 'co_owner', 'caregiver', 'viewer']
const RECIPE_WRITE_ROLES = ['owner', 'co_owner', 'caregiver']

const CONTENT_TYPE_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const MAX_PHOTO_BYTES = 10 * 1024 * 1024 // 10 MB
const UPLOAD_URL_TTL_SECONDS = 300
const DOWNLOAD_URL_TTL_SECONDS = 900

function normalizeRecipeId(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw createHttpError(400, 'INVALID_RECIPE_ID', 'Recipe id must be a UUID.', true)
  }
  return id
}

function assertStorageConfigured() {
  if (!isStorageConfigured()) {
    throw createHttpError(503, 'STORAGE_NOT_CONFIGURED', 'Object storage is not configured.', true)
  }
}

function photoPrefix(householdId, recipeId) {
  return `households/${householdId}/recipes/${recipeId}/`
}

function getDb() {
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }
  return db
}

async function loadRecipeForWrite(db, clerkUserId, householdId, recipeId) {
  const user = await getCurrentAppUser(clerkUserId)
  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const access = await requireHouseholdRole(db, user.id, householdId, RECIPE_WRITE_ROLES, {
    action: 'recipe:edit_content',
    resourceType: 'recipe',
    label: 'recipe:photo-write',
  })
  const recipe = await readRecipeById(db, access.household.id, normalizedRecipeId)
  if (!recipe) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
  }
  return { user, access, recipe, recipeId: normalizedRecipeId }
}

/** Step 1 — issue a presigned PUT URL. Validates type + reported size. */
export async function requestRecipePhotoUpload(clerkUserId, householdId, recipeId, payload) {
  assertStorageConfigured()
  const db = getDb()

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }

  const contentType = typeof payload.contentType === 'string' ? payload.contentType.trim().toLowerCase() : ''
  const ext = CONTENT_TYPE_EXT[contentType]
  if (!ext) {
    throw createHttpError(
      400,
      'UNSUPPORTED_IMAGE_TYPE',
      `contentType must be one of: ${Object.keys(CONTENT_TYPE_EXT).join(', ')}.`,
      true,
    )
  }

  const fileSize = Number(payload.fileSize)
  if (!Number.isInteger(fileSize) || fileSize <= 0) {
    throw createHttpError(400, 'INVALID_FILE_SIZE', 'fileSize must be a positive integer (bytes).', true)
  }
  if (fileSize > MAX_PHOTO_BYTES) {
    throw createHttpError(413, 'FILE_TOO_LARGE', `Image exceeds the ${MAX_PHOTO_BYTES} byte limit.`, true)
  }

  const { access, recipeId: normalizedRecipeId } = await loadRecipeForWrite(db, clerkUserId, householdId, recipeId)

  const storagePath = `${photoPrefix(access.household.id, normalizedRecipeId)}${randomUUID()}.${ext}`
  const uploadUrl = await createPresignedUploadUrl({
    key: storagePath,
    contentType,
    expiresIn: UPLOAD_URL_TTL_SECONDS,
  })

  return {
    household: access.household,
    requester: access.membership,
    upload: {
      uploadUrl,
      method: 'PUT',
      storagePath,
      headers: { 'Content-Type': contentType },
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    },
  }
}

async function setPhotoStoragePath(db, householdId, recipeId, userId, storagePath) {
  const result = await db.query(
    `
      update recipe_adaptations
      set photo_storage_path = $4, photo_url = null, updated_by = $3, updated_at = now()
      where id = $1 and household_id = $2 and deleted_at is null
      returning id, photo_storage_path as "photoStoragePath"
    `,
    [recipeId, householdId, userId, storagePath],
  )
  return result.rows[0] ?? null
}

/** Step 3 — confirm the upload, persist the key, delete the previous object. */
export async function confirmRecipePhotoUpload(clerkUserId, householdId, recipeId, payload) {
  assertStorageConfigured()
  const db = getDb()

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createHttpError(400, 'INVALID_REQUEST_BODY', 'Request body must be a JSON object.', true)
  }
  const storagePath = typeof payload.storagePath === 'string' ? payload.storagePath.trim() : ''
  if (!storagePath) {
    throw createHttpError(400, 'INVALID_STORAGE_PATH', 'storagePath is required.', true)
  }

  const { user, access, recipe, recipeId: normalizedRecipeId } =
    await loadRecipeForWrite(db, clerkUserId, householdId, recipeId)

  // The key must live inside this recipe's own prefix — never trust a client key.
  if (!storagePath.startsWith(photoPrefix(access.household.id, normalizedRecipeId))) {
    throw createHttpError(400, 'INVALID_STORAGE_PATH', 'storagePath does not belong to this recipe.', true)
  }

  // Verify the client actually uploaded the object before we point at it.
  const head = await headObject({ key: storagePath })
  if (!head) {
    throw createHttpError(409, 'UPLOAD_NOT_FOUND', 'No uploaded object found at storagePath.', true)
  }
  if (head.contentLength && head.contentLength > MAX_PHOTO_BYTES) {
    await deleteObject({ key: storagePath }).catch(() => {})
    throw createHttpError(413, 'FILE_TOO_LARGE', `Image exceeds the ${MAX_PHOTO_BYTES} byte limit.`, true)
  }

  const previousPath = recipe.photoStoragePath
  const updated = await setPhotoStoragePath(db, access.household.id, normalizedRecipeId, user.id, storagePath)

  // Best-effort cleanup of the replaced object — never fail the request on it.
  if (previousPath && previousPath !== storagePath) {
    await deleteObject({ key: previousPath }).catch((err) => {
      console.error('Failed to delete replaced recipe photo', { previousPath, error: err?.message })
    })
  }

  await writeAuditLog(db, {
    action: 'recipe.photo_set',
    entityType: 'recipe_adaptation',
    entityId: normalizedRecipeId,
    actorUserId: user.id,
    householdId: access.household.id,
    before: { photoStoragePath: previousPath ?? null },
    after: { photoStoragePath: storagePath },
  })

  const url = await createPresignedDownloadUrl({ key: storagePath, expiresIn: DOWNLOAD_URL_TTL_SECONDS })

  return {
    household: access.household,
    requester: access.membership,
    photo: {
      storagePath: updated.photoStoragePath,
      url,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    },
  }
}

/** Short-lived presigned GET URL for the recipe's current photo. */
export async function getRecipePhotoUrl(clerkUserId, householdId, recipeId) {
  assertStorageConfigured()
  const db = getDb()

  const user = await getCurrentAppUser(clerkUserId)
  const normalizedRecipeId = normalizeRecipeId(recipeId)
  const access = await requireHouseholdCapability(db, user.id, householdId, 'view', { resourceType: 'recipe' })
  const recipe = await readRecipeById(db, access.household.id, normalizedRecipeId)
  if (!recipe) {
    throw createHttpError(404, 'RECIPE_NOT_FOUND', 'Recipe was not found.', true)
  }
  if (!recipe.photoStoragePath) {
    throw createHttpError(404, 'RECIPE_PHOTO_NOT_FOUND', 'This recipe has no photo.', true)
  }

  const url = await createPresignedDownloadUrl({
    key: recipe.photoStoragePath,
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
  })

  return {
    household: access.household,
    requester: access.membership,
    photo: { storagePath: recipe.photoStoragePath, url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS },
  }
}

/** Remove the photo: delete the object (best-effort) and clear the columns. */
export async function removeRecipePhoto(clerkUserId, householdId, recipeId) {
  assertStorageConfigured()
  const db = getDb()

  const { user, access, recipe, recipeId: normalizedRecipeId } =
    await loadRecipeForWrite(db, clerkUserId, householdId, recipeId)

  if (!recipe.photoStoragePath) {
    return {
      removed: false,
      household: access.household,
      requester: access.membership,
    }
  }

  const previousPath = recipe.photoStoragePath
  await setPhotoStoragePath(db, access.household.id, normalizedRecipeId, user.id, null)

  await deleteObject({ key: previousPath }).catch((err) => {
    console.error('Failed to delete recipe photo object', { previousPath, error: err?.message })
  })

  await writeAuditLog(db, {
    action: 'recipe.photo_removed',
    entityType: 'recipe_adaptation',
    entityId: normalizedRecipeId,
    actorUserId: user.id,
    householdId: access.household.id,
    before: { photoStoragePath: previousPath },
  })

  return {
    removed: true,
    household: access.household,
    requester: access.membership,
  }
}
