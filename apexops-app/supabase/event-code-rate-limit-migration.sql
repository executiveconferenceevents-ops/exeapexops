begin;

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
  hashed_client_ip text;
  window_start_at timestamptz := to_timestamp(floor(extract(epoch from now()) / 900) * 900);
  current_attempts integer;
  matched_event_id uuid;
  operational boolean;
begin
  begin
    request_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  exception when others then
    return null;
  end;
  client_ip := coalesce(
    nullif(request_headers->>'cf-connecting-ip', ''),
    nullif(request_headers->>'x-real-ip', ''),
    nullif(trim(regexp_replace(coalesce(request_headers->>'x-forwarded-for', ''), '^.*,', '')), '')
  );
  if client_ip is null or normalized_slug = '' or normalized_code = '' then return null; end if;
  hashed_client_ip := md5(client_ip);

  insert into public.event_code_attempts (event_slug, client_ip_hash, window_start, attempt_count)
  values (normalized_slug, hashed_client_ip, window_start_at, 0)
  on conflict (event_slug, client_ip_hash, window_start)
  do update set attempt_count = public.event_code_attempts.attempt_count
  returning attempt_count into current_attempts;

  if current_attempts >= 10 then return null; end if;

  select event.id into matched_event_id
  from public.events event
  where event.slug = normalized_slug
    and event.exhibitor_code = normalized_code
    and event.is_public;
  if matched_event_id is not null then
    if to_regprocedure('public.is_event_operational(uuid)') is not null then
      execute 'select public.is_event_operational($1)' into operational using matched_event_id;
      if not coalesce(operational, false) then return null; end if;
    end if;
    return matched_event_id;
  end if;

  if coalesce(current_setting('apexops.event_code_attempt_recorded', true), '0') <> '1' then
    update public.event_code_attempts set attempt_count = attempt_count + 1
    where event_slug = normalized_slug and client_ip_hash = hashed_client_ip and window_start = window_start_at;
    perform set_config('apexops.event_code_attempt_recorded', '1', true);
  end if;
  return null;
end;
$$;

revoke all on function public.validate_public_event_code(text, text) from public;

create or replace function public.event_code_rate_limit_version()
returns integer
language sql
immutable
as $$ select 1 $$;

revoke all on function public.event_code_rate_limit_version() from public;

commit;