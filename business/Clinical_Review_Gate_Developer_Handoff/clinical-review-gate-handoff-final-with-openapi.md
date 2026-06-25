# Pop & Ladle — Clinical Review Gate Rework
### Developer Handoff · v2

**Audience:** Full-stack developer
**Status:** Ready to build
**Scope:** MVP. Household tenants only.
**Supersedes:** v1. Two additions in this version — (1) an explicit *what was already right vs. what changed* section, and (2) the external data catalogs (USDA FoodData Central, ICD-10-CM, RxNorm family, FDA NDC/openFDA, DailyMed), which were missing in v1 and are critical to both the Care Profile and recipe nutrition.

**Naming correction carried into this doc:** **FoodData Central is USDA, not FDA.** USDA = food/nutrient truth. FDA = drug listing, labeling, NDC, adverse events, recalls. Both are used, for different things. Don't mislabel the food source as FDA anywhere in code or UI.

---

## 0. TL;DR

We're splitting the clinical review step into **two independent axes** and wiring **external data catalogs** as the source of truth for the facts the system reasons over.

1. **System/AI verdict** — what the run already produces (`approved`, `approved_with_caveats`, etc.).
2. **Human clinical attestation** — optional. Added by a Super Admin or any admin with verified clinical credentials. Absence never blocks publishing.

Plus the non-negotiable data rule:

3. **Nutrient values come from USDA FoodData Central, on every recipe, attestation or not.** The AI does not invent nutrient numbers. FDC (via our Nutrition Catalog mapping layer) supplies them; the Care Profile supplies the person's limits; the rule engine compares the two.

Governing rules:
- **`denied` is the only hard stop.** Nothing else blocks publishing.
- A recipe with no human attestation **still ships**, carrying a non-suppressible "AI-reviewed · not clinically verified" badge.
- Per-person limits are optional. We only *compare* a nutrient against a limit if that care recipient has that limit set — but we *compute* the FDC nutrient value regardless.

---

## 1. What was already right vs. what's changing

This is the part v1 skipped. Read it first so you know what to leave alone.

### Already right — DO NOT rebuild (the engine stays)

These are correct in the current run and stay exactly as-is:

- **The 8-specialist parallel Care Team** — NephAI, CardAI, PCPAI, Onc/HemaAI, NeuroAI, OrthoAI, NutrAI, StarChefAI. Roster, parallelism, per-route isolation: keep.
- **ChairwomanAI synthesis** — specialists → one synthesizer → final caregiver-ready answer. Keep.
- **The verdict taxonomy** — the six statuses (`approved`, `approved_with_caveats`, `denied`, `needs_clinical_review`, `needs_nutrition_verification`, `needs_household_adaptation`). Keep.
- **Per-route model run logging** — provider, model, input/output tokens, latency, error, ok-flag per specialist; chairwoman block. Keep.
- **Caveats / warning items / clinician flags** — `run.caveats`, `run.warningItems`, `run.clinicianFlags`, and the caregiver-facing `clinicalWarning` + `clinicalWarningItems` on the saved recipe. Keep and keep surfacing them.
- **The overall run object shape** — `household`, `requester`, `run`, `deliberations[]`, `chairwoman`, `recipe`. Keep; we add fields, we don't restructure.

### What's changing — this rework

1. **The gate becomes two-axis.** Today the AI verdict is auto-applied as the final clinical status and the recipe is saved immediately. We're separating the AI verdict (Axis A) from an optional human attestation (Axis B). *(§2 Decision A, §4, §5)*
2. **`denied` is the only publish blocker.** Every other status publishes, flagged. Lack of a human reviewer never stops a recipe. *(§4)*
3. **Attestation is credential-gated, not role-gated.** Super Admin or any admin with a verified credential can attest — not exclusively a dedicated Clinician Reviewer. *(§2 Decision A, §7)*
4. **Generation is explicitly two-mode** — generic (`careRecipientId == null`) vs. personalized. New `personalized` flag; the two are different artifacts. *(§2 Decision B, §6)*
5. **Nutrition becomes per-person and FDC-sourced.** Nutrient *values* come from USDA FoodData Central for every recipe. *Verification* against a ceiling happens only when the person has that limit. New `care_intake_limit`, `recipe.nutrition`, `run.appliedLimits`. *(§2 Decision C, §3, §8)*
6. **External catalogs are wired in as truth sources** — Care Profile diagnoses (ICD-10-CM), medications (RxNorm family + FDA NDC + DailyMed), recipe nutrition (USDA FDC). New structured fields on Care Profile and recipe. *(§3)*

Net: the engine doesn't change. The gate, the run's self-description, the data sources, and per-person nutrition do.

---

## 2. The three decisions (source of truth)

If anything below conflicts with the blueprint HTML, **these win.**

### Decision A — The gate is a flag, not a wall

| Axis | Field | Values | Who sets it |
|---|---|---|---|
| System verdict | `clinicalReviewStatus` | the six statuses | The run (ChairwomanAI) |
| Human attestation | `attestation.state` | `none`, `attested` | Super Admin OR admin with verified clinical credentials |

**Publishing:** `denied` → stopped (only block). Anything else → publishable, badge derived from attestation. Attest action gated by **credential on file**, not role title.

### Decision B — Generation is two-mode

- **Generic** (`careRecipientId == null`): no Care Profile/hard rules injected. Master Library candidate. `personalized: false`.
- **Personalized** (`careRecipientId` set): Care Profile + Hard Rule passes inject the person's diagnoses, meds, timing, intake limits, texture, avoids. Household Recipe Copy. `personalized: true`.
- **Hard rule:** never present a generic recipe as personalized; never silently bind a `personalized:false` run to a real care recipient.

### Decision C — Nutrition is FDC-sourced and per-person-conditional

- **Nutrient values:** always computed from USDA FoodData Central (through the Nutrition Catalog). Independent of attestation, computed for generic *and* personalized runs.
- **Hard Rule** = binary/absolute (e.g. "no shellfish"). Pass/fail. Always enforced when present.
- **Intake Limit** = numeric ceiling/target for *one nutrient, one person*. Optional. Drives *verification*, not value computation.
- **Display:** surface a nutrient only when the person has a limit on it, or it's explicitly requested. Stop printing a fixed sodium/K/P/sat-fat panel on every recipe. (Dad has a 2,000 mg potassium ceiling → show potassium for Dad. Mom has no phosphorus limit → don't show phosphorus for Mom.)

---

## 3. External data sources (the catalogs)

These already exist as named Layer 2 data stores (Nutrition Catalog, ICD-10 Catalog, RxNorm Catalog, USDA FoodData Central Catalog) and have an owning role (Nutrition Data Manager) and a Nutrition Verification Queue. v1 omitted them; they are first-class here. **Postgres is the system of record; the catalogs are the domain-truth layer that populates it.**

> **Known blueprint gap (flag for the architecture docs):** The catalogs are present at the data-store layer, but the Care Profile sections of the blueprints list their fields (Diagnoses, Medications, Medication timing, Intake limits) *without drawing the line back to the source catalog.* The connection — Diagnoses ← ICD-10-CM, Medications ← RxNorm, nutrient values ← USDA FDC — is implicit, not shown. This handoff binds them at the **data-model** level (§4.7, §4.2). The **blueprint diagrams** should be updated to show the catalog → Care-Profile link explicitly so the dependency is visible to anyone reading the Care Profile module.

### 3.1 Source-of-truth split

| Layer | Source of truth | Owner | Used for |
|---|---|---|---|
| Food / nutrients | **USDA FoodData Central** (via internal Nutrition Catalog mapping) | USDA | Every recipe's nutrient values + portion math |
| Diagnosis codes | **ICD-10-CM** (CDC/NCHS; accessed via NLM Clinical Tables API) | CDC/NCHS | Structured diagnoses in Care Profile |
| Medication normalization | **RxNorm / RxNav** (NIH/NLM) | NIH/NLM | Structured meds (RxCUI, ingredient, brand/generic, strength, form, route) |
| Medication display/search | **RxTerms** (NIH/NLM) | NIH/NLM | Human-friendly med autocomplete |
| Medication classes | **RxClass / MED-RT** (NIH/NLM) | NIH/NLM | Class-based review triggers (anticoagulant, diuretic, sedating, etc.) |
| Product / package identity | **FDA NDC / openFDA Drug NDC** | FDA | Identify exact product from bottle/label/barcode before mapping to RxNorm |
| Drug label language | **DailyMed SPL** (NIH/NLM, FDA-submitted labeling) | NIH/NLM | Label reference for clinical review packets |
| Drug safety reference (optional) | **openFDA Labeling / Adverse Events / Recalls** | FDA | Review flags + staff packets only — never direct caregiver advice |
| Safety/review flags | Pop & Ladle internal rule engine | Internal | Triggered flags, candidates, reasoning |
| Household reality | Care Profile | Internal | Lived operating picture (eats/refuses/texture/appetite/limits) |
| Final release decision | Clinical Review workflow | Internal | Attestation + publish state |

**One-line summary for the team:** USDA tells us what's *in the food*. ICD-10-CM tells us what *conditions* the profile is organized around. RxNorm tells us what *drug the person is actually taking*. FDA NDC + DailyMed give *product and label* context. Pop & Ladle decides how those facts hit the person, recipe, caregiver, and kitchen.

### 3.2 Where each catalog plugs into the pipeline

- **Care Profile — Diagnosis entry:** caregiver types a condition → NLM Clinical Tables ICD-10-CM API returns candidates → profile stores code + label + version + confirmation source. Diagnosis records activate clinical modules / review lanes / recipe constraints (e.g. CKD activates potassium/phosphorus/sodium/hydration/protein candidates; Parkinson's activates protein-timing candidates).
- **Care Profile — Medication entry:** caregiver types/scans a med → RxNorm/RxTerms for identity, FDA NDC for product/package match, RxClass/MED-RT for class context, DailyMed for label reference. Profile stores RxCUI, ingredient, brand/generic, strength, form, route, drug class, NDC, SPL ref where available.
- **Recipe — Nutrition:** at generation time, ingredients are matched to FDC foods → FDC supplies sodium/potassium/phosphorus/protein/etc. → Pop & Ladle serving math scales to portion → values stored on the recipe with a match-confidence score. This runs for **every** recipe.
- **Rule engine — Comparison:** recipe FDC values vs. the person's `care_intake_limit` rows + hard rules + diagnosis-activated candidates → triggers caveats/flags/status.
- **Clinical Review packet:** reviewer sees source IDs (FDC IDs, ICD-10 codes, RxCUI, NDC, SPL), match confidence, triggered flags, nutrient values, substitutions, reasoning.
- **Caregiver view:** the simple version — serve, portion, swap, hold for review, or ask the care team. The heavy payload stays in the back end.

### 3.3 Integration notes for build

- Treat each external API behind an **internal catalog/service boundary** (Nutrition Catalog, ICD-10 Catalog, RxNorm Catalog). Don't call the public APIs inline from the recipe path — go through the cached/mapped catalog so the Nutrition Data Manager can correct mismatches and re-verify affected recipes (this workflow already exists).
- **FDC match is the critical path for nutrition.** Every recipe needs FDC-backed values. Store the FDC food ID(s) and a match-confidence score per ingredient. No-match is a flagged state, not a silent zero (see §8).
- Catalog versions are pinned and stored on the records they produce (ICD-10 version, RxNorm release, FDC dataset) so a recipe/profile is reproducible and auditable.

---

## 4. Data model changes

Diffed against the run/recipe JSON the system already produces.

### 4.1 `recipe_generation_run` (modify)

```jsonc
{
  // ...existing (id, householdId, careRecipientId, status, mode, verdict, deliberations, chairwoman, ...)
  "personalized": false,          // NEW. true iff careRecipientId non-null at run time
  "hardRuleCount": 0,             // EXISTING
  "intakeLimitCount": 0,          // NEW. per-person intake limits applied this run
  "appliedLimits": [              // NEW. which limits were checked + result (empty on generic)
    { "nutrient": "potassium", "ceiling": 2000, "unit": "mg", "window": "per_day",
      "fdcEstimated": 180, "result": "within" }   // within | over | unknown
  ],
  "nutritionSource": "usda_fdc",  // NEW. provenance tag; constant for MVP
  "catalogVersions": {            // NEW. pinned versions for reproducibility
    "fdc": "2026-04", "icd10cm": "FY2026", "rxnorm": "2026-06"
  }
}
```

### 4.2 `recipe.nutrition` (NEW — FDC-sourced, on every recipe)

```jsonc
{
  "source": "usda_fdc",
  "computedAt": "iso8601",
  "perServing": true,
  "ingredients": [
    { "raw": "1 cup Greek yogurt", "fdcId": 171304, "matchConfidence": 0.92,
      "nutrients": { "sodium_mg": 60, "potassium_mg": 240, "phosphorus_mg": 200, "protein_g": 20 } }
  ],
  "totals": { "sodium_mg": 0, "potassium_mg": 0, "phosphorus_mg": 0, "protein_g": 0, "calories": 0 },
  "unmatchedIngredients": [],     // ingredients FDC could not match — flag, do not zero
  "overallConfidence": 0.0        // aggregate match confidence
}
```

This object exists whether or not there's a care recipient and whether or not there's attestation. Display is still gated per §3.2/§8, but the data is always computed and stored.

### 4.3 `clinical_attestation` (NEW)

```jsonc
{
  "id": "uuid", "recipeId": "uuid", "recipeVersionId": "uuid", "runId": "uuid",
  "attestedBy": "userId", "credentialRef": "uuid",  // FK to verified_credential; REQUIRED
  "decision": "attested",                            // attested | revoked
  "reasoning": "string",                             // required
  "attestedAt": "iso8601", "versionLock": true, "auditEntryId": "uuid"
}
```

Create allowed only if `attestedBy` is Super Admin OR has an active `verified_credential`. Editing the recipe → new version → `attestation.state` resets to `none` (old attestation kept in history, append-only).

### 4.4 `recipe` (modify)

```jsonc
{
  // ...existing (id, careRecipientId, title, outputMarkdown, clinicalReviewStatus, clinicalWarning, clinicalWarningItems, ...)
  "personalized": false,            // NEW
  "attestationState": "none",       // NEW. none | attested (denormalized for badge)
  "currentAttestationId": null,     // NEW
  "publishState": "publishable",    // NEW. publishable | stopped (stopped iff clinicalReviewStatus == denied)
  "nutrition": { /* see 4.2 */ }    // NEW
}
```

`publishState = (clinicalReviewStatus == "denied") ? "stopped" : "publishable"` — derived, not user-set.

### 4.5 `verified_credential` (NEW, minimal for MVP)

```jsonc
{
  "id": "uuid", "userId": "uuid",
  "credentialType": "RD | MD | DO | NP | RN | clinical_nutrition | other",
  "licenseRef": "string", "verifiedBy": "userId", "verifiedAt": "iso8601",
  "active": true, "expiresAt": "iso8601 | null"
}
```

MVP: seeded manually by Super Admin.

### 4.6 `care_intake_limit` (NEW — per-person, optional)

```jsonc
{
  "id": "uuid", "careRecipientId": "uuid",
  "nutrient": "potassium | phosphorus | sodium | fluid | protein | added_sugar | saturated_fat | carbohydrate",
  "limitType": "ceiling | target | floor", "value": 2000, "unit": "mg | g | ml",
  "window": "per_day | per_meal | per_serving",
  "setBy": "userId", "source": "owner | co_owner | clinician_import",
  "createdAt": "iso8601", "auditEntryId": "uuid"
}
```

### 4.7 Care Profile structured-catalog fields (modify diagnosis & medication objects)

```jsonc
// care_diagnosis
{ "id": "uuid", "careRecipientId": "uuid",
  "icd10Code": "N18.3", "label": "CKD stage 3", "icd10Version": "FY2026",
  "confirmationSource": "provider | caregiver", "active": true,
  "activatedModules": ["renal"] }

// care_medication
{ "id": "uuid", "careRecipientId": "uuid",
  "rxcui": "1234567", "ingredient": "zanubrutinib", "brand": "Brukinsa",
  "strength": "80 mg", "doseForm": "capsule", "route": "oral",
  "drugClass": ["BTK inhibitor"], "ndc": "00000-0000-00", "splSetId": "uuid|null",
  "rxnormVersion": "2026-06", "dosingSchedule": "string", "foodTimingRule": "string|null" }
```

### 4.8 `audit_log` (append-only — confirm coverage)

Audit entries for: attest, revoke, intake-limit CRUD, diagnosis/medication CRUD (with source IDs + catalog versions), nutrition catalog corrections, publish-state change, run completion. Append-only.

---

## 5. Gate state machine

```
   Generation Run → ChairwomanAI verdict → sets clinicalReviewStatus
                                 │
                  ┌──────────────┴──────────────┐
              == denied                     != denied
                  │                              │
            publishState=                  publishState=
             "stopped"                     "publishable"
            (HARD STOP)                          │
                                  ┌──────────────┴──────────────┐
                            attestation=none              attestation=attested
                                  │                              │
                       Badge: "AI-reviewed ·            Badge: "Clinically
                        not clinically verified"          reviewed"
                       (ships, flagged)                  (ships)
```

**Invariants for QA:** publishes fine with `attestation=none`; only `denied` blocks; editing an attested recipe resets attestation to `none`; badge is never suppressible by any role including Owner.

---

## 6. Generation pipeline branching

```
Ingestion → Normalization → [branch on careRecipientId]
  generic:      skip Care Profile Pass + Hard Rule Pass; appliedLimits=[]; personalized=false
  personalized: Care Profile Pass + Hard Rule Pass; load care_intake_limit + hard rules; personalized=true
→ Specialist Parallel Review (8) → ChairwomanAI → [gate: set clinicalReviewStatus]
→ Flavor → Pairing/Variation
→ Nutrition Verification  ← FDC LOOKUP RUNS HERE FOR BOTH MODES (values always computed)
                            generic:      compute recipe.nutrition, no per-person comparison
                            personalized: compute recipe.nutrition AND compare vs appliedLimits
→ Version History
```

Both modes run all 8 specialists, ChairwomanAI, and FDC nutrition computation. The branch only controls *injected context* and *whether values are compared against a person's limits.*

---

## 7. Permissions

| Action | Allowed by | Check |
|---|---|---|
| Run generation (generic) | Owner, Co-Owner, Caregiver | role |
| Run generation (personalized) | Owner, Co-Owner, Caregiver | role + careRecipient in household |
| Create/edit `care_intake_limit` | Owner, Co-Owner | role + household scope |
| Create/edit diagnosis & medication | Owner, Co-Owner | role + household scope |
| Attest a recipe | Super Admin OR active `verified_credential` | **credential, not role title** |
| Revoke attestation | Super Admin OR original attester | credential |
| Publish / copy | any recipe-acting role | blocked only if `publishState == stopped` |
| Maintain Nutrition Catalog / FDC mappings | Nutrition Data Manager | internal scope |
| Suppress badge | **nobody** | always rendered |

---

## 8. Nutrition verification logic

```
function computeAndVerify(recipe, careRecipientId):
    # 1. ALWAYS compute values from FDC (both modes, attestation-independent)
    recipe.nutrition = fdcLookup(recipe.ingredients)   # match each ingredient → FDC → scale to serving
    flagLowConfidenceAndUnmatched(recipe.nutrition)    # no-match => unmatchedIngredients, NOT zero

    # 2. Compare ONLY against limits the person actually has
    if careRecipientId == null:
        return []                                      # generic: values computed, no comparison
    limits = care_intake_limit.where(careRecipientId)
    results = []
    for limit in limits:
        est = recipe.nutrition.totals[limit.nutrient]  # may be null if unmatched/unknown
        if est == null:                 result = "unknown"
        elif limit.limitType=="ceiling": result = est <= limit.value ? "within" : "over"
        elif limit.limitType=="floor":   result = est >= limit.value ? "within" : "under"
        else:                            result = "within"   # target advises, doesn't fail
        results.append({nutrient, ceiling: limit.value, unit, window, fdcEstimated: est, result})
    return results
```

- **Values: always from FDC.** AI never fabricates nutrient numbers.
- **Display:** surface a nutrient only if it's in `appliedLimits` or explicitly requested.
- **`over`:** raises a caveat, can set `needs_nutrition_verification` — still publishable (flagged). Not an auto-deny.
- **`unknown` / unmatched ingredient:** does not block; lowers `overallConfidence` and shows a "nutrition estimate incomplete" note. Routes to the Nutrition Verification Queue for the Nutrition Data Manager.

---

## 9. UI requirements

- **Badge** on every recipe surface (library card, detail, print, copy-into-household, planner attachment): "Clinically reviewed" or "AI-reviewed · not clinically verified". Non-suppressible.
- **Nutrition provenance:** where nutrient values show, label the source ("Nutrition from USDA FoodData Central") and show a low-confidence / incomplete note when applicable. Never present a fabricated number.
- **Personalization label:** generic → "General guidance — not tuned to a specific person." Personalized → show care-recipient context.
- **Nutrient lines** render conditionally per §8 (only what the person has a limit on, or what's requested).
- **Diagnosis/medication chips** show the structured label; source codes (ICD-10, RxCUI, NDC) live in the back end / review packet, not the caregiver face.
- **Denied recipes** render stopped — visible in history/audit, not publishable.
- **Print layout** includes badge + hard-rule callout.
- Copy tone: calm, actionable, never alarm-without-action.

---

## 10. Migration / backfill

1. `personalized = (careRecipientId != null)`.
2. `attestationState = none` for all existing rows.
3. `publishState`: `denied → stopped`, else `publishable`.
4. `appliedLimits = []`, `intakeLimitCount = 0` for legacy rows (mark legacy; re-run on next personalized use).
5. `recipe.nutrition`: backfill via FDC for existing recipes where ingredients are parseable; flag the rest into the Nutrition Verification Queue. Do not write zeros.
6. Care Profile diagnoses/meds entered as free text pre-rework: queue for ICD-10 / RxNorm normalization; keep original text until confirmed.
7. Additive columns + new tables + backfill jobs. No destructive changes.

---

## 11. QA test cases

| # | Scenario | Expected |
|---|---|---|
| 1 | Generic run, `approved_with_caveats` | publishable, badge "AI-reviewed", `personalized:false`, `appliedLimits:[]`, **but `recipe.nutrition` populated from FDC** |
| 2 | Generic run, `denied` | stopped, not publishable |
| 3 | Personalized, person has potassium ceiling 2000mg, FDC total 180mg | `appliedLimits` potassium `within`, potassium shown |
| 4 | Personalized, person has NO phosphorus limit | phosphorus NOT compared, NOT shown — **but still present in `recipe.nutrition.totals`** |
| 5 | FDC total exceeds ceiling | caveat, `needs_nutrition_verification`, still publishable |
| 6 | Attest without credential | 403 |
| 7 | Attest by Super Admin | badge → "Clinically reviewed", audit logged w/ reviewer + reasoning |
| 8 | Edit attested recipe | new version, `attestationState` → `none`, badge reverts |
| 9 | Owner tries to hide badge | impossible |
| 10 | Generic recipe bound to real care recipient w/o re-run | blocked / forces re-check |
| 11 | Ingredient FDC no-match | listed in `unmatchedIngredients`, not zeroed, routed to Nutrition Verification Queue, recipe still publishable with incomplete-nutrition note |
| 12 | Diagnosis entry "CKD" | resolves to ICD-10-CM N18.x via NLM API, stores code + version, activates renal candidates |
| 13 | Medication entry "Brukinsa" | normalizes to zanubrutinib via RxNorm, stores RxCUI + class |
| 14 | All audit actions (attest, revoke, limit CRUD, dx/med CRUD, nutrition correction, publish-state change) | append-only entries with source IDs + catalog versions |

---

## 12. Open decisions (not blocking the build)

1. **FDC match strategy** — exact-match threshold, fallback behavior, and handling of composite/prepared foods. (The *source* is settled: USDA FDC. This is only about match quality.)
2. **`target` / `floor` limit types** — confirm MVP needs floor (e.g. minimum protein) or ceilings only.
3. **openFDA adverse-events / recalls** — confirm in/out for MVP; if in, review-packet-only (never caregiver-facing).
4. **Re-attestation scope** — reset on any edit (current spec) vs. only nutrition-relevant edits (add a "nutrition-relevant edit" flag to reduce churn).
5. **Badge wording** — "AI-reviewed · not clinically verified" is placeholder; Legal/Compliance + Clinical Editor sign-off on final copy.
6. **Credential verification flow** — MVP is Super Admin manual seed; confirm acceptable for launch.

---

## Appendix — mapping to the current JSON

- `run.verdict` → `clinicalReviewStatus` (unchanged AI verdict)
- `run.caveats` / `warningItems` / `clinicianFlags` → keep
- `deliberations[]`, `chairwoman` → unchanged
- **NEW on run:** `personalized`, `intakeLimitCount`, `appliedLimits`, `nutritionSource`, `catalogVersions`
- **NEW on recipe:** `personalized`, `attestationState`, `currentAttestationId`, `publishState`, `nutrition`
- **NEW objects:** `clinical_attestation`, `verified_credential`, `care_intake_limit`
- **MODIFIED:** `care_diagnosis` (+ICD-10 fields), `care_medication` (+RxNorm/NDC/SPL fields)
- **Catalogs (already in Layer 2, now wired):** USDA FoodData Central, ICD-10-CM, RxNorm/RxTerms/RxClass, FDA NDC/openFDA, DailyMed

The engine doesn't change. The gate, the run's self-description, the data sources, and per-person nutrition do.

---

## 13. OpenAPI stub (scaffold-ready)

OpenAPI 3.1. Stub-level: paths, methods, request/response shapes, auth, and error envelope for the five endpoints called out in this rework — **attest**, **revoke**, **intake-limit CRUD**, **diagnosis lookup (ICD-10-CM)**, and **medication lookup (RxNorm)**. Schemas mirror the data objects in §4. Lookup endpoints proxy the internal catalogs (§3.3), not the public APIs directly. Fill in server URLs, pagination defaults, and rate limits per environment.

```yaml
openapi: 3.1.0
info:
  title: Pop & Ladle — Clinical Review & Catalog API (MVP stub)
  version: 0.1.0
  description: >
    Attestation, per-person intake limits, and catalog lookups for diagnoses
    (ICD-10-CM) and medications (RxNorm). Nutrient values are sourced from USDA
    FoodData Central via the internal Nutrition Catalog and are computed on the
    recipe; they are not set through this API.

servers:
  - url: https://api.popandladle.example/v1

security:
  - bearerAuth: []

tags:
  - name: attestation
  - name: intake-limits
  - name: catalog-lookup

paths:

  /recipes/{recipeId}/attestations:
    post:
      tags: [attestation]
      summary: Attest a recipe (human clinical sign-off)
      description: >
        Creates a clinical attestation for a specific recipe version. Allowed only
        if the caller is Super Admin OR holds an active verified_credential.
        Does NOT change publishState. Sets attestationState = attested for the
        locked version. Editing the recipe later resets attestationState to none.
      operationId: attestRecipe
      parameters:
        - $ref: '#/components/parameters/RecipeId'
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [recipeVersionId, runId, credentialRef, reasoning]
              properties:
                recipeVersionId: { type: string, format: uuid }
                runId: { type: string, format: uuid }
                credentialRef:
                  type: string
                  format: uuid
                  description: FK to an active verified_credential for the caller.
                reasoning: { type: string, minLength: 1 }
      responses:
        '201':
          description: Attestation created.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ClinicalAttestation' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '403':
          description: >
            Caller is neither Super Admin nor holder of an active verified_credential,
            OR credentialRef is not active.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409':
          description: recipeVersionId no longer current (version moved on); re-fetch and retry.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }

  /recipes/{recipeId}/attestations/{attestationId}/revoke:
    post:
      tags: [attestation]
      summary: Revoke an existing attestation
      description: >
        Marks an attestation revoked (append-only; the original row is retained
        in history). Allowed for Super Admin OR the original attester. Reverts the
        live badge to "AI-reviewed · not clinically verified".
      operationId: revokeAttestation
      parameters:
        - $ref: '#/components/parameters/RecipeId'
        - name: attestationId
          in: path
          required: true
          schema: { type: string, format: uuid }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [reasoning]
              properties:
                reasoning: { type: string, minLength: 1 }
      responses:
        '200':
          description: Attestation revoked.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/ClinicalAttestation' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }

  /care-recipients/{careRecipientId}/intake-limits:
    parameters:
      - $ref: '#/components/parameters/CareRecipientId'
    get:
      tags: [intake-limits]
      summary: List a care recipient's intake limits
      operationId: listIntakeLimits
      responses:
        '200':
          description: Intake limits (may be empty).
          content:
            application/json:
              schema:
                type: array
                items: { $ref: '#/components/schemas/CareIntakeLimit' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
    post:
      tags: [intake-limits]
      summary: Create an intake limit (Owner / Co-Owner)
      operationId: createIntakeLimit
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CareIntakeLimitInput' }
      responses:
        '201':
          description: Created.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/CareIntakeLimit' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '403': { $ref: '#/components/responses/Forbidden' }

  /care-recipients/{careRecipientId}/intake-limits/{limitId}:
    parameters:
      - $ref: '#/components/parameters/CareRecipientId'
      - name: limitId
        in: path
        required: true
        schema: { type: string, format: uuid }
    patch:
      tags: [intake-limits]
      summary: Update an intake limit (Owner / Co-Owner)
      operationId: updateIntakeLimit
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/CareIntakeLimitInput' }
      responses:
        '200':
          description: Updated.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/CareIntakeLimit' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
    delete:
      tags: [intake-limits]
      summary: Delete an intake limit (Owner / Co-Owner)
      operationId: deleteIntakeLimit
      responses:
        '204': { description: Deleted. }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }

  /catalogs/icd10/search:
    get:
      tags: [catalog-lookup]
      summary: Diagnosis lookup (ICD-10-CM via internal ICD-10 Catalog)
      description: >
        Proxies the internal ICD-10 Catalog (backed by NLM Clinical Tables
        ICD-10-CM). Powers diagnosis autocomplete in the Care Profile. Returns
        code + label + catalog version; the selected result is stored on care_diagnosis.
      operationId: searchIcd10
      parameters:
        - name: q
          in: query
          required: true
          schema: { type: string, minLength: 2 }
          description: Partial condition name or code (e.g. "CKD", "N18").
        - name: limit
          in: query
          schema: { type: integer, default: 10, maximum: 50 }
      responses:
        '200':
          description: Candidate diagnoses.
          content:
            application/json:
              schema:
                type: object
                properties:
                  catalogVersion: { type: string, example: "FY2026" }
                  results:
                    type: array
                    items: { $ref: '#/components/schemas/Icd10Result' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '502':
          description: Upstream catalog/source unavailable.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }

  /catalogs/rxnorm/search:
    get:
      tags: [catalog-lookup]
      summary: Medication lookup (RxNorm via internal RxNorm Catalog)
      description: >
        Proxies the internal RxNorm Catalog (RxNorm/RxTerms for identity/display,
        RxClass/MED-RT for class). Powers medication autocomplete in the Care
        Profile. Returns RxCUI + ingredient + brand/generic + class; the selected
        result is stored on care_medication. NDC/SPL resolution is a separate step.
      operationId: searchRxNorm
      parameters:
        - name: q
          in: query
          required: true
          schema: { type: string, minLength: 2 }
          description: Partial drug name (brand or generic), e.g. "Brukinsa".
        - name: limit
          in: query
          schema: { type: integer, default: 10, maximum: 50 }
      responses:
        '200':
          description: Candidate medications.
          content:
            application/json:
              schema:
                type: object
                properties:
                  catalogVersion: { type: string, example: "2026-06" }
                  results:
                    type: array
                    items: { $ref: '#/components/schemas/RxNormResult' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '502':
          description: Upstream catalog/source unavailable.
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Error' }

components:

  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  parameters:
    RecipeId:
      name: recipeId
      in: path
      required: true
      schema: { type: string, format: uuid }
    CareRecipientId:
      name: careRecipientId
      in: path
      required: true
      schema: { type: string, format: uuid }

  responses:
    BadRequest:
      description: Validation error.
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    Forbidden:
      description: Caller lacks the required permission or credential.
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }
    NotFound:
      description: Resource not found or not in caller's household scope.
      content:
        application/json:
          schema: { $ref: '#/components/schemas/Error' }

  schemas:

    Error:
      type: object
      required: [code, message]
      properties:
        code: { type: string, example: "credential_required" }
        message: { type: string }
        details: { type: object, additionalProperties: true }

    ClinicalAttestation:
      type: object
      properties:
        id: { type: string, format: uuid }
        recipeId: { type: string, format: uuid }
        recipeVersionId: { type: string, format: uuid }
        runId: { type: string, format: uuid }
        attestedBy: { type: string, format: uuid }
        credentialRef: { type: string, format: uuid }
        decision: { type: string, enum: [attested, revoked] }
        reasoning: { type: string }
        attestedAt: { type: string, format: date-time }
        versionLock: { type: boolean }
        auditEntryId: { type: string, format: uuid }

    CareIntakeLimitInput:
      type: object
      required: [nutrient, limitType, value, unit, window]
      properties:
        nutrient:
          type: string
          enum: [potassium, phosphorus, sodium, fluid, protein, added_sugar, saturated_fat, carbohydrate]
        limitType: { type: string, enum: [ceiling, target, floor] }
        value: { type: number }
        unit: { type: string, enum: [mg, g, ml] }
        window: { type: string, enum: [per_day, per_meal, per_serving] }

    CareIntakeLimit:
      allOf:
        - $ref: '#/components/schemas/CareIntakeLimitInput'
        - type: object
          properties:
            id: { type: string, format: uuid }
            careRecipientId: { type: string, format: uuid }
            setBy: { type: string, format: uuid }
            source: { type: string, enum: [owner, co_owner, clinician_import] }
            createdAt: { type: string, format: date-time }
            auditEntryId: { type: string, format: uuid }

    Icd10Result:
      type: object
      properties:
        code: { type: string, example: "N18.3" }
        label: { type: string, example: "Chronic kidney disease, stage 3 (moderate)" }
        activatesModules:
          type: array
          items: { type: string }
          example: ["renal"]

    RxNormResult:
      type: object
      properties:
        rxcui: { type: string, example: "1597582" }
        ingredient: { type: string, example: "zanubrutinib" }
        brand: { type: string, nullable: true, example: "Brukinsa" }
        generic: { type: boolean, example: false }
        strength: { type: string, nullable: true, example: "80 mg" }
        doseForm: { type: string, nullable: true, example: "capsule" }
        route: { type: string, nullable: true, example: "oral" }
        drugClass:
          type: array
          items: { type: string }
          example: ["BTK inhibitor"]
```

**Scaffolding notes:**
- The **attest** 403 path is the one to test first — it enforces credential-gating, the core of Decision A. Caller role alone never grants it.
- `409` on attest guards the version lock: if the recipe version moved between fetch and attest, the client re-fetches.
- Lookup endpoints return `catalogVersion` so the caller can persist it on `care_diagnosis` / `care_medication` for reproducibility (§3.3, §4.7).
- No endpoint sets nutrient values — those are computed from USDA FDC on the recipe (§8). This API only handles limits, attestation, and lookups.
- Add `/recipes/{id}` GET to your existing recipe surface so the new fields (`attestationState`, `publishState`, `personalized`, `nutrition`) are returned; not stubbed here since the recipe read endpoint already exists.
