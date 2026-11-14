-- Persist the Platform Admin-managed event rate card and annual discounts.
begin;

create table if not exists public.platform_pricing (
  id boolean primary key default true check (id),
  event_tiers jsonb not null,
  volume_plans jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.platform_pricing (id, event_tiers, volume_plans)
values (
  true,
  '[{"id":"small","name":"Small","minLocations":1,"maxLocations":50,"listPrice":15000},{"id":"medium","name":"Medium","minLocations":51,"maxLocations":100,"listPrice":25000},{"id":"large","name":"Large","minLocations":101,"maxLocations":200,"listPrice":45000},{"id":"extra_large","name":"Extra Large","minLocations":201,"maxLocations":400,"listPrice":70000},{"id":"major","name":"Major","minLocations":401,"maxLocations":600,"listPrice":100000},{"id":"enterprise","name":"Enterprise","minLocations":601,"maxLocations":null,"listPrice":null,"pricing":"custom_quote"}]'::jsonb,
  '[{"id":"vol_12","eventsPerYear":12,"maxEvents":19,"discountPct":5},{"id":"vol_20","eventsPerYear":20,"maxEvents":29,"discountPct":8},{"id":"vol_30","eventsPerYear":30,"maxEvents":49,"discountPct":12},{"id":"vol_50","eventsPerYear":50,"maxEvents":74,"discountPct":15},{"id":"vol_75","eventsPerYear":75,"maxEvents":100,"discountPct":18}]'::jsonb
)
on conflict (id) do nothing;

alter table public.platform_pricing enable row level security;
revoke all on public.platform_pricing from public, anon, authenticated;
grant select, insert, update on public.platform_pricing to authenticated;

drop policy if exists "platform admins manage pricing" on public.platform_pricing;
create policy "platform admins manage pricing"
on public.platform_pricing for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

create or replace function public.touch_platform_pricing_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function public.touch_platform_pricing_updated_at() from public;
drop trigger if exists platform_pricing_set_updated_at on public.platform_pricing;
create trigger platform_pricing_set_updated_at
before update on public.platform_pricing
for each row execute function public.touch_platform_pricing_updated_at();

commit;
-- Persist the Platform Admin-managed event rate card and annual discounts.
begin;

create table if not exists public.platform_pricing (
  id boolean primary key default true check (id),
  event_tiers jsonb not null,
  volume_plans jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.platform_pricing (id, event_tiers, volume_plans)
values (
  true,
  '[{"id":"small","name":"Small","minLocations":1,"maxLocations":50,"listPrice":15000},{"id":"medium","name":"Medium","minLocations":51,"maxLocations":100,"listPrice":25000},{"id":"large","name":"Large","minLocations":101,"maxLocations":200,"listPrice":45000},{"id":"extra_large","name":"Extra Large","minLocations":201,"maxLocations":400,"listPrice":70000},{"id":"major","name":"Major","minLocations":401,"maxLocations":600,"listPrice":100000},{"id":"enterprise","name":"Enterprise","minLocations":601,"maxLocations":null,"listPrice":null,"pricing":"custom_quote"}]'::jsonb,
  '[{"id":"vol_12","eventsPerYear":12,"maxEvents":19,"discountPct":5},{"id":"vol_20","eventsPerYear":20,"maxEvents":29,"discountPct":8},{"id":"vol_30","eventsPerYear":30,"maxEvents":49,"discountPct":12},{"id":"vol_50","eventsPerYear":50,"maxEvents":74,"discountPct":15},{"id":"vol_75","eventsPerYear":75,"maxEvents":100,"discountPct":18}]'::jsonb
)
on conflict (id) do nothing;

alter table public.platform_pricing enable row level security;
revoke all on public.platform_pricing from public, anon, authenticated;
grant select, insert, update on public.platform_pricing to authenticated;

drop policy if exists "platform admins manage pricing" on public.platform_pricing;
create policy "platform admins manage pricing"
on public.platform_pricing for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

commit;