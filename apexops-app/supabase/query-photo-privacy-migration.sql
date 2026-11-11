-- New query photos use a private bucket and code-bound object paths.
-- Legacy public URLs are retained in rows but served only through short-lived signed URLs.

create extension if not exists pgcrypto with schema extensions;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('query-photos-private', 'query-photos-private', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets set public = false where id = 'query-photos';

create or replace function public.is_public_query_photo_path(object_path text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
    select exists (
        select 1
        from public.events event
        where event.id::text = split_part(object_path, '/', 1)
            and event.is_public
            and public.is_event_operational(event.id)
            and encode(digest(upper(trim(event.exhibitor_code)), 'sha256'), 'hex') = split_part(object_path, '/', 2)
            and split_part(object_path, '/', 3) <> ''
            and split_part(object_path, '/', 4) <> ''
            and split_part(object_path, '/', 5) = ''
    );
$$;

create or replace function public.can_upload_query_photo(object_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    target_event_id uuid;
    target_context text := split_part(object_path, '/', 3);
begin
    if public.is_public_query_photo_path(object_path) then return true; end if;
    if split_part(object_path, '/', 2) <> 'team' or split_part(object_path, '/', 4) = '' or split_part(object_path, '/', 5) <> '' then return false; end if;
    begin target_event_id := split_part(object_path, '/', 1)::uuid;
    exception when others then return false; end;
    if not public.is_event_operational(target_event_id) then return false; end if;
    if public.has_event_access(target_event_id, array['client_admin','event_admin','ops']) then return true; end if;
    return exists (
        select 1
        from public.queries query
        join public.staff profile on profile.id = query.assigned_to and profile.event_id = query.event_id
        where query.id = target_context
            and query.event_id = target_event_id
            and public.has_event_access(query.event_id, array['staff'])
            and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
    );
end;
$$;

create or replace function public.can_read_query_photo(object_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    target_event_id uuid;
    target_context text := split_part(object_path, '/', 3);
    photo_reference text := 'private://' || object_path;
begin
    begin target_event_id := split_part(object_path, '/', 1)::uuid;
    exception when others then return false; end;
    if public.has_event_access(target_event_id, array['client_admin','event_admin','ops']) then
        return exists (
            select 1 from public.queries query
            where query.event_id = target_event_id and query.photo_urls @> array[photo_reference]
        );
    end if;
    if public.is_public_query_photo_path(object_path) then
        return exists (
            select 1 from public.queries query
            where query.event_id = target_event_id
                and query.photo_urls @> array[photo_reference]
        );
    end if;
    if split_part(object_path, '/', 2) <> 'team' or split_part(object_path, '/', 4) = '' or split_part(object_path, '/', 5) <> '' then return false; end if;
    return exists (
        select 1
        from public.queries query
        join public.staff profile on profile.id = query.assigned_to and profile.event_id = query.event_id
        where query.id = target_context
            and query.event_id = target_event_id
            and query.photo_urls @> array[photo_reference]
            and public.has_event_access(query.event_id, array['staff'])
            and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
    );
end;
$$;

create or replace function public.valid_query_photo_reference(target_event_id uuid, requested_code text, requested_submission_id uuid, photo_reference text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
    select case
        when photo_reference like 'private://%' then
            split_part(substr(photo_reference, 11), '/', 1) = target_event_id::text
            and split_part(substr(photo_reference, 11), '/', 2) = encode(digest(upper(trim(requested_code)), 'sha256'), 'hex')
            and split_part(substr(photo_reference, 11), '/', 3) = requested_submission_id::text
            and split_part(substr(photo_reference, 11), '/', 4) <> ''
            and split_part(substr(photo_reference, 11), '/', 5) = ''
            and exists (
                select 1 from storage.objects object
                where object.bucket_id = 'query-photos-private'
                    and object.name = substr(photo_reference, 11)
            )
        else position('/storage/v1/object/public/query-photos/' || target_event_id::text || '/' in photo_reference) > 0
    end;
$$;

create or replace function public.can_read_legacy_query_photo(object_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1
        from public.queries query
        join public.events event on event.id = query.event_id
        cross join lateral unnest(query.photo_urls) photo_url
        where query.event_id::text = (storage.foldername(object_path))[1]
            and position('/storage/v1/object/public/query-photos/' || object_path in photo_url) > 0
            and (
                (auth.role() = 'anon' and event.is_public and query.source_tab = 'CLIENT')
                or public.has_event_access(event.id, array['client_admin','event_admin','ops'])
                or (
                    public.has_event_access(event.id, array['staff'])
                    and exists (
                        select 1 from public.staff profile
                        where profile.id = query.assigned_to
                            and profile.event_id = query.event_id
                            and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
                    )
                )
            )
    );
$$;

revoke all on function public.is_public_query_photo_path(text) from public;
revoke all on function public.can_upload_query_photo(text) from public;
revoke all on function public.can_read_query_photo(text) from public;
revoke all on function public.valid_query_photo_reference(uuid, text, uuid, text) from public;
revoke all on function public.can_read_legacy_query_photo(text) from public;
grant execute on function public.is_public_query_photo_path(text) to anon, authenticated;
grant execute on function public.can_upload_query_photo(text) to anon, authenticated;
grant execute on function public.can_read_query_photo(text) to anon, authenticated;
grant execute on function public.valid_query_photo_reference(uuid, text, uuid, text) to anon, authenticated;
grant execute on function public.can_read_legacy_query_photo(text) to anon, authenticated;

drop policy if exists "public can upload query photos" on storage.objects;
drop policy if exists "public can read query photos" on storage.objects;
drop policy if exists "team can delete query photos" on storage.objects;
drop policy if exists "code holders can upload private query photos" on storage.objects;
drop policy if exists "code holders retry private query photo upload" on storage.objects;
drop policy if exists "authorized viewers read private query photos" on storage.objects;
drop policy if exists "event operations delete private query photos" on storage.objects;
drop policy if exists "authorized viewers read legacy query photos" on storage.objects;

create policy "code holders can upload private query photos"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'query-photos-private' and public.can_upload_query_photo(name));

create policy "code holders retry private query photo upload"
on storage.objects for update to anon, authenticated
using (bucket_id = 'query-photos-private' and public.can_upload_query_photo(name))
with check (bucket_id = 'query-photos-private' and public.can_upload_query_photo(name));

create policy "authorized viewers read private query photos"
on storage.objects for select to anon, authenticated
using (bucket_id = 'query-photos-private' and public.can_read_query_photo(name));

create policy "event operations delete private query photos"
on storage.objects for delete to authenticated
using (
    bucket_id = 'query-photos-private'
    and public.has_event_access(split_part(name, '/', 1)::uuid, array['client_admin','event_admin','ops'])
);

create policy "authorized viewers read legacy query photos"
on storage.objects for select to anon, authenticated
using (bucket_id = 'query-photos' and public.can_read_legacy_query_photo(name));

drop policy if exists "public can upload query photos" on storage.objects;
