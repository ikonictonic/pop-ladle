-- Recipe relationships + master-recipe metadata.
--
-- Replaces the Supabase recipeRelationshipService / recipePairingService. Two
-- concerns, one table plus a few recipe columns:
--
--   1. Master recipes — a recipe_adaptations row can be flagged `is_master_recipe`
--      (already added in migration 012). This migration adds the two companion
--      fields the frontend read/wrote alongside the flag:
--        * master_recipe_note   — free-form caregiver note about the master.
--        * planned_over_count   — how many planned-over meals the caregiver
--                                 expects to get out of a big batch (nullable hint).
--
--   2. Directed + symmetric relationships (recipe_relationships):
--        * relationship_type 'planned_over'    — directed: source = master,
--                                                target = the planned-over meal.
--        * relationship_type 'pairs_well_with' — logically symmetric, stored as a
--                                                single lexicographically-ordered
--                                                (source < target) row so the unique
--                                                index rejects duplicates regardless
--                                                of the order the caller passed them.
--
-- Everything is household-scoped; recipe FKs cascade on recipe delete so a
-- deleted recipe takes its relationships with it.

-- --- Master-recipe companion columns (is_master_recipe already exists) --------
alter table recipe_adaptations
  add column if not exists master_recipe_note text,
  add column if not exists planned_over_count integer
    check (planned_over_count is null or planned_over_count >= 0);

-- --- Relationship edges --------------------------------------------------------
create table if not exists recipe_relationships (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  source_recipe_id uuid not null references recipe_adaptations(id) on delete cascade,
  target_recipe_id uuid not null references recipe_adaptations(id) on delete cascade,
  relationship_type text not null
    check (relationship_type in ('planned_over', 'pairs_well_with', 'variation_of')),
  note text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint recipe_relationships_no_self check (source_recipe_id <> target_recipe_id)
);

-- Idempotency: a directed edge (or a normalized symmetric pair) exists at most
-- once per household. The service maps 23505 → no-op create.
create unique index if not exists recipe_relationships_unique_edge_idx
  on recipe_relationships (household_id, source_recipe_id, target_recipe_id, relationship_type);

-- Outbound lookup: relationships where a recipe is the source.
create index if not exists recipe_relationships_source_idx
  on recipe_relationships (household_id, source_recipe_id, relationship_type);

-- Inbound lookup: relationships where a recipe is the target.
create index if not exists recipe_relationships_target_idx
  on recipe_relationships (household_id, target_recipe_id, relationship_type);
