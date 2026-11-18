begin;

create or replace function public.audit_operational_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_client_id uuid;
  target_entity_id uuid;
  target_action text;
  previous_record jsonb;
  next_record jsonb;
begin
  if tg_table_name = 'events' then
    target_client_id := case when tg_op = 'DELETE' then old.client_id else new.client_id end;
    target_entity_id := case when tg_op = 'DELETE' then old.id else new.id end;
    target_action := case tg_op when 'INSERT' then 'event.created' when 'UPDATE' then 'event.updated' else 'event.deleted' end;
    if tg_op <> 'INSERT' then
      previous_record := jsonb_build_object(
        'name',old.name,'slug',old.slug,'event_start_date',old.event_start_date,'event_end_date',old.event_end_date,
        'build_up_start_date',old.build_up_start_date,'build_up_end_date',old.build_up_end_date,
        'breakdown_start_date',old.breakdown_start_date,'breakdown_end_date',old.breakdown_end_date,
        'next_event_name',old.next_event_name,'billing_exempt',old.billing_exempt,'is_public',old.is_public
      );
    end if;
    if tg_op <> 'DELETE' then
      next_record := jsonb_build_object(
        'name',new.name,'slug',new.slug,'event_start_date',new.event_start_date,'event_end_date',new.event_end_date,
        'build_up_start_date',new.build_up_start_date,'build_up_end_date',new.build_up_end_date,
        'breakdown_start_date',new.breakdown_start_date,'breakdown_end_date',new.breakdown_end_date,
        'next_event_name',new.next_event_name,'billing_exempt',new.billing_exempt,'is_public',new.is_public
      );
    end if;
  elsif tg_table_name = 'client_event_memberships' then
    target_client_id := case when tg_op = 'DELETE' then old.client_id else new.client_id end;
    target_entity_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
    target_action := case tg_op when 'INSERT' then 'access.membership_created' when 'UPDATE' then 'access.membership_changed' else 'access.membership_revoked' end;
    if tg_op <> 'INSERT' then
      previous_record := jsonb_build_object('client_id',old.client_id,'event_id',old.event_id,'role',old.role);
    end if;
    if tg_op <> 'DELETE' then
      next_record := jsonb_build_object('client_id',new.client_id,'event_id',new.event_id,'role',new.role);
    end if;
  else
    raise exception 'Unsupported audit table: %', tg_table_name;
  end if;

  if tg_op = 'UPDATE' and previous_record is not distinct from next_record then
    return new;
  end if;

  insert into public.platform_audit_log
    (actor_user_id,client_id,action,entity_type,entity_id,previous_values,new_values)
  values
    (auth.uid(),target_client_id,target_action,tg_table_name,target_entity_id,previous_record,next_record);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.audit_operational_admin_change() from public, anon, authenticated;

drop trigger if exists events_platform_audit_log on public.events;
create trigger events_platform_audit_log
after insert or update or delete on public.events
for each row execute function public.audit_operational_admin_change();

drop trigger if exists memberships_platform_audit_log on public.client_event_memberships;
create trigger memberships_platform_audit_log
after insert or update or delete on public.client_event_memberships
for each row execute function public.audit_operational_admin_change();

commit;