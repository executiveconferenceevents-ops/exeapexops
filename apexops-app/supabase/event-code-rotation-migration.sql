-- Rotate one event's public code atomically and enforce role/lifecycle access.
begin;

create or replace function public.rotate_event_exhibitor_code(target_event_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  rotated_code text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before rotating an event code.' using errcode = '42501';
  end if;
  if not public.is_platform_admin() then
    if not public.has_event_access(target_event_id, array['client_admin','event_admin','ops']) then
      raise exception 'You do not have permission to rotate this event code.' using errcode = '42501';
    end if;
    if not public.is_event_operational(target_event_id) then
      raise exception 'This event is no longer open for team changes.' using errcode = '42501';
    end if;
  end if;

  update public.events
  set exhibitor_code = null
  where id = target_event_id
  returning exhibitor_code into rotated_code;
  if not found or rotated_code is null then
    raise exception 'Could not rotate the event code.' using errcode = 'P0002';
  end if;
  return rotated_code;
end;
$$;

revoke all on function public.rotate_event_exhibitor_code(uuid) from public, anon;
grant execute on function public.rotate_event_exhibitor_code(uuid) to authenticated;

commit;