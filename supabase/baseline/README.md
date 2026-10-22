# Pre-repository baseline

These tables and RPCs were created in production (`IRIS_MEMORY`) before `supabase/migrations`
existed in this repository. They are captured here so a fresh environment can be rebuilt and
RLS can be reviewed. Files in this folder are **reference snapshots**, not migrations tracked by
`supabase_migrations.schema_migrations`; never push them to an existing production project.

- `00_tables_snapshot.sql` — table DDL reconstructed from the production catalog on 2026-10-22.
- `01_core_rpcs.sql` — memory/scene RPCs from the original dashboard migrations.

Apply order for a brand-new project: baseline files, then every file in `supabase/migrations`.
