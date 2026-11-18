-- PREPARED FOR REVIEW ONLY. Do not run until it has been checked against the
-- target project's migration history and storage policies.
--
-- 1. Legacy query photos are private and readable only by the same event-team
--    roles allowed to read the associated query (including assigned staff).
-- 2. Anonymous client-query submissions are limited to 20 per stand and 200
--    per event per fixed UTC hour. Successful inserts only consume quota.

begin;

-- The original query table has no server-created timestamp. Add one so rate
-- limits cannot be bypassed by backdating the client-supplied logged_at value.
alter table public.queries add column if not exists created_at timestamptz;
update public.queries set created_at=coalesce(created_at,logged_at,now()) where created_at is null;
alter table public.queries alter column created_at set default now();
alter table public.queries alter column created_at set not null;

create index if not exists queries_public_event_created_idx
  on public.queries(event_id,created_at) where source_tab='CLIENT';
create index if not exists queries_public_event_stand_created_idx
  on public.queries(event_id,(upper(trim(stand))),created_at) where source_tab='CLIENT';

-- Legacy public URLs must not bypass RLS through a public Storage bucket.
update storage.buckets set public=false where id='query-photos';

create or replace function public.can_read_legacy_query_photo(object_path text)
returns boolean
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select exists (
    select 1
    from public.queries query
    cross join lateral unnest(query.photo_urls) as photos(photo_url)
    where query.event_id::text=(storage.foldername(object_path))[1]
      and position('/storage/v1/object/public/query-photos/'||object_path in photo_url)>0
      and public.can_read_event_history(query.event_id)
      and (
        public.is_platform_admin()
        or public.has_event_access(query.event_id,array['client_admin','event_admin','ops'])
        or (
          public.has_event_access(query.event_id,array['staff'])
          and exists (
            select 1 from public.staff profile
            where profile.id=query.assigned_to
              and profile.event_id=query.event_id
              and lower(trim(coalesce(profile.email,'')))=lower(trim(coalesce(auth.jwt()->>'email','')))
          )
        )
      )
  );
$$;
revoke all on function public.can_read_legacy_query_photo(text) from public,anon;
grant execute on function public.can_read_legacy_query_photo(text) to authenticated;

drop policy if exists "public can read query photos" on storage.objects;
drop policy if exists "authorized viewers read legacy query photos" on storage.objects;
create policy "event team reads legacy query photos"
on storage.objects for select to authenticated
using (bucket_id='query-photos' and public.can_read_legacy_query_photo(name));

-- A reserved '*' stand key holds the per-event counter. Real stand keys are
-- MD5-normalized identifiers, so raw stand numbers are not stored here.
create table if not exists public.public_query_submission_limits (
  event_id uuid not null references public.events(id) on delete cascade,
  window_started_at timestamptz not null,
  stand_key text not null,
  request_count integer not null check (request_count > 0),
  primary key(event_id,window_started_at,stand_key),
  check (stand_key='*' or stand_key ~ '^[a-f0-9]{32}$')
);
create index if not exists public_query_submission_limits_window_idx
  on public.public_query_submission_limits(window_started_at);
alter table public.public_query_submission_limits enable row level security;
revoke all on public.public_query_submission_limits from public,anon,authenticated,service_role;

create or replace function public.allow_public_query_submission(target_event_id uuid, target_stand text)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  hour_start timestamptz := to_timestamp(floor(extract(epoch from clock_timestamp())/3600)*3600);
  normalized_stand text := upper(trim(coalesce(target_stand,'')));
  v_stand_key text;
  event_count integer;
  stand_count integer;
begin
  if target_event_id is null or normalized_stand='' then return false; end if;
  v_stand_key := md5(normalized_stand);
  -- Serialize quota checks within an event so concurrent requests cannot race
  -- past either threshold.
  perform pg_advisory_xact_lock(hashtextextended(target_event_id::text||':'||extract(epoch from hour_start)::bigint::text,0));
  delete from public.public_query_submission_limits where window_started_at < hour_start-interval '24 hours';

  select request_count into event_count from public.public_query_submission_limits
    where event_id=target_event_id and window_started_at=hour_start and stand_key='*';
  if coalesce(event_count,0)>=200 then return false; end if;

  select request_count into stand_count from public.public_query_submission_limits
    where event_id=target_event_id and window_started_at=hour_start and stand_key=v_stand_key;
  if coalesce(stand_count,0)>=20 then return false; end if;

  insert into public.public_query_submission_limits(event_id,window_started_at,stand_key,request_count)
    values(target_event_id,hour_start,'*',1)
    on conflict(event_id,window_started_at,stand_key) do update
      set request_count=public.public_query_submission_limits.request_count+1
      where public.public_query_submission_limits.request_count<200;
  insert into public.public_query_submission_limits(event_id,window_started_at,stand_key,request_count)
    values(target_event_id,hour_start,v_stand_key,1)
    on conflict(event_id,window_started_at,stand_key) do update
      set request_count=public.public_query_submission_limits.request_count+1
      where public.public_query_submission_limits.request_count<20;
  return true;
end;
$$;
revoke all on function public.allow_public_query_submission(uuid,text) from public,anon,authenticated;

create or replace function public.enforce_public_query_submission_limits()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role()='anon' and new.source_tab='CLIENT'
    and not public.allow_public_query_submission(new.event_id,new.stand) then
    raise exception 'Too many requests for this stand or event. Please wait and try again later, or contact the organiser.'
      using errcode='P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_public_query_submission_limits() from public,anon,authenticated;
drop trigger if exists zz_public_query_submission_limits on public.queries;
create trigger zz_public_query_submission_limits
before insert on public.queries
for each row execute function public.enforce_public_query_submission_limits();

commit;