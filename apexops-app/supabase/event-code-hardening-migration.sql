begin;

revoke select on public.events from authenticated;
revoke select (exhibitor_code) on public.events from authenticated;
grant select (
  id, client_id, name, event_start_date, event_end_date, build_up_start_date, build_up_end_date,
  breakdown_start_date, breakdown_end_date, next_event_name, slug, is_public, logo_url
) on public.events to authenticated;

create table if not exists public.event_code_attempts (
  event_slug text not null,
  client_ip_hash text not null,
  window_start timestamptz not null,
  attempt_count integer not null default 0,
  primary key (event_slug, client_ip_hash, window_start)
);

alter table public.event_code_attempts enable row level security;
revoke all on public.event_code_attempts from public, anon, authenticated;

create or replace function public.validate_public_event_code(requested_slug text, requested_code text)
returns uuid
language plpgsql
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
    and event.is_public;
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

create or replace function public.set_event_exhibitor_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.event_start_date is null then
    raise exception 'An event start date is required to generate the exhibitor code.' using errcode = '22023';
  end if;
  if new.event_end_date is null or new.build_up_start_date is null or new.build_up_end_date is null
    or new.breakdown_start_date is null or new.breakdown_end_date is null then
    raise exception 'Event, build-up, and breakdown dates are required.' using errcode = '22023';
  end if;
  if new.event_end_date < new.event_start_date
    or new.build_up_start_date > new.build_up_end_date
    or new.build_up_end_date > new.event_start_date
    or new.breakdown_start_date < new.event_end_date
    or new.breakdown_start_date > new.breakdown_end_date then
    raise exception 'Event, build-up, and breakdown dates must be in chronological order.' using errcode = '22023';
  end if;
  if nullif(trim(new.exhibitor_code), '') is null then
    new.exhibitor_code := 'APX-' || upper(replace(gen_random_uuid()::text, '-', ''));
  end if;
  return new;
end;
$$;

update public.events
set exhibitor_code = null
where exhibitor_code !~ '^APX-[A-F0-9]{32}$';

create or replace function public.get_event_access_codes(requested_event_ids uuid[])
returns table (event_id uuid, exhibitor_code text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select event.id, event.exhibitor_code
  from public.events event
  where event.id = any(requested_event_ids)
    and public.has_event_access(event.id, array['client_admin','event_admin','ops']);
$$;

create or replace function public.get_event_access_code(requested_event_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select event.exhibitor_code
  from public.events event
  where event.id = requested_event_id
    and public.has_event_access(event.id, array['client_admin','event_admin','ops']);
$$;

revoke all on function public.get_event_access_codes(uuid[]) from public;
revoke all on function public.get_event_access_code(uuid) from public;
grant execute on function public.get_event_access_codes(uuid[]) to authenticated;
grant execute on function public.get_event_access_code(uuid) to authenticated;

-- Make every public code-checking RPC use one rate-limited validator.
do $$
declare
  target record;
  definition text;
  original_definition text;
  replaced_count integer := 0;
begin
  for target in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_public_event',
        'get_public_stand_status',
        'get_public_exhibitors',
        'submit_public_query',
        'submit_public_rebooking',
        'escalate_public_query'
      )
      and (
        p.prosrc like '%event.exhibitor_code = upper(trim(requested_code))%'
        or p.prosrc like '%public.validate_public_event_code%'
      )
  loop
    definition := pg_get_functiondef(target.oid);
    original_definition := definition;
    definition := regexp_replace(
      definition,
      'event[.]slug[[:space:]]*=[[:space:]]*lower[[:space:]]*\([[:space:]]*trim[[:space:]]*\([[:space:]]*requested_slug[[:space:]]*\)[[:space:]]*\)[[:space:]]+and[[:space:]]+event[.]exhibitor_code[[:space:]]*=[[:space:]]*upper[[:space:]]*\([[:space:]]*trim[[:space:]]*\([[:space:]]*requested_code[[:space:]]*\)[[:space:]]*\)',
      'event.id = public.validate_public_event_code(requested_slug, requested_code)', 'gi'
    );
    definition := regexp_replace(
      definition,
      'event[.]slug[[:space:]]*=[[:space:]]*lower[[:space:]]*\([[:space:]]*trim[[:space:]]*\([[:space:]]*requested_event_slug[[:space:]]*\)[[:space:]]*\)[[:space:]]+and[[:space:]]+event[.]exhibitor_code[[:space:]]*=[[:space:]]*upper[[:space:]]*\([[:space:]]*trim[[:space:]]*\([[:space:]]*requested_code[[:space:]]*\)[[:space:]]*\)',
      'event.id = public.validate_public_event_code(requested_event_slug, requested_code)', 'gi'
    );
    -- Functions already calling the shared validator are left intact on reruns.
    if target.proname in ('submit_public_query', 'submit_public_rebooking') then
      definition := regexp_replace(
        definition,
        'if[[:space:]]+target_event_id[[:space:]]+is[[:space:]]+null[[:space:]]+then[[:space:]]+raise[[:space:]]+exception[[:space:]]+''The event code is invalid or the event is unavailable.''[[:space:]]+using[[:space:]]+errcode[[:space:]]*=[[:space:]]*''42501'';[[:space:]]+end[[:space:]]+if;',
        'if target_event_id is null then return; end if;', 'gi'
      );
    end if;
    if target.proname = 'escalate_public_query' then
      definition := regexp_replace(
        definition,
        'if[[:space:]]+updated_id[[:space:]]+is[[:space:]]+null[[:space:]]+then[[:space:]]+raise[[:space:]]+exception[[:space:]]+''This query could not be escalated. Check the event, stand and query status.'';[[:space:]]+end[[:space:]]+if;',
        'if updated_id is null then return null; end if;', 'gi'
      );
    end if;
    if definition <> original_definition then
      definition := regexp_replace(definition, '\mSTABLE\M', 'VOLATILE', 'i');
      execute definition;
    end if;
    if definition like '%public.validate_public_event_code%' then
      replaced_count := replaced_count + 1;
    else
      raise exception 'Could not harden event-code validation for function %.', target.proname;
    end if;
  end loop;
  if replaced_count <> 6 then
    raise exception 'Expected to harden 6 public event-code functions, but updated %.', replaced_count;
  end if;
end;
$$;

commit;
