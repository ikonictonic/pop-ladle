# Clinical Review Gate Rework — Gap Analysis vs. Current Codebase

**Against:** `Clinical_Review_Gate_Developer_Handoff` (v2, with OpenAPI)
**Codebase reviewed:** `backend/` (Express + raw pg), migrations `001`–`022`, recipe-brain + clinical-review features, care-profile schema.
**Method:** every spec object/endpoint/rule checked against the actual schema and services. Verdicts: **HAVE** (exists, leave alone) · **MODIFY** (small add to something that exists) · **NEW-S/M/L** (net-new, small/medium/large).

---

## 0. Headline

The spec's claim that *"the engine doesn't change"* holds — the 8-specialist committee, ChairwomanAI, run logging, caveats, and the deterministic accuracy engine all exist and stay. **What it actually asks for is ~70% net-new**, concentrated in three areas you have **nothing** for today: human **attestation + credentials**, **per-person intake limits**, and the **USDA FDC nutrition + medical-catalog (ICD-10 / RxNorm)** stack.

Two of the spec's framing claims are **overstated** and need reconciling (details in §6):
1. It says the **six-status verdict taxonomy is "already right."** The DB only has **three** committee verdicts (`approved`, `approved_with_caveats`, `denied`). `needs_clinical_review`, `needs_nutrition_verification`, `needs_household_adaptation` **do not exist.**
2. It treats the gate as already AI-verdict-driven. In reality the current gate is a **human owner/co-owner approval wall** — the exact thing the spec says to replace. So this is a *redirection of a built feature*, not a greenfield add.

---

## 1. Two-axis gate + attestation + badge (spec §2A, §4.3, §4.4, §4.5, §5, §9)

| Spec item | Verdict | Current state |
|---|---|---|
| Committee verdict sets `clinicalReviewStatus` | **HAVE** | `recipe_brain_runs.verdict` + `recipe_adaptations.clinical_review_status` (003) |
| `denied` = only publish block; everything else ships | **MODIFY (behavioral)** | Today: `DECISION_ROLES=['owner','co_owner']` must **approve/deny** via `POST /clinical-review/:recipeId/decision`. Publishing is gated on human review, not just `denied`. Needs to flip to "ships unless denied." |
| `publishState` (publishable / stopped, derived) | **NEW-S** | No column; trivially derived from `clinical_review_status == 'denied'`. Add denormalized column or compute on read. |
| `attestationState` (none / attested) on recipe | **NEW-S** | No column. |
| `currentAttestationId` on recipe | **NEW-S** | No column. |
| `clinical_attestation` table | **NEW-M** | None. Append-only, version-locked, FK to credential + run. *Partial precedent:* `recipe_clinical_reviews` (007) is an append-only human/committee review log — similar shape, but role-based not credential-based. Could extend or sit beside it. |
| `verified_credential` table (RD/MD/NP/RN…) | **NEW-S/M** | None. MVP = manual Super-Admin seed. |
| Attestation **credential-gated, not role-gated** | **NEW-M** | Today the only human gate is `owner/co_owner`. Need a `requireCredential` check (Super Admin OR active `verified_credential`). |
| Non-suppressible badge ("AI-reviewed" / "Clinically reviewed") | **NEW-S/M** | Frontend; nothing renders a badge today. Must appear on card, detail, print, copy, planner. |
| Editing recipe → attestation resets to `none` | **NEW-S** | Versioning exists (`version_number`, `version_history`); hook the reset into the update/version path. |

**Net:** the gate reshape itself is mostly small column adds + one **behavioral change** (stop blocking on human review) + a **credential check**. The attestation/credential tables are the real new pieces. No external dependencies — this phase is self-contained.

---

## 2. Two-mode generation: generic vs personalized (spec §2B, §4.1, §4.4, §6)

| Spec item | Verdict | Current state |
|---|---|---|
| `careRecipientId == null` ⇒ generic; set ⇒ personalized | **HAVE (logic)** | `recipeBrainService` already branches on `careRecipientId` (`loadCareRecipientContext` / `loadActiveHardRuleContext` skip when null). |
| `personalized` boolean on run + recipe | **NEW-S** | Not stored; fully derivable from `care_recipient_id`. Add explicit column for clarity/queries. |
| Guard: never present generic as personalized; never bind `personalized:false` to a real recipient w/o re-run | **NEW-S** | No such guard today (QA case #10). Small service-level check. |

**Net:** you're basically here. This is the cheapest phase — a flag + one guard.

---

## 3. FDC nutrition + intake limits + catalogs (spec §2C, §3, §4.2, §4.6, §4.7, §8) — the big lift

| Spec item | Verdict | Current state |
|---|---|---|
| Nutrient **values from USDA FoodData Central** on every recipe | **NEW-L** | **No nutrition pipeline exists.** The `nutrition`/`fdc`/`fooddata` hits in code are **text references only** — `clinical-review/engine/sourceRegistry.js` (a list of clinical-guideline citations) and ABAC policy. The accuracy engine reasons *qualitatively*; it never computes nutrient numbers. Requires: USDA FDC API integration, ingredient→food matching, per-ingredient confidence, serving math, caching "Nutrition Catalog," `recipe.nutrition` object. |
| `recipe.nutrition` object (per-serving, per-ingredient, confidence, unmatched) | **NEW-L** | No column/table. |
| Unmatched ingredient = flagged, never zeroed + Nutrition Verification Queue | **NEW-M** | No queue exists (the "Recipe Review Queue" I built is for library curation, unrelated). |
| `care_intake_limit` table (per-person nutrient ceilings) | **NEW-M** | None. Table + CRUD + permissions + audit. **Can ship before FDC** (limits stored; comparison no-ops until nutrition lands). |
| `run.appliedLimits` / `intakeLimitCount` / `nutritionSource` / `catalogVersions` | **NEW-S** | Add to `recipe_brain_runs` (which already has `care_recipient_id`, `hard_rules_snapshot`). |
| Conditional nutrient display (only what the person has a limit on) | **NEW-M** | Frontend; the old fixed nutrition panel was Supabase-only and was **removed** earlier — rebuild per this rule, not as before. |
| Structured `care_diagnosis` (ICD-10-CM) | **NEW-L** | **Care Profile is free-text + JSON today** (`care_profiles.profile_text` + `profile_data`/`clinical_profile_data` jsonb). No structured diagnosis table, no ICD-10. |
| Structured `care_medication` (RxNorm + NDC + SPL) | **NEW-L** | Same — free-text/JSON only. No RxNorm/RxCUI anywhere. |
| ICD-10-CM lookup (NLM Clinical Tables) behind internal catalog | **NEW-M** | None. New catalog service + `/catalogs/icd10/search`. |
| RxNorm lookup (RxNav) behind internal catalog | **NEW-M** | None. New catalog service + `/catalogs/rxnorm/search`. |
| Catalog version pinning on records | **NEW-S** | None. |
| FDA NDC / DailyMed / openFDA (optional, packet-only) | **NEW (deferrable)** | None. Spec marks adverse-events/recalls as an open MVP decision (§12.3). |

**Net:** this is effectively a **second project** — three external integrations (USDA FDC, NLM ICD-10, NLM RxNorm), each behind a cached internal catalog service with a data-manager correction workflow. Highest risk (3rd-party uptime, rate limits, match quality), highest effort.

---

## 4. Endpoints (spec §13 OpenAPI) vs. existing surface

| Spec endpoint | Verdict | Note |
|---|---|---|
| `POST /recipes/{id}/attestations` | **NEW** | credential-gated, version-locked (409 on stale version) |
| `POST /recipes/{id}/attestations/{aid}/revoke` | **NEW** | Super Admin or original attester |
| `GET/POST/PATCH/DELETE /care-recipients/{id}/intake-limits` | **NEW** | maps to the new `care_intake_limit` table |
| `GET /catalogs/icd10/search` | **NEW** | proxies internal ICD-10 catalog |
| `GET /catalogs/rxnorm/search` | **NEW** | proxies internal RxNorm catalog |
| `GET /recipes/{id}` returns new fields | **MODIFY** | recipe read exists (`GET /households/:hid/recipes/:recipeId`); add `personalized`, `attestationState`, `publishState`, `nutrition` to the projection |

Note: the spec's OpenAPI uses a **non-household-scoped** path style (`/recipes/{id}`, `/care-recipients/{id}`). Our API is **household-scoped** (`/households/:hid/...`). Keep our convention; the spec paths are illustrative.

---

## 5. Permissions (spec §7) vs. current

| Action | Spec | Current | Gap |
|---|---|---|---|
| Generate (generic/personalized) | Owner/Co-Owner/Caregiver | `GENERATE_ROLES=['owner','co_owner','caregiver']` ✅ | **HAVE** |
| Create/edit intake limit, diagnosis, medication | Owner/Co-Owner | n/a (no such resources) | **NEW** with table |
| **Attest** | Super Admin **or** verified credential | `DECISION_ROLES=['owner','co_owner']` (different concept) | **NEW** — credential check |
| Publish/copy | any recipe role unless `stopped` | gated on human review today | **MODIFY** to denied-only |
| Suppress badge | nobody | n/a | **NEW** (UI invariant) |

---

## 6. Conflicts / decisions to raise with the client (before building)

1. **The existing owner/co-owner Clinical Review gate is being replaced.** Today owners *approve/deny* to publish; the spec makes publishing automatic (unless `denied`) and moves human sign-off to **optional credentialed attestation.** Confirm the current household review queue becomes a *"needs attention"* surface, not a blocker — and who, in MVP, actually holds credentials (the spec's MVP answer is "Super Admin manual seed").
2. **Verdict taxonomy mismatch.** Spec assumes six statuses exist; we have three committee verdicts. Decide: does ChairwomanAI start *emitting* `needs_clinical_review` / `needs_nutrition_verification` / `needs_household_adaptation` (prompt + enum change), or do we *derive* them (e.g. `needs_nutrition_verification` from an FDC `over`/unmatched result)? The spec's §8 implies derivation for the nutrition one.
3. **Master Recipe Library curation already built.** We have a Recipe Library Admin flow (`/admin/recipe-review-queue` → accept into library). The spec doesn't mention it. Reconcile: a generic, `approved`, attested recipe is the natural Master Library candidate — wire the two together rather than running parallel review concepts.
4. **Nutrition rebuild, not revival.** The old nutrition panel was Supabase-only and was removed. The spec's FDC model is the correct replacement — don't resurrect the old one.
5. **External API ownership.** USDA FDC + NLM (ICD-10/RxNorm) need API keys, rate-limit handling, caching, and a "Nutrition Data Manager" correction workflow. Confirm who owns those accounts and the uptime/latency expectations (spec §3.3 mandates *internal cached catalogs*, never inline public calls on the recipe path).
6. **Care Profile migration.** Existing profiles are free text. Structured ICD-10/RxNorm capture means a backfill/normalization queue (spec §10.6) and a Care Profile UI change (autocomplete). Confirm appetite for changing the Care Profile entry UX now vs. later.

---

## 7. Recommended phased build order

Sequenced so each phase ships value independently and external-API risk is deferred to the end.

| Phase | Scope | Effort | External deps |
|---|---|---|---|
| **1 — Gate reshape + badge** | `personalized` flag + guard; `publishState` (derived); `attestationState`/`currentAttestationId` columns; flip publishing to **denied-only**; non-suppressible badge on all recipe surfaces; reconcile verdict taxonomy (decision #2). | **S–M** | none |
| **2 — Credentials + attestation** | `verified_credential` (manual seed) + `clinical_attestation` tables; `POST /attestations` (credential-gated, version-locked) + `revoke`; badge wiring; reset-on-edit; audit entries. | **M** | none |
| **3 — Per-person intake limits** | `care_intake_limit` table + CRUD endpoints + Owner/Co-Owner permissions + audit; `appliedLimits`/`intakeLimitCount` on run (stored; comparison no-ops until Phase 4). | **M** | none |
| **4 — FDC nutrition pipeline** | Nutrition Catalog service (USDA FDC + cache + match confidence); `recipe.nutrition` computed in the generation pipeline for **both** modes; `appliedLimits` comparison + `over`→`needs_nutrition_verification`; unmatched→Nutrition Verification Queue; conditional nutrient display. | **L** | **USDA FDC** |
| **5 — Structured Care Profile catalogs** | `care_diagnosis`/`care_medication` structured tables; ICD-10 + RxNorm catalog services + `/catalogs/*/search`; Care Profile autocomplete UI; diagnosis→module activation; backfill queue. | **L** | **NLM ICD-10, RxNorm**; FDA NDC/DailyMed optional |

**Phases 1–3 deliver the spec's headline** ("gate is a flag, not a wall" + attestation + badge + per-person limits captured) with **zero external dependencies** — shippable quickly and low-risk. **Phases 4–5 are the heavy external-integration projects**; scope and staff them separately. Open decisions in spec §12 (FDC match strategy, badge copy/Legal sign-off, credential-verification flow, re-attestation scope) gate Phases 4–5, not 1–3.

---

## 8. One-line summary for the client

*"Your engine stays. ~70% of this is net-new and lands in three buckets you have nothing for yet — clinician attestation/credentials, per-person nutrient limits, and the USDA-FDC + ICD-10 + RxNorm data stack. We can ship the whole 'gate is a flag + attestation + limits' outcome (Phases 1–3) fast with no external dependencies, then take on the FDC/medical-catalog integrations (Phases 4–5) as a separately-scoped effort. Two things in the handoff need a quick reconciliation first: the verdict taxonomy (we have 3 of the 6 statuses) and the fact that this replaces the current owner-approval review gate."*
