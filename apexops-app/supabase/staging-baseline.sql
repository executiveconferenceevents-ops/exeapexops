-- STAGING PREFLIGHT ONLY. Confirm the Supabase dashboard project reference is
-- ersytghtkfcznlucaloc before running. Every statement below is read-only.
-- Export each result set (CSV) with a timestamp before applying any migration.

-- 1. Existing clients and current entitlement fields.
select id, name, slug, event_limit, billing_mode, billing_status, billing_plan,
       paid_through, term_started_at, term_ends_at, committed_events,
       prepaid_event_credits, trial_started_at, trial_ends_at
from public.clients
order by id;

-- 2. Client memberships and roles.
select id, user_id, client_id, event_id, role, created_at
from public.client_event_memberships
order by client_id, user_id, event_id nulls first, role;

-- 3. Platform Admin assignments. An empty result means app-level owner access
-- cannot be verified with a current Platform Admin account in this project.
select user_id, created_at
from public.platform_admins
order by user_id;

-- 4. Current Platform Admin rate card.
select id, event_tiers, volume_plans, updated_at, updated_by
from public.platform_pricing
where id = true;

-- 5. Event records, including the internal/non-billable classification.
select id, client_id, name, slug, event_start_date, event_end_date,
       build_up_start_date, build_up_end_date, breakdown_start_date,
       breakdown_end_date, billing_exempt
from public.events
order by client_id, id;

-- 6. Existing policies that must remain unchanged.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('clients','events','client_event_memberships','platform_admins')
order by tablename, policyname;

-- 7. Existing table grants for the tenant/access tables and pricing.
select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('clients','events','client_event_memberships','platform_admins','platform_pricing')
order by table_name, grantee, privilege_type;

-- 8. Stage 1 prerequisites and expected absent objects. This query does not
-- alter data; it highlights schema differences before migration approval.
select check_name, is_present
from (
  values
    ('clients.account_status', exists (select 1 from information_schema.columns where table_schema='public' and table_name='clients' and column_name='account_status')),
    ('public.billing_plans', to_regclass('public.billing_plans') is not null),
    ('public.billing_plan_versions', to_regclass('public.billing_plan_versions') is not null),
    ('public.client_registration_submissions', to_regclass('public.client_registration_submissions') is not null),
    ('public.client_subscriptions', to_regclass('public.client_subscriptions') is not null),
    ('public.platform_audit_log', to_regclass('public.platform_audit_log') is not null),
    ('public.is_platform_admin()', to_regprocedure('public.is_platform_admin()') is not null),
    ('auth.uid()', to_regprocedure('auth.uid()') is not null)
) as checks(check_name, is_present)
order by check_name;
