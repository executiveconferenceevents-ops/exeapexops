const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrationPath=path.join(__dirname,'../supabase/platform-registration-access-migration.sql');
const adminId='00000000-0000-0000-0000-000000000001';
const clientAdminId='00000000-0000-0000-0000-000000000002';
const activeClientId='00000000-0000-0000-0000-000000000010';

async function createFixture() {
  const database=new PGlite();
  await database.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key);
    insert into auth.users values('${adminId}'),('${clientAdminId}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.user_id',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(current_setting('request.role',true),'authenticated') $$;
    create table public.platform_admins(user_id uuid primary key references auth.users(id));
    insert into public.platform_admins values('${adminId}');
    create function public.is_platform_admin() returns boolean language sql stable security definer as $$
      select exists(select 1 from public.platform_admins where user_id=auth.uid())
    $$;
    create table public.clients(
      id uuid primary key default gen_random_uuid(),name text not null,slug text not null unique,event_limit integer not null default 1,
      billing_mode text not null default 'prepaid',billing_status text not null default 'pending',billing_plan text not null default 'pay_per_event',
      account_status text not null default 'draft' check(account_status in ('draft','pending_payment','awaiting_approval','active','rejected','suspended','closed')),
      paid_through date,term_started_at date,term_ends_at date,trial_started_at date,trial_ends_at date,
      prepaid_event_credits integer not null default 0,committed_events integer not null default 0
    );
    insert into public.clients(id,name,slug,event_limit,billing_mode,billing_status,billing_plan,account_status)
    values('${activeClientId}','Active Client','active-client',2,'unmanaged','active','legacy','active');
    create table public.client_event_memberships(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),client_id uuid references public.clients(id),event_id uuid,role text);
    insert into public.client_event_memberships(user_id,client_id,role) values('${clientAdminId}','${activeClientId}','client_admin');
    create table public.events(id uuid primary key default gen_random_uuid(),client_id uuid references public.clients(id));
    create function public.has_client_membership(target_client_id uuid) returns boolean language sql stable security definer as $$
      select public.is_platform_admin() or exists(select 1 from public.client_event_memberships where user_id=auth.uid() and client_id=target_client_id)
    $$;
    create function public.has_client_access(target_client_id uuid,target_event_id uuid default null,allowed_roles text[] default null)
    returns boolean language sql stable security definer as $$ select public.has_client_membership(target_client_id) $$;
    create table public.client_registration_submissions(
      id uuid primary key default gen_random_uuid(),client_id uuid not null unique references public.clients(id),
      requested_plan_version_id uuid,registered_business_name text not null,company_registration_number text,
      primary_contact_name text not null,primary_contact_email text not null,billing_contact_email text,contact_phone text,
      terms_version text not null,terms_accepted_at timestamptz not null,
      status text not null default 'submitted' check(status in ('submitted','approved','rejected','withdrawn')),
      submitted_at timestamptz not null default now(),reviewed_at timestamptz,reviewed_by uuid references auth.users(id),review_note text,created_at timestamptz not null default now()
    );
    create table public.platform_audit_log(id bigint generated always as identity primary key,actor_user_id uuid,client_id uuid,action text,entity_type text,entity_id uuid,previous_values jsonb,new_values jsonb,reason text,created_at timestamptz default now());
    create table public.client_invoices(id uuid primary key,client_id uuid,status text);
    create table public.client_invoice_items(id uuid primary key,invoice_id uuid);
    create table public.client_credit_notes(id uuid primary key,client_id uuid,invoice_id uuid);
    create table public.client_payments(id uuid primary key,client_id uuid);
    create table public.client_payment_allocations(id uuid primary key,invoice_id uuid);
    alter table public.client_invoices enable row level security;
    alter table public.client_invoice_items enable row level security;
    alter table public.client_credit_notes enable row level security;
    alter table public.client_payments enable row level security;
    alter table public.client_payment_allocations enable row level security;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(object_name text) returns text[] language sql immutable as $$
      select (string_to_array(object_name,'/'))[1:array_length(string_to_array(object_name,'/'),1)-1]
    $$;
    grant usage on schema public,auth,storage to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant execute on function public.is_platform_admin() to authenticated;
    grant execute on function public.has_client_membership(uuid) to authenticated;
    grant execute on function public.has_client_access(uuid,uuid,text[]) to authenticated;
    grant select on public.clients,public.client_event_memberships,public.client_invoices,public.client_invoice_items,public.client_credit_notes,public.client_payments,public.client_payment_allocations to authenticated;
    grant update on public.clients to authenticated;
    grant insert,update on public.events to authenticated;
    grant select,insert on storage.objects to authenticated;
    grant execute on function auth.role() to service_role;
  `);
  await database.exec(await readFile(migrationPath,'utf8'));
  return database;
}

test('registration is rate-limited, accounts remain blocked until explicit activation, and billing access survives suspension',async()=>{
  const database=await createFixture();
  try {
    await database.exec('set role service_role');
    await database.query("select set_config('request.role','service_role',false)");
    const subject='a'.repeat(64);
    for(let i=0;i<5;i++) assert.equal((await database.query('select public.consume_client_registration_rate_limit($1) as allowed',[subject])).rows[0].allowed,true);
    assert.equal((await database.query('select public.consume_client_registration_rate_limit($1) as allowed',[subject])).rows[0].allowed,false);
    const request={registration_request_id:'00000000-0000-0000-0000-000000000101',registered_business_name:'New Client Ltd',slug:'new-client',primary_contact_name:'Alex Example',primary_contact_email:'alex@example.test',terms_version:'registration-request-v1',terms_accepted_at:'2026-11-16T10:00:00Z'};
    const submitted=await database.query('select public.submit_client_registration($1::jsonb) as id',[JSON.stringify(request)]);
    const retried=await database.query('select public.submit_client_registration($1::jsonb) as id',[JSON.stringify(request)]);
    assert.equal(retried.rows[0].id,submitted.rows[0].id);
    await database.exec('reset role');
    const submissionId=submitted.rows[0].id;
    const clientId=(await database.query('select client_id from public.client_registration_submissions where id=$1',[submissionId])).rows[0].client_id;
    await database.query("insert into public.client_event_memberships(user_id,client_id,role) values($1,$2,'client_admin')",[clientAdminId,clientId]);
    await database.exec('set role authenticated');
    await database.query("select set_config('request.user_id',$1,false)",[clientAdminId]);
    assert.equal((await database.query('select public.client_billing_is_current($1) as active',[clientId])).rows[0].active,false);
    assert.equal((await database.query("select public.has_client_access($1,null,array['client_admin']) as allowed",[clientId])).rows[0].allowed,false);
    assert.equal((await database.query("select public.has_client_billing_access($1) as allowed",[clientId])).rows[0].allowed,true);
    await assert.rejects(database.query('insert into public.events(client_id) values($1)',[clientId]),/client account is not active/i);
    await database.query("select set_config('request.user_id',$1,false)",[adminId]);
    assert.equal((await database.query("select public.review_client_registration($1,true,'Reviewed') as status",[submissionId])).rows[0].status,'approved');
    assert.equal((await database.query('select account_status from public.clients where id=$1',[clientId])).rows[0].account_status,'pending_payment');
    await assert.rejects(database.query('select public.activate_client_registration($1)',[clientId]),/verified billing active/i);
    await database.exec("update public.clients set billing_status='active' where id='"+clientId+"'");
    assert.equal((await database.query('select public.activate_client_registration($1) as status',[clientId])).rows[0].status,'active');
    assert.equal((await database.query('select account_status from public.clients where id=$1',[clientId])).rows[0].account_status,'active');
    await database.query("select set_config('request.user_id',$1,false)",[clientAdminId]);
    assert.equal((await database.query("select public.has_client_access($1,null,array['client_admin']) as allowed",[clientId])).rows[0].allowed,true);
    await database.query('insert into public.events(client_id) values($1)',[clientId]);
    await database.exec(`update public.clients set account_status='suspended' where id='${activeClientId}'`);
    assert.equal((await database.query('select public.client_billing_is_current($1) as active',[activeClientId])).rows[0].active,false);
    assert.equal((await database.query("select public.has_client_access($1,null,array['client_admin']) as allowed",[activeClientId])).rows[0].allowed,false);
    assert.equal((await database.query('select public.has_client_billing_access($1) as allowed',[activeClientId])).rows[0].allowed,true);
    await assert.rejects(database.query('insert into public.events(client_id) values($1)',[activeClientId]),/client account is not active/i);
  } finally { await database.close(); }
});
