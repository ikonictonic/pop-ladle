# Pop & Ladle — Integration Plan (Backend + Frontend)

**This document executes Architecture Plan §16 Phase 6 — "Website & app cutover"**
(*Public site to production · Customer app to production · exit: production launch*),
and is structured around the plan's **§04 Routing Map** (public / app / admin / api).
Source of truth for the Supabase→Express cutover. Two tracks: backend (finish the
doctrine) and frontend (build the surfaces + cut them over).

> **Recently completed (backend, customer-side daily-care loop):**
> Master Recipe Library (publish / browse / copy-to-household with re-gating) ✅ ·
> Day Plan + Food Acceptance Record ✅ · Hydration tracking ✅ · Grocery List ✅.
> All proven live against Neon. **Next free migration = 017.** Admin UI + admin-only
> features are owned by a separate session — this track stays customer-side.

---

## Where we are against the doctrine (§16 Build Phasing)
| Phase | Doctrine | Status |
|---|---|---|
| 0 Doctrine & alignment | data model + route map | ✅ done |
| 1 Backend & security | prod backend, auth, storage, admin security | ✅ done (Clerk, Neon, R2, audit) |
| 2 Super Admin & App Brain | company unit + service layer | ✅ done (17 `/admin` routes) |
| 3 Household account model | roles, invites, plans, entitlements, billing, audit | ✅ done **except billing** (Stripe = Phase 6) |
| 4 Recipe Brain | providers, LLM proxy, specialists, synthesis | ✅ done + **proven live on Groq** |
| 5 Control Center | master recipes, clinical review, hard rules, categories | ✅ master recipes + clinical review + hard rules; ◑ **categories/taxonomy remaining** |
| **6 Website & app cutover** | **public site + customer app to production** | ⬅ **THIS PLAN** |
| 7 Mobile, Pro, Enterprise | — | later |

Backend Phases 1–5 are now essentially done (only taxonomy lingers in Phase 5). The
**daily-care loop is built** (Day Plan / Hydration / Grocery / Master Library copy), so
Phase 6 (frontend) can cut over *and* light up these surfaces.

---

## Backend facts that correct the original plan
1. **No cross-provider committee fallback** — production is Groq-only; a failed call is a
   graceful per-member error. Anthropic/Gemini adapters dormant until a Super Admin roster
   PATCH. → drop "real Anthropic/Gemini keys" config item.
2. **Don't port committee CRUD or provider-key services** — committee is platform-governed
   (`/admin/roster/:roleKey`); keys live in env only. `committeeService`,
   `committeeMemberKeysService`, `platformProviderKeysService` = DON'T PORT.
3. **Entitlement enforcement is live** — 403 `PLAN_UPGRADE_REQUIRED` / `PLAN_LIMIT_REACHED` /
   `PLAN_NOT_IN_GOOD_STANDING` on generate (Solo+), **library copy (Basic+)**,
   care-recipient/invite create, recipe save (free cap 180). Frontend needs upgrade-prompt
   handling. Comp test households via `PATCH /admin/households/:id/entitlement`.
4. **`POST /recipe-brain/runs` is synchronous** (~35–45s incl. Groq 429 retry) and returns the
   full result. Single await + progress UI; no poll/SSE decision yet.

---

## FRONTEND TRACK — the 3 surfaces (§04 Routing Map)
Already in place: Clerk auth, `lib/apiClient.js`, `auth/ApiTokenBridge.jsx`, and 5 cut-over
services in `src/services/backend/` (currentUser, household, member, careRecipient, recipe).
26 services still on Supabase. **CUTOVER** = backend endpoint exists, swap the service ·
**BUILD UI** = backend ready, no UI yet · **NEW** = build both sides.

### A. Customer app `/app` (authenticated) — the priority surface
| Route (doctrine) | Backend | Action |
|---|---|---|
| `/app/account` | Clerk + `GET /me` | CUTOVER (auth Phase 1) |
| `/household` | `/households` | CUTOVER (service exists) |
| `/members` | `/households/:id/members` + invites | CUTOVER |
| `/people` (care recipients) | `/care-recipients` | CUTOVER (service exists) |
| `/care-profile` | `/care-recipients/:id/clinical-profile` | CUTOVER |
| `/plan` | `/households/:id/plan` + `/plans` | CUTOVER |
| `/invites` | `/invites` (Resend on create) | CUTOVER |
| `/app/my-recipes` (library) | `/recipes` | CUTOVER (service exists) |
| Hard rules | `/hard-rules` | CUTOVER |
| Generate recipe | `POST /recipe-brain/runs` | CUTOVER (Phase 4) |
| Clinical review | `/clinical-review` | CUTOVER |
| Recipe photos | `/recipes/:id/photo*` (R2) | CUTOVER (Phase 3) |
| `/app/recipes` (browse master + add) | `/platform-recipes` + `…/copy` ✅ | **BUILD UI (backend ready)** |
| `/app/today` (Today Plan) | `/care-recipients/:id/day-plan` ✅ | **BUILD UI (backend ready)** |
| `/app/hydration` | `/care-recipients/:id/hydration` ✅ | **BUILD UI (backend ready)** |
| Grocery list | `/households/:id/grocery-list` (+ generate) ✅ | **BUILD UI (backend ready)** |
| `/app/clean-plate`, `/eating-out`, `/caregiver-help`, `/wellness` | — | **NEW both sides (future)** |

### B. Public website (unauthenticated)
`/`, `/recipes` browse, `/recipes/:slug`, `/hydration`, `/products` (affiliate), `/articles`,
`/lexicon`, `/saved`, `/signup`, `/signin`.
- `/signup` `/signin` → Clerk. **CUTOVER**
- `/recipes` browse/detail → **`/platform-recipes` exists ✅** (a public/unauth variant may be
  wanted; today it requires auth). **BUILD UI**
- `/products` `/articles` `/lexicon` `/hydration` content → **NEW both sides (future / content)**

### C. Super Admin console `/admin` (internal) — **owned by the admin session**
Backend mostly ready (`/admin/overview`, users, households, entitlement, roster, proxy-logs,
audit-log, privacy-requests, admins, **+ `/admin/recipes/:id/publish` for the Master Library**).
Still NEW endpoints: `/admin/feature-flags`, `/admin/usage` + `/system-health` metrics,
`/admin/email-templates`, `/admin/billing` (Stripe). The admin session is building this UI.

---

## BACKEND TRACK — remaining work to finish the doctrine
- [x] **Master Recipe Library** — `scope` flag, publish (`/admin/recipes/:id/publish`),
      browse (`/platform-recipes`), copy-to-household (re-gated + entitlement). DONE ✅
- [x] **Day Plan / Today Plan** — `day_plan_entries`, plan/complete + Food Acceptance Record. DONE ✅
- [x] **Hydration** — `hydration_logs`, log vs Care Profile goal. DONE ✅
- [x] **Grocery list** — generate from Day Plan (ingredient parser), check/clear. DONE ✅
- [ ] **Notes / Rejection Routing** — caregiver notes + route meal refusals → alternates.
- [ ] **Favorites** — per-recipe favorite (Viewer journey).
- [ ] **Consent records** — `ConsentRecord` table (care-recipient consent state; PHI posture).
- [ ] **In-app notifications** — alongside the existing email path.
- [ ] **Categories / taxonomy** (Phase 5) — meal slots + recipe categories as managed data.
- [ ] **Nutrition lookup** — genuine gap (accuracy engine uses qualitative bands; no nutrient DB).
- [ ] **Recipe versions / relationships / pairings / variations** (`version_history` not written on update).
- [ ] **Settings / branding** — small.
- [ ] *(admin session)* Feature flags · usage/health metrics · email-templates · **Billing (Stripe)**.

---

## Cutover sequence (the spine — do in order)
- **Phase 0 — config**: R2 creds + CORS; `VITE_API_BASE_URL`→`/me`; comp dev household. (drop A/G keys)
- **Phase 1 — auth**: RETIRE `authService.js` → Clerk; drop `send-signup-confirmation`, `VITE_SUPABASE_*`.
- **Phase 2 — cutover existing endpoints**: 2.1 plans → 2.2 hard-rules → 2.3 clinical-profile →
  2.4 clinical-review (+retire `accuracyCheckRecordService`) → 2.5 invites (retire send-* edge fns).
  Delete Supabase dups (`householdService`, `recipeLibraryService`, `inviteService`). Add global
  403-entitlement → upgrade-prompt handling.
- **Phase 3 — photos → R2**: `photoService.js` → presigned flow; retire Storage bucket.
- **Phase 4 — AI generation**: → `POST /recipe-brain/runs`; retire `llmProxyClient.js`, `llm-proxy`
  edge fn; Care Team page → read-only roster.
- **Phase 5 — build the daily-care UI** (backend now ready): Master Library browse + "Add to
  Household" → Today Plan / Day Plan → Hydration → Grocery List. Then Notes / Favorites when built.
- **Phase 6 — billing** (admin session / parallel).

**Critical path:** config → auth → cutover (2) → photos → AI = all *existing* user flows off
Supabase. The daily-care surfaces (Master Library, Today Plan, Hydration, Grocery) now have
backends ready to wire — they're **BUILD UI**, not net-new.

---

## DON'T PORT (deliberate)
`committeeService` (CRUD), `committeeMemberKeysService`, `platformProviderKeysService`.

---

# Frontend acceptance criteria — MVP Household journeys
From `Pop_Ladle_Actual_Person_10_Step_Paths.md` (Part 2 → MVP Household People). Test scripts
for the customer `/app` surface. Status: ✅ backend ready (cutover/BUILD UI) · ❌ no backend ·
⬜ frontend-only.

### Household (the tenant) & Owner
1. Public site → Create Account — ✅ Clerk signup
2. Signup / verify email — ✅ Clerk
3. Household Setup (name + assign Owner) — ✅ `POST /households`
4. Role Permissions (Owner scope applied) — ✅ `household_role` + `requireHouseholdRole`
5. Care Profile (diagnoses, meds, limits, textures) — ✅ `/care-recipients` + `/clinical-profile` (+ sections)
6. Hard Rules (no-grapefruit, sodium ceiling, fluid limit) — ✅ `/hard-rules` (enforced in committee)
7. Recipe Library — copy a Master Recipe into the Household — ✅ `/platform-recipes` + `…/copy` (re-gated)
8. Generate first adapted recipe + see Clinical Review Gate status — ✅ `POST /recipe-brain/runs` + `/clinical-review`
9. Planner — approve recipes, weekly audit-log check — ✅ Day Plan + `/clinical-review/decision` + `/audit-log`
10. Household Dashboard — govern members/rules/recipes daily — ✅ members/plan/audit · **billing ❌ (Stripe)**

### Co-Owner
1. Invite acceptance (token) — ✅ `POST /invites/accept`
2. Signup / verify — ✅ Clerk
3. Land in Household, Co-Owner scope (billing read-only, no delete) — ✅ role gating
4. Role Permissions card — ⬜ frontend (data from `/me` + role)
5. Care Profile — complete missing fields — ✅ `/clinical-profile/sections/:key`
6. Hard Rules — update med timing after Rx change — ✅ `/hard-rules` PATCH
7. Recipe edit routed back through review checks — ✅ `/recipes` PATCH + `/clinical-review`
8. Planner — build next week, assign prep to Caregiver — ✅ Day Plan · **task assignment ❌**
9. Notifications — invite mgmt, profile upkeep — ◑ invites ✅ · **in-app notifications ❌**
10. Co-administer daily (all actions audited) — ✅ audit-log

### Caregiver (the daily worker)
1. Tap invite link on phone — ✅ accept invite
2. Signup / verify — ✅ Clerk
3. Land on Today's Day Plan, admin controls hidden — ✅ Day Plan (`GET …/day-plan`)
4. Role Permissions card (use/plan/notes, no deletes) — ⬜ frontend
5. Care Profile / hard rules / textures (read-first) — ✅ read endpoints
6. Recipe Detail — open recipe, adjust servings, re-check hard rules + clinical status — ◑ recipe read ✅ · **per-serving live re-check ❌**
7. Day Plan — mark meal completed, log hydration (2 taps) — ✅ Day Plan completion + Food Acceptance + Hydration
8. Notes — log "refused the broccoli" → Rejection Routing — ◑ acceptance=refused captured ✅ · **Notes/Rejection Routing ❌**
9. Planner — daily plan, grocery list, notes — ✅ Day Plan + Grocery List · **Notes ❌**
10. Run real care from the kitchen daily — ✅ (loop built; Notes pending)

### Viewer (read-mostly)
1. Open invite — ✅ accept
2. Signup / verify — ✅ Clerk
3. Read-mostly dashboard, all edit controls hidden — ⬜ frontend (Viewer role)
4. Role Permissions card (view/favorite/copy/print only) — ⬜ frontend
5. Browse Household recipes + clinical review statuses — ✅ `/recipes` + `/clinical-review`
6. Favorite a recipe — ❌ **Favorites**
7. Print an allowed recipe — ⬜ print = frontend · log ❌ (optional)
8. View week plan + hydration read-only — ✅ Day Plan + Hydration (viewer has read access)
9. Repeat view sessions (logged) — ⬜ frontend
10. Stay informed without breaking anything — ✅ role lens enforced server-side

### Care Recipient (profile subject — never logs in)
1. Owner adds them as the person receiving care — ✅ `POST /care-recipients`
2. Care Profile w/ consent context — ✅ care-profiles (+ **consent state ❌**, `ConsentRecord` not built)
3. Hard rules from clinician guidance enforced — ✅ `/hard-rules`
4. Caregiver records tastes/avoids/textures/rhythm — ✅ clinical-profile sections
5. Adapted recipe pre-checked vs profile + gate — ✅ committee + clinical-review
6–9. Day Plan around energy/med timing · Food Acceptance · Hydration · Notes over time — ✅ Day Plan + Acceptance + Hydration · **Notes ❌**
10. System runs around them, every action logged + consented — ◑ audit ✅ · consent ❌

---

## Remaining net-new build (the loop is mostly done)
- [x] **Master Recipe Library** — publish / browse / copy-to-household (re-gated). ✅
- [x] **Day Plan / Today Plan** — meal slots + completion + Food Acceptance Record. ✅
- [x] **Hydration logging** — log vs Care Profile daily goal. ✅
- [x] **Grocery list** — generated from the Day Plan via the ingredient parser. ✅
- [ ] **Notes / Rejection Routing** — `…/notes`; use the captured `acceptance=refused` to suggest alternates.
- [ ] **Favorites** — `…/recipes/:id/favorite`.
- [ ] **Consent records** — `ConsentRecord` (care-recipient consent state).
- [ ] **In-app notifications**.

Build order: **(backend, customer)** Notes/Rejection Routing → Favorites → Consent →
notifications · **(frontend)** cutover spine (Phases 0–4), then wire the BUILD-UI surfaces
(Master Library, Today Plan, Hydration, Grocery) which are ready now.
