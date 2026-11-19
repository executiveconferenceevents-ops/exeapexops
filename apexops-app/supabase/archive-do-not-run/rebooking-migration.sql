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

alter table public.rebooking_requests add column if not exists contact_title text not null default '';
alter table public.rebooking_requests add column if not exists preferred_stand text not null default '';
alter table public.rebooking_requests add column if not exists stand_size text not null default '6 sqm';
alter table public.rebooking_requests add column if not exists booth_type text not null default 'Shell scheme';
alter table public.rebooking_requests add column if not exists sponsorship_interest text not null default 'No';
alter table public.rebooking_requests add column if not exists notes text not null default '';

alter table public.rebooking_requests enable row level security;

drop policy if exists "public can submit rebooking requests" on public.rebooking_requests;
drop policy if exists "team can read rebooking requests" on public.rebooking_requests;
drop policy if exists "team can update rebooking requests" on public.rebooking_requests;

create policy "public can submit rebooking requests"
on public.rebooking_requests
for insert
to anon, authenticated
with check (true);

create policy "team can read rebooking requests"
on public.rebooking_requests
for select
to authenticated
using (true);

create policy "team can update rebooking requests"
on public.rebooking_requests
for update
to authenticated
using (true)
with check (true);
