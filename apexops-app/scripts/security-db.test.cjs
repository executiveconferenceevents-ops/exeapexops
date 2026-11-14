const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('event codes lock after ten failures and remain scoped to IP and event', async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      create table public.events (id uuid primary key, slug text, exhibitor_code text, is_public boolean);
      create table public.event_code_attempts (event_slug text, client_ip_hash text, window_start timestamptz, attempt_count integer not null default 0, primary key (event_slug, client_ip_hash, window_start));
      insert into public.events values ('00000000-0000-0000-0000-000000000001', 'event-one', 'SECRET-CODE', true), ('00000000-0000-0000-0000-000000000002', 'event-two', 'OTHER-CODE', true);
    `);
    await database.exec(await readFile(path.join(__dirname, '../supabase/event-code-rate-limit-migration.sql'), 'utf8'));
    const setIp = async ip => database.query("select set_config('request.headers', $1, false)", [JSON.stringify(ip ? { 'x-real-ip':ip } : {})]);
    const validate = async (slug, code) => (await database.query('select public.validate_public_event_code($1, $2) as id', [slug, code])).rows[0].id;

    await setIp('192.0.2.1');
    for (let attempt = 0; attempt < 10; attempt += 1) assert.equal(await validate('event-one', 'WRONG'), null);
    assert.equal(await validate('event-one', 'SECRET-CODE'), null);
    assert.equal(await validate('event-two', 'OTHER-CODE'), '00000000-0000-0000-0000-000000000002');
    await setIp('192.0.2.2');
    assert.equal(await validate('event-one', 'SECRET-CODE'), '00000000-0000-0000-0000-000000000001');
    await setIp(null);
    assert.equal(await validate('event-one', 'SECRET-CODE'), null);
    await database.exec('create function public.is_event_operational(uuid) returns boolean language sql as $$ select false $$;');
    await setIp('192.0.2.3');
    assert.equal(await validate('event-one', 'SECRET-CODE'), null);
  } finally {
    await database.close();
  }
});

test('expiry migration preserves rate limiting and closes writes after thirty days', async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      create role authenticated;
      create role anon;
      create schema auth;
      create schema storage;
      create function auth.jwt() returns jsonb language sql as $$ select '{"email":"staff@example.test"}'::jsonb $$;
      create table public.clients (id uuid primary key, name text);
      create table public.events (id uuid primary key, client_id uuid, name text, slug text, exhibitor_code text, is_public boolean, event_start_date date, event_end_date date, build_up_start_date date, build_up_end_date date, breakdown_start_date date, breakdown_end_date date, next_event_name text, logo_url text, billing_exempt boolean not null default false);
      create table public.event_code_attempts (event_slug text, client_ip_hash text, window_start timestamptz, attempt_count integer not null default 0, primary key (event_slug, client_ip_hash, window_start));
      create table public.queries (id text primary key, event_id uuid, assigned_to text, status text);
      create table public.staff (id text, event_id uuid, email text);
      create table public.client_event_memberships (id integer generated always as identity primary key, client_id uuid, event_id uuid, user_id uuid, role text);
      create table public.exhibitors (event_id uuid);
      create table public.rebooking_requests (event_id uuid);
      create table public.ops_notifications (event_id uuid);
      create table storage.objects (bucket_id text, name text);
      create table storage.buckets (id text, public boolean);
      create function public.client_billing_is_current(uuid) returns boolean language sql stable as $$ select coalesce(current_setting('request.billing_active', true), 'true') <> 'false' $$;
      create function public.has_client_access(uuid, uuid, text[]) returns boolean language sql as $$ select true $$;
      create function public.is_platform_admin() returns boolean language sql as $$ select false $$;
      create function public.has_event_access(uuid, text[]) returns boolean language sql stable as $$ select current_setting('request.test_role', true) = any($2) $$;
      alter table public.events enable row level security;
      alter table public.queries enable row level security;
      alter table public.client_event_memberships enable row level security;
      alter table storage.objects enable row level security;
      create policy fixture_read_events on public.events for select to authenticated using (true);
      create policy fixture_read_queries on public.queries for select to authenticated using (true);
      create policy fixture_read_memberships on public.client_event_memberships for select to authenticated using (true);
      create policy "active client admins manage memberships" on public.client_event_memberships for all to authenticated using (true) with check (true);
      create policy fixture_read_objects on storage.objects for select to authenticated using (true);
      create policy fixture_read_anonymous_objects on storage.objects for select to anon using (true);
      create policy fixture_insert_anonymous_objects on storage.objects for insert to anon with check (true);
      grant usage on schema public, auth, storage to authenticated;
      grant usage on schema public, storage to anon;
      grant select, update on public.queries to authenticated;
      grant select, insert on public.events to authenticated;
      grant select on public.staff to authenticated;
      grant select on storage.objects to authenticated;
      grant select on storage.objects to anon;
      grant insert on storage.objects to anon;
      insert into public.clients values ('00000000-0000-0000-0000-000000000010', 'Client');
      insert into public.events (id,client_id,name,slug,exhibitor_code,is_public,event_end_date,breakdown_end_date) values
        ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010','Active','active','ACTIVE',true,current_date - 30,current_date - 30),
        ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010','Expired','expired','EXPIRED',true,current_date - 31,current_date - 31),
        ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000010','Old','old','OLD',true,current_date - 400,current_date - 400);
      insert into public.queries values ('active-query','00000000-0000-0000-0000-000000000011',null,'LOGGED'), ('expired-query','00000000-0000-0000-0000-000000000012',null,'LOGGED'), ('old-query','00000000-0000-0000-0000-000000000013',null,'LOGGED');
      insert into storage.objects values ('query-photos-private','00000000-0000-0000-0000-000000000011/team/a.jpg'), ('query-photos-private','00000000-0000-0000-0000-000000000012/team/b.jpg'), ('query-photos-private','00000000-0000-0000-0000-000000000013/team/c.jpg');
    `);
    await database.exec(await readFile(path.join(__dirname, '../supabase/event-code-rate-limit-migration.sql'), 'utf8'));
    const expiryMigration = await readFile(path.join(__dirname, '../supabase/event-expiration-migration.sql'), 'utf8');
    await database.exec(expiryMigration);
    await database.exec(expiryMigration);
    const checks = await database.query(await readFile(path.join(__dirname, '../supabase/check-migrations.sql'), 'utf8'));
    assert.equal(checks.rows.find(row => row.check_name === 'Event-code lockout validator installed').status, 'OK');
    assert.match(checks.rows.find(row => row.check_name === 'Event-code rate limiting in the deployed environment').status, /^MANUAL REVIEW/);
    assert.equal(checks.rows.find(row => row.check_name === '30-day event expiry and twelve-month archive policies').status, 'OK');
    await database.query("select set_config('request.headers', $1, false)", [JSON.stringify({ 'x-real-ip':'192.0.2.10' })]);
    const active = await database.query("select public.validate_public_event_code('active', 'ACTIVE') as id");
    const expired = await database.query("select public.validate_public_event_code('expired', 'EXPIRED') as id");
    assert.equal(active.rows[0].id, '00000000-0000-0000-0000-000000000011');
    assert.equal(expired.rows[0].id, null);
    await database.exec('set role anon');
    assert.equal((await database.query('select name from storage.objects')).rows.length, 1);
    await assert.rejects(database.exec("insert into storage.objects values ('query-photos-private','00000000-0000-0000-0000-000000000012/new.jpg')"), /row-level security/);
    await database.exec('set role authenticated');
    await database.query("select set_config('request.test_role', $1, false)", ['ops']);
    const activeUpdate = await database.query("update public.queries set status = 'COMPLETED' where id = 'active-query' returning id");
    const expiredUpdate = await database.query("update public.queries set status = 'COMPLETED' where id = 'expired-query' returning id");
    assert.equal(activeUpdate.rows.length, 1);
    assert.equal(expiredUpdate.rows.length, 0);
    assert.deepEqual((await database.query('select id from public.queries order by id')).rows.map(row => row.id), ['active-query']);
    assert.equal((await database.query('select name from storage.objects')).rows.length, 1);
    await database.query("select set_config('request.test_role', $1, false)", ['client_admin']);
    assert.deepEqual((await database.query('select id from public.queries order by id')).rows.map(row => row.id), ['active-query', 'expired-query']);
    assert.equal((await database.query('select name from storage.objects')).rows.length, 2);
    await database.query("select set_config('request.test_role', $1, false)", ['staff']);
    assert.deepEqual((await database.query('select id from public.queries order by id')).rows.map(row => row.id), ['active-query']);
    await database.query("select set_config('request.test_role', $1, false)", ['client_admin']);
    const created = await database.query("insert into public.events (id,client_id,name,slug,exhibitor_code,is_public,event_end_date,breakdown_end_date) values ('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000010','New','new','NEW',true,current_date + 30,current_date + 30) returning id");
    assert.equal(created.rows.length, 1);
    await database.exec("insert into public.client_event_memberships (client_id,event_id,user_id,role) values ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','staff')");
    await assert.rejects(database.exec("insert into public.client_event_memberships (client_id,event_id,user_id,role) values ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000022','staff')"), /row-level security/);
    await database.query("select set_config('request.billing_active', $1, false)", ['false']);
    await assert.rejects(database.exec("insert into public.client_event_memberships (client_id,event_id,user_id,role) values ('00000000-0000-0000-0000-000000000010',null,'00000000-0000-0000-0000-000000000023','client_admin')"), /row-level security/);
    await database.exec("reset role; create or replace function public.validate_public_event_code(requested_slug text, requested_code text) returns uuid language sql as $$ select null::uuid $$;");
    await assert.rejects(database.exec(expiryMigration), /Apply event-code-rate-limit-migration/);
  } finally {
    await database.close();
  }
});

test('staff see only their own work while Operations retains event access', async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.test_user', true), '')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('request.test_email', true)) $$;
      create table public.events (id uuid primary key, client_id uuid);
      create table public.client_event_memberships (user_id uuid, client_id uuid, event_id uuid, role text);
      create table public.staff (id text, event_id uuid, email text);
      create table public.queries (id text primary key, event_id uuid, assigned_to text, status text, completed_at timestamptz, notes text, sla_deadline timestamptz, photo_urls text[]);
      create table public.exhibitors (event_id uuid, stand text);
      alter table public.queries add column stand text;
      create table public.suppliers (id text, client_id uuid);
      create function public.is_platform_admin() returns boolean language sql stable as $$ select false $$;
      create function public.has_event_access(target_event uuid, allowed_roles text[]) returns boolean language sql stable security definer as $$
        select exists (select 1 from public.client_event_memberships membership where membership.user_id = auth.uid() and membership.event_id = target_event and membership.role = any(allowed_roles))
      $$;
      alter table public.staff enable row level security;
      alter table public.queries enable row level security;
      alter table public.exhibitors enable row level security;
      alter table public.suppliers enable row level security;
      create policy "event members read exhibitors" on public.exhibitors for select to authenticated using (true);
      create policy "client members read suppliers" on public.suppliers for select to authenticated using (true);
      grant usage on schema public, auth to authenticated;
      grant select on public.staff, public.queries, public.exhibitors, public.suppliers, public.client_event_memberships to authenticated;
      insert into public.events values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010');
      insert into public.client_event_memberships values
        ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011','staff'),
        ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011','ops');
      insert into public.staff values ('staff-one','00000000-0000-0000-0000-000000000011','staff@example.test'), ('staff-two','00000000-0000-0000-0000-000000000011','other@example.test');
      insert into public.queries (id,event_id,assigned_to,status,stand) values ('own','00000000-0000-0000-0000-000000000011','staff-one','LOGGED','A01'), ('other','00000000-0000-0000-0000-000000000011','staff-two','LOGGED','A02');
      insert into public.exhibitors values ('00000000-0000-0000-0000-000000000011','A01'), ('00000000-0000-0000-0000-000000000011','A02');
      insert into public.suppliers values ('supplier-one','00000000-0000-0000-0000-000000000010');
    `);
    const staffMigration = await readFile(path.join(__dirname, '../supabase/staff-queue-security-migration.sql'), 'utf8');
    await database.exec(staffMigration);
    await database.exec(staffMigration);
    await database.exec('set role authenticated');
    await database.query("select set_config('request.test_user', $1, false), set_config('request.test_email', $2, false)", ['00000000-0000-0000-0000-000000000021', 'staff@example.test']);
    assert.deepEqual((await database.query('select id from public.queries order by id')).rows.map(row => row.id), ['own']);
    assert.deepEqual((await database.query('select id from public.staff order by id')).rows.map(row => row.id), ['staff-one']);
    assert.deepEqual((await database.query('select stand from public.exhibitors order by stand')).rows.map(row => row.stand), ['A01']);
    assert.equal((await database.query('select * from public.suppliers')).rows.length, 0);
    assert.equal((await database.query("update public.queries set status = 'COMPLETED' where id = 'own' returning id")).rows.length, 1);
    assert.equal((await database.query("update public.queries set status = 'COMPLETED' where id = 'other' returning id")).rows.length, 0);

    await database.query("select set_config('request.test_user', $1, false), set_config('request.test_email', $2, false)", ['00000000-0000-0000-0000-000000000022', 'ops@example.test']);
    assert.equal((await database.query('select * from public.queries')).rows.length, 2);
    assert.equal((await database.query('select * from public.exhibitors')).rows.length, 2);
    assert.equal((await database.query('select * from public.suppliers')).rows.length, 1);
  } finally {
    await database.close();
  }
});

test('billing requires active paid terms and consumes explicitly approved overage credits', async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      create role authenticated;
      create table public.clients (id uuid primary key);
      create table public.events (id uuid primary key, client_id uuid, created_at timestamptz default now());
      create table public.client_event_memberships (client_id uuid, event_id uuid, role text);
      create table public.suppliers (client_id uuid);
      create function public.is_platform_admin() returns boolean language sql stable as $$ select false $$;
      create function public.has_client_access(uuid, uuid, text[]) returns boolean language sql stable as $$ select true $$;
      insert into public.clients values ('00000000-0000-0000-0000-000000000010');
    `);
    const migration = await readFile(path.join(__dirname, '../supabase/client-billing-access-migration.sql'), 'utf8');
    await database.exec(migration);
    await database.exec(migration);
    await database.exec(`
      update public.clients set billing_mode='monthly', billing_plan='vol_12', billing_status='active',
        paid_through=current_date + 30, term_started_at=current_date + 1, term_ends_at=current_date + 365,
        committed_events=1, prepaid_event_credits=0;
    `);
    assert.equal((await database.query("select public.client_billing_is_current('00000000-0000-0000-0000-000000000010') as current")).rows[0].current, false);
    await database.exec('update public.clients set term_started_at=current_date');
    await database.exec("insert into public.events (id,client_id) values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010')");
    await assert.rejects(database.exec("insert into public.events (id,client_id) values ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010')"));
    await database.exec('update public.clients set prepaid_event_credits=1');
    await database.exec("insert into public.events (id,client_id) values ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010')");
    assert.equal((await database.query('select prepaid_event_credits from public.clients')).rows[0].prepaid_event_credits, 0);
    await assert.rejects(database.exec("insert into public.events (id,client_id) values ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000010')"));
    await database.exec('update public.clients set term_started_at=current_date + 1, prepaid_event_credits=7');
    assert.equal((await database.query('select prepaid_event_credits from public.clients')).rows[0].prepaid_event_credits, 0);
  } finally {
    await database.close();
  }
});

test('30-day trials expire and internal event exemptions are platform-admin-only and non-quota', async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      create role authenticated;
      create table public.clients (id uuid primary key);
      create table public.events (id uuid primary key, client_id uuid, created_at timestamptz default now(), event_end_date date, breakdown_end_date date);
      create table public.client_event_memberships (client_id uuid, event_id uuid, role text);
      create table public.suppliers (client_id uuid);
      insert into public.clients values ('00000000-0000-0000-0000-000000000010');
      create function public.is_platform_admin() returns boolean language sql stable as $$ select coalesce(current_setting('request.platform_admin', true), 'false') = 'true' $$;
      create function public.has_client_access(uuid, uuid, text[]) returns boolean language sql stable as $$ select true $$;
    `);
    await database.exec(await readFile(path.join(__dirname, '../supabase/client-event-limits-migration.sql'), 'utf8'));
    await database.exec(await readFile(path.join(__dirname, '../supabase/client-billing-access-migration.sql'), 'utf8'));
    await database.exec('grant select (id, client_id, created_at, event_end_date, breakdown_end_date) on public.events to authenticated');
    const migration = await readFile(path.join(__dirname, '../supabase/client-trials-event-exemptions-migration.sql'), 'utf8');
    await database.exec(migration);
    await database.exec(migration);
    assert.equal((await database.query("select has_column_privilege('authenticated', 'public.events', 'billing_exempt', 'SELECT') as allowed")).rows[0].allowed, true);

    await database.exec("update public.clients set billing_mode='trial', billing_status='active', trial_started_at=current_date, trial_ends_at=current_date + 30");
    await database.exec('update public.clients set event_limit=2');
    assert.equal((await database.query("select public.client_billing_is_current('00000000-0000-0000-0000-000000000010') as current")).rows[0].current, true);
    await database.exec("insert into public.events (id,client_id,event_end_date,breakdown_end_date) values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010',current_date,current_date)");

    await database.exec('update public.clients set trial_started_at=current_date - 30, trial_ends_at=current_date');
    assert.equal((await database.query("select public.client_billing_is_current('00000000-0000-0000-0000-000000000010') as current")).rows[0].current, false);
    await assert.rejects(database.exec("insert into public.events (id,client_id,event_end_date,breakdown_end_date) values ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010',current_date,current_date)"), /trial has ended/i);
    await assert.rejects(database.exec("insert into public.events (id,client_id,event_end_date,breakdown_end_date,billing_exempt) values ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010',current_date,current_date,true)"), /only a platform administrator/i);

    await database.query("select set_config('request.platform_admin', $1, false)", ['true']);
    await database.exec("insert into public.events (id,client_id,event_end_date,breakdown_end_date,billing_exempt) values ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000010',current_date,current_date,true)");
    assert.equal((await database.query("select public.is_event_operational('00000000-0000-0000-0000-000000000013') as operational")).rows[0].operational, true);
    await database.query("select set_config('request.platform_admin', $1, false)", ['false']);
    await assert.rejects(database.exec("update public.events set billing_exempt=false where id='00000000-0000-0000-0000-000000000013'"), /only a platform administrator/i);

    await database.exec("update public.clients set billing_mode='unmanaged', billing_status='active', event_limit=2");
    await database.exec("insert into public.events (id,client_id,event_end_date,breakdown_end_date) values ('00000000-0000-0000-0000-000000000014','00000000-0000-0000-0000-000000000010',current_date,current_date)");
    await assert.rejects(database.exec("insert into public.events (id,client_id,event_end_date,breakdown_end_date) values ('00000000-0000-0000-0000-000000000015','00000000-0000-0000-0000-000000000010',current_date,current_date)"), /reached its limit/i);
  } finally {
    await database.close();
  }
});

test('event limits preserve existing event counts and enforce new caps', async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      create table public.clients (id uuid primary key);
      create table public.events (id uuid primary key, client_id uuid);
      insert into public.clients values ('00000000-0000-0000-0000-000000000010');
      insert into public.events values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010'), ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010');
    `);
    const migration = await readFile(path.join(__dirname, '../supabase/client-event-limits-migration.sql'), 'utf8');
    await database.exec(migration);
    assert.equal((await database.query('select event_limit from public.clients')).rows[0].event_limit, 2);
    await assert.rejects(database.exec("insert into public.events values ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000010')"));
    await database.exec('update public.clients set event_limit=3');
    await database.exec("insert into public.events values ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000010')");
    await database.exec(migration);
    assert.equal((await database.query('select event_limit from public.clients')).rows[0].event_limit, 3);
  } finally {
    await database.close();
  }
});