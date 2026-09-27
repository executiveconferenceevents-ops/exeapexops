-- Run this in Supabase if photo uploads fail, show "Bucket not found", or photos don't display.
insert into storage.buckets (id, name, public)
values ('staff-photos', 'staff-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "team can upload staff photos" on storage.objects;
drop policy if exists "team can update staff photos" on storage.objects;
drop policy if exists "team can delete staff photos" on storage.objects;
drop policy if exists "public can read staff photos" on storage.objects;

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

create policy "public can read staff photos"
on storage.objects for select to anon, authenticated
using (bucket_id = 'staff-photos');