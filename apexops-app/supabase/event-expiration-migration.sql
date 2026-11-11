-- Close public event access and operational writes seven days after breakdown.
-- Historical records remain readable to authorized event members.

begin;

create or replace function public.is_event_operational(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.events event
    where event.id = target_event_id
      and current_date <= coalesce(event.breakdown_end_date, event.event_end_date) + 7
      and public.client_billing_is_current(event.client_id)
  );
$$;

-- Historical event rows stay readable; clients may only change/create active event records.
drop policy if exists "client admins manage events" on public.events;
drop policy if exists "active client admins create events" on public.events;
drop policy if exists "active client admins update events" on public.events;
create policy "active client admins create events"
on public.events for insert to authenticated
with check (
  public.has_client_access(client_id, id, array['client_admin'])
  and public.client_billing_is_current(client_id)
);
create policy "active client admins update events"
on public.events for update to authenticated
using (
  public.has_client_access(client_id, id, array['client_admin'])
  and public.is_event_operational(id)
)
with check (
  public.has_client_access(client_id, id, array['client_admin'])
  and public.is_event_operational(id)
);

revoke all on function public.is_event_operational(uuid) from public;
grant execute on function public.is_event_operational(uuid) to authenticated;

create or replace function public.validate_public_event_code(requested_slug text, requested_code text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_slug text := lower(trim(coalesce(requested_slug, '')));
  normalized_code text := upper(trim(coalesce(requested_code, '')));
  request_headers jsonb := '{}'::jsonb;
  client_ip text;
  client_ip_hash text;
  window_start_at timestamptz := to_timestamp(floor(extract(epoch from now()) / 900) * 900);
  current_attempts integer := 0;
  matched_event_id uuid;
begin
  begin
    request_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    request_headers := '{}'::jsonb;
  end;
  client_ip := coalesce(
    nullif(request_headers->>'cf-connecting-ip', ''),
    nullif(request_headers->>'x-real-ip', ''),
    nullif(trim(regexp_replace(coalesce(request_headers->>'x-forwarded-for', ''), '^.*,', '')), ''),
    'unknown'
  );
  client_ip_hash := md5(client_ip);

  select event.id into matched_event_id
  from public.events event
  where event.slug = normalized_slug
    and event.exhibitor_code = normalized_code
    and event.is_public
    and public.is_event_operational(event.id);
  if matched_event_id is not null then return matched_event_id; end if;

  if client_ip <> 'unknown'
    and coalesce(current_setting('apexops.event_code_attempt_recorded', true), '0') <> '1' then
    insert into public.event_code_attempts (event_slug, client_ip_hash, window_start, attempt_count)
    values (normalized_slug, client_ip_hash, window_start_at, 1)
    on conflict (event_slug, client_ip_hash, window_start)
    do update set attempt_count = public.event_code_attempts.attempt_count + 1
    returning attempt_count into current_attempts;
    perform set_config('apexops.event_code_attempt_recorded', '1', true);
    delete from public.event_code_attempts where window_start < now() - interval '1 day';
    if current_attempts > 10 then return null; end if;
  end if;

  return null;
end;
$$;

revoke all on function public.validate_public_event_code(text, text) from public;

create or replace function public.list_public_events()
returns table (
  client_name text, event_name text, slug text, event_start_date date, event_end_date date,
  build_up_start_date date, build_up_end_date date, breakdown_start_date date, breakdown_end_date date,
  next_event_name text, logo_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select client.name, event.name, event.slug, event.event_start_date, event.event_end_date,
    event.build_up_start_date, event.build_up_end_date, event.breakdown_start_date, event.breakdown_end_date,
    event.next_event_name, event.logo_url
  from public.events event
  join public.clients client on client.id = event.client_id
  where event.is_public and public.is_event_operational(event.id)
  order by client.name, event.name;
$$;

-- Keep event history visible, but stop operational writes once the grace period expires.
drop policy if exists "event admins delete queries" on public.queries;
create policy "event admins delete active event queries"
on public.queries for delete to authenticated
using (
  public.has_event_access(event_id, array['client_admin','event_admin','ops'])
  and public.is_event_operational(event_id)
);

drop policy if exists "ops and admins insert event queries" on public.queries;
create policy "ops and admins insert event queries"
on public.queries for insert to authenticated
with check (
  public.has_event_access(event_id, array['client_admin','event_admin','ops'])
  and public.is_event_operational(event_id)
);

drop policy if exists "staff update assigned queries" on public.queries;
create policy "staff update assigned queries"
on public.queries for update to authenticated
using (
  public.has_event_access(event_id, array['staff'])
  and public.is_event_operational(event_id)
  and (select count(*) = 1 from public.staff profile where profile.event_id = queries.event_id and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', ''))))
  and exists (
    select 1 from public.staff profile
    where profile.event_id = queries.event_id and profile.id = queries.assigned_to
      and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
)
with check (
  public.has_event_access(event_id, array['staff'])
  and public.is_event_operational(event_id)
  and (select count(*) = 1 from public.staff profile where profile.event_id = queries.event_id and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', ''))))
  and exists (
    select 1 from public.staff profile
    where profile.event_id = queries.event_id and profile.id = queries.assigned_to
      and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
);

drop policy if exists "ops and admins update event queries" on public.queries;
create policy "ops and admins update event queries"
on public.queries for update to authenticated
using (
  public.has_event_access(event_id, array['client_admin','event_admin','ops'])
  and public.is_event_operational(event_id)
)
with check (
  public.has_event_access(event_id, array['client_admin','event_admin','ops'])
  and public.is_event_operational(event_id)
);

drop policy if exists "ops and admins manage event staff" on public.staff;
drop policy if exists "event admins manage staff" on public.staff;
create policy "ops and admins manage event staff"
on public.staff for all to authenticated
using (
  public.has_event_access(event_id, array['client_admin','event_admin','ops'])
  and public.is_event_operational(event_id)
)
with check (
  public.has_event_access(event_id, array['client_admin','event_admin','ops'])
  and public.is_event_operational(event_id)
);

drop policy if exists "event admins manage exhibitors" on public.exhibitors;
create policy "ops and admins manage active event exhibitors"
on public.exhibitors for all to authenticated
using (
  public.has_event_access(event_id, array['client_admin','event_admin','ops'])
  and public.is_event_operational(event_id)
)
with check (
  public.has_event_access(event_id, array['client_admin','event_admin','ops'])
  and public.is_event_operational(event_id)
);

drop policy if exists "event admins update rebooking requests" on public.rebooking_requests;
create policy "event admins update active rebooking requests"
on public.rebooking_requests for update to authenticated
using (
  public.has_event_access(event_id, array['client_admin','event_admin','ops'])
  and public.is_event_operational(event_id)
)
with check (
  public.has_event_access(event_id, array['client_admin','event_admin','ops'])
  and public.is_event_operational(event_id)
);

drop policy if exists "event members update notifications" on public.ops_notifications;
create policy "event members update active notifications"
on public.ops_notifications for update to authenticated
using (
  public.has_event_access(event_id, array['client_admin','event_admin','ops','staff'])
  and public.is_event_operational(event_id)
)
with check (
  public.has_event_access(event_id, array['client_admin','event_admin','ops','staff'])
  and public.is_event_operational(event_id)
);

drop policy if exists "event operations delete private query photos" on storage.objects;
create policy "event operations delete active private query photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'query-photos-private'
  and public.has_event_access(split_part(name, '/', 1)::uuid, array['client_admin','event_admin','ops'])
  and public.is_event_operational(split_part(name, '/', 1)::uuid)
);

commit;
