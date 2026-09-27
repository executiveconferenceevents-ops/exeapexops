create table if not exists public.queries (
  id text primary key,
  stand text not null,
  exhibitor text not null,
  contact text,
  phone text,
  category text not null,
  description text not null,
  est text not null,
  source_tab text,
  sla_deadline timestamptz,
  status text not null default 'LOGGED',
  assigned_to text,
  logged_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text
);

create table if not exists public.staff (
  id text primary key,
  name text not null,
  category text not null,
  role text not null default 'staff',
  mobile text,
  photo_url text
);

create table if not exists public.exhibitors (
  stand text primary key,
  name text not null,
  contact text,
  phone text,
  email text
);

create table if not exists public.suppliers (
  id text primary key,
  name text not null,
  contact text,
  mobile text,
  email text,
  category text not null default 'Other'
);

alter table public.queries add column if not exists source_tab text;
alter table public.queries add column if not exists sla_deadline timestamptz;
alter table public.staff add column if not exists mobile text;
alter table public.staff add column if not exists photo_url text;
alter table public.staff add column if not exists supplier_name text;
alter table public.staff add column if not exists email text;
alter table public.staff add column if not exists supplier_logo_url text;
alter table public.exhibitors add column if not exists logo_url text;
alter table public.exhibitors add column if not exists pack_collected boolean not null default false;
alter table public.exhibitors add column if not exists pack_collected_by text;
alter table public.exhibitors add column if not exists pack_collected_at timestamptz;
alter table public.exhibitors add column if not exists scanner_booked_out boolean not null default false;
alter table public.exhibitors add column if not exists scanner_booked_out_at timestamptz;
alter table public.exhibitors add column if not exists scanner_due_at timestamptz;
alter table public.exhibitors add column if not exists scanner_day1_booked_out boolean not null default false;
alter table public.exhibitors add column if not exists scanner_day1_booked_out_at timestamptz;
alter table public.exhibitors add column if not exists scanner_day1_booked_in boolean not null default false;
alter table public.exhibitors add column if not exists scanner_day1_booked_in_at timestamptz;
alter table public.exhibitors add column if not exists scanner_day2_booked_out boolean not null default false;
alter table public.exhibitors add column if not exists scanner_day2_booked_out_at timestamptz;
alter table public.exhibitors add column if not exists scanner_day2_booked_in boolean not null default false;
alter table public.exhibitors add column if not exists scanner_day2_booked_in_at timestamptz;
alter table public.exhibitors add column if not exists scanner_booked_in boolean not null default false;
alter table public.exhibitors add column if not exists scanner_booked_in_at timestamptz;
alter table public.exhibitors add column if not exists scanner_staff_name text;
alter table public.exhibitors add column if not exists scanner_staff_contact text;
alter table public.exhibitors add column if not exists scanner_out_staff_name text;
alter table public.exhibitors add column if not exists scanner_out_staff_contact text;
alter table public.exhibitors add column if not exists scanner_in_staff_name text;
alter table public.exhibitors add column if not exists scanner_in_staff_contact text;

insert into storage.buckets (id, name, public)
values ('staff-photos', 'staff-photos', true)
on conflict (id) do nothing;

create or replace function public.update_queries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists queries_updated_at on public.queries;
create trigger queries_updated_at
before update on public.queries
for each row execute function public.update_queries_updated_at();

alter table public.queries enable row level security;
alter table public.staff enable row level security;
alter table public.exhibitors enable row level security;
alter table public.suppliers enable row level security;

drop policy if exists "public can read queries" on public.queries;
drop policy if exists "public can insert queries" on public.queries;
drop policy if exists "public can update queries" on public.queries;
drop policy if exists "public can read staff" on public.staff;
drop policy if exists "public can insert staff" on public.staff;
drop policy if exists "public can update staff" on public.staff;
drop policy if exists "public can delete staff" on public.staff;
drop policy if exists "public can read exhibitors" on public.exhibitors;
drop policy if exists "team can read queries" on public.queries;
drop policy if exists "team can insert queries" on public.queries;
drop policy if exists "team can update queries" on public.queries;
drop policy if exists "team can read staff" on public.staff;
drop policy if exists "team can insert staff" on public.staff;
drop policy if exists "team can update staff" on public.staff;
drop policy if exists "team can delete staff" on public.staff;
drop policy if exists "team can read exhibitors" on public.exhibitors;
drop policy if exists "team can insert exhibitors" on public.exhibitors;
drop policy if exists "team can update exhibitors" on public.exhibitors;
drop policy if exists "team can delete exhibitors" on public.exhibitors;
drop policy if exists "team can read suppliers" on public.suppliers;
drop policy if exists "team can insert suppliers" on public.suppliers;
drop policy if exists "team can update suppliers" on public.suppliers;
drop policy if exists "team can delete suppliers" on public.suppliers;

create policy "team can read queries"
on public.queries for select
to authenticated
using (true);

create policy "team can insert queries"
on public.queries for insert
to authenticated
with check (true);

create policy "team can update queries"
on public.queries for update
to authenticated
using (true)
with check (true);

create policy "team can read staff"
on public.staff for select
to authenticated
using (true);

create policy "team can insert staff"
on public.staff for insert
to authenticated
with check (true);

create policy "team can update staff"
on public.staff for update
to authenticated
using (true)
with check (true);

create policy "team can delete staff"
on public.staff for delete
to authenticated
using (true);

drop policy if exists "team can upload staff photos" on storage.objects;
drop policy if exists "team can update staff photos" on storage.objects;
drop policy if exists "team can delete staff photos" on storage.objects;

create policy "team can upload staff photos"
on storage.objects for insert to authenticated
with check (bucket_id = 'staff-photos');

create policy "team can update staff photos"
on storage.objects for update to authenticated
using (bucket_id = 'staff-photos')
with check (bucket_id = 'staff-photos');

create policy "team can delete staff photos"
on storage.objects for delete to authenticated
using (bucket_id = 'staff-photos');

create policy "team can read exhibitors"
on public.exhibitors for select
to authenticated
using (true);

create policy "team can insert exhibitors"
on public.exhibitors for insert
to authenticated
with check (true);

create policy "team can update exhibitors"
on public.exhibitors for update
to authenticated
using (true)
with check (true);

create policy "team can delete exhibitors"
on public.exhibitors for delete
to authenticated
using (true);

create policy "team can read suppliers" on public.suppliers for select to authenticated using (true);
create policy "team can insert suppliers" on public.suppliers for insert to authenticated with check (true);
create policy "team can update suppliers" on public.suppliers for update to authenticated using (true) with check (true);
create policy "team can delete suppliers" on public.suppliers for delete to authenticated using (true);

create or replace function public.get_public_stand_status(requested_stand text)
returns table (
  id text,
  stand text,
  exhibitor text,
  category text,
  description text,
  est text,
  status text,
  logged_at timestamptz,
  source_tab text,
  sla_deadline timestamptz,
  completed_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select q.id, q.stand, q.exhibitor, q.category, q.description, q.est,
         q.status, q.logged_at, q.source_tab, q.sla_deadline, q.completed_at
  from public.queries q
  where upper(q.stand) = upper(trim(requested_stand));
$$;

revoke all on function public.get_public_stand_status(text) from public;
grant execute on function public.get_public_stand_status(text) to anon, authenticated;

create or replace function public.get_public_exhibitors()
returns table (stand text, name text, logo_url text)
language sql
security definer
set search_path = public
as $$
  select e.stand, e.name, e.logo_url
  from public.exhibitors e
  order by e.stand;
$$;

revoke all on function public.get_public_exhibitors() from public;
grant execute on function public.get_public_exhibitors() to anon, authenticated;
