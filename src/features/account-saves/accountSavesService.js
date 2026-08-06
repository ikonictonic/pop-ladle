/**
 * Account saves — a signed-in user's saved marketing content from the public
 * site (recipes, drinks, products, articles), keyed by content slug.
 *
 * The public site (popladle.com) saves to localStorage while a visitor is a
 * guest; when they sign in on the app, those device saves are POSTed to `adopt`
 * and merged into this per-user store (deduped by save_key). Thereafter the
 * signed-in client reads/writes here instead of localStorage.
 *
 * This is intentionally NOT recipe_favorites: that is household care data keyed
 * by recipe UUID; this is public content keyed by slug and has no household.
 */

import { getDatabasePool } from '../../database/pool.js'
import { getCurrentAppUser } from '../auth/currentUserService.js'
import { createHttpError } from '../households/householdAccess.js'

const ITEM_TYPES = new Set(['recipe', 'drink', 'product', 'article'])
const MAX_TITLE = 300
const MAX_ID = 200
const MAX_IMG = 2000
// A single adopt call migrates a device's localStorage; cap it so a hostile or
// corrupt payload can't fan out into an unbounded transaction.
const MAX_ADOPT_ITEMS = 500

function getDb() {
  const db = getDatabasePool()
  if (!db) {
    throw createHttpError(503, 'DATABASE_NOT_CONFIGURED', 'DATABASE_URL is not set.', true)
  }
  return db
}

/** Canonical save key for a content item. Mirrors the site's `type:id`. */
export function saveKeyFor(type, id) {
  return `${type}:${id}`
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Validate + normalize one client save into the row shape, or throw 400.
 * Shared by the single-item PUT and the bulk adopt so both enforce identically.
 */
function normalizeSaveInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw createHttpError(400, 'INVALID_SAVE', 'A save must be a JSON object.', true)
  }

  const type = trimString(raw.type)
  if (!ITEM_TYPES.has(type)) {
    throw createHttpError(
      400,
      'INVALID_SAVE_TYPE',
      `Save type must be one of: ${[...ITEM_TYPES].join(', ')}.`,
      true,
    )
  }

  const id = trimString(raw.id)
  if (!id || id.length > MAX_ID) {
    throw createHttpError(400, 'INVALID_SAVE_ID', 'A save needs a non-empty id.', true)
  }

  const title = trimString(raw.title)
  if (!title || title.length > MAX_TITLE) {
    throw createHttpError(400, 'INVALID_SAVE_TITLE', 'A save needs a non-empty title.', true)
  }

  const img = trimString(raw.img).slice(0, MAX_IMG)

  // savedAt is a client timestamp (ms). Keep it only if it is a sane positive
  // number, else 0 — never trust it enough to sort security on.
  const savedAtMs =
    typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) && raw.savedAt > 0
      ? Math.floor(raw.savedAt)
      : 0

  return { type, id, title, img, savedAtMs, key: saveKeyFor(type, id) }
}

function rowToSave(row) {
  return {
    key: row.save_key,
    type: row.item_type,
    id: row.item_id,
    title: row.title,
    img: row.img,
    savedAt: Number(row.saved_at_ms) || 0,
  }
}

/** List the current user's saves, newest first. */
export async function listSavesForCurrentUser(clerkUserId) {
  const db = getDb()
  const user = await getCurrentAppUser(clerkUserId)
  const result = await db.query(
    `
      select save_key, item_type, item_id, title, img, saved_at_ms
      from account_saves
      where user_id = $1
      order by created_at desc
    `,
    [user.id],
  )
  return { items: result.rows.map(rowToSave) }
}

/** Upsert one save for the current user. Returns the saved item. */
export async function putSaveForCurrentUser(clerkUserId, payload) {
  const db = getDb()
  const user = await getCurrentAppUser(clerkUserId)
  const input = normalizeSaveInput(payload)

  const result = await db.query(
    `
      insert into account_saves (user_id, save_key, item_type, item_id, title, img, saved_at_ms)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (user_id, save_key)
      do update set
        title = excluded.title,
        img = excluded.img,
        updated_at = now()
      returning save_key, item_type, item_id, title, img, saved_at_ms
    `,
    [user.id, input.key, input.type, input.id, input.title, input.img, input.savedAtMs],
  )
  return { item: rowToSave(result.rows[0]) }
}

/** Remove one save by key. Idempotent — removing an absent key is a no-op. */
export async function removeSaveForCurrentUser(clerkUserId, saveKey) {
  const key = trimString(saveKey)
  if (!key) {
    throw createHttpError(400, 'INVALID_SAVE_KEY', 'A save key is required.', true)
  }
  const db = getDb()
  const user = await getCurrentAppUser(clerkUserId)
  await db.query('delete from account_saves where user_id = $1 and save_key = $2', [user.id, key])
  return { removed: key }
}

/**
 * Adopt a batch of device (localStorage) saves into the account. Dedupes by
 * key: an item already saved keeps its earlier saved_at_ms and just refreshes
 * title/img. Returns the user's full save list afterward so the client can
 * replace its local view in one round-trip.
 */
export async function adoptSavesForCurrentUser(clerkUserId, payload) {
  const items = payload?.items
  if (!Array.isArray(items)) {
    throw createHttpError(400, 'INVALID_ADOPT_PAYLOAD', 'Body must be { items: [...] }.', true)
  }
  if (items.length > MAX_ADOPT_ITEMS) {
    throw createHttpError(
      400,
      'TOO_MANY_SAVES',
      `Cannot adopt more than ${MAX_ADOPT_ITEMS} saves at once.`,
      true,
    )
  }

  // Validate all before writing any, and collapse duplicate keys within the
  // batch (keep the earliest savedAt) so one bad row rejects the whole adopt.
  const byKey = new Map()
  for (const raw of items) {
    const input = normalizeSaveInput(raw)
    const existing = byKey.get(input.key)
    // Same key twice in one batch: keep one row, at the earliest save time.
    byKey.set(input.key, existing ? { ...input, savedAtMs: pickEarlier(existing.savedAtMs, input.savedAtMs) } : input)
  }

  const db = getDb()
  const user = await getCurrentAppUser(clerkUserId)

  if (byKey.size > 0) {
    const client = await db.connect()
    try {
      await client.query('begin')
      for (const input of byKey.values()) {
        await client.query(
          `
            insert into account_saves (user_id, save_key, item_type, item_id, title, img, saved_at_ms)
            values ($1, $2, $3, $4, $5, $6, $7)
            on conflict (user_id, save_key)
            do update set
              title = excluded.title,
              img = excluded.img,
              -- keep the earliest known save time across device + account
              saved_at_ms = case
                when account_saves.saved_at_ms = 0 then excluded.saved_at_ms
                when excluded.saved_at_ms = 0 then account_saves.saved_at_ms
                else least(account_saves.saved_at_ms, excluded.saved_at_ms)
              end,
              updated_at = now()
          `,
          [user.id, input.key, input.type, input.id, input.title, input.img, input.savedAtMs],
        )
      }
      await client.query('commit')
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
  }

  const result = await db.query(
    `
      select save_key, item_type, item_id, title, img, saved_at_ms
      from account_saves
      where user_id = $1
      order by created_at desc
    `,
    [user.id],
  )
  return { adopted: byKey.size, items: result.rows.map(rowToSave) }
}

/** Earliest of two ms timestamps, treating 0 (unknown) as "no opinion". */
function pickEarlier(a, b) {
  if (!a) return b
  if (!b) return a
  return Math.min(a, b)
}

// Exported for accountSaves.test.js — pin the validation/normalization that
// both PUT and adopt depend on, without a live DB.
export {
  normalizeSaveInput as __normalizeSaveInputForTests,
  ITEM_TYPES as __ITEM_TYPES_FOR_TESTS,
  MAX_ADOPT_ITEMS as __MAX_ADOPT_ITEMS_FOR_TESTS,
}
