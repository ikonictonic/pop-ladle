# ABAC migration — authorization inventory (Phase 0)

Every authorization decision in the backend today, mapped to the ABAC capability
it will become. This is the cutover worksheet: Phase 2 runs the new PDP in shadow
against these call sites; Phase 3 swaps them one feature at a time.

Source of truth for capabilities: `policy.generated.js` (compiled from the matrix
CSV via `npm run abac:compile`). Source of truth for *who holds a role*: the DB
(today `household_members.role` + `internal_admin_users.role`).

## Role identity mapping

| Today (code) | Matrix role | Tier |
|---|---|---|
| household `owner` | PL-069 Owner | T5 Tenant Owner |
| household `co_owner` | PL-070 Co-Owner | T6 Tenant Co-Admin |
| household `caregiver` | PL-071 Caregiver | T7 Operator |
| household `viewer` | PL-072 Viewer | T8 Reader |
| (care recipient, non-login) | PL-073 Care Recipient | T9 Data Subject |
| internal `super_admin` | PL-001 Global Super Admin | T0 Root |
| internal `clinical_admin` | PL-004 Clinical Review Admin (+ library/gate caps it exercises) | T1 |
| internal `support_admin` | PL-011 Support Admin | T1 |

The 4-value household enum and 3-value staff enum collapse **143 matrix roles into
~7 effective code roles**. Only these are live; the other 136 are Phase-3 surfaces.

## Household capability checks (`requireHouseholdRole(db, user, hh, ROLES)`)

Convention in code: `[owner,co_owner,caregiver,viewer]` = all members (read);
`[owner,co_owner,caregiver]` = members minus viewer (write/execute);
`[owner,co_owner]` = admin; `[owner]` = owner-only.

| Feature (const) | Roles | → ABAC capability |
|---|---|---|
| recipe-brain `GENERATE_ROLES` | o,co,cg | `recipe:generate` (+ entitlement, below) |
| recipes `RECIPE_READ_ROLES` | all | `view` |
| recipes `RECIPE_WRITE_ROLES` | o,co,cg | `recipe:edit_content`, `recipe:edit_flavor`, `recipe:version_manage`, `create:family_recipe` |
| recipes `RECIPE_DELETE_ROLES` | o,co | `recipe:delete` — ⚠ see discrepancies |
| recipePhoto `RECIPE_READ/WRITE_ROLES` | all / o,co,cg | `view` / `asset:upload` (`recipe:edit_content`) |
| households `HOUSEHOLD_VIEW_ROLES` | all | `view` |
| households `HOUSEHOLD_MANAGE_ROLES` | o,co | `household:settings` |
| households `['owner']` (delete/transfer) | o | `household:delete`, `owner_transfer` |
| members `MEMBER_MANAGER_ROLES` | o,co | `iam:invite`, `iam:grant_role:household` |
| members `INVITABLE_MEMBER_ROLES` | co,cg,viewer | *value-set* — which roles may be granted to an invitee (not a gate) |
| hard-rules `READ/WRITE_ROLES` | all / o,co,cg | `view` / `hard_rule:edit` |
| care-recipients `READ/WRITE_ROLES` | all / o,co,cg | `care_profile:view` / `care_profile:edit` — ⚠ caregiver scope |
| notes `VIEW/WRITE_ROLES` | all / o,co,cg | `view` / `note:write` |
| day-plan `VIEW/EDIT_ROLES` | all / o,co,cg | `view` / `dayplan:execute`, `planner:manage` |
| grocery `VIEW/EDIT_ROLES` | all / o,co,cg | `view` / `shopping:manage` |
| hydration `VIEW/LOG_ROLES` | all / o,co,cg | `view` / `hydration:log` |
| plans `PLAN_VIEW_ROLES` | all | `view` |
| clinical-review `VIEW_ROLES` | all | `view:clinical_status` |
| clinical-review `DECISION_ROLES` | o,co | ⚠ household status decision — no direct matrix cap (households `submit_to`) |
| accuracyCheck `ACCURACY_WRITE_ROLES` | o,co,cg | part of `recipe:generate` pipeline |
| platform-recipes `COPY_ROLES` | o,co,cg | `copy:recipe` (+ entitlement, below) |
| audit-log `AUDIT_VIEW_ROLES` | o,co | `audit:read_scoped:household` |

## Entitlement gates — a SEPARATE axis (keep distinct from capabilities)

These are plan-tier checks, not role capabilities. In ABAC they are a
subject/environment attribute the PDP **ANDs** with the capability. Do not fold
them into the role matrix.

| Gate (planService) | Requires | Pairs with |
|---|---|---|
| `requireGeneratorAccess` | feature `generator_access` (Solo+) + good standing | `recipe:generate` |
| `requireLibraryCopyAccess` | feature `library_copy` (Basic+) + good standing | `copy:recipe` |

## Internal admin gates (`requireInternalAdmin(allowedRoles)`)

| Call group | Roles | → matrix capability area |
|---|---|---|
| `ANY_ADMIN` | super, support, clinical | `view` + read consoles |
| `SUPER_ONLY` | super | `*` (PL-001 wildcard) |
| `SUPPORT_ADMINS` | super, support | `support:*` (PL-011) |
| `CLINICAL_ADMINS` | super, clinical | gate/library: `library:accept`, `publish:public`, gate config (PL-004/005/007) |

## Frontend (UI-hide only — never the enforcement layer)

- `roleService.js` boolean helpers mirror the backend capabilities → Phase 5 replaces
  with `can('<capability>')` fed by an effective-capability set from `/me`.
- `currentUserService.normalizeRole` maps `co_owner → owner` → **remove** (see discrepancy 1).
- `guards.jsx` `RequireRole` → `RequireCapability`.

## Discrepancies surfaced (Phase 2 shadow-mode worklist)

1. **co_owner over-granted in the UI.** `normalizeRole(co_owner→owner)` hands co-owners
   the full owner UI. Matrix PL-070 explicitly `DENY:billing:manage | DENY:household:delete
   | DENY:owner_transfer`. Backend is mostly fine (`HOUSEHOLD_MANAGE`=o,co but delete is
   `['owner']`); the gap is frontend.
2. **recipe:delete for co_owner unspecified.** Code `RECIPE_DELETE_ROLES=[o,co]`. Matrix
   gives Owner delete, marks Caregiver `DENY:recipe:delete`, and is **silent** for
   Co-Owner. Decide co_owner recipe-delete explicitly when wiring.
3. **caregiver care_profile scope.** Code lets caregiver write all care-recipient fields.
   Matrix PL-071 = `DENY:care_profile:edit(beyond acceptance)` — caregiver edits should be
   limited to acceptance/logging fields, not diagnoses/limits.
4. **household clinical decision vs the gate.** `DECISION_ROLES` lets owner/co_owner set a
   review status at the household, but the matrix gate is staff-only (`recipe:clinical_gate_approve`,
   Clinician Reviewer) with households `submit_to`. Reconcile: household acknowledgement ≠
   clinical-gate approval.
5. **staff SoD not enforced.** `CLINICAL_ADMINS` can both accept into the library and publish
   public; matrix splits Recipe Library Admin (`library:accept`, `DENY:publish:public`) from
   Publishing Admin (`publish:public`) and forbids one person holding both.

## Phase 0 status — done

Built: CSV→artifact compiler (`npm run abac:compile`), `policy.generated.js` (143 roles,
300 capabilities), `policy.js` read helpers, validation + doctrine tests.

## Phase 1 status — done

Built the PDP: `authorize({ subject, action, resource, env })` in `authorize.js`, pure and
deny-wins, with two non-overridable guardrails (clinical gate, Food/Medical domain) and
golden tests in `authorize.test.js`. **Still dormant — only the tests import it; no request
path enforces it.** Behavior unchanged.

The golden tests turned discrepancy #2 above into an executable fact: the matrix grants
`recipe:delete` to no role, so the PDP default-denies it for everyone (Owner included). This
will light up in Phase 2 shadow mode (legacy allows owner/co_owner delete; PDP denies) — fix
by adding the grant to the CSV or deciding deletes are owner-only/soft.

## Phase 2 status — shadow mode wired (in progress)

Built `shadow.js` (`shadowCompare`, role-id mappings) + `shadow.test.js`. `requireHouseholdRole`
gained an **opt-in** 5th arg `shadowOpts` — when present it runs the PDP and logs agree/DISAGREE
without touching control flow (observes both allow and deny paths; never throws).

Toggle: `ABAC_SHADOW=off` silences; `ABAC_SHADOW_VERBOSE=1` also logs agreements. Logs are
greppable JSON: `{"tag":"abac-shadow","kind":"DISAGREE",...}` (disagreements → stderr).

Call sites wired so far:
- `recipe-brain:create` → `recipe:generate` — **agrees** (no regression on the migrated-first feature).
- `recipe:delete` → **DISAGREES** (legacy allows owner/co_owner; PDP DEFAULT_DENY — discrepancy #2, live).

Remaining: wire the other ~25 `requireHouseholdRole` sites (each just adds `shadowOpts`), let logs
accumulate in dev/staging, triage discrepancies #1–5, reconcile the CSV (e.g. add `recipe:delete`
to Owner/Co-Owner).

## Phase 3 status — first cutover done (generator)

`householdAccess.js` refactored: extracted `loadHouseholdMembership` (the shared 404/403 membership
loader) and added **`requireHouseholdCapability(db, userId, householdId, action, opts)`** — same
membership semantics, but the **PDP decides** the action instead of a role-array. `roleMap.js`
(foundational) now owns the role→matrix-id bridge, imported by both shadow and enforcement.

Cut over: **recipe-brain create** now calls `requireHouseholdCapability(..., 'recipe:generate')`
instead of `requireHouseholdRole(..., GENERATE_ROLES)`. Safe because Phase 2 shadow proved exact
agreement; `householdAccess.test.js` re-asserts the equivalence on the enforcement path
(owner/co_owner/caregiver allowed, viewer `CAPABILITY_REQUIRED`, 404/403 preserved). Deny code
changed `HOUSEHOLD_ROLE_REQUIRED` → `CAPABILITY_REQUIRED` (both 403; deny path is unreachable from
the UI, which already hides generate for non-generators). The generator read/list paths and all
other features stay on legacy `requireHouseholdRole` for now.

**Deferred deliberately — frontend `normalizeRole(co_owner→owner)` (discrepancy #1).** Removing it
safely requires teaching every `roleService` helper about `co_owner` (it isn't modeled at all today),
so a naive removal would lock co-owners out of settings/invite that the backend *does* allow. That
belongs with Phase 5 (frontend → effective-capabilities from `/me`), not bolted onto this slice.
The generator UI stays correct for co_owner via the existing normalization until then.

## Phase 4 status — grants data model done

The subject is now a **set of scoped grants**, not one role string. Built:
- Migration `019_abac_subject_grants.sql` — additive `subject_grants` table (pro / cross-tenant /
  comped / future grants). Household roles stay in `household_members`, staff roles in
  `internal_admin_users` — single source each, no sync trap.
- `access/grants.js` `resolveSubjectGrants(db, userId)` — UNIONs all three sources into the PDP
  subject `{ grants: [{ roleId, scope }] }`. Multiple memberships → multiple tenant-scoped grants
  (the role-explosion fix, made concrete). Unmapped roles are skipped + logged, never guessed.
  Tolerates `subject_grants` not existing yet (only the `42P01` undefined_table error) so code can
  deploy ahead of the migration.
- `requireHouseholdCapability` now decides against the member's **full** grant set via the resolver;
  PDP scope keeps only grants that reach the household, so additive grants apply too. Membership gate
  (404/403) unchanged. Behavior for the generator is identical today (table empty) — verified by tests.

⚠ **Rollout order:** run `npm run db:migrate` (applies 019) before/with deploying this code. The
resolver degrades gracefully if it hasn't, but apply it.

## Phase 5 status — frontend capabilities (generator slice) done

The frontend now hides on **capabilities**, not roles, for the migrated feature — keyed off the
exact same capability the backend PDP enforces. Policy stays server-side; the client just gets a
resolved string list.

- Backend: `effectiveCapabilities(roleId)` (policy.js) + `/me` (`getCurrentUserContext`) now returns
  `capabilities: [...]` per household. Root → `['*']`. Tested in `policy.generated.test.js`.
- Frontend: `hasCap(capabilities, cap)` / `hasCapability(access, cap)` in roleService; `capabilities`
  on the access context (deriveAccess); `RequireCapability` guard. The generator gate is migrated
  in all four spots — route guard, sidebar nav, home redirect, and the AdjustRecipePage defense —
  from `canGenerateRecipe(role)` to the `recipe:generate` capability. Lint-clean (10 pre-existing
  errors elsewhere are untouched).

Behavior is unchanged: co_owner (normalized to owner today) and the matrix both grant
`recipe:generate`, so the generator UI is identical — but now driven by capability, no longer
dependent on `normalizeRole`.

⚠ **`normalizeRole(co_owner→owner)` is still in place** — every other roleService helper
(delete/setup/invite/day-plan/notes/clinical/all-recipes) is still role-based and would lock
co-owners out if it were removed now. It comes out only once those helpers are also capability-
migrated. Track as discrepancy #1.

## Phase 6 status — dual control done; break-glass + decommission pending

**Dual control — done.** The PDP's dormant `env` seam is now live. `DUAL_CONTROL_ACTIONS`
(`household:delete`, `owner_transfer`, `iam:grant_role`, `keys:rotate`, `model:key_manage`,
`config:global`, `retention:configure`, `breakglass:approve` — matches deeper-qualified forms too)
require `env.dualControlSatisfied === true` ON TOP of the capability. Checked AFTER the capability
allow, so a subject who simply lacks the capability gets the capability denial, not a misleading
"needs a second approver". New reason `DUAL_CONTROL_REQUIRED`; `requireHouseholdCapability` accepts
`opts.env` and throws a distinct `DUAL_CONTROL_REQUIRED` (403) so the client can prompt for a second
approver. Golden tests in `authorize.test.js`.

**Break-glass — deferred (no consumer yet).** The `env` seam supports it (an approved, time-boxed,
audited grant that relaxes the domain/PHI boundary). Build it when the first `/admin` break-glass
flow needs it, not speculatively.

**Decommission — blocked on the widening tail.** Can't delete the legacy `*_ROLES` arrays,
`normalizeRole`, or the shadow scaffolding until every feature is capability-migrated. Remaining tail:
the other ~25 `requireHouseholdRole` sites, the internal-admin gates (`requireInternalAdmin`), and the
5 CSV discrepancies (esp. #2 `recipe:delete` granted to nobody, #3 caregiver care_profile scope).

Each remaining feature is the same grooved move: shadow → confirm agreement → swap to
`requireHouseholdCapability` (back) + `hasCapability` (front). Then drop `normalizeRole` and the
legacy arrays.
