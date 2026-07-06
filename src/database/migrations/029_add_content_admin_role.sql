-- Content Admin — the business ABAC doc's PL-005 "Recipe Library Admin":
-- may generate, edit, publish, and quality-review Master Library recipes;
-- denied billing and admin-personnel management (those gates stay super-only).
--
-- Standalone migration (008 pattern): a new enum value cannot be USED in the
-- same transaction that adds it. All code references land in the app layer.
alter type internal_admin_role add value if not exists 'content_admin';
