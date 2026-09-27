-- Run this once in Supabase before using the Suppliers tab.
alter table public.staff add column if not exists supplier_name text;
alter table public.staff add column if not exists email text;
