-- Run this in Supabase SQL Editor to enable shared supplier logos.
alter table public.staff add column if not exists supplier_logo_url text;