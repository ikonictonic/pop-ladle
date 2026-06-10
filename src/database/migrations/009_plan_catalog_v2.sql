-- Plan catalog v2 — the Plan-2 §07 ladder.
--
-- Two free access tiers (anon browse is the public site, not a DB tier; 'free'
-- here is Free-with-Account) plus the paid ladder. Basic ($9.99) is the MVP-only
-- bridge that retires in Phase 2 when Solo and Family open; Pro/Clinician/
-- Enterprise follow in Phase 3.
--
-- household_member_limit counts login members including the owner
-- (Basic 1+1+1 = 3; Solo = owner + up to 5 caregivers = 6; null = unlimited).
-- Confirmed decisions: Family $39 (vs blueprint $49.99); free saved-recipe cap 180;
-- generator access is strictly Solo+ (Basic copies from the master library only).

insert into plan_definitions (
  code,
  display_name,
  monthly_price_cents,
  care_recipient_limit,
  household_member_limit,
  features
)
values
  ('free', 'Free with Account', 0, 1, 1, '{
    "phase": "mvp",
    "generator_access": false,
    "library_copy": false,
    "recipe_access": "browse_save",
    "care_profile": "basic",
    "hard_rules": false,
    "saved_recipe_cap": 180,
    "smart_filtering": false,
    "reports": "none",
    "family_kitchen": "none"
  }'::jsonb),
  ('basic', 'Basic', 999, 1, 3, '{
    "phase": "mvp_only",
    "retires": "phase_2",
    "generator_access": false,
    "library_copy": true,
    "recipe_access": "full",
    "care_profile": "full",
    "hard_rules": true,
    "saved_recipe_cap": null,
    "smart_filtering": false,
    "reports": "none",
    "family_kitchen": "1+1+1"
  }'::jsonb),
  ('solo', 'Solo', 1999, 1, 6, '{
    "phase": "phase_2",
    "generator_access": true,
    "library_copy": true,
    "recipe_access": "full",
    "care_profile": "full",
    "hard_rules": true,
    "saved_recipe_cap": null,
    "smart_filtering": "phase_2",
    "reports": "none",
    "family_kitchen": "team"
  }'::jsonb),
  ('family', 'Family', 3900, 3, null, '{
    "phase": "phase_2",
    "generator_access": true,
    "library_copy": true,
    "recipe_access": "full",
    "care_profile": "full",
    "hard_rules": true,
    "saved_recipe_cap": null,
    "smart_filtering": "phase_2",
    "reports": "basic",
    "family_kitchen": "family"
  }'::jsonb),
  ('pro', 'Pro', 7900, null, null, '{
    "phase": "phase_3",
    "generator_access": true,
    "library_copy": true,
    "recipe_access": "full",
    "care_profile": "full",
    "hard_rules": true,
    "saved_recipe_cap": null,
    "smart_filtering": true,
    "reports": "full",
    "family_kitchen": "team",
    "team": true
  }'::jsonb),
  ('clinician', 'Clinician', 17500, null, null, '{
    "phase": "phase_3",
    "generator_access": true,
    "library_copy": true,
    "recipe_access": "full",
    "care_profile": "deeper",
    "hard_rules": true,
    "saved_recipe_cap": null,
    "smart_filtering": true,
    "reports": "clinical",
    "family_kitchen": "practice",
    "caseload": true
  }'::jsonb),
  ('enterprise', 'Enterprise', null, null, null, '{
    "phase": "phase_3",
    "generator_access": true,
    "library_copy": true,
    "recipe_access": "full",
    "care_profile": "deeper",
    "hard_rules": true,
    "saved_recipe_cap": null,
    "smart_filtering": true,
    "reports": "org",
    "family_kitchen": "org",
    "enterprise_controls": true,
    "org_defined_limits": true
  }'::jsonb)
on conflict (code) do update set
  display_name = excluded.display_name,
  monthly_price_cents = excluded.monthly_price_cents,
  care_recipient_limit = excluded.care_recipient_limit,
  household_member_limit = excluded.household_member_limit,
  features = excluded.features,
  is_active = true;
