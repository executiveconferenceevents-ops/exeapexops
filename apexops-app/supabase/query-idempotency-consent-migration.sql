-- Persist exhibitor privacy acknowledgements and make public query retries idempotent.
begin;

alter table public.queries add column if not exists client_submission_id uuid;
create unique index if not exists queries_event_submission_id_unique
  on public.queries (event_id, client_submission_id)
  where client_submission_id is not null;

create table if not exists public.event_privacy_acknowledgements (
  event_id uuid not null references public.events(id) on delete cascade,
  acknowledgement_id uuid not null,
  notice_version text not null,
  acknowledged_at timestamptz not null default now(),
  primary key (event_id, acknowledgement_id)
);
alter table public.event_privacy_acknowledgements enable row level security;
revoke all on public.event_privacy_acknowledgements from public, anon, authenticated;

alter table public.queries add column if not exists privacy_acknowledgement_id uuid;
alter table public.rebooking_requests add column if not exists privacy_acknowledgement_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.queries'::regclass and conname = 'queries_privacy_acknowledgement_fk') then
    alter table public.queries add constraint queries_privacy_acknowledgement_fk
      foreign key (event_id, privacy_acknowledgement_id)
      references public.event_privacy_acknowledgements (event_id, acknowledgement_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.rebooking_requests'::regclass and conname = 'rebooking_privacy_acknowledgement_fk') then
    alter table public.rebooking_requests add constraint rebooking_privacy_acknowledgement_fk
      foreign key (event_id, privacy_acknowledgement_id)
      references public.event_privacy_acknowledgements (event_id, acknowledgement_id);
  end if;
end;
$$;

create or replace function public.prevent_duplicate_client_query()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source_tab = 'CLIENT' then
    perform pg_advisory_xact_lock(hashtextextended(new.event_id::text || ':' || upper(trim(new.stand)), 0));
    if exists (
      select 1 from public.queries existing
      where existing.event_id = new.event_id
        and upper(trim(existing.stand)) = upper(trim(new.stand))
        and lower(regexp_replace(trim(existing.exhibitor), '\s+', ' ', 'g')) = lower(regexp_replace(trim(new.exhibitor), '\s+', ' ', 'g'))
        and lower(regexp_replace(trim(existing.description), '\s+', ' ', 'g')) = lower(regexp_replace(trim(new.description), '\s+', ' ', 'g'))
        and existing.status <> 'COMPLETED'
        and (new.client_submission_id is null or existing.client_submission_id is distinct from new.client_submission_id)
    ) then
      raise exception 'This issue has already been submitted for this exhibitor and stand.' using errcode = '23505';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.acknowledge_public_event_privacy(
  requested_event_slug text,
  requested_code text,
  requested_acknowledgement_id uuid,
  requested_notice_version text
)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_event_id uuid;
  saved_at timestamptz;
begin
  target_event_id := public.validate_public_event_code(requested_event_slug, requested_code);
  if target_event_id is null or requested_acknowledgement_id is null
    or nullif(trim(requested_notice_version), '') is null then
    return null;
  end if;

  insert into public.event_privacy_acknowledgements (event_id, acknowledgement_id, notice_version)
  values (target_event_id, requested_acknowledgement_id, left(trim(requested_notice_version), 80))
  on conflict (event_id, acknowledgement_id) do nothing
  returning acknowledged_at into saved_at;

  if saved_at is null then
    select acknowledgement.acknowledged_at into saved_at
    from public.event_privacy_acknowledgements acknowledgement
    where acknowledgement.event_id = target_event_id
      and acknowledgement.acknowledgement_id = requested_acknowledgement_id;
  end if;
  return saved_at;
end;
$$;

revoke all on function public.acknowledge_public_event_privacy(text, text, uuid, text) from public;
grant execute on function public.acknowledge_public_event_privacy(text, text, uuid, text) to anon, authenticated;

create or replace function public.submit_public_rebooking(requested_event_slug text, requested_code text, request_payload jsonb)
returns setof public.rebooking_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_event_id uuid;
  new_request_id text;
  acknowledgement_id uuid;
  notice_version text := nullif(trim(request_payload->>'privacy_notice_version'), '');
  company_name text := trim(coalesce(request_payload->>'company', ''));
  contact_name text := trim(coalesce(request_payload->>'contact_person', ''));
  contact_email text := trim(coalesce(request_payload->>'email', ''));
  current_stand text := upper(trim(coalesce(request_payload->>'current_stand', '')));
begin
  target_event_id := public.validate_public_event_code(requested_event_slug, requested_code);
  if target_event_id is null then return; end if;
  begin acknowledgement_id := nullif(request_payload->>'acknowledgement_id', '')::uuid;
  exception when others then raise exception 'Invalid privacy acknowledgement.' using errcode = '22023'; end;
  if acknowledgement_id is null or notice_version is null or not exists (
    select 1 from public.event_privacy_acknowledgements acknowledgement
    where acknowledgement.event_id = target_event_id
      and acknowledgement.acknowledgement_id = acknowledgement_id
      and acknowledgement.notice_version = notice_version
  ) then
    raise exception 'Please review and acknowledge the event privacy notice before submitting.' using errcode = '42501';
  end if;
  if company_name = '' or contact_name = '' or contact_email = '' or current_stand = '' then
    raise exception 'Complete the company, contact, email and current stand fields before submitting.' using errcode = '22023';
  end if;

  new_request_id := 'rebook-' || replace(gen_random_uuid()::text, '-', '');
  return query
  insert into public.rebooking_requests (
    event_id, id, company, contact_person, contact_title, email, mobile, current_stand,
    interest, preferred_stand, stand_size, booth_type, sponsorship_interest,
    discussion_topics, notes, created_at, privacy_acknowledgement_id
  ) values (
    target_event_id, new_request_id, company_name, contact_name,
    trim(coalesce(request_payload->>'contact_title', '')), contact_email,
    trim(coalesce(request_payload->>'mobile', '')), current_stand,
    trim(coalesce(request_payload->>'interest', 'Rebook current stand')),
    upper(trim(coalesce(request_payload->>'preferred_stand', ''))),
    coalesce(nullif(trim(request_payload->>'stand_size'), ''), '6 sqm'),
    coalesce(nullif(trim(request_payload->>'booth_type'), ''), 'Shell scheme'),
    coalesce(nullif(trim(request_payload->>'sponsorship_interest'), ''), 'No'),
    coalesce(request_payload->'discussion_topics', '[]'::jsonb),
    trim(coalesce(request_payload->>'notes', '')), now(), acknowledgement_id
  ) returning *;
end;
$$;

revoke all on function public.submit_public_rebooking(text, text, jsonb) from public;
grant execute on function public.submit_public_rebooking(text, text, jsonb) to anon, authenticated;

create or replace function public.submit_public_query(requested_event_slug text, requested_code text, query_payload jsonb)
returns setof public.queries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_event_id uuid;
  new_query_id text;
  requested_submission_id uuid := gen_random_uuid();
  requested_acknowledgement_id uuid;
  requested_notice_version text := nullif(trim(query_payload->>'privacy_notice_version'), '');
  requested_est text := coalesce(nullif(trim(query_payload->>'est'), ''), '1 hour');
  requested_stand text := upper(trim(coalesce(query_payload->>'stand', '')));
  requested_exhibitor text := trim(coalesce(query_payload->>'exhibitor', ''));
  requested_category text := trim(coalesce(query_payload->>'category', ''));
  requested_description text := trim(coalesce(query_payload->>'description', ''));
  requested_photos text[] := '{}';
  requested_logged_at timestamptz := now();
  existing_query public.queries%rowtype;
begin
  target_event_id := public.validate_public_event_code(requested_event_slug, requested_code);
  if target_event_id is null then return; end if;

  begin
    requested_submission_id := coalesce(nullif(query_payload->>'submission_id', '')::uuid, requested_submission_id);
    requested_acknowledgement_id := nullif(query_payload->>'acknowledgement_id', '')::uuid;
  exception when others then
    raise exception 'Invalid submission or acknowledgement reference.' using errcode = '22023';
  end;

  select query.* into existing_query
  from public.queries query
  where query.event_id = target_event_id
    and query.client_submission_id = requested_submission_id;
  if found then return next existing_query; return; end if;

  if (
    requested_acknowledgement_id is null
    or requested_notice_version is null
    or not exists (
      select 1 from public.event_privacy_acknowledgements acknowledgement
      where acknowledgement.event_id = target_event_id
        and acknowledgement.acknowledgement_id = requested_acknowledgement_id
        and acknowledgement.notice_version = requested_notice_version
    )
  ) and not public.has_event_access(target_event_id, array['client_admin','event_admin','ops']) then
    raise exception 'Please review and acknowledge the event privacy notice before submitting.' using errcode = '42501';
  end if;
  if auth.role() = 'authenticated'
    and not public.has_event_access(target_event_id, array['client_admin','event_admin','ops']) then
    raise exception 'You do not have permission to submit a query for this event.' using errcode = '42501';
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
  if cardinality(requested_photos) > case when auth.role() = 'anon' then 4 else 8 end
    or exists (
      select 1 from unnest(requested_photos) as photo
      where length(photo) > 600
        or not public.valid_query_photo_reference(target_event_id, requested_code, requested_submission_id, photo)
    ) then
    raise exception 'Photos could not be attached to this query.' using errcode = '22023';
  end if;

  begin
    requested_logged_at := greatest(now() - interval '3 days', least(now(), (query_payload->>'submittedAt')::timestamptz));
  exception when others then
    requested_logged_at := now();
  end;
  new_query_id := 'Q-' || upper(substr(replace(requested_submission_id::text, '-', ''), 1, 16));

  insert into public.queries (
    event_id, id, client_submission_id, stand, exhibitor, contact, phone, category, description, est,
    status, assigned_to, logged_at, source_tab, sla_deadline, notes, photo_urls, privacy_acknowledgement_id
  ) values (
    target_event_id, new_query_id, requested_submission_id, requested_stand, requested_exhibitor,
    nullif(trim(query_payload->>'contact'), ''), nullif(trim(query_payload->>'phone'), ''),
    requested_category, requested_description, requested_est, 'LOGGED', null, requested_logged_at, 'CLIENT',
    requested_logged_at + case requested_est
      when '15 min' then interval '15 minutes'
      when '30 min' then interval '30 minutes'
      when '2 hours' then interval '2 hours'
      when '3 hours' then interval '3 hours'
      when '4 hours' then interval '4 hours'
      when 'Half day' then interval '4 hours'
      when 'Full day' then interval '8 hours'
      else interval '1 hour'
    end,
    null, requested_photos,
    case when auth.role() = 'anon' then requested_acknowledgement_id else null end
  ) on conflict (event_id, client_submission_id) where client_submission_id is not null do nothing
  returning * into existing_query;

  if not found then
    select query.* into existing_query
    from public.queries query
    where query.event_id = target_event_id
      and query.client_submission_id = requested_submission_id;
  end if;
  if existing_query.id is not null then return next existing_query; end if;
end;
$$;

revoke all on function public.submit_public_query(text, text, jsonb) from public;
grant execute on function public.submit_public_query(text, text, jsonb) to anon, authenticated;

commit;
