-- Stage 2: manual invoice records and line items. No payment processing is included.
begin;

create table if not exists public.invoice_number_counters (
  invoice_year integer primary key check (invoice_year between 2000 and 9999),
  last_number integer not null check (last_number > 0),
  last_credit_number integer not null default 0 check (last_credit_number >= 0)
);
alter table public.invoice_number_counters add column if not exists last_credit_number integer not null default 0;
alter table public.invoice_number_counters enable row level security;
revoke all on public.invoice_number_counters from public, anon, authenticated, service_role;

create table if not exists public.platform_invoice_tax_settings (
  id boolean primary key default true check (id),
  is_registered boolean not null default false,
  tax_label text not null default 'Tax',
  tax_rate_basis_points integer not null default 0 check (tax_rate_basis_points between 0 and 10000),
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (length(trim(tax_label)) between 1 and 40)
);
insert into public.platform_invoice_tax_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.client_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique default '',
  client_id uuid not null references public.clients(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','issued','partially_paid','paid','overdue','cancelled','credited')),
  currency text not null default 'ZAR' check (currency ~ '^[A-Z]{3}$'),
  invoice_date date not null default current_date,
  due_date date,
  billed_to_name text not null,
  billed_to_email text,
  description text not null default '',
  payment_instructions text,
  invoice_discount_cents bigint not null default 0 check (invoice_discount_cents >= 0),
  subtotal_cents bigint not null default 0 check (subtotal_cents >= 0),
  line_discount_cents bigint not null default 0 check (line_discount_cents >= 0),
  tax_label text not null default 'Tax',
  tax_rate_basis_points integer not null default 0 check (tax_rate_basis_points between 0 and 10000),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  total_cents bigint not null default 0 check (total_cents >= 0),
  status_reason text,
  created_by uuid references auth.users(id) on delete set null,
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(billed_to_name)) between 2 and 200),
  check (due_date is null or due_date >= invoice_date),
  check (invoice_number ~ '^ECE-[0-9]{4}-[0-9]{6}$'),
  check (invoice_discount_cents + line_discount_cents <= subtotal_cents),
  check (total_cents = subtotal_cents - line_discount_cents - invoice_discount_cents + tax_cents)
);
alter table public.client_invoices drop constraint if exists client_invoices_status_check;
alter table public.client_invoices add constraint client_invoices_status_check
  check (status in ('draft','issued','partially_paid','paid','overdue','partially_credited','cancelled','credited'));

create index if not exists client_invoices_client_date_idx
  on public.client_invoices (client_id, invoice_date desc, created_at desc);
create index if not exists client_invoices_status_due_idx
  on public.client_invoices (status, due_date);

create table if not exists public.client_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.client_invoices(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  description text not null,
  quantity numeric(12,2) not null default 1 check (quantity > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  line_total_cents bigint generated always as (round(quantity * unit_price_cents)::bigint - discount_cents) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, line_number),
  check (length(trim(description)) between 1 and 300),
  check (discount_cents <= round(quantity * unit_price_cents)::bigint),
  check (line_total_cents >= 0)
);

create index if not exists client_invoice_items_invoice_line_idx
  on public.client_invoice_items (invoice_id, line_number);

create table if not exists public.client_credit_notes (
  id uuid primary key default gen_random_uuid(),
  credit_note_number text not null unique,
  invoice_id uuid not null references public.client_invoices(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  status text not null default 'issued' check (status in ('draft','issued','cancelled')),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  issued_on date not null default current_date,
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null,
  description text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  issued_by uuid references auth.users(id) on delete set null,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (credit_note_number ~ '^CN-ECE-[0-9]{4}-[0-9]{6}$'),
  check (length(trim(reason)) between 2 and 500)
);
create index if not exists client_credit_notes_invoice_idx
  on public.client_credit_notes (invoice_id, issued_on desc);

create or replace function public.next_client_invoice_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_invoice_year integer := extract(year from current_date)::integer;
  next_invoice_number integer;
begin
  insert into public.invoice_number_counters (invoice_year, last_number)
  values (current_invoice_year, 1)
  on conflict (invoice_year) do update
    set last_number = public.invoice_number_counters.last_number + 1
  returning last_number into next_invoice_number;
  return 'ECE-' || current_invoice_year::text || '-' || lpad(next_invoice_number::text, 6, '0');
end;
$$;
revoke all on function public.next_client_invoice_number() from public, anon, authenticated, service_role;

create or replace function public.next_client_credit_note_number()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_year integer := extract(year from current_date)::integer;
  next_number integer;
begin
  insert into public.invoice_number_counters (invoice_year,last_number,last_credit_number)
  values (current_year,1,1)
  on conflict (invoice_year) do update
    set last_credit_number=public.invoice_number_counters.last_credit_number+1
  returning last_credit_number into next_number;
  return 'CN-ECE-'||current_year::text||'-'||lpad(next_number::text,6,'0');
end;
$$;
revoke all on function public.next_client_credit_note_number() from public, anon, authenticated, service_role;

create or replace function public.touch_invoice_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.touch_invoice_updated_at() from public, anon, authenticated, service_role;

drop trigger if exists client_invoices_set_updated_at on public.client_invoices;
create trigger client_invoices_set_updated_at
before update on public.client_invoices
for each row execute function public.touch_invoice_updated_at();
drop trigger if exists client_invoice_items_set_updated_at on public.client_invoice_items;
create trigger client_invoice_items_set_updated_at
before update on public.client_invoice_items
for each row execute function public.touch_invoice_updated_at();
drop trigger if exists platform_invoice_tax_settings_set_updated_at on public.platform_invoice_tax_settings;
create trigger platform_invoice_tax_settings_set_updated_at
before update on public.platform_invoice_tax_settings
for each row execute function public.touch_invoice_updated_at();

create or replace function public.calculate_client_invoice_totals(target_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  line_subtotal bigint;
  line_discounts bigint;
  invoice_record public.client_invoices%rowtype;
  calculated_tax bigint;
begin
  select * into invoice_record from public.client_invoices where id = target_invoice_id for update;
  if not found then return; end if;
  select coalesce(sum(round(item.quantity * item.unit_price_cents)::bigint), 0),
         coalesce(sum(item.discount_cents), 0)
  into line_subtotal, line_discounts
  from public.client_invoice_items item
  where item.invoice_id = target_invoice_id;
  if invoice_record.invoice_discount_cents + line_discounts > line_subtotal then
    raise exception 'Discounts cannot exceed invoice subtotal.' using errcode = '23514';
  end if;
  calculated_tax := round((line_subtotal - line_discounts - invoice_record.invoice_discount_cents)
    * invoice_record.tax_rate_basis_points / 10000.0)::bigint;
  update public.client_invoices
  set subtotal_cents = line_subtotal,
      line_discount_cents = line_discounts,
      tax_cents = calculated_tax,
      total_cents = line_subtotal - line_discounts - invoice_record.invoice_discount_cents + calculated_tax
  where id = target_invoice_id;
end;
$$;
revoke all on function public.calculate_client_invoice_totals(uuid) from public, anon, authenticated, service_role;

create or replace function public.sync_client_invoice_item_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.calculate_client_invoice_totals(coalesce(new.invoice_id, old.invoice_id));
  if tg_op = 'DELETE' then return old; end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.sync_client_invoice_item_totals() from public, anon, authenticated, service_role;
drop trigger if exists client_invoice_items_sync_totals on public.client_invoice_items;
create trigger client_invoice_items_sync_totals
after insert or update or delete on public.client_invoice_items
for each row execute function public.sync_client_invoice_item_totals();

create or replace function public.guard_client_invoice_item()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  parent_status text;
begin
  if tg_op = 'DELETE' then
    select status into parent_status from public.client_invoices where id = old.invoice_id for update;
    if not found then raise exception 'Invoice not found.' using errcode = '23503'; end if;
    if parent_status <> 'draft' then
      raise exception 'Issued invoice items are immutable.' using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    raise exception 'Invoice items cannot be moved between invoices.' using errcode = '23514';
  end if;
  select status into parent_status from public.client_invoices where id = new.invoice_id for update;
  if not found then raise exception 'Invoice not found.' using errcode = '23503'; end if;
  if parent_status <> 'draft' then
    raise exception 'Issued invoice items are immutable.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_client_invoice_item() from public, anon, authenticated, service_role;
drop trigger if exists client_invoice_items_guard on public.client_invoice_items;
create trigger client_invoice_items_guard
before insert or update or delete on public.client_invoice_items
for each row execute function public.guard_client_invoice_item();

create or replace function public.guard_client_invoice_header()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.invoice_number is null or trim(new.invoice_number) = '' then
      new.invoice_number := public.next_client_invoice_number();
    end if;
    if new.created_by is null then new.created_by := auth.uid(); end if;
    if new.status <> 'draft' then
      raise exception 'Invoices must be created as drafts.' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status <> 'draft' and (
    new.client_id is distinct from old.client_id
    or new.invoice_number is distinct from old.invoice_number
    or new.currency is distinct from old.currency
    or new.invoice_date is distinct from old.invoice_date
    or new.due_date is distinct from old.due_date
    or new.billed_to_name is distinct from old.billed_to_name
    or new.billed_to_email is distinct from old.billed_to_email
    or new.description is distinct from old.description
    or new.payment_instructions is distinct from old.payment_instructions
    or new.invoice_discount_cents is distinct from old.invoice_discount_cents
    or new.subtotal_cents is distinct from old.subtotal_cents
    or new.line_discount_cents is distinct from old.line_discount_cents
    or new.tax_label is distinct from old.tax_label
    or new.tax_rate_basis_points is distinct from old.tax_rate_basis_points
    or new.tax_cents is distinct from old.tax_cents
    or new.total_cents is distinct from old.total_cents
  ) then
    raise exception 'Issued invoice values are immutable; use a credit or replacement invoice.' using errcode = '23514';
  end if;
  if new.status is distinct from old.status then
    if not ((old.status = 'draft' and new.status in ('issued','cancelled'))
      or (old.status = 'issued' and new.status in ('partially_credited','credited','cancelled'))
      or (old.status = 'partially_credited' and new.status in ('credited','cancelled'))) then
      raise exception 'Invalid invoice status transition.' using errcode = '23514';
    end if;
    if new.status in ('cancelled','credited') and nullif(trim(new.status_reason), '') is null then
      raise exception 'Provide a reason when cancelling or crediting an invoice.' using errcode = '23514';
    end if;
    if new.status = 'issued' then
      if not exists (select 1 from public.client_invoice_items item where item.invoice_id = new.id) or new.total_cents <= 0 then
        raise exception 'Add a positive-value line item before issuing an invoice.' using errcode = '23514';
      end if;
      new.issued_at := coalesce(new.issued_at, now());
      new.issued_by := coalesce(new.issued_by, auth.uid());
    end if;
  end if;
  if old.status = 'draft' and (
    new.invoice_discount_cents is distinct from old.invoice_discount_cents
    or new.tax_rate_basis_points is distinct from old.tax_rate_basis_points
    or new.tax_label is distinct from old.tax_label
  ) then
    select coalesce(sum(round(item.quantity * item.unit_price_cents)::bigint), 0),
           coalesce(sum(item.discount_cents), 0)
    into new.subtotal_cents, new.line_discount_cents
    from public.client_invoice_items item
    where item.invoice_id = old.id;
    if new.invoice_discount_cents + new.line_discount_cents > new.subtotal_cents then
      raise exception 'Discounts cannot exceed invoice subtotal.' using errcode = '23514';
    end if;
    new.tax_cents := round((new.subtotal_cents - new.line_discount_cents - new.invoice_discount_cents)
      * new.tax_rate_basis_points / 10000.0)::bigint;
    new.total_cents := new.subtotal_cents - new.line_discount_cents - new.invoice_discount_cents + new.tax_cents;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_client_invoice_header() from public, anon, authenticated, service_role;
drop trigger if exists client_invoices_guard on public.client_invoices;
create trigger client_invoices_guard
before insert or update on public.client_invoices
for each row execute function public.guard_client_invoice_header();

create or replace function public.audit_client_invoice_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_client_id uuid;
  target_invoice_id uuid;
  audit_entity_id uuid;
  event_action text;
  audit_reason text;
  old_values jsonb;
  new_values jsonb;
begin
  if tg_table_name = 'client_invoices' then
    parent_client_id := new.client_id;
    target_invoice_id := new.id;
    audit_entity_id := new.id;
    event_action := case when tg_op = 'INSERT' then 'invoice.draft_created' else 'invoice.changed' end;
    if tg_op = 'UPDATE' then
      old_values := jsonb_build_object('status',old.status,'due_date',old.due_date,'discount_cents',old.invoice_discount_cents,'tax_rate_basis_points',old.tax_rate_basis_points,'total_cents',old.total_cents);
    end if;
    new_values := jsonb_build_object('invoice_number',new.invoice_number,'status',new.status,'due_date',new.due_date,'discount_cents',new.invoice_discount_cents,'tax_rate_basis_points',new.tax_rate_basis_points,'total_cents',new.total_cents,'status_reason',new.status_reason);
    audit_reason := new.status_reason;
  elsif tg_table_name = 'client_credit_notes' then
    parent_client_id := new.client_id;
    target_invoice_id := new.invoice_id;
    audit_entity_id := new.id;
    event_action := 'invoice.credit_note_issued';
    new_values := jsonb_build_object('credit_note_number',new.credit_note_number,'invoice_id',new.invoice_id,'amount_cents',new.amount_cents,'reason',new.reason,'status',new.status);
    audit_reason := new.reason;
  elsif tg_table_name = 'platform_invoice_tax_settings' then
    event_action := 'invoice.tax_settings_changed';
    if tg_op = 'UPDATE' then old_values := jsonb_build_object('is_registered',old.is_registered,'tax_label',old.tax_label,'tax_rate_basis_points',old.tax_rate_basis_points,'currency',old.currency); end if;
    new_values := jsonb_build_object('is_registered',new.is_registered,'tax_label',new.tax_label,'tax_rate_basis_points',new.tax_rate_basis_points,'currency',new.currency);
  else
    audit_entity_id := case when tg_op='DELETE' then old.id else new.id end;
    target_invoice_id := case when tg_op='DELETE' then old.invoice_id else new.invoice_id end;
    select client_id into parent_client_id from public.client_invoices where id = target_invoice_id;
    if tg_op = 'DELETE' then
      event_action := 'invoice.item_removed';
      old_values := jsonb_build_object('description',old.description,'quantity',old.quantity,'unit_price_cents',old.unit_price_cents,'discount_cents',old.discount_cents,'line_total_cents',old.line_total_cents);
    else
      event_action := case when tg_op = 'INSERT' then 'invoice.item_added' else 'invoice.item_changed' end;
      if tg_op = 'UPDATE' then old_values := jsonb_build_object('description',old.description,'quantity',old.quantity,'unit_price_cents',old.unit_price_cents,'discount_cents',old.discount_cents); end if;
      new_values := jsonb_build_object('description',new.description,'quantity',new.quantity,'unit_price_cents',new.unit_price_cents,'discount_cents',new.discount_cents,'line_total_cents',new.line_total_cents);
    end if;
  end if;
  insert into public.platform_audit_log (actor_user_id,client_id,action,entity_type,entity_id,previous_values,new_values,reason)
  values (auth.uid(),parent_client_id,event_action,tg_table_name,audit_entity_id,old_values,new_values,audit_reason);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.audit_client_invoice_change() from public, anon, authenticated, service_role;
drop trigger if exists client_invoices_audit on public.client_invoices;
create trigger client_invoices_audit
after insert or update on public.client_invoices
for each row execute function public.audit_client_invoice_change();
drop trigger if exists client_invoice_items_audit on public.client_invoice_items;
create trigger client_invoice_items_audit
after insert or update or delete on public.client_invoice_items
for each row execute function public.audit_client_invoice_change();
drop trigger if exists client_credit_notes_audit on public.client_credit_notes;
create trigger client_credit_notes_audit
after insert on public.client_credit_notes
for each row execute function public.audit_client_invoice_change();
drop trigger if exists platform_invoice_tax_settings_audit on public.platform_invoice_tax_settings;
create trigger platform_invoice_tax_settings_audit
after update on public.platform_invoice_tax_settings
for each row when (old.is_registered is distinct from new.is_registered or old.tax_label is distinct from new.tax_label or old.tax_rate_basis_points is distinct from new.tax_rate_basis_points or old.currency is distinct from new.currency)
execute function public.audit_client_invoice_change();

create or replace function public.create_client_invoice(invoice_request jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_invoice_id uuid;
  invoice_client_id uuid;
  invoice_item jsonb;
  tax_settings public.platform_invoice_tax_settings%rowtype;
  line_number integer := 0;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only a platform administrator can create invoices.' using errcode = '42501';
  end if;
  if jsonb_typeof(invoice_request) <> 'object' or jsonb_typeof(invoice_request->'items') <> 'array' or jsonb_array_length(invoice_request->'items') = 0 then
    raise exception 'Provide an invoice request with at least one line item.' using errcode = '22023';
  end if;
  invoice_client_id := (invoice_request->>'client_id')::uuid;
  select * into strict tax_settings from public.platform_invoice_tax_settings where id = true;
  insert into public.client_invoices (
    client_id,billed_to_name,billed_to_email,invoice_date,due_date,description,payment_instructions,
    invoice_discount_cents,tax_label,tax_rate_basis_points,created_by
  ) values (
    invoice_client_id,trim(invoice_request->>'billed_to_name'),nullif(trim(invoice_request->>'billed_to_email'),''),
    coalesce(nullif(invoice_request->>'invoice_date','')::date,current_date),
    nullif(invoice_request->>'due_date','')::date,
    coalesce(trim(invoice_request->>'description'),''),nullif(trim(invoice_request->>'payment_instructions'),''),
    0,
    tax_settings.tax_label,case when tax_settings.is_registered then tax_settings.tax_rate_basis_points else 0 end,auth.uid()
  ) returning id into new_invoice_id;

  for invoice_item in select value from jsonb_array_elements(invoice_request->'items') loop
    line_number := line_number + 1;
    insert into public.client_invoice_items (invoice_id,line_number,description,quantity,unit_price_cents,discount_cents)
    values (
      new_invoice_id,line_number,trim(invoice_item->>'description'),
      coalesce(nullif(invoice_item->>'quantity','')::numeric,1),
      (invoice_item->>'unit_price_cents')::bigint,
      coalesce(nullif(invoice_item->>'discount_cents','')::bigint,0)
    );
  end loop;
  if coalesce(nullif(invoice_request->>'invoice_discount_cents','')::bigint,0) > 0 then
    update public.client_invoices
    set invoice_discount_cents = (invoice_request->>'invoice_discount_cents')::bigint
    where id = new_invoice_id;
  end if;
  return new_invoice_id;
end;
$$;
revoke all on function public.create_client_invoice(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_client_invoice(jsonb) to authenticated;

create or replace function public.update_client_invoice_draft(target_invoice_id uuid, invoice_request jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invoice_item jsonb;
  line_number integer := 0;
  invoice_status text;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only a platform administrator can edit invoices.' using errcode = '42501';
  end if;
  if jsonb_typeof(invoice_request) <> 'object' or jsonb_typeof(invoice_request->'items') <> 'array' or jsonb_array_length(invoice_request->'items') = 0 then
    raise exception 'Provide an invoice request with at least one line item.' using errcode = '22023';
  end if;
  select status into invoice_status from public.client_invoices where id = target_invoice_id for update;
  if not found then raise exception 'Invoice not found.' using errcode = 'P0002'; end if;
  if invoice_status <> 'draft' then raise exception 'Only draft invoices can be edited.' using errcode = '23514'; end if;

  update public.client_invoices
  set client_id=(invoice_request->>'client_id')::uuid,
      billed_to_name=trim(invoice_request->>'billed_to_name'),
      billed_to_email=nullif(trim(invoice_request->>'billed_to_email'),''),
      invoice_date=coalesce(nullif(invoice_request->>'invoice_date','')::date,current_date),
      due_date=nullif(invoice_request->>'due_date','')::date,
      description=coalesce(trim(invoice_request->>'description'),''),
      payment_instructions=nullif(trim(invoice_request->>'payment_instructions'),''),
      invoice_discount_cents=0
  where id=target_invoice_id;

  delete from public.client_invoice_items where invoice_id=target_invoice_id;
  for invoice_item in select value from jsonb_array_elements(invoice_request->'items') loop
    line_number := line_number + 1;
    insert into public.client_invoice_items (invoice_id,line_number,description,quantity,unit_price_cents,discount_cents)
    values (
      target_invoice_id,line_number,trim(invoice_item->>'description'),
      coalesce(nullif(invoice_item->>'quantity','')::numeric,1),
      (invoice_item->>'unit_price_cents')::bigint,
      coalesce(nullif(invoice_item->>'discount_cents','')::bigint,0)
    );
  end loop;
  update public.client_invoices
  set invoice_discount_cents=coalesce(nullif(invoice_request->>'invoice_discount_cents','')::bigint,0)
  where id=target_invoice_id;
  return target_invoice_id;
end;
$$;
revoke all on function public.update_client_invoice_draft(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_client_invoice_draft(uuid,jsonb) to authenticated;

create or replace function public.create_client_credit_note(target_invoice_id uuid, credit_request jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invoice_record public.client_invoices%rowtype;
  prior_credits bigint;
  credit_amount bigint;
  credit_id uuid;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only a platform administrator can issue credit notes.' using errcode = '42501';
  end if;
  if jsonb_typeof(credit_request) <> 'object' then
    raise exception 'Provide credit-note details.' using errcode = '22023';
  end if;
  credit_amount := (credit_request->>'amount_cents')::bigint;
  if credit_amount is null or credit_amount <= 0 or length(trim(coalesce(credit_request->>'reason',''))) < 2 then
    raise exception 'Provide a positive credit amount and a reason.' using errcode = '22023';
  end if;
  select * into invoice_record from public.client_invoices where id=target_invoice_id for update;
  if not found then raise exception 'Invoice not found.' using errcode = 'P0002'; end if;
  if invoice_record.status not in ('issued','partially_credited') then
    raise exception 'Only issued invoices can receive credit notes.' using errcode = '23514';
  end if;
  select coalesce(sum(amount_cents),0) into prior_credits
  from public.client_credit_notes where invoice_id=target_invoice_id and status='issued';
  if prior_credits + credit_amount > invoice_record.total_cents then
    raise exception 'Credit amount exceeds the remaining invoice value.' using errcode = '23514';
  end if;
  insert into public.client_credit_notes (credit_note_number,invoice_id,client_id,status,currency,amount_cents,reason,description,created_by,issued_by)
  values (public.next_client_credit_note_number(),target_invoice_id,invoice_record.client_id,'issued',invoice_record.currency,credit_amount,trim(credit_request->>'reason'),coalesce(trim(credit_request->>'description'),''),auth.uid(),auth.uid())
  returning id into credit_id;
  update public.client_invoices
  set status=case when prior_credits+credit_amount=invoice_record.total_cents then 'credited' else 'partially_credited' end,
      status_reason=case when prior_credits+credit_amount=invoice_record.total_cents then trim(credit_request->>'reason') else null end
  where id=target_invoice_id;
  return credit_id;
end;
$$;
revoke all on function public.create_client_credit_note(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.create_client_credit_note(uuid,jsonb) to authenticated;

create or replace function public.issue_client_invoice(target_invoice_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only a platform administrator can issue invoices.' using errcode = '42501';
  end if;
  update public.client_invoices set status = 'issued' where id = target_invoice_id and status = 'draft';
  if not found then raise exception 'Draft invoice not found.' using errcode = 'P0002'; end if;
  return 'issued';
end;
$$;
revoke all on function public.issue_client_invoice(uuid) from public, anon, authenticated, service_role;
grant execute on function public.issue_client_invoice(uuid) to authenticated;

alter table public.platform_invoice_tax_settings enable row level security;
alter table public.client_invoices enable row level security;
alter table public.client_invoice_items enable row level security;
alter table public.client_credit_notes enable row level security;
revoke all on public.platform_invoice_tax_settings, public.client_invoices, public.client_invoice_items, public.client_credit_notes from public, anon, authenticated;
grant select, insert, update on public.platform_invoice_tax_settings, public.client_invoices, public.client_invoice_items to authenticated;
grant select on public.client_credit_notes to authenticated;
grant select, insert, update on public.platform_invoice_tax_settings, public.client_invoices, public.client_invoice_items, public.client_credit_notes to service_role;

drop policy if exists "platform admins manage invoice tax settings" on public.platform_invoice_tax_settings;
create policy "platform admins manage invoice tax settings" on public.platform_invoice_tax_settings
for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists "platform admins manage client invoices" on public.client_invoices;
create policy "platform admins manage client invoices" on public.client_invoices
for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists "platform admins manage invoice items" on public.client_invoice_items;
create policy "platform admins manage invoice items" on public.client_invoice_items
for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists "platform admins read client credit notes" on public.client_credit_notes;
create policy "platform admins read client credit notes" on public.client_credit_notes
for select to authenticated using (public.is_platform_admin());

commit;
