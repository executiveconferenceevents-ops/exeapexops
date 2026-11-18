-- APEXOPS exhibitor invoices and payments.
-- PREPARED ONLY. Review against the target schema before applying; never run from app code.
begin;

alter table public.event_order_settings
  add column if not exists supplier_vat_registered boolean not null default false,
  add column if not exists supplier_vat_number text,
  add column if not exists organiser_email text;
update public.event_order_settings
  set platform_fee_rate=0.03,
      supplier_vat_registered=coalesce(supplier_vat_registered, coalesce(prices_exclude_vat,false));
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname='event_order_settings_fixed_platform_fee'
      and conrelid='public.event_order_settings'::regclass
  ) then
    alter table public.event_order_settings
      add constraint event_order_settings_fixed_platform_fee check (platform_fee_rate=0.03);
  end if;
end $$;

alter table public.service_orders
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','proof_uploaded','paid','cancelled'));

create table if not exists public.client_exhibitor_payment_settings (
  client_id uuid primary key references public.clients(id) on delete cascade,
  eft_enabled boolean not null default false,
  payfast_enabled boolean not null default false,
  yoco_enabled boolean not null default false,
  bank_account_name text,
  bank_name text,
  bank_account_number text,
  bank_branch_code text,
  bank_account_type text,
  eft_reference_prefix text,
  encrypted_provider_secrets text,
  updated_at timestamptz not null default now(),
  check (bank_account_type is null or bank_account_type in ('cheque','savings','transmission')),
  check (eft_enabled = false or (nullif(trim(bank_account_name),'') is not null
    and nullif(trim(bank_name),'') is not null and nullif(trim(bank_account_number),'') is not null))
);

create table if not exists public.exhibitor_invoice_counters (
  invoice_year integer primary key check (invoice_year between 2000 and 9999),
  last_number integer not null check (last_number > 0)
);

create table if not exists public.exhibitor_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  event_id uuid not null references public.events(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  order_id uuid not null unique references public.service_orders(id) on delete restrict,
  status text not null default 'unpaid' check (status in ('unpaid','proof_uploaded','paid','cancelled')),
  invoice_source text not null default 'generated' check (invoice_source in ('generated','uploaded')),
  invoice_file_path text,
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  invoice_date date not null default current_date,
  due_date date,
  supplier_name text not null,
  supplier_vat_registered boolean not null default false,
  supplier_vat_number text,
  billed_to_name text not null,
  billed_to_email text,
  stand text not null,
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  vat_cents bigint not null default 0 check (vat_cents >= 0),
  total_cents bigint not null check (total_cents > 0),
  bank_details jsonb not null default '{}',
  paid_at timestamptz,
  payment_method text check (payment_method in ('eft','payfast','yoco')),
  created_at timestamptz not null default now(),
  issued_at timestamptz not null default now(),
  check (due_date is null or due_date >= invoice_date)
);
create index if not exists exhibitor_invoices_event_status_idx
  on public.exhibitor_invoices (event_id,status,created_at desc);
create index if not exists exhibitor_invoices_client_date_idx
  on public.exhibitor_invoices (client_id,invoice_date desc);

create table if not exists public.exhibitor_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.exhibitor_invoices(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  code text not null,
  description text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  line_total_cents bigint not null check (line_total_cents >= 0),
  unique(invoice_id,line_number)
);

create table if not exists public.exhibitor_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.exhibitor_invoices(id) on delete restrict,
  event_id uuid not null references public.events(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  payment_method text not null check (payment_method in ('eft','payfast','yoco')),
  status text not null check (status in ('pending_review','settled','rejected')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  paid_on date,
  reference text,
  evidence_path text,
  provider_transaction_id text,
  idempotency_key uuid not null unique,
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create unique index if not exists exhibitor_payments_provider_transaction_idx
  on public.exhibitor_payments(payment_method,provider_transaction_id)
  where provider_transaction_id is not null;
create index if not exists exhibitor_payments_event_status_idx
  on public.exhibitor_payments(event_id,status,created_at desc);

create table if not exists public.exhibitor_payment_checkouts (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.exhibitor_invoices(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  provider text not null check (provider in ('payfast','yoco')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  idempotency_key uuid not null unique,
  provider_checkout_id text,
  redirect_url text,
  status text not null default 'pending' check (status in ('pending','settled','expired')),
  expires_at timestamptz not null default now() + interval '30 minutes',
  payment_id uuid references public.exhibitor_payments(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists exhibitor_payment_checkouts_provider_id_idx
  on public.exhibitor_payment_checkouts(provider,provider_checkout_id)
  where provider_checkout_id is not null;
create index if not exists exhibitor_payment_checkouts_invoice_idx
  on public.exhibitor_payment_checkouts(invoice_id,status,expires_at);

create table if not exists public.exhibitor_platform_fee_accruals (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null unique references public.exhibitor_invoices(id) on delete restrict,
  order_id uuid not null unique references public.service_orders(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  paid_at timestamptz not null,
  fee_month date not null,
  rate_basis_points integer not null check (rate_basis_points between 0 and 10000),
  amount_cents bigint not null check (amount_cents >= 0),
  client_invoice_id uuid references public.client_invoices(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists exhibitor_fee_accruals_unbilled_idx
  on public.exhibitor_platform_fee_accruals(client_id,fee_month)
  where client_invoice_id is null;

create table if not exists public.exhibitor_webhook_deliveries (
  provider text not null check (provider in ('payfast','yoco')),
  delivery_id text not null,
  received_at timestamptz not null default now(),
  primary key(provider,delivery_id)
);

alter table public.client_exhibitor_payment_settings enable row level security;
alter table public.exhibitor_invoices enable row level security;
alter table public.exhibitor_invoice_items enable row level security;
alter table public.exhibitor_payments enable row level security;
alter table public.exhibitor_payment_checkouts enable row level security;
alter table public.exhibitor_platform_fee_accruals enable row level security;
alter table public.exhibitor_webhook_deliveries enable row level security;

revoke all on public.client_exhibitor_payment_settings, public.exhibitor_payment_checkouts,
  public.exhibitor_platform_fee_accruals, public.exhibitor_webhook_deliveries
  from public,anon,authenticated;
grant select,insert,update,delete on public.client_exhibitor_payment_settings,
  public.exhibitor_payment_checkouts,public.exhibitor_platform_fee_accruals,
  public.exhibitor_webhook_deliveries to service_role;
revoke all on public.exhibitor_invoices,public.exhibitor_invoice_items,public.exhibitor_payments
  from public,anon,authenticated;
grant select on public.exhibitor_invoices,public.exhibitor_invoice_items,public.exhibitor_payments to authenticated;
grant select,insert,update,delete on public.exhibitor_invoices,public.exhibitor_invoice_items,
  public.exhibitor_payments to service_role;

drop policy if exists "event operators read exhibitor invoices" on public.exhibitor_invoices;
create policy "event operators read exhibitor invoices" on public.exhibitor_invoices
  for select to authenticated using (public.apex_can_operate_event(event_id));
drop policy if exists "event operators read exhibitor invoice lines" on public.exhibitor_invoice_items;
create policy "event operators read exhibitor invoice lines" on public.exhibitor_invoice_items
  for select to authenticated using (exists(select 1 from public.exhibitor_invoices i
    where i.id=invoice_id and public.apex_can_operate_event(i.event_id)));
drop policy if exists "event operators read exhibitor payments" on public.exhibitor_payments;
create policy "event operators read exhibitor payments" on public.exhibitor_payments
  for select to authenticated using (public.apex_can_operate_event(event_id));

create or replace function public.next_exhibitor_invoice_number()
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare invoice_year integer:=extract(year from current_date)::integer; next_number integer;
begin
  insert into public.exhibitor_invoice_counters(invoice_year,last_number) values(invoice_year,1)
  on conflict(invoice_year) do update set last_number=public.exhibitor_invoice_counters.last_number+1
  returning last_number into next_number;
  return 'EXH-'||invoice_year::text||'-'||lpad(next_number::text,6,'0');
end $$;
revoke all on function public.next_exhibitor_invoice_number() from public,anon,authenticated,service_role;

create or replace function public.apex_create_exhibitor_invoice_for_order()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare
  event_client uuid;
  event_name text;
  vat_registered boolean:=false;
  vat_number text;
  supplier_bank jsonb:='{}'::jsonb;
  created_invoice uuid;
begin
  if new.total_payable<=0 or new.status='cancelled' then return new; end if;
  if exists(select 1 from public.exhibitor_invoices where order_id=new.id) then return new; end if;
  select e.client_id into event_client from public.events e where e.id=new.event_id;
  if event_client is null then raise exception 'Could not identify the client for this event.'; end if;
  select coalesce(nullif(trim(s.supplier_name),''),c.name),coalesce(s.supplier_vat_registered,false),s.supplier_vat_number
    into event_name,vat_registered,vat_number
    from public.events e join public.clients c on c.id=e.client_id
    left join public.event_order_settings s on s.event_id=e.id where e.id=new.event_id;
  select jsonb_strip_nulls(jsonb_build_object(
    'account_name',bank_account_name,'bank_name',bank_name,'account_number',bank_account_number,
    'branch_code',bank_branch_code,'account_type',bank_account_type,'reference_prefix',eft_reference_prefix
  )) into supplier_bank from public.client_exhibitor_payment_settings where client_id=event_client;
  insert into public.exhibitor_invoices(invoice_number,event_id,client_id,order_id,supplier_name,
    supplier_vat_registered,supplier_vat_number,billed_to_name,billed_to_email,stand,
    subtotal_cents,vat_cents,total_cents,bank_details)
  values(public.next_exhibitor_invoice_number(),new.event_id,event_client,new.id,event_name,
    vat_registered,vat_number,coalesce(nullif(trim(new.exhibitor_name),''),'Exhibitor'),
    nullif(trim(new.contact_email),''),new.stand,
    round(new.total_excl_vat*100)::bigint,round(new.total_vat*100)::bigint,
    round(new.total_payable*100)::bigint,coalesce(supplier_bank,'{}'::jsonb))
  returning id into created_invoice;
  insert into public.exhibitor_invoice_items(invoice_id,line_number,code,description,quantity,unit_price_cents,line_total_cents)
  select created_invoice,row_number() over(order by item.id)::integer,item.code,item.name||coalesce(' · '||nullif(item.option,''),''),
    item.qty,round(item.unit_price_excl_vat*100)::bigint,round(item.unit_price_excl_vat*item.qty*100)::bigint
  from public.service_order_items item where item.order_id=new.id;
  return new;
end $$;

drop trigger if exists service_orders_create_exhibitor_invoice on public.service_orders;
create trigger service_orders_create_exhibitor_invoice after update of total_payable on public.service_orders
for each row when (new.total_payable>0) execute function public.apex_create_exhibitor_invoice_for_order();
revoke all on function public.apex_create_exhibitor_invoice_for_order() from public,anon,authenticated,service_role;

-- Backfill invoices for existing orders without changing their order totals.
update public.service_orders set total_payable=total_payable where total_payable>0 and status<>'cancelled'
  and not exists(select 1 from public.exhibitor_invoices i where i.order_id=service_orders.id);

create or replace function public.get_public_exhibitor_invoice(requested_edit_token uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  select jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,'status',i.status,
    'invoice_source',i.invoice_source,'currency',i.currency,'invoice_date',i.invoice_date,'due_date',i.due_date,
    'supplier_name',i.supplier_name,'supplier_vat_registered',i.supplier_vat_registered,'supplier_vat_number',i.supplier_vat_number,
    'billed_to_name',i.billed_to_name,'billed_to_email',i.billed_to_email,'stand',i.stand,
    'subtotal_cents',i.subtotal_cents,'vat_cents',i.vat_cents,'total_cents',i.total_cents,'bank_details',i.bank_details,
    'invoice_file_path',i.invoice_file_path,
    'items',coalesce((select jsonb_agg(jsonb_build_object('code',line.code,'description',line.description,
      'quantity',line.quantity,'unit_price_cents',line.unit_price_cents,'line_total_cents',line.line_total_cents)
      order by line.line_number) from public.exhibitor_invoice_items line where line.invoice_id=i.id),'[]'::jsonb))
    into result from public.service_orders o join public.exhibitor_invoices i on i.order_id=o.id
    where o.edit_token=requested_edit_token;
  if result is null then raise exception 'Order invoice not found.'; end if;
  return result;
end $$;

create or replace function public.get_exhibitor_portal_invoices(requested_portal_token uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare profile public.exhibitor_profiles; result jsonb;
begin
  select * into profile from public.exhibitor_profiles where portal_token=requested_portal_token;
  if profile.event_id is null then raise exception 'This link is not valid'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'invoice_number',i.invoice_number,
    'status',i.status,'invoice_source',i.invoice_source,'currency',i.currency,'invoice_date',i.invoice_date,
    'due_date',i.due_date,'supplier_name',i.supplier_name,'supplier_vat_registered',i.supplier_vat_registered,
    'supplier_vat_number',i.supplier_vat_number,'billed_to_name',i.billed_to_name,'billed_to_email',i.billed_to_email,
    'stand',i.stand,'subtotal_cents',i.subtotal_cents,'vat_cents',i.vat_cents,'total_cents',i.total_cents,
    'bank_details',i.bank_details,'invoice_file_path',i.invoice_file_path,'order_ref',o.ref,
    'items',coalesce((select jsonb_agg(jsonb_build_object('code',line.code,'description',line.description,
      'quantity',line.quantity,'unit_price_cents',line.unit_price_cents,'line_total_cents',line.line_total_cents)
      order by line.line_number) from public.exhibitor_invoice_items line where line.invoice_id=i.id),'[]'::jsonb))
    order by i.created_at desc),'[]'::jsonb) into result
  from public.exhibitor_invoices i join public.service_orders o on o.id=i.order_id
  where i.event_id=profile.event_id and upper(i.stand)=upper(profile.stand);
  return result;
end $$;

create or replace function public.submit_exhibitor_eft_proof(target_invoice_id uuid, requested_portal_token uuid, requested_path text, requested_reference text)
returns uuid language plpgsql security definer set search_path=public as $$
declare invoice_row public.exhibitor_invoices%rowtype; payment_id uuid;
begin
  select i.* into invoice_row from public.exhibitor_invoices i join public.exhibitor_profiles p
    on p.event_id=i.event_id and upper(p.stand)=upper(i.stand)
  where i.id=target_invoice_id and p.portal_token=requested_portal_token for update;
  if not found then raise exception 'Invoice not found for this private stand link.'; end if;
  if invoice_row.status not in ('unpaid','proof_uploaded') then raise exception 'This invoice is no longer awaiting payment.'; end if;
  if split_part(requested_path,'/',1)<>requested_portal_token::text
    or split_part(requested_path,'/',2)<>target_invoice_id::text then raise exception 'Invalid proof upload path.'; end if;
  if length(trim(coalesce(requested_reference,'')))>160 then raise exception 'Payment reference is too long.'; end if;
  insert into public.exhibitor_payments(invoice_id,event_id,client_id,payment_method,status,amount_cents,
    paid_on,reference,evidence_path,idempotency_key)
  values(invoice_row.id,invoice_row.event_id,invoice_row.client_id,'eft','pending_review',invoice_row.total_cents,
    current_date,nullif(trim(requested_reference),''),requested_path,gen_random_uuid()) returning id into payment_id;
  update public.exhibitor_invoices set status='proof_uploaded' where id=target_invoice_id;
  update public.service_orders set payment_status='proof_uploaded' where id=invoice_row.order_id;
  return payment_id;
end $$;

create or replace function public.create_exhibitor_payment_checkout(
  target_invoice_id uuid,
  requested_portal_token uuid,
  requested_provider text,
  requested_idempotency_key uuid
)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare
  invoice_row public.exhibitor_invoices%rowtype;
  settings_row public.client_exhibitor_payment_settings%rowtype;
  existing_checkout uuid;
  checkout_id uuid;
begin
  if requested_provider not in ('payfast','yoco') or requested_idempotency_key is null then
    raise exception 'Choose a supported online payment method.' using errcode='22023';
  end if;
  select i.* into invoice_row
  from public.exhibitor_invoices i
  join public.exhibitor_profiles p
    on p.event_id=i.event_id and upper(p.stand)=upper(i.stand)
  where i.id=target_invoice_id
    and p.portal_token=requested_portal_token
  for update of i;
  if not found then raise exception 'Invoice not found for this private stand link.' using errcode='P0002'; end if;
  if invoice_row.status not in ('unpaid','proof_uploaded') then
    raise exception 'This invoice is no longer awaiting payment.' using errcode='23514';
  end if;
  select * into settings_row
  from public.client_exhibitor_payment_settings
  where client_id=invoice_row.client_id;
  if not found then raise exception 'Online payment is not configured.' using errcode='P0001'; end if;
  if requested_provider='payfast' and not settings_row.payfast_enabled then
    raise exception 'PayFast is not enabled for this exhibitor invoice.' using errcode='23514';
  end if;
  if requested_provider='yoco' and not settings_row.yoco_enabled then
    raise exception 'Yoco is not enabled for this exhibitor invoice.' using errcode='23514';
  end if;
  select id into existing_checkout
  from public.exhibitor_payment_checkouts
  where idempotency_key=requested_idempotency_key;
  if existing_checkout is not null then return existing_checkout; end if;
  insert into public.exhibitor_payment_checkouts(
    invoice_id,client_id,provider,amount_cents,idempotency_key
  )
  values(invoice_row.id,invoice_row.client_id,requested_provider,invoice_row.total_cents,requested_idempotency_key)
  returning id into checkout_id;
  return checkout_id;
end $$;

create or replace function public.settle_exhibitor_invoice_payment(
  target_invoice_id uuid, requested_method text, requested_transaction_id text,
  requested_amount_cents bigint, requested_paid_at timestamptz default now(), requested_idempotency_key uuid default gen_random_uuid()
)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare invoice_row public.exhibitor_invoices%rowtype; order_row public.service_orders%rowtype;
  event_client uuid; fee_rate numeric:=0.03; fee_cents bigint:=0; payment_id uuid; current_payment uuid;
begin
  if requested_method not in ('eft','payfast','yoco') or requested_amount_cents<=0 or requested_idempotency_key is null then
    raise exception 'Invalid exhibitor payment details.' using errcode='22023';
  end if;
  select * into invoice_row from public.exhibitor_invoices where id=target_invoice_id for update;
  if not found then raise exception 'Exhibitor invoice not found.' using errcode='P0002'; end if;
  if requested_method in ('payfast','yoco') and auth.role()<>'service_role' then
    raise exception 'Verified online settlement requires the service role.' using errcode='42501';
  end if;
  if requested_method='eft' and (auth.uid() is null or not public.apex_can_operate_event(invoice_row.event_id)) then
    raise exception 'Only event operators can approve an EFT payment.' using errcode='42501';
  end if;
  select id into current_payment from public.exhibitor_payments where idempotency_key=requested_idempotency_key;
  if current_payment is not null then return current_payment; end if;
  if requested_amount_cents<>invoice_row.total_cents then raise exception 'Payment amount does not match the invoice.' using errcode='23514'; end if;
  if invoice_row.status='paid' then
    select id into current_payment from public.exhibitor_payments
      where invoice_id=target_invoice_id and provider_transaction_id=requested_transaction_id;
    if current_payment is not null then return current_payment; end if;
    raise exception 'Invoice has already been paid.' using errcode='23514';
  end if;
  if invoice_row.status not in ('unpaid','proof_uploaded') then raise exception 'Invoice is not payable.' using errcode='23514'; end if;
  insert into public.exhibitor_payments(invoice_id,event_id,client_id,payment_method,status,amount_cents,
    paid_on,reference,provider_transaction_id,idempotency_key,reviewed_at)
  values(invoice_row.id,invoice_row.event_id,invoice_row.client_id,requested_method,'settled',requested_amount_cents,
    coalesce(requested_paid_at::date,current_date),nullif(trim(requested_transaction_id),''),
    nullif(trim(requested_transaction_id),''),requested_idempotency_key,now()) returning id into payment_id;
  update public.exhibitor_invoices set status='paid',paid_at=coalesce(requested_paid_at,now()),payment_method=requested_method
    where id=target_invoice_id;
  update public.service_orders set payment_status='paid' where id=invoice_row.order_id;
  select * into order_row from public.service_orders where id=invoice_row.order_id;
  select e.client_id into event_client from public.events e where e.id=invoice_row.event_id;
  fee_cents:=round(order_row.total_fee*100)::bigint;
  insert into public.exhibitor_platform_fee_accruals(invoice_id,order_id,client_id,paid_at,fee_month,rate_basis_points,amount_cents)
  values(invoice_row.id,invoice_row.order_id,event_client,coalesce(requested_paid_at,now()),
    date_trunc('month',coalesce(requested_paid_at,now()))::date,round(fee_rate*10000)::integer,
    fee_cents)
  on conflict(invoice_id) do nothing;
  return payment_id;
end $$;

create or replace function public.review_exhibitor_eft_payment(target_payment_id uuid, approve boolean, requested_note text default null)
returns text language plpgsql security definer set search_path=public as $$
declare payment_row public.exhibitor_payments%rowtype;
begin
  select * into payment_row from public.exhibitor_payments where id=target_payment_id for update;
  if not found or payment_row.payment_method<>'eft' then raise exception 'EFT submission not found.'; end if;
  if not public.apex_can_operate_event(payment_row.event_id) then raise exception 'Only event operators can review exhibitor EFT.' using errcode='42501'; end if;
  if payment_row.status<>'pending_review' then raise exception 'EFT submission has already been reviewed.'; end if;
  if approve then
    update public.exhibitor_payments set status='rejected',review_note=left(requested_note,500),reviewed_at=now() where id=target_payment_id;
    perform public.settle_exhibitor_invoice_payment(payment_row.invoice_id,'eft',coalesce(payment_row.reference,payment_row.id::text),payment_row.amount_cents,now(),payment_row.idempotency_key);
    return 'settled';
  end if;
  update public.exhibitor_payments set status='rejected',review_note=left(requested_note,500),reviewed_at=now() where id=target_payment_id;
  update public.exhibitor_invoices set status='unpaid' where id=payment_row.invoice_id and status='proof_uploaded';
  update public.service_orders set payment_status='unpaid' where id=(select order_id from public.exhibitor_invoices where id=payment_row.invoice_id);
  return 'rejected';
end $$;

create or replace function public.attach_exhibitor_fees_to_client_invoice(target_invoice_id uuid, requested_fee_month date)
returns bigint language plpgsql security definer set search_path=public,pg_temp as $$
declare invoice_row public.client_invoices%rowtype; fee_total bigint; fee_count integer; next_line integer;
begin
  if auth.uid() is null or not public.is_platform_admin() then raise exception 'Only a platform administrator can attach exhibitor fees.' using errcode='42501'; end if;
  if requested_fee_month is null or extract(day from requested_fee_month)<>1 then raise exception 'Choose the first day of a month.' using errcode='22023'; end if;
  select * into invoice_row from public.client_invoices where id=target_invoice_id for update;
  if not found or invoice_row.status<>'draft' then raise exception 'Choose a draft client invoice.' using errcode='23514'; end if;
  select coalesce(sum(amount_cents),0),count(*) into fee_total,fee_count
  from public.exhibitor_platform_fee_accruals where client_id=invoice_row.client_id and fee_month=requested_fee_month and client_invoice_id is null;
  if fee_total=0 then return 0; end if;
  select coalesce(max(line_number),0)+1 into next_line from public.client_invoice_items where invoice_id=target_invoice_id;
  insert into public.client_invoice_items(invoice_id,line_number,description,quantity,unit_price_cents,discount_cents)
  values(target_invoice_id,next_line,'Exhibitor order platform fees · '||to_char(requested_fee_month,'YYYY-MM')||' ('||fee_count||' paid orders)',1,fee_total,0);
  update public.exhibitor_platform_fee_accruals set client_invoice_id=target_invoice_id
    where client_id=invoice_row.client_id and fee_month=requested_fee_month and client_invoice_id is null;
  return fee_total;
end $$;

revoke all on function public.get_public_exhibitor_invoice(uuid) from public;
grant execute on function public.get_public_exhibitor_invoice(uuid) to anon,authenticated;
revoke all on function public.get_exhibitor_portal_invoices(uuid) from public;
grant execute on function public.get_exhibitor_portal_invoices(uuid) to anon,authenticated;
revoke all on function public.submit_exhibitor_eft_proof(uuid,uuid,text,text) from public;
grant execute on function public.submit_exhibitor_eft_proof(uuid,uuid,text,text) to anon,authenticated;
revoke all on function public.create_exhibitor_payment_checkout(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.create_exhibitor_payment_checkout(uuid,uuid,text,uuid) to anon,authenticated;
revoke all on function public.settle_exhibitor_invoice_payment(uuid,text,text,bigint,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.settle_exhibitor_invoice_payment(uuid,text,text,bigint,timestamptz,uuid) to service_role,authenticated;
revoke all on function public.review_exhibitor_eft_payment(uuid,boolean,text) from public,anon;
grant execute on function public.review_exhibitor_eft_payment(uuid,boolean,text) to authenticated;
revoke all on function public.attach_exhibitor_fees_to_client_invoice(uuid,date) from public,anon;
grant execute on function public.attach_exhibitor_fees_to_client_invoice(uuid,date) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('exhibitor-invoices','exhibitor-invoices',false,10485760,array['application/pdf']) on conflict(id) do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('exhibitor-payment-proofs','exhibitor-payment-proofs',false,10485760,array['application/pdf','image/jpeg','image/png']) on conflict(id) do nothing;

drop policy if exists "exhibitors upload own payment proof" on storage.objects;
create policy "exhibitors upload own payment proof" on storage.objects for insert to anon,authenticated
  with check(bucket_id='exhibitor-payment-proofs' and exists(
    select 1 from public.exhibitor_profiles p join public.exhibitor_invoices i
      on i.event_id=p.event_id and upper(i.stand)=upper(p.stand)
    where p.portal_token::text=(storage.foldername(name))[1]
      and i.id::text=(storage.foldername(name))[2] and i.status in ('unpaid','proof_uploaded')
  ));
drop policy if exists "event operators read payment proof" on storage.objects;
create policy "event operators read payment proof" on storage.objects for select to authenticated
  using(bucket_id='exhibitor-payment-proofs' and exists(
    select 1 from public.exhibitor_invoices i where i.id::text=(storage.foldername(name))[2]
      and public.apex_can_operate_event(i.event_id)
  ));
drop policy if exists "event operators upload invoice pdf" on storage.objects;
create policy "event operators upload invoice pdf" on storage.objects for insert to authenticated
  with check(bucket_id='exhibitor-invoices' and exists(
    select 1 from public.exhibitor_invoices i where i.id::text=(storage.foldername(name))[2]
      and i.event_id::text=(storage.foldername(name))[1] and public.apex_can_operate_event(i.event_id)
  ));
drop policy if exists "event operators read invoice pdf" on storage.objects;
create policy "event operators read invoice pdf" on storage.objects for select to authenticated
  using(bucket_id='exhibitor-invoices' and exists(
    select 1 from public.exhibitor_invoices i where i.id::text=(storage.foldername(name))[2]
      and public.apex_can_operate_event(i.event_id)
  ));

commit;