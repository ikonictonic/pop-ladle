-- Recipe adaptation parity columns.
--
-- The frontend (migrating off Supabase) reads/writes a few recipe_adaptations
-- columns that the backend schema never created. This adds them so the Express
-- recipes API can reach parity and own the recipe library end-to-end:
--   * is_master_recipe          — library/detail "master recipe" badge. Populated
--                                 by the (not-yet-migrated) relationships feature;
--                                 defaults false so the badge simply reads false
--                                 until that slice lands.
--   * flavor_change_log         — append-only log of flavor tweaks, grown by the
--                                 in-place "modify" version op.
--   * prompt_version            — provenance: which prompt template generated this.
--   * clinical_profile_updated_at_used — provenance: clinical-profile freshness at
--                                 generation time (hard_rules_updated_at_used
--                                 already exists from migration 005).

alter table recipe_adaptations
  add column if not exists is_master_recipe boolean not null default false,
  add column if not exists flavor_change_log jsonb not null default '[]'::jsonb,
  add column if not exists prompt_version text,
  add column if not exists clinical_profile_updated_at_used timestamptz;
