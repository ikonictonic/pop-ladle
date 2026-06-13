-- Master Recipe Library — step 1: scope flag (single-table model).
--
-- Per the prototype's ALL_RECIPES_PLAN decision, master recipes reuse all the
-- existing recipe_adaptations machinery (photos, versions, clinical review,
-- accuracy checks) with a `scope` flag rather than a parallel table. A master
-- recipe is platform-owned content; a household copy points back to its master.
--
-- Additive + backward-compatible: default 'household' keeps every existing row
-- correct. Master recipes keep a non-null household_id (the publishing Super
-- Admin's household) to satisfy the existing NOT NULL constraint; lifting masters
-- to household_id = NULL is a later, larger change (see ALL_RECIPES_PLAN caveats).

alter table recipe_adaptations
  add column if not exists scope text
    not null default 'household'
    check (scope in ('household', 'master')),
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references app_users(id) on delete set null,
  -- A household copy records which master it was copied from (lineage + future
  -- "already added" de-duplication). Self-reference; null for originals/masters.
  add column if not exists source_master_recipe_id uuid
    references recipe_adaptations(id) on delete set null;

-- Browse-the-library query: published masters, newest first.
create index if not exists recipe_adaptations_master_published_idx
  on recipe_adaptations (published_at desc)
  where scope = 'master' and deleted_at is null;

-- Find household copies made from a given master.
create index if not exists recipe_adaptations_source_master_idx
  on recipe_adaptations (source_master_recipe_id)
  where source_master_recipe_id is not null;
