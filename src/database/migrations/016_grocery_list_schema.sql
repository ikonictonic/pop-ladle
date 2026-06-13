-- Grocery list (Application Brain A9 shopping) — a household checklist, optionally
-- scoped to one care recipient. Items come from planned recipes (generated from
-- the Day Plan via the ingredient parser) or are added manually. normalized_key
-- is the parser's canonical ingredient noun, used to de-duplicate on generation.

create table if not exists grocery_list_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  care_recipient_id uuid references care_recipients(id) on delete cascade,
  item_text text not null,
  normalized_key text not null,
  source text not null default 'manual'
    check (source in ('manual', 'recipe')),
  source_recipe_id uuid references recipe_adaptations(id) on delete set null,
  checked boolean not null default false,
  position integer not null default 0,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grocery_list_items_text_not_blank check (length(trim(item_text)) > 0)
);

create index if not exists grocery_list_items_scope_idx
  on grocery_list_items (household_id, care_recipient_id, checked, position);

-- De-dup target for generate-from-plan: one auto/recipe item per normalized
-- ingredient per scope. Postgres 15+ NULLS NOT DISTINCT so the household-wide
-- (care_recipient_id is null) scope dedupes too. Manual items can still collide
-- intentionally only if they normalize differently; generation never inserts a
-- key that already exists in scope.
create unique index if not exists grocery_list_items_dedup_idx
  on grocery_list_items (household_id, care_recipient_id, normalized_key)
  nulls not distinct;

drop trigger if exists grocery_list_items_set_updated_at on grocery_list_items;
create trigger grocery_list_items_set_updated_at
before update on grocery_list_items
for each row execute function set_updated_at();
