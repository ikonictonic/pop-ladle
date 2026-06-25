-- Recipe adaptation: add the missing hard_rules_updated_at_used column.
--
-- Migration 012 added clinical_profile_updated_at_used to recipe_adaptations but
-- deliberately skipped its sibling, on the (incorrect) note that
-- hard_rules_updated_at_used "already exists from migration 005". In fact 005
-- only added that column to recipe_brain_runs — never to recipe_adaptations.
--
-- The recipe projection (recipeService.recipeProjection) selects
-- ra.hard_rules_updated_at_used, so every recipe read/list failed with
-- Postgres 42703 (undefined_column) — surfaced in the app as "Something went
-- wrong" on My Recipes. This adds the missing column. Idempotent.

alter table recipe_adaptations
  add column if not exists hard_rules_updated_at_used timestamptz;
