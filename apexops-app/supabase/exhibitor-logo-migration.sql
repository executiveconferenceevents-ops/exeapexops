-- Run this in Supabase SQL Editor to make exhibitor logos available to clients.
alter table public.exhibitors add column if not exists logo_url text;

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