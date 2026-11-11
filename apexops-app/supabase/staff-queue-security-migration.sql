-- Restrict staff-only accounts to their own profile and assigned queries.
-- Staff email must match the email on their authenticated Supabase account.

begin;

-- Keep broad event visibility for operations and administrators only.
drop policy if exists "event members read queries" on public.queries;
drop policy if exists "ops and admins read event queries" on public.queries;
drop policy if exists "staff read assigned queries" on public.queries;
create policy "ops and admins read event queries"
on public.queries for select to authenticated
using (public.has_event_access(event_id, array['client_admin','event_admin','ops']));

create policy "staff read assigned queries"
on public.queries for select to authenticated
using (
  public.has_event_access(event_id, array['staff'])
  and (
    select count(*) = 1
    from public.staff as profile
    where profile.event_id = queries.event_id
      and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
  and exists (
    select 1
    from public.staff as profile
    where profile.event_id = queries.event_id
      and profile.id = queries.assigned_to
      and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
);

-- Staff can update only assigned query rows; operations/admins retain event-wide access.
drop policy if exists "event members update queries" on public.queries;
drop policy if exists "ops and admins update event queries" on public.queries;
drop policy if exists "staff update assigned queries" on public.queries;
create policy "ops and admins update event queries"
on public.queries for update to authenticated
using (public.has_event_access(event_id, array['client_admin','event_admin','ops']))
with check (public.has_event_access(event_id, array['client_admin','event_admin','ops']));

create policy "staff update assigned queries"
on public.queries for update to authenticated
using (
  public.has_event_access(event_id, array['staff'])
  and (
    select count(*) = 1
    from public.staff as profile
    where profile.event_id = queries.event_id
      and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
  and exists (
    select 1
    from public.staff as profile
    where profile.event_id = queries.event_id
      and profile.id = queries.assigned_to
      and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
)
with check (
  public.has_event_access(event_id, array['staff'])
  and (
    select count(*) = 1
    from public.staff as profile
    where profile.event_id = queries.event_id
      and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
  and exists (
    select 1
    from public.staff as profile
    where profile.event_id = queries.event_id
      and profile.id = queries.assigned_to
      and lower(trim(coalesce(profile.email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
);

-- Staff process assigned work; they do not create or assign event queries.
drop policy if exists "event members insert queries" on public.queries;
drop policy if exists "ops and admins insert event queries" on public.queries;
create policy "ops and admins insert event queries"
on public.queries for insert to authenticated
with check (public.has_event_access(event_id, array['client_admin','event_admin','ops']));

-- The UI's staff picker is not an access boundary; expose only a staff member's own profile to staff roles.
drop policy if exists "event members read staff" on public.staff;
drop policy if exists "ops and admins read event staff" on public.staff;
drop policy if exists "staff read own profile" on public.staff;
create policy "ops and admins read event staff"
on public.staff for select to authenticated
using (public.has_event_access(event_id, array['client_admin','event_admin','ops']));

create policy "staff read own profile"
on public.staff for select to authenticated
using (
  public.has_event_access(event_id, array['staff'])
  and lower(trim(coalesce(email, ''))) = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
);

-- The application only updates these query fields; assignment remains protected by the row policy.
revoke update on public.queries from authenticated;
grant update (assigned_to, status, completed_at, notes, sla_deadline, photo_urls)
on public.queries to authenticated;

commit;
