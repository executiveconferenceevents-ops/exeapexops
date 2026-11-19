const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const invoiceMigrationPath = path.join(__dirname, '../supabase/platform-invoice-records-migration.sql');
const paymentMigrationPath = path.join(__dirname, '../supabase/platform-invoice-payments-migration.sql');
const adminId = '00000000-0000-0000-0000-000000000001';
const clientAdminId = '00000000-0000-0000-0000-000000000002';
const clientId = '00000000-0000-0000-0000-000000000010';

async function createFixture() {
  const database = new PGlite();
  await database.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema auth;
    create schema storage;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${adminId}'), ('${clientAdminId}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.user_id', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select coalesce(current_setting('request.role', true), 'authenticated')
    $$;
    create table public.platform_admins(user_id uuid primary key references auth.users(id));
    insert into public.platform_admins values ('${adminId}');
    create function public.is_platform_admin() returns boolean language sql stable security definer as $$
      select exists(select 1 from public.platform_admins where user_id=auth.uid())
    $$;
    create table public.clients (id uuid primary key, name text not null);
    insert into public.clients values ('${clientId}', 'Fixture Client'), ('00000000-0000-0000-0000-000000000011', 'Other Client');
    create table public.client_event_memberships(id uuid primary key default gen_random_uuid(),user_id uuid,client_id uuid,event_id uuid,role text);
    insert into public.client_event_memberships(user_id,client_id,event_id,role) values ('${clientAdminId}','${clientId}',null,'client_admin');
    create function public.has_client_membership(target_client_id uuid) returns boolean language sql stable as $$
      select public.is_platform_admin() or exists(select 1 from public.client_event_memberships where user_id=auth.uid() and client_id=target_client_id)
    $$;
    create function public.has_client_access(target_client_id uuid,target_event_id uuid default null,allowed_roles text[] default null)
      returns boolean language sql stable security definer as $$
      select public.is_platform_admin() or exists(
        select 1 from public.client_event_memberships membership
        where membership.user_id=auth.uid() and membership.client_id=target_client_id
          and (membership.event_id is null or membership.event_id=target_event_id)
          and (allowed_roles is null or membership.role=any(allowed_roles))
      )
    $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null);
    alter table storage.objects enable row level security;
    create function storage.foldername(object_name text) returns text[] language sql immutable as $$
      select (string_to_array(object_name,'/'))[1:array_length(string_to_array(object_name,'/'),1)-1]
    $$;
    create table public.platform_audit_log (
      id bigint generated always as identity primary key,
      actor_user_id uuid,
      client_id uuid,
      action text not null,
      entity_type text not null,
      entity_id uuid,
      previous_values jsonb,
      new_values jsonb,
      reason text,
      created_at timestamptz not null default now()
    );
    grant usage on schema public, auth to authenticated;
    grant usage on schema storage to authenticated;
    grant select on storage.buckets to authenticated;
    grant select,insert on storage.objects to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant execute on function auth.role() to service_role;
    grant execute on function public.has_client_access(uuid,uuid,text[]) to authenticated;
    grant execute on function public.has_client_membership(uuid) to authenticated;
  `);
  await database.exec(await readFile(invoiceMigrationPath,'utf8'));
  await database.exec(await readFile(paymentMigrationPath,'utf8'));
  return database;
}

async function createIssuedInvoice(database, targetClientId=clientId) {
  const request = {
    client_id:targetClientId,
    billed_to_name:'Fixture Client',
    invoice_date:'2026-11-15',
    description:'Stage 3 payment fixture',
    items:[{ description:'Operations', quantity:1, unit_price_cents:10000 }],
  };
  const created = await database.query('select public.create_client_invoice($1::jsonb) as id',[JSON.stringify(request)]);
  const invoiceId = created.rows[0].id;
  await database.query('select public.issue_client_invoice($1)',[invoiceId]);
  return invoiceId;
}

test('payments allocate atomically, are idempotent, support EFT review and reversals, and preserve invoice balances', async () => {
  const database = await createFixture();
  try {
    await database.exec('set role authenticated');
    await database.query("select set_config('request.user_id',$1,false)",[adminId]);
    const invoiceId = await createIssuedInvoice(database);
    const otherInvoiceId = await createIssuedInvoice(database,'00000000-0000-0000-0000-000000000011');
    const key = '00000000-0000-0000-0000-000000000100';
    const request = {
      client_id:clientId,
      amount_cents:4000,
      currency:'ZAR',
      payment_method:'eft',
      paid_on:'2026-11-15',
      reference:'BANK-001',
      note:'Matched to bank statement',
      idempotency_key:key,
      allocations:[{ invoice_id:invoiceId, amount_cents:4000 }],
    };
    const first = await database.query('select public.record_client_payment($1::jsonb) as id',[JSON.stringify(request)]);
    const duplicate = await database.query('select public.record_client_payment($1::jsonb) as id',[JSON.stringify(request)]);
    assert.equal(first.rows[0].id,duplicate.rows[0].id);
    assert.equal((await database.query('select status from public.client_invoices where id=$1',[invoiceId])).rows[0].status,'partially_paid');
    await assert.rejects(database.query('select public.record_client_payment($1::jsonb)',[JSON.stringify({ ...request, amount_cents:10001, allocations:[{invoice_id:invoiceId,amount_cents:10001}],idempotency_key:'00000000-0000-0000-0000-000000000101' })]),/exceeds the invoice balance/i);
    await assert.rejects(database.query('select public.record_client_payment($1::jsonb)',[JSON.stringify({ ...request, amount_cents:3000, allocations:[{invoice_id:invoiceId,amount_cents:3000}] })]),/different payment/i);

    await database.query("select set_config('request.user_id',$1,false)",[clientAdminId]);
    assert.equal((await database.query('select count(*) as count from public.client_invoices where id=$1',[invoiceId])).rows[0].count,1);
    assert.equal((await database.query('select count(*) as count from public.client_invoices where id=$1',[otherInvoiceId])).rows[0].count,0);
    await database.query("insert into storage.objects(bucket_id,name) values('client-payment-evidence',$1)",[
      `${clientId}/${invoiceId}/proof.pdf`,
    ]);
    assert.equal((await database.query("select count(*) as count from storage.objects where bucket_id='client-payment-evidence'")).rows[0].count,1);
    await assert.rejects(database.query("insert into storage.objects(bucket_id,name) values('client-payment-evidence',$1)",[
      `00000000-0000-0000-0000-000000000011/${otherInvoiceId}/proof.pdf`,
    ]),/row-level security|permission/i);
    const eftKey='00000000-0000-0000-0000-000000000102';
    const eft=await database.query("select public.submit_client_eft_payment($1,6000,'2026-11-15','BANK-002','private/client/invoice/proof.pdf',$2) as id",[invoiceId,eftKey]);
    await database.query("select set_config('request.user_id',$1,false)",[adminId]);
    assert.equal((await database.query('select status from public.client_invoices where id=$1',[invoiceId])).rows[0].status,'partially_paid');
    await database.query("select set_config('request.user_id',$1,false)",[clientAdminId]);
    await assert.rejects(database.query("select public.review_client_eft_payment($1,true,'approved')",[eft.rows[0].id]),/platform administrator/i);
    await database.query("select set_config('request.user_id',$1,false)",[adminId]);
    assert.equal((await database.query("select public.review_client_eft_payment($1,true,'Bank entry matched') as status",[eft.rows[0].id])).rows[0].status,'settled');
    assert.equal((await database.query('select status from public.client_invoices where id=$1',[invoiceId])).rows[0].status,'paid');

    await database.query("select public.reverse_client_payment($1,'Duplicate bank credit')",[eft.rows[0].id]);
    assert.equal((await database.query('select status from public.client_invoices where id=$1',[invoiceId])).rows[0].status,'partially_paid');
    assert.equal((await database.query('select status from public.client_payments where id=$1',[eft.rows[0].id])).rows[0].status,'reversed');
    await assert.rejects(database.query("select public.reverse_client_payment($1,'Again')",[eft.rows[0].id]),/Only settled payments/i);

    await database.query("select set_config('request.user_id',$1,false)",[clientAdminId]);
    const checkoutKey='00000000-0000-0000-0000-000000000103';
    const checkout=await database.query('select * from public.create_client_payfast_checkout($1::uuid,$2::uuid)',[invoiceId,checkoutKey]);
    assert.equal(Number(checkout.rows[0].amount_cents),6000);
    assert.equal((await database.query('select * from public.create_client_payfast_checkout($1::uuid,$2::uuid)',[invoiceId,checkoutKey])).rows[0].checkout_session_id,checkout.rows[0].checkout_session_id);
    await database.query("select set_config('request.user_id',$1,false)",[adminId]);
    await assert.rejects(database.query('select public.record_client_payment($1::jsonb)',[JSON.stringify({
      client_id:clientId,amount_cents:6000,currency:'ZAR',payment_method:'eft',paid_on:'2026-11-15',reference:'BANK-003',
      idempotency_key:'00000000-0000-0000-0000-000000000104',allocations:[{invoice_id:invoiceId,amount_cents:6000}],
    })]),/exceeds the invoice balance/i);
    await database.exec('set role service_role');
    await database.query("select set_config('request.role','service_role',false)");
    const payfast=await database.query("select public.record_verified_payfast_payment($1,'PF-TRANSACTION-001','2026-11-15') as id",[checkout.rows[0].checkout_session_id]);
    assert.equal((await database.query("select public.record_verified_payfast_payment($1,'PF-TRANSACTION-001','2026-11-15') as id",[checkout.rows[0].checkout_session_id])).rows[0].id,payfast.rows[0].id);
    await assert.rejects(database.query("select public.record_verified_payfast_payment($1,'PF-TRANSACTION-ALTERED','2026-11-15')",[checkout.rows[0].checkout_session_id]),/no longer payable/i);
    await database.exec('reset role');
    assert.equal((await database.query('select status from public.client_invoices where id=$1',[invoiceId])).rows[0].status,'paid');
    assert.equal((await database.query('select status from public.client_payment_checkout_sessions where id=$1',[checkout.rows[0].checkout_session_id])).rows[0].status,'settled');

    const audit=await database.query("select action from public.platform_audit_log where client_id=$1 order by id",[clientId]);
    assert.ok(audit.rows.some(row=>row.action==='payment.settled'));
    assert.ok(audit.rows.some(row=>row.action==='payment.eft_submitted'));
    assert.ok(audit.rows.some(row=>row.action==='payment.eft_approved'));
    assert.ok(audit.rows.some(row=>row.action==='payment.reversed'));
  } finally {
    await database.close();
  }
});