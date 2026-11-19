-- Additive Stage 1 foundation. Existing entitlement columns and access policies remain unchanged.
begin;

alter table public.clients
  add column if not exists account_status text;

update public.clients set account_status = 'active' where account_status is null;
alter table public.clients alter column account_status set default 'draft';
alter table public.clients alter column account_status set not null;

alter table public.clients drop constraint if exists clients_account_status_check;
alter table public.clients add constraint clients_account_status_check
  check (account_status in ('draft','pending_payment','awaiting_approval','active','rejected','suspended','closed'));

create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null unique,
  name text not null,
  description text not null default '',
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(plan_code)) between 2 and 80),
  check (length(trim(name)) between 2 and 160)
);

create table if not exists public.billing_plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft','published','retired')),
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  billing_frequency text not null check (billing_frequency in ('per_event','monthly','annual','custom')),
  configuration jsonb not null,
  effective_from date,
  effective_until date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (plan_id, version_number),
  check (jsonb_typeof(configuration) = 'object'),
  check (status = 'draft' or effective_from is not null),
  check (effective_until is null or effective_from is null or effective_until >= effective_from)
);

create table if not exists public.client_registration_submissions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete restrict,
  requested_plan_version_id uuid references public.billing_plan_versions(id) on delete restrict,
  registered_business_name text not null,
  company_registration_number text,
  primary_contact_name text not null,
  primary_contact_email text not null,
  billing_contact_email text,
  contact_phone text,
  terms_version text not null,
  terms_accepted_at timestamptz not null,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','withdrawn')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  review_note text,
  created_at timestamptz not null default now(),
  check (length(trim(registered_business_name)) between 2 and 200),
  check (length(trim(primary_contact_name)) between 2 and 160),
  check (position('@' in primary_contact_email) > 1),
  check (length(trim(terms_version)) > 0),
  check ((status in ('approved','rejected') and reviewed_at is not null and reviewed_by is not null) or status not in ('approved','rejected'))
);

create index if not exists client_registration_submissions_status_idx
  on public.client_registration_submissions (status, submitted_at desc);

create table if not exists public.client_subscriptions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  plan_version_id uuid references public.billing_plan_versions(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','active','expired','cancelled')),
  billing_mode text not null check (billing_mode in ('unmanaged','prepaid','monthly','trial')),
  billing_frequency text not null check (billing_frequency in ('per_event','monthly','annual','custom')),
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  agreement_snapshot jsonb not null,
  starts_on date,
  ends_on date,
  agreed_at timestamptz,
  status_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(agreement_snapshot) = 'object'),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  check (status <> 'active' or agreed_at is not null)
);

create index if not exists client_subscriptions_client_status_idx
  on public.client_subscriptions (client_id, status, created_at desc);

do $$
declare
  pricing_plan_id uuid;
begin
  if to_regclass('public.platform_pricing') is not null then
    insert into public.billing_plans (plan_code, name, description)
    values ('platform-event-pricing', 'Platform event pricing', 'Versioned snapshot of the existing Platform Admin rate card.')
    on conflict (plan_code) do nothing;

    select id into strict pricing_plan_id
    from public.billing_plans where plan_code = 'platform-event-pricing';

    insert into public.billing_plan_versions
      (plan_id, version_number, status, currency, billing_frequency, configuration, effective_from)
    select pricing_plan_id, 1, 'published', 'ZAR', 'custom',
      jsonb_build_object('event_tiers', pricing.event_tiers, 'volume_plans', pricing.volume_plans), current_date
    from public.platform_pricing pricing
    where pricing.id = true
    on conflict (plan_id, version_number) do nothing;
  end if;
end;
$$;

create table if not exists public.platform_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  client_id uuid references public.clients(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  previous_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now(),
  check (length(trim(action)) > 0),
  check (length(trim(entity_type)) > 0)
);

create index if not exists platform_audit_log_client_created_idx
  on public.platform_audit_log (client_id, created_at desc);
create index if not exists platform_audit_log_entity_idx
  on public.platform_audit_log (entity_type, entity_id, created_at desc);

create or replace function public.guard_published_billing_plan_version()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('published','retired') then
      raise exception 'Published pricing versions are immutable.' using errcode = '23514';
    end if;
    return old;
  end if;
  if old.status in ('published','retired') and (
    new.plan_id is distinct from old.plan_id
    or new.version_number is distinct from old.version_number
    or new.currency is distinct from old.currency
    or new.billing_frequency is distinct from old.billing_frequency
    or new.configuration is distinct from old.configuration
    or new.effective_from is distinct from old.effective_from
    or new.effective_until is distinct from old.effective_until
    or new.status = 'draft'
  ) then
    raise exception 'Published pricing versions are immutable; create a new version.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_published_billing_plan_version() from public, anon, authenticated;
drop trigger if exists billing_plan_versions_immutable on public.billing_plan_versions;
create trigger billing_plan_versions_immutable
before update or delete on public.billing_plan_versions
for each row execute function public.guard_published_billing_plan_version();

create or replace function public.guard_client_registration_submission()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.client_id is distinct from old.client_id
    or new.requested_plan_version_id is distinct from old.requested_plan_version_id
    or new.registered_business_name is distinct from old.registered_business_name
    or new.company_registration_number is distinct from old.company_registration_number
    or new.primary_contact_name is distinct from old.primary_contact_name
    or new.primary_contact_email is distinct from old.primary_contact_email
    or new.billing_contact_email is distinct from old.billing_contact_email
    or new.contact_phone is distinct from old.contact_phone
    or new.terms_version is distinct from old.terms_version
    or new.terms_accepted_at is distinct from old.terms_accepted_at then
    raise exception 'Submitted registration details are immutable; create a new submission for corrections.' using errcode = '23514';
  end if;
  if old.status <> 'submitted' and new.status is distinct from old.status then
    raise exception 'A reviewed registration decision is final.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_client_registration_submission() from public, anon, authenticated;
drop trigger if exists client_registration_submissions_guard on public.client_registration_submissions;
create trigger client_registration_submissions_guard
before update on public.client_registration_submissions
for each row execute function public.guard_client_registration_submission();

create or replace function public.guard_client_subscription_agreement()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Agreed subscriptions cannot be deleted; record a cancellation or replacement.' using errcode = '23514';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and (
    new.client_id is distinct from old.client_id
    or new.plan_version_id is distinct from old.plan_version_id
    or new.billing_mode is distinct from old.billing_mode
    or new.billing_frequency is distinct from old.billing_frequency
    or new.currency is distinct from old.currency
    or new.agreement_snapshot is distinct from old.agreement_snapshot
    or new.starts_on is distinct from old.starts_on
    or new.ends_on is distinct from old.ends_on
    or new.agreed_at is distinct from old.agreed_at
  ) then
    raise exception 'Agreed subscription terms are immutable; create an amendment or replacement agreement.' using errcode = '23514';
  end if;
  if old.status in ('expired','cancelled') and new.status is distinct from old.status then
    raise exception 'A terminal subscription cannot be reactivated.' using errcode = '23514';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status in ('active','cancelled'))
    or (old.status = 'active' and new.status in ('expired','cancelled'))
  ) then
    raise exception 'Invalid subscription status transition.' using errcode = '23514';
  end if;
  if new.status in ('expired','cancelled') and nullif(trim(new.status_reason), '') is null then
    raise exception 'Provide a reason when expiring or cancelling an agreement.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_client_subscription_agreement() from public, anon, authenticated;
drop trigger if exists client_subscriptions_guard_agreement on public.client_subscriptions;
create trigger client_subscriptions_guard_agreement
before update or delete on public.client_subscriptions
for each row execute function public.guard_client_subscription_agreement();

create or replace function public.touch_billing_foundation_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.touch_billing_foundation_updated_at() from public, anon, authenticated;
drop trigger if exists billing_plans_set_updated_at on public.billing_plans;
create trigger billing_plans_set_updated_at
before update on public.billing_plans
for each row execute function public.touch_billing_foundation_updated_at();
drop trigger if exists client_subscriptions_set_updated_at on public.client_subscriptions;
create trigger client_subscriptions_set_updated_at
before update on public.client_subscriptions
for each row execute function public.touch_billing_foundation_updated_at();

create or replace function public.audit_billing_foundation_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_client_id uuid;
  target_entity_id uuid;
  target_action text;
  target_reason text;
  previous_record jsonb;
  next_record jsonb;
begin
  if tg_table_name = 'clients' then
    target_client_id := new.id;
    target_entity_id := new.id;
    target_action := 'client.account_status_changed';
    previous_record := jsonb_build_object('account_status', old.account_status);
    next_record := jsonb_build_object('account_status', new.account_status);
  elsif tg_table_name = 'client_registration_submissions' then
    target_client_id := new.client_id;
    target_entity_id := new.id;
    target_action := case when tg_op = 'INSERT' then 'client.registration_submitted' else 'client.registration_status_changed' end;
    if tg_op = 'UPDATE' then
      previous_record := jsonb_build_object('status', old.status, 'reviewed_by', old.reviewed_by, 'review_note', old.review_note);
    end if;
    next_record := jsonb_build_object('status', new.status, 'reviewed_by', new.reviewed_by, 'review_note', new.review_note);
    target_reason := new.review_note;
  elsif tg_table_name = 'client_subscriptions' then
    target_client_id := new.client_id;
    target_entity_id := new.id;
    target_action := case when tg_op = 'INSERT' then 'client.subscription_created' else 'client.subscription_changed' end;
    if tg_op = 'UPDATE' then
      previous_record := jsonb_build_object('plan_version_id', old.plan_version_id, 'status', old.status, 'starts_on', old.starts_on, 'ends_on', old.ends_on, 'status_reason', old.status_reason);
    end if;
    next_record := jsonb_build_object('plan_version_id', new.plan_version_id, 'status', new.status, 'starts_on', new.starts_on, 'ends_on', new.ends_on, 'status_reason', new.status_reason);
    target_reason := new.status_reason;
  elsif tg_table_name = 'billing_plans' then
    target_entity_id := new.id;
    target_action := case when tg_op = 'INSERT' then 'pricing.plan_created' else 'pricing.plan_changed' end;
    if tg_op = 'UPDATE' then previous_record := jsonb_build_object('plan_code', old.plan_code, 'name', old.name, 'is_active', old.is_active); end if;
    next_record := jsonb_build_object('plan_code', new.plan_code, 'name', new.name, 'is_active', new.is_active);
  else
    target_entity_id := new.id;
    target_action := 'pricing.version_changed';
    if tg_op = 'UPDATE' then previous_record := jsonb_build_object('status', old.status, 'configuration', old.configuration); end if;
    next_record := jsonb_build_object('status', new.status, 'configuration', new.configuration);
  end if;

  insert into public.platform_audit_log (actor_user_id, client_id, action, entity_type, entity_id, previous_values, new_values, reason)
  values (auth.uid(), target_client_id, target_action, tg_table_name, target_entity_id, previous_record, next_record, target_reason);
  return new;
end;
$$;
revoke all on function public.audit_billing_foundation_change() from public, anon, authenticated;

drop trigger if exists clients_audit_account_status on public.clients;
create trigger clients_audit_account_status
after update of account_status on public.clients
for each row when (old.account_status is distinct from new.account_status)
execute function public.audit_billing_foundation_change();

drop trigger if exists client_registrations_audit on public.client_registration_submissions;
create trigger client_registrations_audit
after insert or update of status, reviewed_by, reviewed_at, review_note on public.client_registration_submissions
for each row execute function public.audit_billing_foundation_change();

drop trigger if exists client_subscriptions_audit on public.client_subscriptions;
create trigger client_subscriptions_audit
after insert or update on public.client_subscriptions
for each row execute function public.audit_billing_foundation_change();

drop trigger if exists billing_plan_versions_audit on public.billing_plan_versions;
create trigger billing_plan_versions_audit
after insert or update on public.billing_plan_versions
for each row execute function public.audit_billing_foundation_change();

drop trigger if exists billing_plans_audit on public.billing_plans;
create trigger billing_plans_audit
after insert or update on public.billing_plans
for each row execute function public.audit_billing_foundation_change();

create or replace function public.version_platform_pricing_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  pricing_plan_id uuid;
  next_version integer;
begin
  select id into strict pricing_plan_id
  from public.billing_plans where plan_code = 'platform-event-pricing';
  select coalesce(max(version_number), 0) + 1 into next_version
  from public.billing_plan_versions where plan_id = pricing_plan_id;

  insert into public.billing_plan_versions
    (plan_id, version_number, status, currency, billing_frequency, configuration, effective_from, created_by)
  values (
    pricing_plan_id, next_version, 'published', 'ZAR', 'custom',
    jsonb_build_object('event_tiers', new.event_tiers, 'volume_plans', new.volume_plans),
    current_date, auth.uid()
  );
  return new;
end;
$$;
revoke all on function public.version_platform_pricing_change() from public, anon, authenticated;

do $$
begin
  if to_regclass('public.platform_pricing') is not null then
    execute 'drop trigger if exists platform_pricing_create_version on public.platform_pricing';
    execute 'create trigger platform_pricing_create_version
      after update of event_tiers, volume_plans on public.platform_pricing
      for each row when (old.event_tiers is distinct from new.event_tiers or old.volume_plans is distinct from new.volume_plans)
      execute function public.version_platform_pricing_change()';
  end if;
end;
$$;

alter table public.billing_plans enable row level security;
alter table public.billing_plan_versions enable row level security;
alter table public.client_registration_submissions enable row level security;
alter table public.client_subscriptions enable row level security;
alter table public.platform_audit_log enable row level security;

revoke all on public.billing_plans, public.billing_plan_versions, public.client_registration_submissions,
  public.client_subscriptions, public.platform_audit_log from public, anon, authenticated;
grant select, insert, update on public.billing_plans, public.billing_plan_versions,
  public.client_registration_submissions, public.client_subscriptions to authenticated;
grant select on public.platform_audit_log to authenticated;
grant select, insert, update on public.billing_plans, public.billing_plan_versions,
  public.client_registration_submissions, public.client_subscriptions to service_role;
grant select on public.platform_audit_log to service_role;

drop policy if exists "platform admins manage billing plans" on public.billing_plans;
create policy "platform admins manage billing plans" on public.billing_plans
for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists "platform admins manage billing plan versions" on public.billing_plan_versions;
create policy "platform admins manage billing plan versions" on public.billing_plan_versions
for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists "platform admins manage client registrations" on public.client_registration_submissions;
create policy "platform admins manage client registrations" on public.client_registration_submissions
for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists "platform admins manage client subscriptions" on public.client_subscriptions;
create policy "platform admins manage client subscriptions" on public.client_subscriptions
for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists "platform admins read platform audit log" on public.platform_audit_log;
create policy "platform admins read platform audit log" on public.platform_audit_log
for select to authenticated using (public.is_platform_admin());

commit;
