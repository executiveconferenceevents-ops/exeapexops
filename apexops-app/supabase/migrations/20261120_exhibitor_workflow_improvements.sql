-- APEXOPS exhibitor workflow improvements.
-- PREPARED ONLY: apply after reviewing all prerequisite migrations and schema.
begin;

alter table public.event_order_settings
  add column if not exists exhibitor_checklist_items jsonb not null default '[]'::jsonb;
alter table public.exhibitor_profiles
  add column if not exists checklist_status jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='event_order_settings_exhibitor_checklist_array'
      and conrelid='public.event_order_settings'::regclass
  ) then
    alter table public.event_order_settings
      add constraint event_order_settings_exhibitor_checklist_array
      check (jsonb_typeof(exhibitor_checklist_items)='array');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='exhibitor_profiles_checklist_status_object'
      and conrelid='public.exhibitor_profiles'::regclass
  ) then
    alter table public.exhibitor_profiles
      add constraint exhibitor_profiles_checklist_status_object
      check (jsonb_typeof(checklist_status)='object');
  end if;
end $$;

alter table public.exhibitor_files drop constraint if exists exhibitor_files_kind_check;
alter table public.exhibitor_files
  add constraint exhibitor_files_kind_check
  check (kind in ('logo','artwork_vinyl','artwork_fabric','document'));

create or replace function public.register_exhibitor_file(
  requested_token uuid,
  requested_kind text,
  requested_file_name text,
  requested_path text
)
returns void language plpgsql volatile security definer set search_path=public as $$
declare v_p public.exhibitor_profiles;
begin
  select * into v_p from public.exhibitor_profiles where portal_token=requested_token;
  if v_p.event_id is null or not public.apex_event_window_open(v_p.event_id) then
    raise exception 'This link is not valid or the event is closed';
  end if;
  if requested_kind not in ('logo','artwork_vinyl','artwork_fabric','document') then
    raise exception 'Unknown file type';
  end if;
  if split_part(requested_path,'/',1)<>requested_token::text then raise exception 'Invalid file path'; end if;
  if (select count(*) from public.exhibitor_files where event_id=v_p.event_id and stand=v_p.stand)>=30 then
    raise exception 'Too many files for this stand';
  end if;
  insert into public.exhibitor_files(event_id,stand,kind,file_name,storage_path)
  values(v_p.event_id,v_p.stand,requested_kind,left(requested_file_name,200),requested_path);
end $$;

create or replace function public.submit_public_order(
  requested_event_slug text,
  requested_code text,
  payload jsonb
)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
  v_event uuid; v_settings public.event_order_settings; v_vat numeric; v_fee numeric;
  v_order public.service_orders; v_item jsonb; v_cat public.catalogue_items; v_qty int;
  v_ex numeric:=0; v_pay numeric:=0; v_unit_pay numeric; v_name text; v_stand text;
begin
  v_event:=public.apex_public_event_id(requested_event_slug,requested_code);
  if v_event is null then raise exception 'Event code is not valid'; end if;
  if not public.apex_event_window_open(v_event) then raise exception 'Ordering is closed for this event'; end if;
  if coalesce((payload->>'accept_terms')::boolean,false) is false then raise exception 'Please accept the order terms'; end if;
  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(coalesce(payload->'items','[]'))=0 then
    raise exception 'Add at least one item';
  end if;
  if jsonb_array_length(payload->'items')>60 then raise exception 'Too many lines in one order'; end if;
  v_stand:=upper(trim(payload->>'stand'));
  select name into v_name from public.exhibitors where event_id=v_event and upper(stand)=v_stand limit 1;
  if v_name is null then raise exception 'Stand not found for this event'; end if;
  if (select count(*) from public.service_orders where event_id=v_event and stand=v_stand and created_at>now()-interval '1 day')>=20 then
    raise exception 'Too many orders today for this stand. Please contact the organiser.';
  end if;
  select * into v_settings from public.event_order_settings where event_id=v_event;
  v_vat:=case when coalesce(v_settings.supplier_vat_registered,coalesce(v_settings.prices_exclude_vat,false),false)
    then coalesce(v_settings.vat_rate,0.15) else 0 end;
  v_fee:=0.03;
  insert into public.service_orders(event_id,stand,exhibitor_name,contact_name,contact_email,contact_phone,notes,terms_accepted_at)
  values(v_event,v_stand,v_name,left(payload->>'contact_name',120),left(payload->>'contact_email',200),
    left(payload->>'contact_phone',60),left(payload->>'notes',1000),now())
  returning * into v_order;
  for v_item in select * from jsonb_array_elements(payload->'items') loop
    select * into v_cat from public.catalogue_items
      where id=(v_item->>'id')::uuid and event_id=v_event and active;
    if v_cat.id is null then raise exception 'An item is no longer available'; end if;
    v_qty:=greatest(1,least(500,coalesce((v_item->>'qty')::int,1)));
    v_unit_pay:=round(v_cat.price_excl_vat*(1+v_vat)*1.03);
    insert into public.service_order_items(order_id,catalogue_item_id,code,name,option,qty,unit_price_excl_vat,unit_payable)
    values(v_order.id,v_cat.id,v_cat.code,v_cat.name,nullif(left(v_item->>'option',80),''),v_qty,v_cat.price_excl_vat,v_unit_pay);
    v_ex:=v_ex+v_cat.price_excl_vat*v_qty;
    v_pay:=v_pay+v_unit_pay*v_qty;
  end loop;
  update public.service_orders
    set total_excl_vat=round(v_ex,2),total_vat=round(v_ex*v_vat,2),
        total_fee=round(v_ex*(1+v_vat)*v_fee,2),total_payable=round(v_pay,2)
    where id=v_order.id;
  return jsonb_build_object('ref',v_order.ref,'edit_token',v_order.edit_token,'total_payable',round(v_pay,2),
    'exhibitor_name',v_name,'created_at',v_order.created_at,'appended',false);
end $$;

create or replace function public.append_public_order(
  requested_event_slug text,
  requested_code text,
  existing_edit_token uuid,
  payload jsonb
)
returns jsonb language plpgsql volatile security definer set search_path=public as $$
declare
  v_event uuid; v_stand text; v_order public.service_orders; v_invoice public.exhibitor_invoices;
  v_settings public.event_order_settings; v_item jsonb; v_cat public.catalogue_items; v_qty int;
  v_vat numeric; v_unit_pay numeric; v_result jsonb; v_ex numeric; v_tax numeric; v_total numeric; v_fee numeric;
begin
  v_event:=public.apex_public_event_id(requested_event_slug,requested_code);
  if v_event is null then raise exception 'Event code is not valid'; end if;
  if not public.apex_event_window_open(v_event) then raise exception 'Ordering is closed for this event'; end if;
  if coalesce((payload->>'accept_terms')::boolean,false) is false then raise exception 'Please accept the order terms'; end if;
  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(coalesce(payload->'items','[]'))=0 then
    raise exception 'Add at least one item';
  end if;
  if jsonb_array_length(payload->'items')>60 then raise exception 'Too many lines in one order'; end if;
  v_stand:=upper(trim(payload->>'stand'));
  select * into v_order from public.service_orders
    where edit_token=existing_edit_token and event_id=v_event and stand=v_stand for update;
  if v_order.id is null then raise exception 'This order is no longer available to update'; end if;
  select * into v_invoice from public.exhibitor_invoices where order_id=v_order.id for update;
  if v_invoice.id is null then raise exception 'The existing invoice is unavailable; contact the organiser before ordering more'; end if;

  if v_invoice.status in ('paid','cancelled') or v_invoice.invoice_source<>'generated'
     or v_order.status in ('picking','loaded','delivered','cancelled') then
    v_result:=public.submit_public_order(requested_event_slug,requested_code,payload);
    return v_result||jsonb_build_object('appended',false);
  end if;
  update public.exhibitor_payment_checkouts set status='expired'
    where invoice_id=v_invoice.id and status='pending' and expires_at<=now();
  if exists(select 1 from public.exhibitor_payment_checkouts
      where invoice_id=v_invoice.id and status='pending' and expires_at>now()) then
    raise exception 'A payment session is already open for this invoice. Complete it or wait for it to expire before changing the order.';
  end if;
  if v_invoice.status='proof_uploaded' then
    update public.exhibitor_payments
      set status='rejected',review_note='Order changed before payment was approved',reviewed_at=now()
      where invoice_id=v_invoice.id and status='pending_review';
  end if;
  select * into v_settings from public.event_order_settings where event_id=v_event;
  v_vat:=case when coalesce(v_settings.supplier_vat_registered,coalesce(v_settings.prices_exclude_vat,false),false)
    then coalesce(v_settings.vat_rate,0.15) else 0 end;
  for v_item in select * from jsonb_array_elements(payload->'items') loop
    select * into v_cat from public.catalogue_items
      where id=(v_item->>'id')::uuid and event_id=v_event and active;
    if v_cat.id is null then raise exception 'An item is no longer available'; end if;
    v_qty:=greatest(1,least(500,coalesce((v_item->>'qty')::int,1)));
    v_unit_pay:=round(v_cat.price_excl_vat*(1+v_vat)*1.03);
    insert into public.service_order_items(order_id,catalogue_item_id,code,name,option,qty,unit_price_excl_vat,unit_payable)
    values(v_order.id,v_cat.id,v_cat.code,v_cat.name,nullif(left(v_item->>'option',80),''),v_qty,v_cat.price_excl_vat,v_unit_pay);
  end loop;
  select coalesce(sum(unit_price_excl_vat*qty),0),coalesce(sum(unit_payable*qty),0)
    into v_ex,v_total from public.service_order_items where order_id=v_order.id;
  v_tax:=round(v_ex*v_vat,2);
  v_fee:=round(v_ex*(1+v_vat)*0.03,2);
  update public.service_orders set
    contact_name=coalesce(nullif(left(payload->>'contact_name',120),''),contact_name),
    contact_email=coalesce(nullif(left(payload->>'contact_email',200),''),contact_email),
    contact_phone=coalesce(nullif(left(payload->>'contact_phone',60),''),contact_phone),
    notes=left(concat_ws(E'\n',nullif(notes,''),nullif(payload->>'notes','')),1000),
    terms_accepted_at=now(),total_excl_vat=round(v_ex,2),total_vat=v_tax,total_fee=v_fee,
    total_payable=round(v_total,2),payment_status='unpaid',updated_at=now()
    where id=v_order.id;
  update public.exhibitor_invoices set status='unpaid',paid_at=null,payment_method=null,
    subtotal_cents=round(v_ex*100)::bigint,vat_cents=round(v_tax*100)::bigint,total_cents=round(v_total*100)::bigint,
    billed_to_email=coalesce(nullif(left(payload->>'contact_email',200),''),billed_to_email)
    where id=v_invoice.id;
  delete from public.exhibitor_invoice_items where invoice_id=v_invoice.id;
  insert into public.exhibitor_invoice_items(invoice_id,line_number,code,description,quantity,unit_price_cents,line_total_cents)
  select v_invoice.id,row_number() over(order by item.id)::integer,item.code,
    item.name||coalesce(' · '||nullif(item.option,''),''),item.qty,
    round(item.unit_payable*100)::bigint,round(item.unit_payable*item.qty*100)::bigint
    from public.service_order_items item where item.order_id=v_order.id;
  return jsonb_build_object('ref',v_order.ref,'edit_token',v_order.edit_token,'total_payable',round(v_total,2),
    'exhibitor_name',v_order.exhibitor_name,'created_at',v_order.created_at,'appended',true);
end $$;

grant execute on function public.submit_public_order(text,text,jsonb) to anon,authenticated;
grant execute on function public.append_public_order(text,text,uuid,jsonb) to anon,authenticated;
grant execute on function public.register_exhibitor_file(uuid,text,text,text) to anon,authenticated;

drop policy if exists "event members read rebooking requests" on public.rebooking_requests;
drop policy if exists "event admins update rebooking requests" on public.rebooking_requests;
drop policy if exists "event admins update active rebooking requests" on public.rebooking_requests;
drop policy if exists "team can read rebooking requests" on public.rebooking_requests;
drop policy if exists "team can update rebooking requests" on public.rebooking_requests;
create policy "organizers read rebooking requests" on public.rebooking_requests
  for select to authenticated
  using (public.has_event_access(event_id,array['client_admin','event_admin']));

drop policy if exists "event members read notifications" on public.ops_notifications;
drop policy if exists "event members read non-rebooking notifications" on public.ops_notifications;
drop policy if exists "organizers read rebooking notifications" on public.ops_notifications;
create policy "event members read non-rebooking notifications" on public.ops_notifications
  for select to authenticated
  using (
    kind<>'REBOOKING'
    and public.has_event_access(event_id,array['client_admin','event_admin','ops','staff'])
  );
create policy "organizers read rebooking notifications" on public.ops_notifications
  for select to authenticated
  using (
    kind='REBOOKING'
    and public.has_event_access(event_id,array['client_admin','event_admin'])
  );

drop policy if exists "event members update notifications" on public.ops_notifications;
drop policy if exists "event members update active notifications" on public.ops_notifications;
drop policy if exists "event members update non-rebooking notifications" on public.ops_notifications;
create policy "event members update non-rebooking notifications" on public.ops_notifications
  for update to authenticated
  using (
    kind<>'REBOOKING'
    and public.has_event_access(event_id,array['client_admin','event_admin','ops','staff'])
    and public.is_event_operational(event_id)
  )
  with check (
    kind<>'REBOOKING'
    and public.has_event_access(event_id,array['client_admin','event_admin','ops','staff'])
    and public.is_event_operational(event_id)
  );

commit;
