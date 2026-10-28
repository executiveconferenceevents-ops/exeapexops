-- Exhibitor photo attachments for queries. Run once in the Supabase SQL Editor.

alter table public.queries add column if not exists photo_urls text[] not null default '{}';

-- Storage bucket: public read, images only, 5 MB each.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('query-photos', 'query-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Uploads are only accepted into a folder named after a public event.
create or replace function public.is_public_event_folder(folder text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.events event where event.id::text = folder and event.is_public);
$$;

revoke all on function public.is_public_event_folder(text) from public;
grant execute on function public.is_public_event_folder(text) to anon, authenticated;

drop policy if exists "public can upload query photos" on storage.objects;
drop policy if exists "public can read query photos" on storage.objects;
drop policy if exists "team can delete query photos" on storage.objects;

create policy "public can upload query photos"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'query-photos' and public.is_public_event_folder((storage.foldername(name))[1]));

create policy "public can read query photos"
on storage.objects for select to anon, authenticated
using (bucket_id = 'query-photos');

create policy "team can delete query photos"
on storage.objects for delete to authenticated
using (bucket_id = 'query-photos');

-- Exhibitors see the photos on their own stand's queries.
drop function if exists public.get_public_stand_status(text, text, text);
create or replace function public.get_public_stand_status(requested_event_slug text, requested_code text, requested_stand text)
returns table (
  id text, stand text, exhibitor text, category text, description text, est text,
  status text, logged_at timestamptz, source_tab text, sla_deadline timestamptz, completed_at timestamptz,
  photo_urls text[]
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select query.id, query.stand, query.exhibitor, query.category, query.description, query.est,
         query.status, query.logged_at, query.source_tab, query.sla_deadline, query.completed_at,
         query.photo_urls
  from public.queries query
  join public.events event on event.id = query.event_id
  where event.slug = lower(trim(requested_event_slug))
    and event.exhibitor_code = upper(trim(requested_code))
    and event.is_public
    and upper(query.stand) = upper(trim(requested_stand));
$$;

revoke all on function public.get_public_stand_status(text, text, text) from public;
grant execute on function public.get_public_stand_status(text, text, text) to anon, authenticated;

-- Accept up to four photo URLs that point into this event's folder.
create or replace function public.submit_public_query(requested_event_slug text, requested_code text, query_payload jsonb)
returns setof public.queries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_event_id uuid;
  new_query_id text;
  requested_est text := coalesce(nullif(trim(query_payload->>'est'), ''), '1 hour');
  requested_stand text := upper(trim(coalesce(query_payload->>'stand', '')));
  requested_exhibitor text := trim(coalesce(query_payload->>'exhibitor', ''));
  requested_category text := trim(coalesce(query_payload->>'category', ''));
  requested_description text := trim(coalesce(query_payload->>'description', ''));
  requested_photos text[] := '{}';
begin
  select event.id into target_event_id
  from public.events event
  where event.slug = lower(trim(requested_event_slug))
    and event.exhibitor_code = upper(trim(requested_code))
    and event.is_public;
  if target_event_id is null then
    raise exception 'The event code is invalid or the event is unavailable.' using errcode = '42501';
  end if;
  if requested_stand = '' or length(requested_stand) > 30
    or requested_exhibitor = '' or length(requested_exhibitor) > 200
    or requested_category = '' or length(requested_category) > 100
    or requested_description = '' or length(requested_description) > 3000 then
    raise exception 'Complete the event, stand, department and issue details before submitting.' using errcode = '22023';
  end if;

  if jsonb_typeof(query_payload->'photo_urls') = 'array' then
    select coalesce(array_agg(photo), '{}') into requested_photos
    from jsonb_array_elements_text(query_payload->'photo_urls') as photo;
  end if;
  if cardinality(requested_photos) > 4
    or exists (
      select 1 from unnest(requested_photos) as photo
      where length(photo) > 600
        or position('/storage/v1/object/public/query-photos/' || target_event_id::text || '/' in photo) = 0
    ) then
    raise exception 'Photos could not be attached to this query.' using errcode = '22023';
  end if;

  new_query_id := 'Q-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  return query
  insert into public.queries (
    event_id, id, stand, exhibitor, contact, phone, category, description, est,
    status, assigned_to, logged_at, source_tab, sla_deadline, notes, photo_urls
  ) values (
    target_event_id,
    new_query_id,
    requested_stand,
    requested_exhibitor,
    nullif(trim(query_payload->>'contact'), ''),
    nullif(trim(query_payload->>'phone'), ''),
    requested_category,
    requested_description,
    requested_est,
    'LOGGED',
    null,
    now(),
    'CLIENT',
    now() + case requested_est
      when '15 min' then interval '15 minutes'
      when '30 min' then interval '30 minutes'
      when '2 hours' then interval '2 hours'
      when '3 hours' then interval '3 hours'
      when '4 hours' then interval '4 hours'
      when 'Half day' then interval '4 hours'
      when 'Full day' then interval '8 hours'
      else interval '1 hour'
    end,
    null,
    requested_photos
  ) returning *;
end;
$$;

revoke all on function public.submit_public_query(text, text, jsonb) from public;
grant execute on function public.submit_public_query(text, text, jsonb) to anon, authenticated;
