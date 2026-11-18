-- Multi-client/event foundation for APEXOPS.
-- Existing rows are assigned to Executive Conference Events / ESG Africa 2026.
-- Review the seed event name before running this migration in Supabase.

do $$
declare
  unrecognized_policies text;
begin
  select string_agg(format('%I.%I (%I)', schemaname, tablename, policyname), ', ')
  into unrecognized_policies
  from pg_policies
  where schemaname = 'public'
    and tablename = any(array['clients','events','client_event_memberships','platform_admins','queries','staff','exhibitors','suppliers','rebooking_requests','ops_notifications'])
    and policyname <> all(array[
      'public can read queries','public can insert queries','public can update queries',
      'read queries','insert queries','update queries',
      'team can read queries','team can insert queries','team can update queries','public can submit client queries','allow_all',
      'public can read staff','public can insert staff','public can update staff','public can delete staff',
      'team can read staff','team can insert staff','team can update staff','team can delete staff','read staff','allow_all',
      'public can read exhibitors','team can read exhibitors','team can insert exhibitors','team can update exhibitors','team can delete exhibitors','allow_all',
      'team can read suppliers','team can insert suppliers','team can update suppliers','team can delete suppliers','allow_all',
      'event members read suppliers','event admins manage suppliers','client members read suppliers','client admins manage suppliers',
      'public can submit rebooking requests','team can read rebooking requests','team can update rebooking requests',
      'team can read ops notifications','team can update ops notifications',
      'members can read clients','platform admins manage clients','public can resolve public events','members read assigned events',
      'client admins manage events','platform admins manage all events','members read memberships','client admins manage memberships',
      'platform admins manage memberships','users read own platform admin flag','event members read queries','public submit event queries',
      'event members insert queries','event members update queries','event admins delete queries','event members read staff',
      'event admins manage staff','public can read public exhibitors','event members read exhibitors','event admins manage exhibitors',
      'event members read suppliers','event admins manage suppliers','event members read rebooking requests',
      'event admins update rebooking requests','event members read notifications','event members update notifications'
    ]);
  if unrecognized_policies is not null then
    raise exception 'Unrecognized RLS policies exist on APEXOPS tenant tables: %. Review them before applying the multi-client migration.', unrecognized_policies;
  end if;
end;
$$;

create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  slug text not null unique,
  event_start_date date,
  event_end_date date,
  build_up_start_date date,
  build_up_end_date date,
  breakdown_start_date date,
  breakdown_end_date date,
  next_event_name text,
  logo_url text,
  exhibitor_code text not null default '',
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.events add column if not exists logo_url text;

create unique index if not exists events_client_id_id_key on public.events (client_id, id);

create table if not exists public.client_event_memberships (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  role text not null check (role in ('client_admin', 'event_admin', 'ops', 'staff')),
  created_at timestamptz not null default now(),
  check (event_id is null or client_id is not null)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_client_event_fkey') then
    alter table public.client_event_memberships
      add constraint memberships_client_event_fkey
      foreign key (client_id, event_id) references public.events (client_id, id) on delete cascade;
  end if;
end;
$$;

create unique index if not exists client_event_memberships_scope_key
on public.client_event_memberships (user_id, client_id, coalesce(event_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

insert into public.platform_admins (user_id)
select id from auth.users
where lower(email) = lower('didi@executiveconferenceevents.com')
on conflict (user_id) do nothing;

insert into public.clients (name, slug)
values ('Executive Conference Events', 'executive-conference-events')
on conflict (slug) do nothing;

alter table public.events add column if not exists next_event_name text;
alter table public.events add column if not exists event_start_date date;
alter table public.events add column if not exists event_end_date date;
alter table public.events add column if not exists build_up_start_date date;
alter table public.events add column if not exists build_up_end_date date;
alter table public.events add column if not exists breakdown_start_date date;
alter table public.events add column if not exists breakdown_end_date date;
alter table public.events add column if not exists exhibitor_code text;

update public.events
set event_start_date = coalesce(event_start_date, case when slug = 'esg-africa-2026' then date '2026-09-30' else created_at::date end),
    event_end_date = coalesce(event_end_date, case when slug = 'esg-africa-2026' then date '2026-10-01' else coalesce(event_start_date, created_at::date) end),
    build_up_start_date = coalesce(build_up_start_date, case when slug = 'esg-africa-2026' then date '2026-09-29' else coalesce(event_start_date, created_at::date) end),
    build_up_end_date = coalesce(build_up_end_date, case when slug = 'esg-africa-2026' then date '2026-09-29' else coalesce(event_start_date, created_at::date) end),
    breakdown_start_date = coalesce(breakdown_start_date, case when slug = 'esg-africa-2026' then date '2026-10-01' else coalesce(event_end_date, event_start_date, created_at::date) end),
    breakdown_end_date = coalesce(breakdown_end_date, case when slug = 'esg-africa-2026' then date '2026-10-01' else coalesce(event_end_date, event_start_date, created_at::date) end);

alter table public.events alter column event_start_date set not null;
alter table public.events alter column event_end_date set not null;
alter table public.events alter column build_up_start_date set not null;
alter table public.events alter column build_up_end_date set not null;
alter table public.events alter column breakdown_start_date set not null;
alter table public.events alter column breakdown_end_date set not null;
update public.events
set exhibitor_code = coalesce(
  nullif(upper(substr(regexp_replace(coalesce(name, ''), '[^A-Za-z]', '', 'g'), 1, 5)), ''),
  'EVENT'
) || '-' || to_char(event_start_date, 'YYYYMMDD')
where exhibitor_code is null or trim(exhibitor_code) = '';
alter table public.events alter column exhibitor_code set not null;
drop index if exists public.events_exhibitor_code_key;

create or replace function public.set_event_exhibitor_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  name_prefix text;
begin
  if new.event_start_date is null then
    raise exception 'An event start date is required to generate the exhibitor code.' using errcode = '22023';
  end if;
  if new.event_end_date is null or new.build_up_start_date is null or new.build_up_end_date is null
    or new.breakdown_start_date is null or new.breakdown_end_date is null then
    raise exception 'Event, build-up, and breakdown dates are required.' using errcode = '22023';
  end if;
  if new.event_end_date < new.event_start_date
    or new.build_up_start_date > new.build_up_end_date
    or new.build_up_end_date > new.event_start_date
    or new.breakdown_start_date < new.event_end_date
    or new.breakdown_start_date > new.breakdown_end_date then
    raise exception 'Event, build-up, and breakdown dates must be in chronological order.' using errcode = '22023';
  end if;
  name_prefix := coalesce(nullif(upper(substr(regexp_replace(coalesce(new.name, ''), '[^A-Za-z]', '', 'g'), 1, 5)), ''), 'EVENT');
  new.exhibitor_code := name_prefix || '-' || to_char(new.event_start_date, 'YYYYMMDD');
  return new;
end;
$$;

drop trigger if exists events_set_exhibitor_code on public.events;
create trigger events_set_exhibitor_code
before insert or update of name, event_start_date, exhibitor_code on public.events
for each row execute function public.set_event_exhibitor_code();

update public.events set event_start_date = event_start_date;

insert into public.events (
  client_id, name, slug, event_start_date, event_end_date, build_up_start_date,
  build_up_end_date, breakdown_start_date, breakdown_end_date, next_event_name, is_public
)
select id, 'ESG Africa 2026', 'esg-africa-2026', date '2026-09-30', date '2026-10-01',
  date '2026-09-29', date '2026-09-29', date '2026-10-01', date '2026-10-01', 'ESG Africa 2027', true
from public.clients
where slug = 'executive-conference-events'
on conflict (slug) do nothing;

update public.events
set next_event_name = 'ESG Africa 2027'
where slug = 'esg-africa-2026' and next_event_name is null;

create table if not exists public.rebooking_requests (
  id text primary key,
  company text not null,
  contact_person text not null,
  contact_title text not null default '',
  email text not null,
  mobile text not null,
  current_stand text not null,
  interest text not null,
  preferred_stand text not null default '',
  stand_size text not null default '6 sqm',
  booth_type text not null default 'Shell scheme',
  sponsorship_interest text not null default 'No',
  discussion_topics jsonb not null default '[]'::jsonb,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.ops_notifications (
  id bigint generated always as identity primary key,
  kind text not null,
  title text not null,
  message text not null,
  query_id text,
  rebooking_id text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.queries add column if not exists event_id uuid references public.events(id);
alter table public.staff add column if not exists event_id uuid references public.events(id);
alter table public.exhibitors add column if not exists event_id uuid references public.events(id);
alter table public.suppliers add column if not exists client_id uuid references public.clients(id);
alter table public.suppliers add column if not exists event_id uuid references public.events(id);
alter table public.rebooking_requests add column if not exists event_id uuid references public.events(id);
alter table public.ops_notifications add column if not exists event_id uuid references public.events(id);

do $$
declare
  starter_event_id uuid;
begin
  select id into strict starter_event_id from public.events where slug = 'esg-africa-2026';
  update public.queries set event_id = starter_event_id where event_id is null;
  update public.staff set event_id = starter_event_id where event_id is null;
  update public.exhibitors set event_id = starter_event_id where event_id is null;
  update public.suppliers supplier
  set client_id = event.client_id
  from public.events event
  where supplier.event_id = event.id and supplier.client_id is null;
  update public.suppliers
  set client_id = (select id from public.clients where slug = 'executive-conference-events')
  where client_id is null;
  update public.rebooking_requests set event_id = starter_event_id where event_id is null;
  update public.ops_notifications set event_id = starter_event_id where event_id is null;
end;
$$;

alter table public.queries alter column event_id set not null;
alter table public.staff alter column event_id set not null;
alter table public.exhibitors alter column event_id set not null;
alter table public.suppliers alter column client_id set not null;
alter table public.suppliers alter column event_id drop not null;
alter table public.rebooking_requests alter column event_id set not null;
alter table public.ops_notifications alter column event_id set not null;

create index if not exists queries_event_logged_idx on public.queries (event_id, logged_at desc);
create index if not exists staff_event_name_idx on public.staff (event_id, name);
create index if not exists exhibitors_event_stand_idx on public.exhibitors (event_id, stand);
create index if not exists suppliers_client_name_idx on public.suppliers (client_id, name);
create index if not exists rebooking_event_created_idx on public.rebooking_requests (event_id, created_at desc);
create index if not exists notifications_event_created_idx on public.ops_notifications (event_id, created_at desc);
create index if not exists memberships_user_event_idx on public.client_event_memberships (user_id, event_id);

alter table public.exhibitors drop constraint if exists exhibitors_pkey;
alter table public.exhibitors add constraint exhibitors_pkey primary key (event_id, stand);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create or replace function public.has_client_access(target_client_id uuid, target_event_id uuid default null, allowed_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.client_event_memberships membership
    where membership.user_id = auth.uid()
      and membership.client_id = target_client_id
      and (membership.event_id is null or membership.event_id = target_event_id)
      and (allowed_roles is null or membership.role = any(allowed_roles))
  );
$$;

create or replace function public.has_client_membership(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_platform_admin() or exists (
    select 1 from public.client_event_memberships membership
    where membership.user_id = auth.uid() and membership.client_id = target_client_id
  );
$$;

create or replace function public.has_event_access(target_event_id uuid, allowed_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.events event
    where event.id = target_event_id
      and public.has_client_access(event.client_id, event.id, allowed_roles)
  );
$$;

create or replace function public.create_client(requested_name text, requested_slug text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_client_id uuid;
  normalized_slug text := lower(trim(requested_slug));
begin
  if not public.is_platform_admin() then
    raise exception 'Only platform administrators can create client organizations.' using errcode = '42501';
  end if;
  if length(trim(requested_name)) not between 2 and 160
    or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Provide a client name and a URL-safe slug.' using errcode = '22023';
  end if;
  insert into public.clients (name, slug)
  values (trim(requested_name), normalized_slug)
  returning id into created_client_id;
  return created_client_id;
end;
$$;

revoke all on function public.is_platform_admin() from public;
revoke all on function public.has_client_access(uuid, uuid, text[]) from public;
revoke all on function public.has_client_membership(uuid) from public;
revoke all on function public.has_event_access(uuid, text[]) from public;
revoke all on function public.create_client(text, text) from public;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.has_client_access(uuid, uuid, text[]) to authenticated;
grant execute on function public.has_client_membership(uuid) to authenticated;
grant execute on function public.has_event_access(uuid, text[]) to authenticated;
grant execute on function public.create_client(text, text) to authenticated;

alter table public.clients enable row level security;
alter table public.events enable row level security;
alter table public.client_event_memberships enable row level security;
alter table public.platform_admins enable row level security;
alter table public.queries enable row level security;
alter table public.staff enable row level security;
alter table public.exhibitors enable row level security;
alter table public.suppliers enable row level security;
alter table public.rebooking_requests enable row level security;
alter table public.ops_notifications enable row level security;

drop policy if exists "public can read queries" on public.queries;
drop policy if exists "public can insert queries" on public.queries;
drop policy if exists "public can update queries" on public.queries;
drop policy if exists "team can read queries" on public.queries;
drop policy if exists "team can insert queries" on public.queries;
drop policy if exists "team can update queries" on public.queries;
drop policy if exists "public can submit client queries" on public.queries;
drop policy if exists "read queries" on public.queries;
drop policy if exists "insert queries" on public.queries;
drop policy if exists "update queries" on public.queries;
drop policy if exists "allow_all" on public.queries;
drop policy if exists "public can read staff" on public.staff;
drop policy if exists "public can insert staff" on public.staff;
drop policy if exists "public can update staff" on public.staff;
drop policy if exists "public can delete staff" on public.staff;
drop policy if exists "team can read staff" on public.staff;
drop policy if exists "team can insert staff" on public.staff;
drop policy if exists "team can update staff" on public.staff;
drop policy if exists "team can delete staff" on public.staff;
drop policy if exists "read staff" on public.staff;
drop policy if exists "allow_all" on public.staff;
drop policy if exists "public can read exhibitors" on public.exhibitors;
drop policy if exists "team can read exhibitors" on public.exhibitors;
drop policy if exists "team can insert exhibitors" on public.exhibitors;
drop policy if exists "team can update exhibitors" on public.exhibitors;
drop policy if exists "team can delete exhibitors" on public.exhibitors;
drop policy if exists "allow_all" on public.exhibitors;
drop policy if exists "team can read suppliers" on public.suppliers;
drop policy if exists "team can insert suppliers" on public.suppliers;
drop policy if exists "team can update suppliers" on public.suppliers;
drop policy if exists "team can delete suppliers" on public.suppliers;
drop policy if exists "allow_all" on public.suppliers;
drop policy if exists "event members read suppliers" on public.suppliers;
drop policy if exists "event admins manage suppliers" on public.suppliers;
drop policy if exists "client members read suppliers" on public.suppliers;
drop policy if exists "client admins manage suppliers" on public.suppliers;
drop policy if exists "public can submit rebooking requests" on public.rebooking_requests;
drop policy if exists "team can read rebooking requests" on public.rebooking_requests;
drop policy if exists "team can update rebooking requests" on public.rebooking_requests;
drop policy if exists "team can read ops notifications" on public.ops_notifications;
drop policy if exists "team can update ops notifications" on public.ops_notifications;
drop policy if exists "members can read clients" on public.clients;
drop policy if exists "platform admins manage clients" on public.clients;
drop policy if exists "public can resolve public events" on public.events;
drop policy if exists "members read assigned events" on public.events;
drop policy if exists "client admins manage events" on public.events;
drop policy if exists "platform admins manage all events" on public.events;
drop policy if exists "members read memberships" on public.client_event_memberships;
drop policy if exists "client admins manage memberships" on public.client_event_memberships;
drop policy if exists "platform admins manage memberships" on public.client_event_memberships;
drop policy if exists "users read own platform admin flag" on public.platform_admins;
drop policy if exists "event members read queries" on public.queries;
drop policy if exists "public submit event queries" on public.queries;
drop policy if exists "event members insert queries" on public.queries;
drop policy if exists "event members update queries" on public.queries;
drop policy if exists "event admins delete queries" on public.queries;
drop policy if exists "event members read staff" on public.staff;
drop policy if exists "event admins manage staff" on public.staff;
drop policy if exists "public can read public exhibitors" on public.exhibitors;
drop policy if exists "event members read exhibitors" on public.exhibitors;
drop policy if exists "event admins manage exhibitors" on public.exhibitors;
drop policy if exists "event members read suppliers" on public.suppliers;
drop policy if exists "event admins manage suppliers" on public.suppliers;
drop policy if exists "event members read rebooking requests" on public.rebooking_requests;
drop policy if exists "event admins update rebooking requests" on public.rebooking_requests;
drop policy if exists "event members read notifications" on public.ops_notifications;
drop policy if exists "event members update notifications" on public.ops_notifications;

create policy "members can read clients" on public.clients
for select to authenticated using (public.has_client_membership(id));
create policy "platform admins manage clients" on public.clients
for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists "public can resolve public events" on public.events;
create policy "members read assigned events" on public.events
for select to authenticated using (public.has_client_access(client_id, id));
create policy "client admins manage events" on public.events
for all to authenticated using (public.has_client_access(client_id, id, array['client_admin']))
with check (public.has_client_access(client_id, id, array['client_admin']));
create policy "platform admins manage all events" on public.events
for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy "members read memberships" on public.client_event_memberships
for select to authenticated using (
  user_id = auth.uid()
  or public.has_client_access(client_id, event_id, array['client_admin'])
);
create policy "client admins manage memberships" on public.client_event_memberships
for all to authenticated using (public.has_client_access(client_id, event_id, array['client_admin']))
with check (
  role <> 'platform_admin'
  and public.has_client_access(client_id, event_id, array['client_admin'])
);
create policy "platform admins manage memberships" on public.client_event_memberships
for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy "users read own platform admin flag" on public.platform_admins
for select to authenticated using (user_id = auth.uid());

create policy "event members read queries" on public.queries
for select to authenticated using (public.has_event_access(event_id, array['client_admin','event_admin','ops','staff']));
drop policy if exists "public submit event queries" on public.queries;
create policy "event members insert queries" on public.queries
for insert to authenticated with check (public.has_event_access(event_id, array['client_admin','event_admin','ops','staff']));
create policy "event members update queries" on public.queries
for update to authenticated using (public.has_event_access(event_id, array['client_admin','event_admin','ops','staff']))
with check (public.has_event_access(event_id, array['client_admin','event_admin','ops','staff']));
create policy "event admins delete queries" on public.queries
for delete to authenticated using (public.has_event_access(event_id, array['client_admin','event_admin','ops']));

create policy "event members read staff" on public.staff
for select to authenticated using (public.has_event_access(event_id, array['client_admin','event_admin','ops','staff']));
create policy "event admins manage staff" on public.staff
for all to authenticated using (public.has_event_access(event_id, array['client_admin','event_admin','ops']))
with check (public.has_event_access(event_id, array['client_admin','event_admin','ops']));

drop policy if exists "public can read public exhibitors" on public.exhibitors;
create policy "event members read exhibitors" on public.exhibitors
for select to authenticated using (public.has_event_access(event_id, array['client_admin','event_admin','ops','staff']));
create policy "event admins manage exhibitors" on public.exhibitors
for all to authenticated using (public.has_event_access(event_id, array['client_admin','event_admin','ops']))
with check (public.has_event_access(event_id, array['client_admin','event_admin','ops']));

create policy "client members read suppliers" on public.suppliers
for select to authenticated using (public.has_client_membership(client_id));
create policy "client admins manage suppliers" on public.suppliers
for all to authenticated using (public.has_client_access(client_id, null, array['client_admin']))
with check (public.has_client_access(client_id, null, array['client_admin']));

drop policy if exists "public submit rebooking requests" on public.rebooking_requests;
create policy "event members read rebooking requests" on public.rebooking_requests
for select to authenticated using (public.has_event_access(event_id, array['client_admin','event_admin','ops']));
create policy "event admins update rebooking requests" on public.rebooking_requests
for update to authenticated using (public.has_event_access(event_id, array['client_admin','event_admin','ops']))
with check (public.has_event_access(event_id, array['client_admin','event_admin','ops']));

create policy "event members read notifications" on public.ops_notifications
for select to authenticated using (public.has_event_access(event_id, array['client_admin','event_admin','ops','staff']));
create policy "event members update notifications" on public.ops_notifications
for update to authenticated using (public.has_event_access(event_id, array['client_admin','event_admin','ops','staff']))
with check (public.has_event_access(event_id, array['client_admin','event_admin','ops','staff']));

grant select on public.clients, public.events, public.client_event_memberships to authenticated;
grant select on public.platform_admins to authenticated;
grant insert, update, delete on public.events to authenticated;
revoke select on public.events, public.exhibitors from public, anon;
grant select, insert, update, delete on public.queries, public.staff, public.exhibitors, public.suppliers,
  public.rebooking_requests, public.ops_notifications to authenticated;
revoke insert on public.queries, public.rebooking_requests from public, anon;

drop function if exists public.list_public_events();
create or replace function public.list_public_events()
returns table (
  client_name text, event_name text, slug text, event_start_date date, event_end_date date,
  build_up_start_date date, build_up_end_date date, breakdown_start_date date, breakdown_end_date date,
  next_event_name text, logo_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select client.name, event.name, event.slug, event.event_start_date, event.event_end_date,
    event.build_up_start_date, event.build_up_end_date, event.breakdown_start_date, event.breakdown_end_date,
    event.next_event_name, event.logo_url
  from public.events event
  join public.clients client on client.id = event.client_id
  where event.is_public
  order by client.name, event.name;
$$;

drop function if exists public.get_public_event(text, text);
create or replace function public.get_public_event(requested_slug text, requested_code text)
returns table (
  id uuid, name text, slug text, event_start_date date, event_end_date date,
  build_up_start_date date, build_up_end_date date, breakdown_start_date date, breakdown_end_date date,
  next_event_name text, logo_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select event.id, event.name, event.slug, event.event_start_date, event.event_end_date,
    event.build_up_start_date, event.build_up_end_date, event.breakdown_start_date, event.breakdown_end_date,
    event.next_event_name, event.logo_url
  from public.events event
  where event.slug = lower(trim(requested_slug))
    and event.exhibitor_code = upper(trim(requested_code))
    and event.is_public;
$$;

create or replace function public.get_public_stand_status(requested_event_slug text, requested_code text, requested_stand text)
returns table (
  id text, stand text, exhibitor text, category text, description text, est text,
  status text, logged_at timestamptz, source_tab text, sla_deadline timestamptz, completed_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select query.id, query.stand, query.exhibitor, query.category, query.description, query.est,
         query.status, query.logged_at, query.source_tab, query.sla_deadline, query.completed_at
  from public.queries query
  join public.events event on event.id = query.event_id
  where event.slug = lower(trim(requested_event_slug))
    and event.exhibitor_code = upper(trim(requested_code))
    and event.is_public
    and upper(query.stand) = upper(trim(requested_stand));
$$;

create or replace function public.get_public_exhibitors(requested_event_slug text, requested_code text)
returns table (stand text, name text, logo_url text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exhibitor.stand, exhibitor.name, exhibitor.logo_url
  from public.exhibitors exhibitor
  join public.events event on event.id = exhibitor.event_id
  where event.slug = lower(trim(requested_event_slug))
    and event.exhibitor_code = upper(trim(requested_code))
    and event.is_public
  order by exhibitor.stand;
$$;

drop function if exists public.get_public_event(text);
drop function if exists public.get_public_stand_status(text);
drop function if exists public.get_public_stand_status(text, text);
drop function if exists public.get_public_exhibitors();
drop function if exists public.get_public_exhibitors(text);
revoke all on function public.list_public_events() from public;
revoke all on function public.get_public_event(text, text) from public;
revoke all on function public.get_public_stand_status(text, text, text) from public;
revoke all on function public.get_public_exhibitors(text, text) from public;
grant execute on function public.list_public_events() to anon, authenticated;
grant execute on function public.get_public_event(text, text) to anon, authenticated;
grant execute on function public.get_public_stand_status(text, text, text) to anon, authenticated;
grant execute on function public.get_public_exhibitors(text, text) to anon, authenticated;

create or replace function public.submit_public_query(requested_event_slug text, requested_code text, query_payload jsonb)
returns setof public.queries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_event_id uuid;
  new_query_id text;
  requested_est text := coalesce(nullif(trim(query_payload->>'est'), ''), '1 hour');
  requested_stand text := upper(trim(coalesce(query_payload->>'stand', '')));
  requested_exhibitor text := trim(coalesce(query_payload->>'exhibitor', ''));
  requested_category text := trim(coalesce(query_payload->>'category', ''));
  requested_description text := trim(coalesce(query_payload->>'description', ''));
begin
  select event.id into target_event_id
  from public.events event
  where event.slug = lower(trim(requested_event_slug))
    and event.exhibitor_code = upper(trim(requested_code))
    and event.is_public;
  if target_event_id is null then
    raise exception 'The event code is invalid or the event is unavailable.' using errcode = '42501';
  end if;
  if requested_stand = '' or length(requested_stand) > 30
    or requested_exhibitor = '' or length(requested_exhibitor) > 200
    or requested_category = '' or length(requested_category) > 100
    or requested_description = '' or length(requested_description) > 3000 then
    raise exception 'Complete the event, stand, department and issue details before submitting.' using errcode = '22023';
  end if;

  new_query_id := 'Q-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  return query
  insert into public.queries (
    event_id, id, stand, exhibitor, contact, phone, category, description, est,
    status, assigned_to, logged_at, source_tab, sla_deadline, notes
  ) values (
    target_event_id,
    new_query_id,
    requested_stand,
    requested_exhibitor,
    nullif(trim(query_payload->>'contact'), ''),
    nullif(trim(query_payload->>'phone'), ''),
    requested_category,
    requested_description,
    requested_est,
    'LOGGED',
    null,
    now(),
    'CLIENT',
    now() + case requested_est
      when '15 min' then interval '15 minutes'
      when '30 min' then interval '30 minutes'
      when '2 hours' then interval '2 hours'
      when '3 hours' then interval '3 hours'
      when '4 hours' then interval '4 hours'
      when 'Half day' then interval '4 hours'
      when 'Full day' then interval '8 hours'
      else interval '1 hour'
    end,
    null
  ) returning *;
end;
$$;

create or replace function public.submit_public_rebooking(requested_event_slug text, requested_code text, request_payload jsonb)
returns setof public.rebooking_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_event_id uuid;
  new_request_id text;
  company_name text := trim(coalesce(request_payload->>'company', ''));
  contact_name text := trim(coalesce(request_payload->>'contact_person', ''));
  contact_email text := trim(coalesce(request_payload->>'email', ''));
  current_stand text := upper(trim(coalesce(request_payload->>'current_stand', '')));
begin
  select event.id into target_event_id
  from public.events event
  where event.slug = lower(trim(requested_event_slug))
    and event.exhibitor_code = upper(trim(requested_code))
    and event.is_public;
  if target_event_id is null then
    raise exception 'The event code is invalid or the event is unavailable.' using errcode = '42501';
  end if;
  if company_name = '' or contact_name = '' or contact_email = '' or current_stand = '' then
    raise exception 'Complete the company, contact, email and current stand fields before submitting.' using errcode = '22023';
  end if;

  new_request_id := 'rebook-' || replace(gen_random_uuid()::text, '-', '');
  return query
  insert into public.rebooking_requests (
    event_id, id, company, contact_person, contact_title, email, mobile, current_stand,
    interest, preferred_stand, stand_size, booth_type, sponsorship_interest,
    discussion_topics, notes, created_at
  ) values (
    target_event_id,
    new_request_id,
    company_name,
    contact_name,
    trim(coalesce(request_payload->>'contact_title', '')),
    contact_email,
    trim(coalesce(request_payload->>'mobile', '')),
    current_stand,
    trim(coalesce(request_payload->>'interest', 'Rebook current stand')),
    upper(trim(coalesce(request_payload->>'preferred_stand', ''))),
    coalesce(nullif(trim(request_payload->>'stand_size'), ''), '6 sqm'),
    coalesce(nullif(trim(request_payload->>'booth_type'), ''), 'Shell scheme'),
    coalesce(nullif(trim(request_payload->>'sponsorship_interest'), ''), 'No'),
    coalesce(request_payload->'discussion_topics', '[]'::jsonb),
    trim(coalesce(request_payload->>'notes', '')),
    now()
  ) returning *;
end;
$$;

revoke all on function public.submit_public_query(text, text, jsonb) from public;
revoke all on function public.submit_public_rebooking(text, text, jsonb) from public;
grant execute on function public.submit_public_query(text, text, jsonb) to anon, authenticated;
grant execute on function public.submit_public_rebooking(text, text, jsonb) to anon, authenticated;

create or replace function public.prevent_duplicate_client_query()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source_tab = 'CLIENT' then
    perform pg_advisory_xact_lock(hashtextextended(new.event_id::text || ':' || upper(trim(new.stand)), 0));
    if exists (
      select 1 from public.queries existing
      where existing.event_id = new.event_id
        and upper(trim(existing.stand)) = upper(trim(new.stand))
        and lower(regexp_replace(trim(existing.exhibitor), '\s+', ' ', 'g')) = lower(regexp_replace(trim(new.exhibitor), '\s+', ' ', 'g'))
        and lower(regexp_replace(trim(existing.description), '\s+', ' ', 'g')) = lower(regexp_replace(trim(new.description), '\s+', ' ', 'g'))
        and existing.status <> 'COMPLETED'
    ) then
      raise exception 'This issue has already been submitted for this exhibitor and stand.' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.notify_ops_of_client_query()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source_tab = 'CLIENT' then
    insert into public.ops_notifications (event_id, kind, title, message, query_id)
    values (new.event_id, 'CLIENT_QUERY', 'New client query', new.exhibitor || ' · Stand ' || new.stand || ' · ' || new.category, new.id);
  end if;
  return new;
end;
$$;

create or replace function public.notify_ops_of_client_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'ESCALATED' and old.status is distinct from 'ESCALATED' then
    insert into public.ops_notifications (event_id, kind, title, message, query_id)
    values (new.event_id, 'CLIENT_ESCALATION', 'Client escalated a query', new.exhibitor || ' · Stand ' || new.stand || ' · ' || new.category, new.id);
  end if;
  return new;
end;
$$;

create or replace function public.escalate_public_query(requested_event_slug text, requested_code text, requested_query_id text, requested_stand text, escalation_message text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  updated_id text;
begin
  update public.queries query
  set status = 'ESCALATED',
      notes = concat_ws(E'\n', nullif(query.notes, ''), nullif('Client escalation: ' || trim(coalesce(escalation_message, '')), 'Client escalation: '))
  from public.events event
  where event.id = query.event_id
    and event.slug = lower(trim(requested_event_slug))
    and event.exhibitor_code = upper(trim(requested_code))
    and event.is_public
    and query.id = requested_query_id
    and upper(trim(query.stand)) = upper(trim(requested_stand))
    and query.status <> 'COMPLETED'
  returning query.id into updated_id;
  if updated_id is null then
    raise exception 'This query could not be escalated. Check the event, stand and query status.';
  end if;
  return updated_id;
end;
$$;

drop function if exists public.escalate_public_query(text, text, text);
drop function if exists public.escalate_public_query(text, text, text, text);
revoke all on function public.escalate_public_query(text, text, text, text, text) from public;
grant execute on function public.escalate_public_query(text, text, text, text, text) to anon, authenticated;

create or replace function public.notify_ops_of_rebooking()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.ops_notifications (event_id, kind, title, message, rebooking_id)
  values (new.event_id, 'REBOOKING', 'New stand rebooking request', new.company || ' · Current stand ' || new.current_stand || ' · ' || new.interest, new.id);
  return new;
end;
$$;

drop policy if exists "team can upload event logos" on storage.objects;
drop policy if exists "team can update event logos" on storage.objects;
drop policy if exists "team can delete event logos" on storage.objects;
drop policy if exists "team can upload staff photos" on storage.objects;
drop policy if exists "team can update staff photos" on storage.objects;
drop policy if exists "team can delete staff photos" on storage.objects;
drop policy if exists "event members upload event media" on storage.objects;
drop policy if exists "event members update event media" on storage.objects;
drop policy if exists "event members delete event media" on storage.objects;

create policy "event members upload event media" on storage.objects
for insert to authenticated with check (
  bucket_id in ('exhibitor-logos','supplier-logos','staff-photos')
  and exists (
    select 1 from public.events event
    where event.id::text = (storage.foldername(name))[1]
      and public.has_event_access(event.id, array['client_admin','event_admin','ops'])
  )
);
create policy "event members update event media" on storage.objects
for update to authenticated using (
  bucket_id in ('exhibitor-logos','supplier-logos','staff-photos')
  and exists (
    select 1 from public.events event
    where event.id::text = (storage.foldername(name))[1]
      and public.has_event_access(event.id, array['client_admin','event_admin','ops'])
  )
) with check (
  bucket_id in ('exhibitor-logos','supplier-logos','staff-photos')
  and exists (
    select 1 from public.events event
    where event.id::text = (storage.foldername(name))[1]
      and public.has_event_access(event.id, array['client_admin','event_admin','ops'])
  )
);
create policy "event members delete event media" on storage.objects
for delete to authenticated using (
  bucket_id in ('exhibitor-logos','supplier-logos','staff-photos')
  and exists (
    select 1 from public.events event
    where event.id::text = (storage.foldername(name))[1]
      and public.has_event_access(event.id, array['client_admin','event_admin','ops'])
  )
);

notify pgrst, 'reload schema';

-- If this account did not exist when the migration ran, create it in Auth and rerun:
-- insert into public.platform_admins (user_id)
-- select id from auth.users where lower(email) = lower('didi@executiveconferenceevents.com')
-- on conflict (user_id) do nothing;