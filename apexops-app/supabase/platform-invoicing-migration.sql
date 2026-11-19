-- Manual invoice and payment ledger for Platform Admin. No payment processing is performed.
begin;

create table if not exists public.client_invoices (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  invoice_number text not null unique,
  description text not null,
  event_name text,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  issued_on date not null default current_date,
  due_on date,
  status text not null default 'draft' check (status in ('draft','issued','partially_paid','paid','void')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_on is null or due_on >= issued_on)
);

create index if not exists client_invoices_client_issued_idx
  on public.client_invoices (client_id, issued_on desc);

create table if not exists public.client_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.client_invoices(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date not null default current_date,
  payment_method text not null check (payment_method in ('eft','cash','other')),
  reference text,
  note text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists client_invoice_payments_invoice_date_idx
  on public.client_invoice_payments (invoice_id, paid_on desc);

alter table public.client_invoices enable row level security;
alter table public.client_invoice_payments enable row level security;
revoke all on public.client_invoices, public.client_invoice_payments from public, anon, authenticated;
grant select, insert, update on public.client_invoices to authenticated;
grant select on public.client_invoice_payments to authenticated;

drop policy if exists "platform admins manage client invoices" on public.client_invoices;
create policy "platform admins manage client invoices"
on public.client_invoices for all to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "platform admins read invoice payments" on public.client_invoice_payments;
create policy "platform admins read invoice payments"
on public.client_invoice_payments for select to authenticated
using (public.is_platform_admin());

create or replace function public.touch_client_invoice_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_client_invoice_updated_at() from public;
drop trigger if exists client_invoices_set_updated_at on public.client_invoices;
create trigger client_invoices_set_updated_at
before update on public.client_invoices
for each row execute function public.touch_client_invoice_updated_at();

create or replace function public.record_client_invoice_payment(
  target_invoice_id uuid,
  payment_amount_cents bigint,
  payment_date date,
  payment_method text,
  payment_reference text default null,
  payment_note text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invoice_record public.client_invoices%rowtype;
  paid_total bigint;
  next_status text;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Only a platform administrator can record invoice payments.' using errcode = '42501';
  end if;
  if payment_amount_cents is null or payment_amount_cents <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = '22023';
  end if;
  if payment_method not in ('eft','cash','other') then
    raise exception 'Choose EFT, cash, or other as the payment method.' using errcode = '22023';
  end if;

  select * into invoice_record
  from public.client_invoices
  where id = target_invoice_id
  for update;
  if not found then raise exception 'Invoice not found.' using errcode = 'P0002'; end if;
  if invoice_record.status not in ('issued','partially_paid') then
    raise exception 'Only issued or partially paid invoices can accept a payment.' using errcode = '23514';
  end if;

  select coalesce(sum(payment.amount_cents), 0) into paid_total
  from public.client_invoice_payments payment
  where payment.invoice_id = target_invoice_id;
  if paid_total + payment_amount_cents > invoice_record.amount_cents then
    raise exception 'Payment exceeds the invoice balance.' using errcode = '23514';
  end if;

  insert into public.client_invoice_payments (invoice_id, amount_cents, paid_on, payment_method, reference, note, recorded_by)
  values (target_invoice_id, payment_amount_cents, coalesce(payment_date, current_date), payment_method, nullif(trim(payment_reference), ''), nullif(trim(payment_note), ''), auth.uid());

  next_status := case when paid_total + payment_amount_cents = invoice_record.amount_cents then 'paid' else 'partially_paid' end;
  update public.client_invoices set status = next_status where id = target_invoice_id;
  return next_status;
end;
$$;
revoke all on function public.record_client_invoice_payment(uuid, bigint, date, text, text, text) from public, anon;
grant execute on function public.record_client_invoice_payment(uuid, bigint, date, text, text, text) to authenticated;

commit;
