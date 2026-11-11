-- Close public event access and operational writes 30 days after breakdown.
-- Historical records remain readable to authorized event members.

begin;

do $$
begin
  if to_regprocedure('public.event_code_rate_limit_version()') is null
    or not exists (
      select 1 from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public' and procedure.proname = 'validate_public_event_code'
        and procedure.prosrc like '%if current_attempts >= 10%'
    ) then
    raise exception 'Apply event-code-rate-limit-migration.sql before the event expiry migration.';
  end if;
end;
$$;

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
      and current_date <= coalesce(event.breakdown_end_date, event.event_end_date) + 30
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

drop policy if exists "active client admins manage memberships" on public.client_event_memberships;
create policy "active client admins manage memberships" on public.client_event_memberships for all to authenticated
using (
  role <> 'platform_admin'
  and public.has_client_access(client_id, event_id, array['client_admin'])
  and public.client_billing_is_current(client_id)
  and (event_id is null or public.is_event_operational(event_id))
)
with check (
  role <> 'platform_admin'
  and public.has_client_access(client_id, event_id, array['client_admin'])
  and public.client_billing_is_current(client_id)
  and (event_id is null or public.is_event_operational(event_id))
);
grant insert, update, delete on public.client_event_memberships to authenticated;

create or replace function public.can_read_event_history(target_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_platform_admin() or exists (
    select 1 from public.events event
    where event.id = target_event_id
      and (
        (public.is_event_operational(event.id) and public.has_event_access(event.id, array['client_admin','event_admin','ops','staff']))
        or (current_date <= (coalesce(event.event_end_date, event.breakdown_end_date) + interval '12 months')::date
          and public.has_event_access(event.id, array['client_admin']))
      )
  );
$$;

revoke all on function public.can_read_event_history(uuid) from public;
grant execute on function public.can_read_event_history(uuid) to authenticated;

drop policy if exists "event history access" on public.events;
create policy "event history access" on public.events as restrictive for select to authenticated
using (
  public.is_platform_admin()
  or (current_date <= coalesce(breakdown_end_date, event_end_date) + 30
    and public.client_billing_is_current(client_id)
    and public.has_client_access(client_id, id, array['client_admin','event_admin','ops','staff']))
  or (current_date <= (coalesce(event_end_date, breakdown_end_date) + interval '12 months')::date
    and public.has_client_access(client_id, id, array['client_admin']))
);
drop policy if exists "event history access" on public.queries;
create policy "event history access" on public.queries as restrictive for select to authenticated
using (public.can_read_event_history(event_id));
drop policy if exists "event history access" on public.staff;
create policy "event history access" on public.staff as restrictive for select to authenticated
using (public.can_read_event_history(event_id));
drop policy if exists "event history access" on public.exhibitors;
create policy "event history access" on public.exhibitors as restrictive for select to authenticated
using (public.can_read_event_history(event_id));
drop policy if exists "event history access" on public.rebooking_requests;
create policy "event history access" on public.rebooking_requests as restrictive for select to authenticated
using (public.can_read_event_history(event_id));
drop policy if exists "event history access" on public.ops_notifications;
create policy "event history access" on public.ops_notifications as restrictive for select to authenticated
using (public.can_read_event_history(event_id));

drop policy if exists "event history access for query photos" on storage.objects;
create policy "event history access for query photos" on storage.objects as restrictive for select to authenticated
using (
  case
    when bucket_id not in ('query-photos', 'query-photos-private') then true
    when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_read_event_history(split_part(name, '/', 1)::uuid)
    else false
  end
);

create or replace function public.is_query_photo_event_active(object_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when split_part(object_path, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_event_operational(split_part(object_path, '/', 1)::uuid)
    else false
  end;
$$;
revoke all on function public.is_query_photo_event_active(text) from public;
grant execute on function public.is_query_photo_event_active(text) to anon, authenticated;
drop policy if exists "active public query photos" on storage.objects;
create policy "active public query photos" on storage.objects as restrictive for select to anon
using (bucket_id not in ('query-photos', 'query-photos-private') or public.is_query_photo_event_active(name));
drop policy if exists "active query photo uploads" on storage.objects;
create policy "active query photo uploads" on storage.objects as restrictive for insert to anon, authenticated
with check (bucket_id not in ('query-photos', 'query-photos-private') or public.is_query_photo_event_active(name));
drop policy if exists "active query photo updates" on storage.objects;
create policy "active query photo updates" on storage.objects as restrictive for update to anon, authenticated
using (bucket_id not in ('query-photos', 'query-photos-private') or public.is_query_photo_event_active(name))
with check (bucket_id not in ('query-photos', 'query-photos-private') or public.is_query_photo_event_active(name));
drop policy if exists "active query photo deletions" on storage.objects;
create policy "active query photo deletions" on storage.objects as restrictive for delete to authenticated
using (bucket_id not in ('query-photos', 'query-photos-private') or public.is_query_photo_event_active(name));

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
drop policy if exists "event admins delete active event queries" on public.queries;
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
drop policy if exists "ops and admins manage active event exhibitors" on public.exhibitors;
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
drop policy if exists "event admins update active rebooking requests" on public.rebooking_requests;
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
drop policy if exists "event members update active notifications" on public.ops_notifications;
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
drop policy if exists "event operations delete active private query photos" on storage.objects;
create policy "event operations delete active private query photos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'query-photos-private'
  and public.has_event_access(split_part(name, '/', 1)::uuid, array['client_admin','event_admin','ops'])
  and public.is_event_operational(split_part(name, '/', 1)::uuid)
);

commit;
