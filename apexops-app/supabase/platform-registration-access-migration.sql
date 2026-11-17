-- Stage 4: controlled client registration, explicit activation, and account-state access gates.
begin;

create table if not exists public.client_registration_rate_limits (
  subject_hash text primary key check (subject_hash ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null check (request_count > 0)
);
alter table public.client_registration_rate_limits enable row level security;
revoke all on public.client_registration_rate_limits from public, anon, authenticated, service_role;

create or replace function public.consume_client_registration_rate_limit(request_subject_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare attempts integer;
begin
  if auth.role()<>'service_role' then raise exception 'Registration rate limits are service-only.' using errcode = '42501'; end if;
  if request_subject_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid registration rate limit key.' using errcode = '22023'; end if;
  delete from public.client_registration_rate_limits where window_started_at<now()-interval '24 hours';
  insert into public.client_registration_rate_limits(subject_hash,window_started_at,request_count)
  values(request_subject_hash,now(),1)
  on conflict(subject_hash) do update set
    window_started_at=case when public.client_registration_rate_limits.window_started_at<now()-interval '1 hour' then now() else public.client_registration_rate_limits.window_started_at end,
    request_count=case when public.client_registration_rate_limits.window_started_at<now()-interval '1 hour' then 1 else public.client_registration_rate_limits.request_count+1 end
  returning request_count into attempts;
  return attempts<=5;
end;
$$;
revoke all on function public.consume_client_registration_rate_limit(text) from public, anon, authenticated;
grant execute on function public.consume_client_registration_rate_limit(text) to service_role;

create unique index if not exists client_registration_submissions_one_pending_email_idx
  on public.client_registration_submissions(lower(primary_contact_email)) where status='submitted';
alter table public.client_registration_submissions add column if not exists registration_request_id uuid;
create unique index if not exists client_registration_submissions_request_id_idx
  on public.client_registration_submissions(registration_request_id) where registration_request_id is not null;

create or replace function public.submit_client_registration(registration_request jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_client_id uuid;
  created_submission_id uuid;
  company_name text;
  company_slug text;
  contact_name text;
  contact_email text;
  accepted_at timestamptz;
  request_id uuid;
begin
  if auth.role()<>'service_role' then raise exception 'Registration submission is service-only.' using errcode = '42501'; end if;
  if jsonb_typeof(registration_request)<>'object' then raise exception 'Provide a registration request.' using errcode = '22023'; end if;
  company_name:=trim(registration_request->>'registered_business_name');
  company_slug:=lower(trim(registration_request->>'slug'));
  contact_name:=trim(registration_request->>'primary_contact_name');
  contact_email:=lower(trim(registration_request->>'primary_contact_email'));
  accepted_at:=nullif(registration_request->>'terms_accepted_at','')::timestamptz;
  request_id:=nullif(registration_request->>'registration_request_id','')::uuid;
  if length(company_name) not between 2 and 200
    or company_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or length(contact_name) not between 2 and 160
    or position('@' in contact_email)<=1
    or length(trim(coalesce(registration_request->>'terms_version','')))<1
    or accepted_at is null or request_id is null then
    raise exception 'Complete the organization, contact, and registration acknowledgement fields.' using errcode = '22023';
  end if;
  select id into created_submission_id from public.client_registration_submissions where registration_request_id=request_id;
  if found then return created_submission_id; end if;
  if exists(select 1 from public.client_registration_submissions where lower(primary_contact_email)=contact_email and status='submitted') then
    raise exception 'A request from this email is already awaiting review.' using errcode = '23505';
  end if;
  insert into public.clients(name,slug,event_limit,billing_mode,billing_status,billing_plan,account_status,prepaid_event_credits,committed_events)
  values(company_name,company_slug,1,'prepaid','pending','pay_per_event','awaiting_approval',0,0)
  returning id into created_client_id;
  insert into public.client_registration_submissions(
    client_id,registration_request_id,registered_business_name,company_registration_number,primary_contact_name,primary_contact_email,
    billing_contact_email,contact_phone,terms_version,terms_accepted_at
  ) values (
    created_client_id,request_id,company_name,nullif(trim(registration_request->>'company_registration_number'),''),contact_name,contact_email,
    nullif(lower(trim(registration_request->>'billing_contact_email')),''),nullif(trim(registration_request->>'contact_phone'),''),
    trim(registration_request->>'terms_version'),accepted_at
  ) returning id into created_submission_id;
  return created_submission_id;
end;
$$;
revoke all on function public.submit_client_registration(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.submit_client_registration(jsonb) to service_role;

create or replace function public.review_client_registration(target_submission_id uuid, approve_request boolean, decision_note text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare submission public.client_registration_submissions%rowtype;
begin
  if auth.uid() is null or not public.is_platform_admin() then raise exception 'Only a platform administrator can review registrations.' using errcode = '42501'; end if;
  select * into submission from public.client_registration_submissions where id=target_submission_id for update;
  if not found then raise exception 'Registration request not found.' using errcode = 'P0002'; end if;
  if submission.status<>'submitted' then raise exception 'Only submitted requests can be reviewed.' using errcode = '23514'; end if;
  update public.client_registration_submissions set status=case when approve_request then 'approved' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=now(),review_note=nullif(trim(decision_note),'')
  where id=target_submission_id;
  update public.clients set account_status=case when approve_request then 'pending_payment' else 'rejected' end
  where id=submission.client_id and account_status='awaiting_approval';
  if not found then raise exception 'Client account is not awaiting review.' using errcode = '23514'; end if;
  return case when approve_request then 'approved' else 'rejected' end;
end;
$$;
revoke all on function public.review_client_registration(uuid,boolean,text) from public, anon, service_role;
grant execute on function public.review_client_registration(uuid,boolean,text) to authenticated;

create or replace function public.activate_client_registration(target_client_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then raise exception 'Only a platform administrator can activate a client.' using errcode = '42501'; end if;
  if not exists(select 1 from public.client_registration_submissions submission
    where submission.client_id=target_client_id and submission.status='approved') then
    raise exception 'Approve the registration before activation.' using errcode = '23514';
  end if;
  update public.clients set account_status='active'
  where id=target_client_id and account_status='pending_payment' and billing_status='active';
  if not found then raise exception 'Set verified billing active before activating this account.' using errcode = '23514'; end if;
  return 'active';
end;
$$;
revoke all on function public.activate_client_registration(uuid) from public, anon, service_role;
grant execute on function public.activate_client_registration(uuid) to authenticated;

create or replace function public.client_billing_is_current(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.clients client where client.id=target_client_id
      and client.account_status='active' and client.billing_status='active'
      and (
        client.billing_mode in ('unmanaged','prepaid')
        or (client.billing_mode='monthly' and client.paid_through>=current_date
          and client.term_started_at<=current_date and client.term_ends_at>=current_date)
        or (client.billing_mode='trial' and client.trial_started_at<=current_date and client.trial_ends_at>current_date)
      )
  );
$$;
revoke all on function public.client_billing_is_current(uuid) from public;
grant execute on function public.client_billing_is_current(uuid) to authenticated;

create or replace function public.has_client_access(target_client_id uuid, target_event_id uuid default null, allowed_roles text[] default null)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_platform_admin() or (
    public.client_billing_is_current(target_client_id)
    and exists(select 1 from public.client_event_memberships membership
      where membership.user_id=auth.uid() and membership.client_id=target_client_id
        and (membership.event_id is null or membership.event_id=target_event_id)
        and (allowed_roles is null or membership.role=any(allowed_roles)))
  );
$$;
revoke all on function public.has_client_access(uuid,uuid,text[]) from public;
grant execute on function public.has_client_access(uuid,uuid,text[]) to authenticated;

create or replace function public.has_client_billing_access(target_client_id uuid, allowed_roles text[] default array['client_admin']::text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_platform_admin() or exists(select 1 from public.client_event_memberships membership
    where membership.user_id=auth.uid() and membership.client_id=target_client_id and membership.event_id is null
      and (allowed_roles is null or membership.role=any(allowed_roles)));
$$;
revoke all on function public.has_client_billing_access(uuid,text[]) from public;
grant execute on function public.has_client_billing_access(uuid,text[]) to authenticated;

create or replace function public.guard_active_client_event_access()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_platform_admin() then return new; end if;
  if not public.client_billing_is_current(new.client_id) then
    raise exception 'This client account is not active. Contact the platform administrator.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_active_client_event_access() from public, anon, authenticated, service_role;
drop trigger if exists events_guard_active_client_account on public.events;
create trigger events_guard_active_client_account
before insert or update of client_id on public.events
for each row execute function public.guard_active_client_event_access();

drop policy if exists "client admins read own invoices" on public.client_invoices;
create policy "client admins read own invoices" on public.client_invoices
for select to authenticated using (public.has_client_billing_access(client_id));
drop policy if exists "client admins read own invoice items" on public.client_invoice_items;
create policy "client admins read own invoice items" on public.client_invoice_items
for select to authenticated using (exists(select 1 from public.client_invoices invoice where invoice.id=invoice_id
  and public.has_client_billing_access(invoice.client_id)));
drop policy if exists "client admins read own credit notes" on public.client_credit_notes;
create policy "client admins read own credit notes" on public.client_credit_notes
for select to authenticated using (public.has_client_billing_access(client_id));
drop policy if exists "client admins read own payments" on public.client_payments;
create policy "client admins read own payments" on public.client_payments
for select to authenticated using (public.has_client_billing_access(client_id));
drop policy if exists "client admins read own payment allocations" on public.client_payment_allocations;
create policy "client admins read own payment allocations" on public.client_payment_allocations
for select to authenticated using (exists(select 1 from public.client_invoices invoice where invoice.id=invoice_id
  and public.has_client_billing_access(invoice.client_id)));
drop policy if exists "client admins upload own payment evidence" on storage.objects;
create policy "client admins upload own payment evidence" on storage.objects
for insert to authenticated with check (bucket_id='client-payment-evidence'
  and array_length(storage.foldername(name),1)=2
  and public.has_client_billing_access((storage.foldername(name))[1]::uuid)
  and exists(select 1 from public.client_invoices invoice where invoice.id=(storage.foldername(name))[2]::uuid
    and invoice.client_id=(storage.foldername(name))[1]::uuid and invoice.status in ('issued','partially_paid','partially_credited')));
drop policy if exists "client admins read own payment evidence" on storage.objects;
create policy "client admins read own payment evidence" on storage.objects
for select to authenticated using (bucket_id='client-payment-evidence'
  and array_length(storage.foldername(name),1)=2
  and public.has_client_billing_access((storage.foldername(name))[1]::uuid)
  and exists(select 1 from public.client_invoices invoice where invoice.id=(storage.foldername(name))[2]::uuid
    and invoice.client_id=(storage.foldername(name))[1]::uuid));

commit;