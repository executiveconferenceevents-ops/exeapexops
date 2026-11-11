-- Add an admin-configurable per-client event quota and enforce it on every event insert.
begin;

alter table public.clients
  add column if not exists event_limit integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.clients'::regclass and conname = 'clients_event_limit_positive'
  ) then
    alter table public.clients add constraint clients_event_limit_positive check (event_limit > 0);
  end if;
end;
$$;

create or replace function public.prevent_client_event_limit_reduction()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_event_count integer;
begin
  if new.event_limit < old.event_limit then
    select count(*) into current_event_count from public.events where client_id = new.id;
    if new.event_limit < current_event_count then
      raise exception 'This client already has % events. The event limit cannot be lower than the current count.', current_event_count
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_prevent_event_limit_reduction on public.clients;
create trigger clients_prevent_event_limit_reduction
before update of event_limit on public.clients
for each row execute function public.prevent_client_event_limit_reduction();

create or replace function public.enforce_client_event_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed_events integer;
  current_event_count integer;
begin
  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id then return new; end if;

  select client.event_limit into allowed_events
  from public.clients client
  where client.id = new.client_id
  for update;
  if not found then
    raise exception 'Choose a valid client for this event.' using errcode = '23503';
  end if;

  select count(*) into current_event_count
  from public.events event
  where event.client_id = new.client_id
    and (tg_op = 'INSERT' or event.id <> new.id);
  if current_event_count >= allowed_events then
    raise exception 'This client has reached its limit of % events. Ask the platform administrator to increase the limit.', allowed_events
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists events_enforce_client_event_limit on public.events;
create trigger events_enforce_client_event_limit
before insert or update of client_id on public.events
for each row execute function public.enforce_client_event_limit();

revoke all on function public.prevent_client_event_limit_reduction() from public;
revoke all on function public.enforce_client_event_limit() from public;

commit;
