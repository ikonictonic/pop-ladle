// =============================================================================
// generationPolicy — single source of truth for "who may generate a recipe".
//
// Phase 1 of the recipe-generation capability lock. Per the doctrine in
// business/Pop_Ladle_Actual_Person_10_Step_Paths.md, generation is an
// Operate/Execute household action: Owner, Co-Owner, and Caregiver may generate;
// the Viewer is view/favorite/copy/print only; the Care Recipient is a profile
// subject who never logs in. Company/admin staff curate the master library
// (the Recipe Library Admin "accepts" a gate-cleared recipe) — they do not get
// a "generate" button.
//
// This is the ROLE gate only. Generation is independently gated to paid tiers
// (Solo+, good standing) by requireGeneratorAccess in ../plans/planService.js;
// both gates run on every POST /recipe-brain/runs. Keep this in sync with the
// frontend canGenerateRecipe() in services/roleService.js — note the frontend
// sees co_owner already normalized to owner by currentUserService.normalizeRole.
//
// Locked by generationPolicy.test.js — if the doctrine changes, change it there.
// =============================================================================

export const GENERATE_ROLES = Object.freeze(['owner', 'co_owner', 'caregiver'])

const GENERATE_ROLE_SET = new Set(GENERATE_ROLES)

/** True if a household membership role may run the recipe generator. */
export function canRoleGenerate(role) {
  return GENERATE_ROLE_SET.has(role)
}
