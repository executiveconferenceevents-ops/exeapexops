-- Persistent image storage for event, exhibitor, and supplier logos.
insert into storage.buckets (id, name, public)
values
  ('exhibitor-logos', 'exhibitor-logos', true),
  ('supplier-logos', 'supplier-logos', true),
  ('event-logos', 'event-logos', true)
on conflict (id) do update set public = true;

drop policy if exists "team can upload event logos" on storage.objects;
drop policy if exists "team can update event logos" on storage.objects;
drop policy if exists "team can delete event logos" on storage.objects;
drop policy if exists "public can read event logos" on storage.objects;

create policy "team can upload event logos"
on storage.objects for insert to authenticated
with check (bucket_id in ('exhibitor-logos', 'supplier-logos', 'event-logos'));

create policy "team can update event logos"
on storage.objects for update to authenticated
using (bucket_id in ('exhibitor-logos', 'supplier-logos', 'event-logos'))
with check (bucket_id in ('exhibitor-logos', 'supplier-logos', 'event-logos'));

create policy "team can delete event logos"
on storage.objects for delete to authenticated
using (bucket_id in ('exhibitor-logos', 'supplier-logos', 'event-logos'));

create policy "public can read event logos"
on storage.objects for select to anon, authenticated
using (bucket_id in ('exhibitor-logos', 'supplier-logos', 'event-logos'));
