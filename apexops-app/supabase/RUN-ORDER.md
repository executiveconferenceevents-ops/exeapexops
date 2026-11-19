# Supabase SQL run order (best-known; verify live)

This is reconstructed from the project README, TODO, and migration dependencies. The repository does not contain a complete Supabase migration-history export, so the exact order already applied to staging or production is **uncertain**. Do not rerun migrations based only on this list. Compare it with the target project's migration history first. No Supabase connection was made while preparing this file.

## Historical base and event setup

1. `archive-do-not-run/schema.sql` - legacy base schema. Archived because it creates broad authenticated policies; do not rerun over an event-scoped database.
2. Feature setup, where needed on the original project: `exhibitor-logo-migration.sql`, `exhibitor-scanner-migration.sql`, `supplier-logo-migration.sql`, `media-buckets.sql`, `staff-photos-bucket.sql`, and `archive-do-not-run/client-ops-notifications-migration.sql`.
3. Optional staff/supplier field setup: `staff-supplier-fields.sql`; `people-migration.sql` is archived and must not be rerun because it recreates broad supplier policies.
4. `multi-client-events-migration.sql` - documented as following the base and feature setup and preceding event-scoped imports. Its `allow_all` references are only defensive drops; it creates scoped tenant/event policies.
5. `event-logo-migration.sql` - documented as following the multi-client migration.
6. `archive-do-not-run/rebooking-migration.sql` - legacy standalone schema and broad policies; use the event-scoped rebooking setup in the multi-client/client-Ops migrations instead.

## Later access, billing, and security stages

The README describes this security sequence after the base/event-code setup:

1. `client-event-limits-migration.sql`
2. `client-billing-access-migration.sql`
3. `staff-queue-security-migration.sql`
4. `event-code-rate-limit-migration.sql`
5. `client-trials-event-exemptions-migration.sql`
6. `event-expiration-migration.sql`
7. `event-code-rotation-migration.sql` and `platform-pricing-migration.sql`

The project TODO records these staged feature groups as applied in order, but does not record exact timestamps or the complete order between all supporting migrations:

- `platform-billing-foundation-migration.sql`
- `platform-invoice-records-migration.sql`
- `platform-invoice-payments-migration.sql`
- `platform-registration-access-migration.sql`
- `platform-operational-audit-migration.sql`
- `query-idempotency-consent-migration.sql`
- `query-photos-migration.sql`, followed by `query-photo-privacy-migration.sql` after the event-history helper exists
- `client-ops-notifications-migration.sql` was applied before the tenant/event migration in the legacy setup, but is now archived because its standalone policies are broad

The optional `conference-team-import.sql`, `staff-import.sql`, `workbook-import.sql`, `exhibitor-delivery-import.sql`, and `reset-live-event-data.sql` are data operations, not part of this schema migration sequence. Review their targets and effects separately before use.

## Prepared, not applied

- `migrations/20261118_exhibitor_services.sql` is supplied by the exhibitor-services package and has not been run.
- `migrations/20261118_fix_query_photo_access.sql` is a security-fix proposal and has not been run. Review it against the live policies before applying.