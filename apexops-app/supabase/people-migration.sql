alter table public.staff add column if not exists mobile text;
alter table public.staff add column if not exists photo_url text;
alter table public.staff add column if not exists supplier_name text;
alter table public.staff add column if not exists email text;

create table if not exists public.suppliers (
  id text primary key,
  name text not null,
  contact text,
  mobile text,
  email text,
  category text not null default 'Other'
);

alter table public.suppliers enable row level security;

drop policy if exists "team can read suppliers" on public.suppliers;
drop policy if exists "team can insert suppliers" on public.suppliers;
drop policy if exists "team can update suppliers" on public.suppliers;
drop policy if exists "team can delete suppliers" on public.suppliers;

create policy "team can read suppliers" on public.suppliers for select to authenticated using (true);
create policy "team can insert suppliers" on public.suppliers for insert to authenticated with check (true);
create policy "team can update suppliers" on public.suppliers for update to authenticated using (true) with check (true);
create policy "team can delete suppliers" on public.suppliers for delete to authenticated using (true);
