alter table public.events add column if not exists logo_url text;

drop function if exists public.list_public_events();
create function public.list_public_events()
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
  where event.is_public
  order by client.name, event.name;
$$;

drop function if exists public.get_public_event(text, text);
create function public.get_public_event(requested_slug text, requested_code text)
returns table (
  id uuid, name text, slug text, event_start_date date, event_end_date date,
  build_up_start_date date, build_up_end_date date, breakdown_start_date date, breakdown_end_date date,
  next_event_name text, logo_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select event.id, event.name, event.slug, event.event_start_date, event.event_end_date,
    event.build_up_start_date, event.build_up_end_date, event.breakdown_start_date, event.breakdown_end_date,
    event.next_event_name, event.logo_url
  from public.events event
  where event.slug = lower(trim(requested_slug))
    and event.exhibitor_code = upper(trim(requested_code))
    and event.is_public;
$$;

revoke all on function public.list_public_events() from public;
revoke all on function public.get_public_event(text, text) from public;
grant execute on function public.list_public_events() to anon, authenticated;
grant execute on function public.get_public_event(text, text) to anon, authenticated;