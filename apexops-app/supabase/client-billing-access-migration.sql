-- Manual entitlement controls until a payment provider/webhook is connected.
begin;

alter table public.clients add column if not exists billing_mode text not null default 'unmanaged';
alter table public.clients add column if not exists billing_status text not null default 'active';
alter table public.clients add column if not exists billing_plan text not null default 'legacy';
alter table public.clients add column if not exists paid_through date;
alter table public.clients add column if not exists prepaid_event_credits integer not null default 0;
alter table public.clients add column if not exists term_started_at date;
alter table public.clients add column if not exists term_ends_at date;
alter table public.clients add column if not exists committed_events integer not null default 0;

-- Preserve existing customers as unmanaged/active, but require explicit activation for new clients.
alter table public.clients alter column billing_mode set default 'prepaid';
alter table public.clients alter column billing_status set default 'pending';
alter table public.clients alter column billing_plan set default 'pay_per_event';

alter table public.clients drop constraint if exists clients_billing_mode_check;
alter table public.clients add constraint clients_billing_mode_check
  check (billing_mode in ('unmanaged', 'prepaid', 'monthly'));
alter table public.clients drop constraint if exists clients_billing_status_check;
alter table public.clients add constraint clients_billing_status_check
  check (billing_status in ('pending', 'active', 'past_due', 'suspended', 'cancelled'));
alter table public.clients drop constraint if exists clients_billing_plan_check;
alter table public.clients add constraint clients_billing_plan_check
  check (billing_plan in ('legacy', 'pay_per_event', 'vol_12', 'vol_15', 'vol_20', 'vol_30', 'vol_40', 'vol_50', 'vol_75', 'vol_100', 'enterprise'));
alter table public.clients drop constraint if exists clients_prepaid_event_credits_check;
alter table public.clients add constraint clients_prepaid_event_credits_check
  check (prepaid_event_credits >= 0);
alter table public.clients drop constraint if exists clients_committed_events_check;
alter table public.clients add constraint clients_committed_events_check
  check (committed_events >= 0);

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
      )
  );
$$;

revoke all on function public.client_billing_is_current(uuid) from public;
grant execute on function public.client_billing_is_current(uuid) to authenticated;

create or replace function public.enforce_client_event_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  client_record public.clients%rowtype;
begin
  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id then return new; end if;
  if public.is_platform_admin() then return new; end if;

  select * into client_record from public.clients where id = new.client_id for update;
  if not found then raise exception 'Choose a valid client for this event.' using errcode = '23503'; end if;
  if client_record.billing_status <> 'active' then
    raise exception 'This client account is not active. Contact the platform administrator.' using errcode = '23514';
  end if;
  if client_record.billing_mode = 'monthly' and (client_record.paid_through is null or client_record.paid_through < current_date) then
    raise exception 'This monthly subscription is not current. Contact the platform administrator.' using errcode = '23514';
  end if;
  if client_record.billing_mode = 'monthly' then
    if client_record.term_started_at is null or client_record.term_started_at > current_date or client_record.term_ends_at is null or client_record.term_ends_at < current_date then
      raise exception 'This annual plan term is not current. Contact the platform administrator.' using errcode = '23514';
    end if;
    if client_record.billing_plan <> 'enterprise' and client_record.committed_events > 0 then
      if (select count(*) from public.events event where event.client_id = new.client_id and event.created_at::date between client_record.term_started_at and client_record.term_ends_at) >= client_record.committed_events then
        update public.clients set prepaid_event_credits = prepaid_event_credits - 1
        where id = new.client_id and prepaid_event_credits > 0;
        if not found then
          raise exception 'This annual plan has used its allocation. Contact the platform administrator to approve an additional event.' using errcode = '23514';
        end if;
      end if;
    end if;
  end if;
  if client_record.billing_mode = 'prepaid' then
    update public.clients
    set prepaid_event_credits = prepaid_event_credits - 1
    where id = new.client_id and prepaid_event_credits > 0;
    if not found then
      raise exception 'No prepaid events remain. Contact the platform administrator to add event credit.' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists events_enforce_client_event_entitlement on public.events;
create trigger events_enforce_client_event_entitlement
before insert or update of client_id on public.events
for each row execute function public.enforce_client_event_entitlement();

revoke all on function public.enforce_client_event_entitlement() from public;

create or replace function public.clear_expired_overage_credits()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.billing_mode = 'monthly' and new.term_started_at is distinct from old.term_started_at then
    new.prepaid_event_credits := 0;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_clear_expired_overage_credits on public.clients;
create trigger clients_clear_expired_overage_credits
before update of term_started_at on public.clients
for each row execute function public.clear_expired_overage_credits();
revoke all on function public.clear_expired_overage_credits() from public;

-- Client admins can view history after the event, but cannot change team access or supplier records on inactive accounts.
drop policy if exists "client admins manage memberships" on public.client_event_memberships;
drop policy if exists "active client admins manage memberships" on public.client_event_memberships;
create policy "active client admins manage memberships"
on public.client_event_memberships for all to authenticated
using (
  role <> 'platform_admin'
  and public.has_client_access(client_id, event_id, array['client_admin'])
  and public.client_billing_is_current(client_id)
)
with check (
  role <> 'platform_admin'
  and public.has_client_access(client_id, event_id, array['client_admin'])
  and public.client_billing_is_current(client_id)
);

drop policy if exists "client admins manage suppliers" on public.suppliers;
drop policy if exists "active client admins manage suppliers" on public.suppliers;
create policy "active client admins manage suppliers"
on public.suppliers for all to authenticated
using (
  public.has_client_access(client_id, null, array['client_admin'])
  and public.client_billing_is_current(client_id)
)
with check (
  public.has_client_access(client_id, null, array['client_admin'])
  and public.client_billing_is_current(client_id)
);

commit;
