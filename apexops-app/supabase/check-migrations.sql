-- Read-only check: shows which APEXOPS migrations are already applied. Changes nothing.
-- Paste the whole file into the Supabase SQL Editor and click Run.
-- Apply required schema, entitlement, lifecycle and security migrations before deploying the app.

select checks.check_name, case when fix like 'MANUAL: %' then 'MANUAL REVIEW - ' || substr(fix, 9) when ok then 'OK' else 'MISSING - run ' || fix end as status
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
  ('Staff can read only assigned work and its related records',
    (select count(*) = 5 from pg_policies where schemaname = 'public' and ((tablename = 'queries' and policyname in ('staff read assigned queries', 'staff update assigned queries')) or (tablename = 'staff' and policyname = 'staff read own profile') or (tablename = 'exhibitors' and policyname = 'staff read assigned exhibitors') or (tablename = 'suppliers' and policyname = 'event managers read suppliers')))
      and not exists (select 1 from pg_policies where schemaname = 'public' and ((tablename = 'queries' and policyname = 'event members read queries') or (tablename = 'exhibitors' and policyname = 'event members read exhibitors') or (tablename = 'suppliers' and policyname = 'client members read suppliers'))),
    'staff-queue-security-migration.sql'),
  ('Event codes are random and failed attempts are recorded',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'validate_public_event_code')
      and exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname = 'event_code_attempts')
      and exists (select 1 from pg_trigger where tgrelid = 'public.events'::regclass and tgname = 'events_set_exhibitor_code' and not tgisinternal),
    'event-code-hardening-migration.sql'),
  ('Event-code lockout validator installed',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'event_code_rate_limit_version')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'validate_public_event_code' and p.prosrc like '%if current_attempts >= 10%'),
    'event-code-rate-limit-migration.sql'),
  ('Event-code rate limiting in the deployed environment',
    false,
    'MANUAL: verify trusted proxy IP headers, concurrent requests and all public access paths'),
  ('Query submission idempotency and durable consent',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'queries' and column_name = 'client_submission_id')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'event_privacy_acknowledgements')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'queries' and column_name = 'privacy_acknowledgement_id')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rebooking_requests' and column_name = 'privacy_acknowledgement_id')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'queries_event_submission_id_unique')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'acknowledge_public_event_privacy'),
    'query-idempotency-consent-migration.sql'),
  ('Private query photo storage',
    exists (select 1 from storage.buckets where id = 'query-photos-private' and public = false)
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_read_query_photo'),
    'query-photo-privacy-migration.sql'),
  ('Per-client event limits enforced by the database',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'event_limit')
      and exists (select 1 from pg_trigger where tgrelid = 'public.events'::regclass and tgname = 'events_enforce_client_event_limit' and not tgisinternal),
    'client-event-limits-migration.sql'),
  ('Manual client billing and annual event entitlements',
    (select count(*) = 8 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name in ('billing_mode','billing_status','billing_plan','paid_through','prepaid_event_credits','term_started_at','term_ends_at','committed_events'))
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'client_billing_is_current')
      and exists (select 1 from pg_trigger where tgrelid = 'public.events'::regclass and tgname = 'events_enforce_client_event_entitlement' and not tgisinternal),
    'client-billing-access-migration.sql'),
  ('30-day client trials and internal non-billable events',
    (select count(*) = 2 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name in ('trial_started_at','trial_ends_at'))
      and exists (select 1 from pg_constraint where conrelid = 'public.clients'::regclass and conname = 'clients_trial_dates_check' and pg_get_constraintdef(oid) like '%trial_ends_at > trial_started_at%')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name = 'billing_exempt')
      and exists (select 1 from pg_trigger where tgrelid = 'public.events'::regclass and tgname = 'events_guard_billing_exemption' and not tgisinternal)
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'client_billing_is_current' and p.prosrc like '%trial_ends_at%')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'enforce_client_event_limit' and p.prosrc like '%billing_exempt%'),
    'client-trials-event-exemptions-migration.sql'),
  ('30-day event expiry and twelve-month archive policies',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'is_event_operational' and p.prosrc like '%+ 30%')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_read_event_history')
      and (select count(*) = 6 from pg_policies where schemaname = 'public' and policyname = 'event history access' and tablename in ('events','queries','staff','exhibitors','rebooking_requests','ops_notifications'))
      and (select count(*) = 5 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('event history access for query photos','active public query photos','active query photo uploads','active query photo updates','active query photo deletions'))
      and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_event_memberships' and policyname = 'active client admins manage memberships' and with_check like '%is_event_operational%')
      and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'events' and policyname = 'active client admins update events')
      and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'queries' and policyname = 'ops and admins insert event queries'),
    'event-expiration-migration.sql')
) as checks(check_name, ok, fix);
