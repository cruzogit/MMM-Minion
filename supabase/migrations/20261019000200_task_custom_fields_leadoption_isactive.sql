-- Two columns that exist in the live database (they were added by a schema push, not by a migration file) and in prisma/schema.prisma,
-- written down here so a database built from these files matches. Safe to run on the live database: both columns are already there.
--   "Task"."customFields"      values of the fields added in Tasks > Edit Page Layout, keyed by field key (cf_...)
--   "LeadOption"."isActive"    read by the Leads / Deals import to leave out options that are switched off (default: on). The earlier
--                              migration 20261005000100 dropped this column; it came back with the import, and nothing switches it off.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "customFields" JSONB;
ALTER TABLE "LeadOption" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
