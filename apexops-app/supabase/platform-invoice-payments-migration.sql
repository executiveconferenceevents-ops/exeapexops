-- Stage 3: auditable payments, allocations, EFT review, and verified gateway settlement.
begin;

create table if not exists public.client_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  payment_method text not null check (payment_method in ('eft','cash','other','payfast')),
  status text not null check (status in ('pending_review','settled','rejected','reversed')),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  paid_on date not null default current_date,
  reference text,
  evidence_reference text,
  note text,
  provider_transaction_id text,
  idempotency_key uuid not null unique,
  request_payload jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check ((status = 'pending_review') = (payment_method = 'eft' and reviewed_at is null and reviewed_by is null) or status <> 'pending_review'),
  check (payment_method = 'payfast' or provider_transaction_id is null)
);

create unique index if not exists client_payments_provider_transaction_idx
  on public.client_payments (provider_transaction_id)
  where payment_method = 'payfast' and provider_transaction_id is not null;
create index if not exists client_payments_client_created_idx
  on public.client_payments (client_id, created_at desc);

create table if not exists public.client_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.client_payments(id) on delete restrict,
  invoice_id uuid not null references public.client_invoices(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null check (status in ('pending','settled','released','reversed')),
  created_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);
create index if not exists client_payment_allocations_invoice_status_idx
  on public.client_payment_allocations (invoice_id, status);

create table if not exists public.client_payment_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.client_invoices(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','settling','settled','expired')),
  idempotency_key uuid not null unique,
  provider_transaction_id text unique,
  payment_id uuid references public.client_payments(id) on delete restrict,
  expires_at timestamptz not null default now()+interval '15 minutes',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists client_payment_checkout_invoice_status_idx
  on public.client_payment_checkout_sessions(invoice_id,status,expires_at);

alter table public.client_payments enable row level security;
alter table public.client_payment_allocations enable row level security;
alter table public.client_payment_checkout_sessions enable row level security;
revoke all on public.client_payments, public.client_payment_allocations from public, anon, authenticated;
revoke all on public.client_payment_checkout_sessions from public, anon, authenticated;
grant select on public.client_payments, public.client_payment_allocations to authenticated;
grant select on public.client_payment_checkout_sessions to authenticated;
grant select, insert, update on public.client_payments, public.client_payment_allocations to service_role;
grant select, insert, update on public.client_payment_checkout_sessions to service_role;

drop policy if exists "platform admins read client payments" on public.client_payments;
create policy "platform admins read client payments" on public.client_payments
for select to authenticated using (public.is_platform_admin());
drop policy if exists "platform admins read payment allocations" on public.client_payment_allocations;
create policy "platform admins read payment allocations" on public.client_payment_allocations
for select to authenticated using (public.is_platform_admin());
drop policy if exists "platform admins read payment checkout sessions" on public.client_payment_checkout_sessions;
create policy "platform admins read payment checkout sessions" on public.client_payment_checkout_sessions
for select to authenticated using (public.is_platform_admin());
drop policy if exists "client admins read own payment checkout sessions" on public.client_payment_checkout_sessions;
create policy "client admins read own payment checkout sessions" on public.client_payment_checkout_sessions
for select to authenticated using (public.has_client_access(client_id,null,array['client_admin']));

drop policy if exists "client admins read own invoices" on public.client_invoices;
create policy "client admins read own invoices" on public.client_invoices
for select to authenticated using (public.has_client_access(client_id,null,array['client_admin']));
drop policy if exists "client admins read own invoice items" on public.client_invoice_items;
create policy "client admins read own invoice items" on public.client_invoice_items
for select to authenticated using (
  exists (select 1 from public.client_invoices invoice where invoice.id=invoice_id
    and public.has_client_access(invoice.client_id,null,array['client_admin']))
);
drop policy if exists "client admins read own credit notes" on public.client_credit_notes;
create policy "client admins read own credit notes" on public.client_credit_notes
for select to authenticated using (public.has_client_access(client_id,null,array['client_admin']));
drop policy if exists "client admins read own payments" on public.client_payments;
create policy "client admins read own payments" on public.client_payments
for select to authenticated using (public.has_client_access(client_id,null,array['client_admin']));
drop policy if exists "client admins read own payment allocations" on public.client_payment_allocations;
create policy "client admins read own payment allocations" on public.client_payment_allocations
for select to authenticated using (
  exists (select 1 from public.client_invoices invoice where invoice.id=invoice_id
    and public.has_client_access(invoice.client_id,null,array['client_admin']))
);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('client-payment-evidence','client-payment-evidence',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "client admins upload own payment evidence" on storage.objects;
create policy "client admins upload own payment evidence" on storage.objects
for insert to authenticated with check (
  bucket_id='client-payment-evidence'
  and array_length(storage.foldername(name),1)=2
  and public.has_client_access((storage.foldername(name))[1]::uuid,null,array['client_admin'])
  and exists (
    select 1 from public.client_invoices invoice
    where invoice.id=(storage.foldername(name))[2]::uuid
      and invoice.client_id=(storage.foldername(name))[1]::uuid
      and invoice.status in ('issued','partially_paid','partially_credited')
  )
);
drop policy if exists "client admins read own payment evidence" on storage.objects;
create policy "client admins read own payment evidence" on storage.objects
for select to authenticated using (
  bucket_id='client-payment-evidence'
  and array_length(storage.foldername(name),1)=2
  and public.has_client_access((storage.foldername(name))[1]::uuid,null,array['client_admin'])
  and exists (
    select 1 from public.client_invoices invoice
    where invoice.id=(storage.foldername(name))[2]::uuid
      and invoice.client_id=(storage.foldername(name))[1]::uuid
  )
);

create or replace function public.refresh_client_invoice_payment_status(target_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invoice_total bigint;
  current_status text;
  settled_total bigint;
  credited_total bigint;
  next_status text;
begin
  select total_cents, status into invoice_total, current_status
  from public.client_invoices where id = target_invoice_id for update;
  if not found or current_status in ('draft','cancelled') then return; end if;
  select coalesce(sum(allocation.amount_cents),0) into settled_total
  from public.client_payment_allocations allocation
  join public.client_payments payment on payment.id = allocation.payment_id
  where allocation.invoice_id = target_invoice_id
    and allocation.status = 'settled' and payment.status = 'settled';
  select coalesce(sum(amount_cents),0) into credited_total
  from public.client_credit_notes where invoice_id = target_invoice_id and status = 'issued';
  if settled_total > 0 and settled_total + credited_total >= invoice_total then next_status := 'paid';
  elsif settled_total > 0 then next_status := 'partially_paid';
  elsif credited_total >= invoice_total then next_status := 'credited';
  elsif credited_total > 0 then next_status := 'partially_credited';
  else next_status := 'issued';
  end if;
  if current_status is distinct from next_status then
    update public.client_invoices set status = next_status,
      status_reason = case when next_status in ('issued','partially_paid','paid','partially_credited') then null else status_reason end
    where id = target_invoice_id;
  end if;
end;
$$;
revoke all on function public.refresh_client_invoice_payment_status(uuid) from public, anon, authenticated, service_role;

create or replace function public.guard_client_invoice_header()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  settled_total bigint;
  credited_total bigint;
begin
  if tg_op = 'INSERT' then
    if new.invoice_number is null or trim(new.invoice_number) = '' then new.invoice_number := public.next_client_invoice_number(); end if;
    if new.created_by is null then new.created_by := auth.uid(); end if;
    if new.status <> 'draft' then raise exception 'Invoices must be created as drafts.' using errcode = '23514'; end if;
    return new;
  end if;
  if old.status <> 'draft' and (
    new.client_id is distinct from old.client_id or new.invoice_number is distinct from old.invoice_number
    or new.currency is distinct from old.currency or new.invoice_date is distinct from old.invoice_date
    or new.due_date is distinct from old.due_date or new.billed_to_name is distinct from old.billed_to_name
    or new.billed_to_email is distinct from old.billed_to_email or new.description is distinct from old.description
    or new.payment_instructions is distinct from old.payment_instructions
    or new.invoice_discount_cents is distinct from old.invoice_discount_cents
    or new.subtotal_cents is distinct from old.subtotal_cents or new.line_discount_cents is distinct from old.line_discount_cents
    or new.tax_label is distinct from old.tax_label or new.tax_rate_basis_points is distinct from old.tax_rate_basis_points
    or new.tax_cents is distinct from old.tax_cents or new.total_cents is distinct from old.total_cents
  ) then raise exception 'Issued invoice values are immutable; use a credit or replacement invoice.' using errcode = '23514'; end if;
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status in ('issued','cancelled'))
      or (old.status = 'issued' and new.status in ('partially_paid','paid','partially_credited','credited','cancelled'))
      or (old.status = 'partially_paid' and new.status in ('issued','paid','cancelled'))
      or (old.status = 'partially_credited' and new.status in ('issued','partially_paid','paid','credited','cancelled'))
      or (old.status = 'paid' and new.status in ('issued','partially_paid','partially_credited','credited','cancelled'))
    ) then raise exception 'Invalid invoice status transition.' using errcode = '23514'; end if;
    if new.status in ('cancelled','credited') and nullif(trim(new.status_reason),'') is null then
      raise exception 'Provide a reason when cancelling or crediting an invoice.' using errcode = '23514';
    end if;
    if new.status = 'issued' then
      if not exists (select 1 from public.client_invoice_items item where item.invoice_id = new.id) or new.total_cents <= 0 then
        raise exception 'Add a positive-value line item before issuing an invoice.' using errcode = '23514';
      end if;
      new.issued_at := coalesce(new.issued_at,now());
      new.issued_by := coalesce(new.issued_by,auth.uid());
    end if;
    if new.status in ('partially_paid','paid','partially_credited','credited','issued') and old.status <> 'draft' then
      select coalesce(sum(allocation.amount_cents),0) into settled_total
      from public.client_payment_allocations allocation
      join public.client_payments payment on payment.id = allocation.payment_id
      where allocation.invoice_id = new.id and allocation.status = 'settled' and payment.status = 'settled';
      select coalesce(sum(amount_cents),0) into credited_total
      from public.client_credit_notes where invoice_id = new.id and status = 'issued';
      if new.status = 'partially_paid' and not (settled_total > 0 and settled_total + credited_total < new.total_cents) then
        raise exception 'Invoice payment totals do not support partially paid status.' using errcode = '23514';
      elsif new.status = 'paid' and not (settled_total > 0 and settled_total + credited_total >= new.total_cents) then
        raise exception 'Invoice payment totals do not support paid status.' using errcode = '23514';
      elsif new.status = 'partially_credited' and not (settled_total = 0 and credited_total > 0 and credited_total < new.total_cents) then
        raise exception 'Invoice credit totals do not support partially credited status.' using errcode = '23514';
      elsif new.status = 'credited' and not (settled_total = 0 and credited_total >= new.total_cents) then
        raise exception 'Invoice credit totals do not support credited status.' using errcode = '23514';
      elsif new.status = 'issued' and (settled_total > 0 or credited_total > 0) then
        raise exception 'An invoice with payment or credit activity cannot return to issued status.' using errcode = '23514';
      end if;
    end if;
  end if;
  if old.status = 'draft' and (
    new.invoice_discount_cents is distinct from old.invoice_discount_cents
    or new.tax_rate_basis_points is distinct from old.tax_rate_basis_points
    or new.tax_label is distinct from old.tax_label
  ) then
    select coalesce(sum(round(item.quantity * item.unit_price_cents)::bigint),0),coalesce(sum(item.discount_cents),0)
    into new.subtotal_cents,new.line_discount_cents
    from public.client_invoice_items item where item.invoice_id = old.id;
    if new.invoice_discount_cents + new.line_discount_cents > new.subtotal_cents then
      raise exception 'Discounts cannot exceed invoice subtotal.' using errcode = '23514';
    end if;
    new.tax_cents := round((new.subtotal_cents-new.line_discount_cents-new.invoice_discount_cents)*new.tax_rate_basis_points/10000.0)::bigint;
    new.total_cents := new.subtotal_cents-new.line_discount_cents-new.invoice_discount_cents+new.tax_cents;
  end if;
  return new;
end;
$$;

create or replace function public.create_client_payfast_checkout(target_invoice_id uuid, requested_idempotency_key uuid)
returns table(checkout_session_id uuid, amount_cents bigint, currency text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invoice_record public.client_invoices%rowtype;
  session_record public.client_payment_checkout_sessions%rowtype;
  paid_total bigint;
  pending_total bigint;
  credited_total bigint;
  checkout_amount bigint;
begin
  if auth.uid() is null or requested_idempotency_key is null then
    raise exception 'Sign in and provide an idempotency key to start checkout.' using errcode = '42501';
  end if;
  select * into strict invoice_record from public.client_invoices where id=target_invoice_id for update;
  if not public.has_client_access(invoice_record.client_id,null,array['client_admin']) then
    raise exception 'Only a client administrator can pay this invoice.' using errcode = '42501';
  end if;
  if invoice_record.status not in ('issued','partially_paid','partially_credited') then
    raise exception 'Only open issued invoices can start checkout.' using errcode = '23514';
  end if;
  select * into session_record from public.client_payment_checkout_sessions session
  where session.idempotency_key=requested_idempotency_key for update;
  if found then
    if session_record.invoice_id<>target_invoice_id then raise exception 'Idempotency key belongs to a different invoice.' using errcode = '23505'; end if;
    if session_record.status='pending' and session_record.expires_at>now() then
      return query select session_record.id,session_record.amount_cents,session_record.currency,session_record.expires_at;
      return;
    end if;
    raise exception 'This checkout session is no longer active.' using errcode = '23514';
  end if;
  select coalesce(sum(a.amount_cents),0) into paid_total from public.client_payment_allocations a
  join public.client_payments payment on payment.id=a.payment_id
  where a.invoice_id=target_invoice_id and a.status='settled' and payment.status='settled';
  select coalesce(sum(a.amount_cents),0) into pending_total from public.client_payment_allocations a
  where a.invoice_id=target_invoice_id and a.status='pending';
  select coalesce(sum(credit_note.amount_cents),0) into credited_total from public.client_credit_notes credit_note
  where credit_note.invoice_id=target_invoice_id and credit_note.status='issued';
  select pending_total+coalesce(sum(session.amount_cents),0) into pending_total
  from public.client_payment_checkout_sessions session
  where session.invoice_id=target_invoice_id and session.status='pending' and session.expires_at>now();
  checkout_amount := invoice_record.total_cents-paid_total-pending_total-credited_total;
  if checkout_amount<=0 then raise exception 'No invoice balance is available for online payment.' using errcode = '23514'; end if;
  insert into public.client_payment_checkout_sessions(invoice_id,client_id,amount_cents,currency,idempotency_key,created_by)
  values(target_invoice_id,invoice_record.client_id,checkout_amount,invoice_record.currency,requested_idempotency_key,auth.uid())
  returning * into session_record;
  return query select session_record.id,session_record.amount_cents,session_record.currency,session_record.expires_at;
end;
$$;
revoke all on function public.create_client_payfast_checkout(uuid,uuid) from public, anon;
grant execute on function public.create_client_payfast_checkout(uuid,uuid) to authenticated;

create or replace function public._record_client_payment(payment_request jsonb, required_role text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_key uuid;
  checkout_session_id uuid;
  existing_payment public.client_payments%rowtype;
  created_payment_id uuid;
  payment_client_id uuid;
  payment_method_value text;
  payment_currency text;
  payment_amount bigint;
  allocation jsonb;
  invoice_record public.client_invoices%rowtype;
  allocation_amount bigint;
  allocated_total bigint := 0;
  paid_total bigint;
  pending_total bigint;
  credited_total bigint;
begin
  if required_role = 'platform_admin' then
    if auth.uid() is null or not public.is_platform_admin() then raise exception 'Only a platform administrator can record payments.' using errcode = '42501'; end if;
  elsif required_role = 'service_role' then
    if auth.role() <> 'service_role' then raise exception 'Verified gateway settlement requires the service role.' using errcode = '42501'; end if;
  else raise exception 'Invalid payment operation.' using errcode = '22023'; end if;
  if jsonb_typeof(payment_request) <> 'object' or jsonb_typeof(payment_request->'allocations') <> 'array' or jsonb_array_length(payment_request->'allocations') = 0 then
    raise exception 'Provide at least one invoice allocation.' using errcode = '22023';
  end if;
  request_key := (payment_request->>'idempotency_key')::uuid;
  checkout_session_id := nullif(payment_request->>'checkout_session_id','')::uuid;
  payment_amount := (payment_request->>'amount_cents')::bigint;
  payment_method_value := payment_request->>'payment_method';
  payment_client_id := (payment_request->>'client_id')::uuid;
  payment_currency := payment_request->>'currency';
  if request_key is null or payment_amount <= 0 or payment_currency !~ '^[A-Z]{3}$' then
    raise exception 'Provide a valid idempotency key, amount, and currency.' using errcode = '22023';
  end if;
  if required_role = 'platform_admin' and payment_method_value not in ('eft','cash','other') then
    raise exception 'Choose EFT, cash, or other for a manually recorded payment.' using errcode = '22023';
  elsif required_role = 'service_role' and payment_method_value <> 'payfast' then
    raise exception 'Only verified PayFast transactions can use this operation.' using errcode = '22023';
  end if;
  select * into existing_payment from public.client_payments where idempotency_key = request_key;
  if found then
    if existing_payment.request_payload is distinct from payment_request then raise exception 'Idempotency key was already used for a different payment.' using errcode = '23505'; end if;
    return existing_payment.id;
  end if;
  if payment_method_value = 'payfast' then
    if nullif(trim(payment_request->>'provider_transaction_id'),'') is null then raise exception 'Verified gateway transaction id is required.' using errcode = '22023'; end if;
    select * into existing_payment from public.client_payments where payment_method = 'payfast' and provider_transaction_id = payment_request->>'provider_transaction_id';
    if found then
      if existing_payment.request_payload is distinct from payment_request then raise exception 'Gateway transaction id was already used for a different payment.' using errcode = '23505'; end if;
      return existing_payment.id;
    end if;
  end if;
  insert into public.client_payments (client_id,payment_method,status,amount_cents,currency,paid_on,reference,evidence_reference,note,provider_transaction_id,idempotency_key,request_payload,created_by)
  values (payment_client_id,payment_method_value,'settled',payment_amount, payment_currency,
    coalesce(nullif(payment_request->>'paid_on','')::date,current_date),nullif(trim(payment_request->>'reference'),''),
    nullif(trim(payment_request->>'evidence_reference'),''),nullif(trim(payment_request->>'note'),''),
    nullif(trim(payment_request->>'provider_transaction_id'),''),request_key,payment_request,auth.uid())
  returning id into created_payment_id;
  for allocation in select value from jsonb_array_elements(payment_request->'allocations') order by value->>'invoice_id' loop
    allocation_amount := (allocation->>'amount_cents')::bigint;
    if allocation_amount <= 0 then raise exception 'Allocation amounts must be positive.' using errcode = '22023'; end if;
    select * into invoice_record from public.client_invoices where id = (allocation->>'invoice_id')::uuid for update;
    if not found or invoice_record.client_id <> payment_client_id or invoice_record.currency <> payment_currency then
      raise exception 'Every allocated invoice must match the payment client and currency.' using errcode = '23514';
    end if;
    if invoice_record.status not in ('issued','partially_paid','partially_credited') then
      raise exception 'Only open issued invoices can accept payments.' using errcode = '23514';
    end if;
    select coalesce(sum(a.amount_cents),0) into paid_total
    from public.client_payment_allocations a join public.client_payments p on p.id=a.payment_id
    where a.invoice_id=invoice_record.id and a.status='settled' and p.status='settled';
    select coalesce(sum(a.amount_cents),0) into pending_total
    from public.client_payment_allocations a where a.invoice_id=invoice_record.id and a.status='pending';
    select pending_total+coalesce(sum(session.amount_cents),0) into pending_total
    from public.client_payment_checkout_sessions session
    where session.invoice_id=invoice_record.id and session.status='pending' and session.expires_at>now()
      and session.id is distinct from checkout_session_id;
    select coalesce(sum(amount_cents),0) into credited_total
    from public.client_credit_notes where invoice_id=invoice_record.id and status='issued';
    if paid_total + pending_total + credited_total + allocation_amount > invoice_record.total_cents then
      raise exception 'Payment exceeds the invoice balance after pending EFT reviews.' using errcode = '23514';
    end if;
    insert into public.client_payment_allocations (payment_id,invoice_id,amount_cents,status)
    values (created_payment_id,invoice_record.id,allocation_amount,'settled');
    allocated_total := allocated_total + allocation_amount;
  end loop;
  if allocated_total <> payment_amount then raise exception 'Payment amount must equal the sum of its invoice allocations.' using errcode = '23514'; end if;
  for invoice_record in select distinct i.* from public.client_invoices i join public.client_payment_allocations a on a.invoice_id=i.id where a.payment_id=created_payment_id order by i.id loop
    perform public.refresh_client_invoice_payment_status(invoice_record.id);
  end loop;
  insert into public.platform_audit_log (actor_user_id,client_id,action,entity_type,entity_id,new_values,reason)
  values (auth.uid(),payment_client_id,'payment.settled','client_payments',created_payment_id,
    jsonb_build_object('payment_method',payment_method_value,'amount_cents',payment_amount,'currency',payment_currency,'reference',payment_request->>'reference'),
    case when payment_method_value='payfast' then 'Verified gateway settlement' else 'Manually recorded payment' end);
  return created_payment_id;
end;
$$;
revoke all on function public._record_client_payment(jsonb,text) from public, anon, authenticated, service_role;

create or replace function public.record_client_payment(payment_request jsonb)
returns uuid
language sql
security definer
set search_path = public, pg_temp
as $$ select public._record_client_payment(payment_request,'platform_admin'); $$;
revoke all on function public.record_client_payment(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.record_client_payment(jsonb) to authenticated;

create or replace function public.record_verified_payfast_payment(
  target_checkout_session_id uuid, provider_transaction_id text, payment_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  checkout_record public.client_payment_checkout_sessions%rowtype;
  request jsonb;
  created_payment_id uuid;
  verified_transaction_id text := trim(provider_transaction_id);
begin
  if auth.role()<>'service_role' then raise exception 'Verified gateway settlement requires the service role.' using errcode = '42501'; end if;
  if nullif(trim(coalesce(provider_transaction_id,'')),'') is null then raise exception 'PayFast transaction ID is required.' using errcode = '22023'; end if;
  select * into checkout_record from public.client_payment_checkout_sessions session
  where session.id=target_checkout_session_id for update;
  if not found then raise exception 'PayFast checkout session not found.' using errcode = 'P0002'; end if;
  if checkout_record.status='settled' and checkout_record.provider_transaction_id=verified_transaction_id then
    return checkout_record.payment_id;
  end if;
  if checkout_record.status<>'pending' or checkout_record.expires_at<=now() then
    raise exception 'PayFast checkout session is no longer payable.' using errcode = '23514';
  end if;
  update public.client_payment_checkout_sessions set status='settling' where id=target_checkout_session_id;
  request := jsonb_build_object('client_id',checkout_record.client_id,'currency',checkout_record.currency,
    'amount_cents',checkout_record.amount_cents,'payment_method','payfast','paid_on',coalesce(payment_date,current_date),
    'provider_transaction_id',verified_transaction_id,'idempotency_key',checkout_record.idempotency_key,
    'checkout_session_id',target_checkout_session_id,
    'allocations',jsonb_build_array(jsonb_build_object('invoice_id',checkout_record.invoice_id,'amount_cents',checkout_record.amount_cents)));
  created_payment_id:=public._record_client_payment(request,'service_role');
  update public.client_payment_checkout_sessions set status='settled',provider_transaction_id=verified_transaction_id,
    payment_id=created_payment_id,completed_at=now() where id=target_checkout_session_id;
  return created_payment_id;
end;
$$;
revoke all on function public.record_verified_payfast_payment(uuid,text,date) from public, anon, authenticated, service_role;
grant execute on function public.record_verified_payfast_payment(uuid,text,date) to service_role;

create or replace function public.submit_client_eft_payment(
  target_invoice_id uuid, payment_amount_cents bigint, payment_date date, payment_reference text,
  proof_reference text, idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invoice_record public.client_invoices%rowtype;
  request jsonb;
  existing_payment public.client_payments%rowtype;
  payment_id uuid;
  request_key uuid;
  paid_total bigint;
  pending_total bigint;
  credited_total bigint;
begin
  if auth.uid() is null then raise exception 'Sign in before submitting payment.' using errcode = '42501'; end if;
  if payment_amount_cents is null or payment_amount_cents <= 0 or nullif(trim(coalesce(payment_reference,'')),'') is null
    or nullif(trim(coalesce(proof_reference,'')),'') is null or idempotency_key is null then
    raise exception 'Provide the amount, transfer reference, proof reference, and idempotency key.' using errcode = '22023';
  end if;
  request_key := idempotency_key;
  select * into strict invoice_record from public.client_invoices where id=target_invoice_id for update;
  if not public.has_client_access(invoice_record.client_id,null,array['client_admin']) then
    raise exception 'Only a client administrator can submit payment for this invoice.' using errcode = '42501';
  end if;
  if invoice_record.status not in ('issued','partially_paid','partially_credited') then raise exception 'Only open issued invoices can receive EFT submissions.' using errcode = '23514'; end if;
  request := jsonb_build_object('invoice_id',target_invoice_id,'client_id',invoice_record.client_id,'amount_cents',payment_amount_cents,
    'currency',invoice_record.currency,'payment_method','eft','paid_on',coalesce(payment_date,current_date),
    'reference',trim(payment_reference),'evidence_reference',trim(proof_reference),'idempotency_key',request_key);
  select * into existing_payment from public.client_payments payment where payment.idempotency_key=request_key;
  if found then
    if existing_payment.request_payload is distinct from request then raise exception 'Idempotency key was already used for another EFT submission.' using errcode = '23505'; end if;
    return existing_payment.id;
  end if;
  select coalesce(sum(a.amount_cents),0) into paid_total from public.client_payment_allocations a join public.client_payments p on p.id=a.payment_id
    where a.invoice_id=target_invoice_id and a.status='settled' and p.status='settled';
  select coalesce(sum(amount_cents),0) into pending_total from public.client_payment_allocations where invoice_id=target_invoice_id and status='pending';
  select coalesce(sum(amount_cents),0) into credited_total from public.client_credit_notes where invoice_id=target_invoice_id and status='issued';
  if paid_total+pending_total+credited_total+payment_amount_cents>invoice_record.total_cents then raise exception 'EFT submission exceeds the invoice balance.' using errcode = '23514'; end if;
  insert into public.client_payments (client_id,payment_method,status,amount_cents,currency,paid_on,reference,evidence_reference,idempotency_key,request_payload,created_by)
  values (invoice_record.client_id,'eft','pending_review',payment_amount_cents,invoice_record.currency,coalesce(payment_date,current_date),trim(payment_reference),trim(proof_reference),request_key,request,auth.uid())
  returning id into payment_id;
  insert into public.client_payment_allocations (payment_id,invoice_id,amount_cents,status)
  values (payment_id,target_invoice_id,payment_amount_cents,'pending');
  insert into public.platform_audit_log (actor_user_id,client_id,action,entity_type,entity_id,new_values,reason)
  values (auth.uid(),invoice_record.client_id,'payment.eft_submitted','client_payments',payment_id,
    jsonb_build_object('amount_cents',payment_amount_cents,'reference',trim(payment_reference),'evidence_reference',trim(proof_reference)),'Awaiting Platform Admin review');
  return payment_id;
end;
$$;
revoke all on function public.submit_client_eft_payment(uuid,bigint,date,text,text,uuid) from public, anon, service_role;
grant execute on function public.submit_client_eft_payment(uuid,bigint,date,text,text,uuid) to authenticated;

create or replace function public.review_client_eft_payment(target_payment_id uuid, approve_payment boolean, review_note text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  payment_record public.client_payments%rowtype;
  allocation record;
  invoice_record public.client_invoices%rowtype;
  paid_total bigint;
  other_pending_total bigint;
  credited_total bigint;
  next_status text;
  review_reason text := review_note;
begin
  if auth.uid() is null or not public.is_platform_admin() then raise exception 'Only a platform administrator can review EFT submissions.' using errcode = '42501'; end if;
  select * into payment_record from public.client_payments where id=target_payment_id for update;
  if not found then raise exception 'Payment submission not found.' using errcode = 'P0002'; end if;
  if payment_record.payment_method<>'eft' or payment_record.status<>'pending_review' then raise exception 'Only pending EFT submissions can be reviewed.' using errcode = '23514'; end if;
  if approve_payment then
    for allocation in select * from public.client_payment_allocations where payment_id=target_payment_id and status='pending' order by invoice_id loop
      select * into strict invoice_record from public.client_invoices where id=allocation.invoice_id for update;
      select coalesce(sum(a.amount_cents),0) into paid_total from public.client_payment_allocations a join public.client_payments p on p.id=a.payment_id
        where a.invoice_id=invoice_record.id and a.status='settled' and p.status='settled';
      select coalesce(sum(a.amount_cents),0) into other_pending_total from public.client_payment_allocations a
        where a.invoice_id=invoice_record.id and a.status='pending' and a.payment_id<>target_payment_id;
      select coalesce(sum(amount_cents),0) into credited_total from public.client_credit_notes where invoice_id=invoice_record.id and status='issued';
      if paid_total+other_pending_total+credited_total+allocation.amount_cents>invoice_record.total_cents then raise exception 'EFT approval would exceed the invoice balance.' using errcode = '23514'; end if;
      if invoice_record.status not in ('issued','partially_paid','partially_credited') then raise exception 'Invoice is no longer open for payment.' using errcode = '23514'; end if;
      update public.client_payment_allocations set status='settled' where id=allocation.id;
    end loop;
    next_status := 'settled';
  else
    update public.client_payment_allocations set status='released' where payment_id=target_payment_id and status='pending';
    next_status := 'rejected';
  end if;
  update public.client_payments set status=next_status,reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(review_reason),'') where id=target_payment_id;
  if approve_payment then
    for allocation in select invoice_id from public.client_payment_allocations where payment_id=target_payment_id loop
      perform public.refresh_client_invoice_payment_status(allocation.invoice_id);
    end loop;
  end if;
  insert into public.platform_audit_log (actor_user_id,client_id,action,entity_type,entity_id,previous_values,new_values,reason)
  values (auth.uid(),payment_record.client_id,case when approve_payment then 'payment.eft_approved' else 'payment.eft_rejected' end,
    'client_payments',target_payment_id,jsonb_build_object('status','pending_review'),jsonb_build_object('status',next_status),nullif(trim(review_reason),''));
  return next_status;
end;
$$;
revoke all on function public.review_client_eft_payment(uuid,boolean,text) from public, anon, service_role;
grant execute on function public.review_client_eft_payment(uuid,boolean,text) to authenticated;

create or replace function public.reverse_client_payment(target_payment_id uuid, reversal_reason text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare payment_record public.client_payments%rowtype; allocation record;
begin
  if auth.uid() is null or not public.is_platform_admin() then raise exception 'Only a platform administrator can reverse payments.' using errcode = '42501'; end if;
  if length(trim(coalesce(reversal_reason,'')))<2 then raise exception 'Provide a reason for reversing this payment.' using errcode = '22023'; end if;
  select * into payment_record from public.client_payments where id=target_payment_id for update;
  if not found then raise exception 'Payment not found.' using errcode = 'P0002'; end if;
  if payment_record.status<>'settled' then raise exception 'Only settled payments can be reversed.' using errcode = '23514'; end if;
  update public.client_payments set status='reversed',reviewed_by=auth.uid(),reviewed_at=now(),review_note=trim(reversal_reason) where id=target_payment_id;
  update public.client_payment_allocations set status='reversed' where payment_id=target_payment_id and status='settled';
  for allocation in select invoice_id from public.client_payment_allocations where payment_id=target_payment_id loop
    perform public.refresh_client_invoice_payment_status(allocation.invoice_id);
  end loop;
  insert into public.platform_audit_log (actor_user_id,client_id,action,entity_type,entity_id,previous_values,new_values,reason)
  values (auth.uid(),payment_record.client_id,'payment.reversed','client_payments',target_payment_id,
    jsonb_build_object('status','settled'),jsonb_build_object('status','reversed'),trim(reversal_reason));
  return 'reversed';
end;
$$;
revoke all on function public.reverse_client_payment(uuid,text) from public, anon, service_role;
grant execute on function public.reverse_client_payment(uuid,text) to authenticated;

commit;