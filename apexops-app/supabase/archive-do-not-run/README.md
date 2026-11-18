# Archived legacy SQL

Do not run these - they reopen access when applied after the event-scoped security migrations. They are retained for history only.

Files moved here:

- `schema.sql`
- `people-migration.sql`
- `rebooking-migration.sql`
- `client-ops-notifications-migration.sql`

`multi-client-events-migration.sql` is intentionally kept in the active `supabase/` folder. Although it mentions `allow_all`, those occurrences only drop old policies; it creates scoped tenant/event policies.

See `../RUN-ORDER.md` for the best-known documented sequence. That sequence is not a live database migration-history export.