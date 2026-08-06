# Account saves

A signed-in user's saved **public-site** content (recipes, drinks, products,
articles) from popladle.com, keyed by content slug (`recipe:warm-oats`).

This is **not** `recipe_favorites`. Favorites are per-user bookmarks on household
/ master `recipe_adaptations` rows keyed by UUID (care data inside a household).
Account saves are the public marketing site's saves: slug-keyed, no household.

## API (all require a Clerk session)

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/v1/account/saves` | — | `{ items: SavedItem[] }` (newest first) |
| PUT | `/api/v1/account/saves` | `{ type, id, title, img?, savedAt? }` | `{ item }` |
| DELETE | `/api/v1/account/saves/:key` | — | `{ removed }` |
| POST | `/api/v1/account/saves/adopt` | `{ items: SavedItem[] }` | `{ adopted, items }` |

`SavedItem = { key, type, id, title, img, savedAt }`, `type ∈ {recipe, drink,
product, article}`, `key = "<type>:<id>"`. `savedAt` is client ms since epoch
(0 if unknown). `:key` must be URL-encoded (the colon → `%3A`).

`adopt` is the one-time migration: it upserts a batch (deduped by key, keeping
the earliest `savedAt`) and returns the full list, so the client can replace its
local view in one round-trip. Capped at 500 items per call.

## Consumer flow (guest → account)

1. **popladle.com (guest, no login):** saves live in `localStorage` under
   `pl_saved` (see `pop-and-ladle-mvp/src/features/saved/savedService.ts`). The
   record shape already carries `savedAt` + `schemaVersion` for adoption.
2. **User signs in on app.popladle.com** (login exists only in the app).
3. **App adopts:** on first authenticated load, POST the device saves to
   `/account/saves/adopt`, then read `/account/saves` as the source of truth.
   New saves while signed in go through PUT/DELETE, not localStorage.

## Cross-domain bridge (unresolved — needs a decision)

Step 1 writes `localStorage` on **popladle.com**; step 3 runs on
**app.popladle.com**. `localStorage` is origin-scoped, so the app cannot read
the landing page's saves directly. A bridge is required. Options:

- **A. Cookie on `.popladle.com`** — the landing page mirrors `pl_saved` into a
  cookie scoped to the parent domain; the app reads and adopts it, then clears
  it. Simple; limited to ~4KB (a dozen-ish saves with image URLs). Needs both
  apps on `*.popladle.com` (does not work across `localhost` ports in dev).
- **B. Redirect handoff** — the landing page's "Go to app" link carries the
  saves (or a short-lived token) to the app. URL-length limited; explicit.
- **C. Anonymous device saves** — the landing page writes saves to a backend
  device store under an anonymous id (cookie on `.popladle.com`); the app claims
  them by that id on login. No size limit; adds an unauthenticated write path to
  rate-limit. Best if save volume can be large.

Until a bridge is chosen, the landing page correctly stays localStorage-only
(no login there per the waitlist phase) and this API is ready for the app to
call.
