-- Add one-time 30-day client trials and platform-admin-only non-billable internal events.
begin;

alter table public.clients add column if not exists trial_started_at date;
alter table public.clients add column if not exists trial_ends_at date;
alter table public.events add column if not exists billing_exempt boolean not null default false;

alter table public.clients drop constraint if exists clients_billing_mode_check;
alter table public.clients add constraint clients_billing_mode_check
  check (billing_mode in ('unmanaged', 'prepaid', 'monthly', 'trial'));
alter table public.clients drop constraint if exists clients_trial_dates_check;
alter table public.clients add constraint clients_trial_dates_check
  check (
    (trial_started_at is null and trial_ends_at is null)
    or (trial_started_at is not null and trial_ends_at is not null and trial_ends_at > trial_started_at)
  );

create or replace function public.client_billing_is_current(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.clients client
    where client.id = target_client_id
      and client.billing_status = 'active'
      and (
        client.billing_mode in ('unmanaged', 'prepaid')
        or (client.billing_mode = 'monthly'
          and client.paid_through >= current_date
          and client.term_started_at <= current_date
          and client.term_ends_at >= current_date)
        or (client.billing_mode = 'trial'
          and client.trial_started_at <= current_date
          and client.trial_ends_at > current_date)
      )
  );
$$;
revoke all on function public.client_billing_is_current(uuid) from public;
grant execute on function public.client_billing_is_current(uuid) to authenticated;

create or replace function public.guard_event_billing_exemption()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.billing_exempt and not public.is_platform_admin() then
    raise exception 'Only a platform administrator can create a non-billable internal event.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.billing_exempt is distinct from old.billing_exempt and not public.is_platform_admin() then
    raise exception 'Only a platform administrator can change an event billing exemption.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_event_billing_exemption() from public;
drop trigger if exists events_guard_billing_exemption on public.events;
create trigger events_guard_billing_exemption
before insert or update of billing_exempt on public.events
for each row execute function public.guard_event_billing_exemption();

create or replace function public.enforce_trial_event_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  client_billing_mode text;
begin
  if new.billing_exempt then return new; end if;
  select billing_mode into client_billing_mode from public.clients where id = new.client_id;
  if client_billing_mode = 'trial' and not public.client_billing_is_current(new.client_id) then
    raise exception 'This client trial has ended. Contact the platform administrator to activate billing.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_trial_event_entitlement() from public;
drop trigger if exists events_enforce_trial_entitlement on public.events;
create trigger events_enforce_trial_entitlement
before insert or update of client_id on public.events
for each row execute function public.enforce_trial_event_entitlement();

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
    select count(*) into current_event_count
    from public.events
    where client_id = new.id and not billing_exempt;
    if new.event_limit < current_event_count then
      raise exception 'This client already has % billable events. The event limit cannot be lower than that count.', current_event_count
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_client_event_limit_reduction() from public;

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
  if tg_op = 'UPDATE'
    and new.client_id is not distinct from old.client_id
    and new.billing_exempt is not distinct from old.billing_exempt then
    return new;
  end if;
  if new.billing_exempt and public.is_platform_admin() then return new; end if;

  select client.event_limit into allowed_events
  from public.clients client where client.id = new.client_id for update;
  if not found then raise exception 'Choose a valid client for this event.' using errcode = '23503'; end if;

  select count(*) into current_event_count
  from public.events event
  where event.client_id = new.client_id
    and not event.billing_exempt
    and (tg_op = 'INSERT' or event.id <> new.id);
  if current_event_count >= allowed_events then
    raise exception 'This client has reached its limit of % billable events. Ask the platform administrator to increase the limit.', allowed_events
      using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_client_event_limit() from public;
drop trigger if exists events_enforce_client_event_limit on public.events;
create trigger events_enforce_client_event_limit
before insert or update of client_id, billing_exempt on public.events
for each row execute function public.enforce_client_event_limit();

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
      and (event.billing_exempt or public.client_billing_is_current(event.client_id))
  );
$$;

commit;
