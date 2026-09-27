-- Run this once in Supabase if photo uploads show "Bucket not found".
insert into storage.buckets (id, name, public)
values ('staff-photos', 'staff-photos', true)
on conflict (id) do nothing;