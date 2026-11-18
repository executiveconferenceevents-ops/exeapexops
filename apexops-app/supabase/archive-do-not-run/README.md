# Archived legacy SQL

Do not run these - they reopen access when applied after the event-scoped security migrations. They are retained for history only.

Files moved here:

- `schema.sql`
- `people-migration.sql`
- `rebooking-migration.sql`
- `client-ops-notifications-migration.sql`
- `multi-client-events-migration.sql`

Important exception: `multi-client-events-migration.sql` contains the text `allow_all` only in defensive `DROP POLICY` statements. Its created tenant/event policies are scoped, not `USING (true)`. It is archived because it matched the requested text scan, but it is a historical bootstrap migration and should only be used for a fresh environment after a security review.

See `../RUN-ORDER.md` for the best-known documented sequence. That sequence is not a live database migration-history export.