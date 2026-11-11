-- Read-only check: shows which APEXOPS migrations are already applied. Changes nothing.
-- Paste the whole file into the Supabase SQL Editor and click Run.
-- Apply missing security migrations in this order: event-code-hardening, query-photo-privacy, query-idempotency-consent.

select item, case when ok then 'OK' else 'MISSING - run ' || fix end as status
from (values
  ('Base tables (queries, staff, exhibitors, suppliers)',
    (select count(*) = 4 from information_schema.tables where table_schema = 'public' and table_name in ('queries', 'staff', 'exhibitors', 'suppliers')),
    'schema.sql (new project only)'),
  ('queries: source_tab, sla_deadline, updated_at',
    (select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'queries' and column_name in ('source_tab', 'sla_deadline', 'updated_at')),
    'schema.sql (only the "alter table public.queries" lines)'),
  ('staff: mobile, photo, supplier name, email',
    (select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'staff' and column_name in ('mobile', 'photo_url', 'supplier_name', 'email')),
    'people-migration.sql'),
  ('staff: supplier logo',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff' and column_name = 'supplier_logo_url'),
    'supplier-logo-migration.sql'),
  ('staff: departments',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff' and column_name = 'departments'),
    'staff-departments-migration.sql'),
  ('exhibitors: phone, email',
    (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'exhibitors' and column_name in ('phone', 'email')),
    'exhibitor-contacts-migration.sql'),
  ('exhibitors: logo',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'exhibitors' and column_name = 'logo_url'),
    'exhibitor-logo-migration.sql'),
  ('exhibitors: pack collected',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'exhibitors' and column_name = 'pack_collected_at'),
    'exhibitor-pack-migration.sql'),
  ('exhibitors: scanner tracking',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'exhibitors' and column_name = 'scanner_in_staff_contact'),
    'exhibitor-scanner-migration.sql'),
  ('Rebooking requests table',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rebooking_requests' and column_name = 'discussion_topics'),
    'rebooking-migration.sql'),
  ('Ops notifications and escalations',
    (select count(*) = 3 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('notify_ops_of_client_query', 'notify_ops_of_rebooking', 'prevent_duplicate_client_query'))
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'ops_notifications'),
    'client-ops-notifications-migration.sql'),
  ('Clients, events and memberships tables',
    (select count(*) = 4 from information_schema.tables where table_schema = 'public' and table_name in ('clients', 'events', 'client_event_memberships', 'platform_admins')),
    'multi-client-events-migration.sql'),
  ('Multi-client: event_id on queries, staff, exhibitors',
    (select count(*) = 3 from information_schema.columns where table_schema = 'public' and column_name = 'event_id' and table_name in ('queries', 'staff', 'exhibitors')),
    'multi-client-events-migration.sql'),
  ('Multi-client functions (create_client, is_platform_admin, public event lookups)',
    (select count(*) >= 5 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('create_client', 'is_platform_admin', 'list_public_events', 'get_public_event', 'submit_public_query', 'get_public_exhibitors')),
    'multi-client-events-migration.sql'),
  ('Events: dates, logo, next event, access code',
    (select count(*) = 4 from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name in ('event_start_date', 'logo_url', 'next_event_name', 'exhibitor_code')),
    'multi-client-events-migration.sql'),
  ('Storage: event, exhibitor and supplier logos',
    (select count(*) = 3 from storage.buckets where id in ('event-logos', 'exhibitor-logos', 'supplier-logos')),
    'media-buckets.sql'),
  ('Storage: staff photos',
    exists (select 1 from storage.buckets where id = 'staff-photos'),
    'staff-photos-bucket.sql'),
  ('Query photos (column, bucket, new submit function)',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'queries' and column_name = 'photo_urls')
      and exists (select 1 from storage.buckets where id = 'query-photos')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'submit_public_query' and p.prosrc like '%photo_urls%'),
    'query-photos-migration.sql'),
  ('Staff queues restricted to own assigned queries',
    (select count(*) = 3 from pg_policies where schemaname = 'public' and ((tablename = 'queries' and policyname in ('staff read assigned queries', 'staff update assigned queries')) or (tablename = 'staff' and policyname = 'staff read own profile'))),
    'staff-queue-security-migration.sql'),
  ('Event codes are random and guess attempts are rate-limited',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'validate_public_event_code')
      and exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname = 'event_code_attempts')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'events_exhibitor_code_unique_idx'),
    'event-code-hardening-migration.sql'),
  ('Query submission idempotency and durable consent',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'queries' and column_name = 'client_submission_id')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'event_privacy_acknowledgements')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'queries_event_submission_id_unique')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'acknowledge_public_event_privacy'),
    'query-idempotency-consent-migration.sql'),
  ('Private query photo storage',
    exists (select 1 from storage.buckets where id = 'query-photos-private' and public = false)
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_read_query_photo'),
    'query-photo-privacy-migration.sql')
) as checks(item, ok, fix);
