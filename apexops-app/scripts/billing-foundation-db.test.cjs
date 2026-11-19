const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrationPath = path.join(__dirname, '../supabase/platform-billing-foundation-migration.sql');
const userIds = {
  admin:'00000000-0000-0000-0000-000000000020',
  clientAdmin:'00000000-0000-0000-0000-000000000021',
  staff:'00000000-0000-0000-0000-000000000022',
};
const clientIds = {
  existing:'00000000-0000-0000-0000-000000000010',
  event:'00000000-0000-0000-0000-000000000011',
  new:'00000000-0000-0000-0000-000000000030',
};

async function createDatabaseFixture() {
  const database = new PGlite();
  await database.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values
      ('${userIds.admin}'), ('${userIds.clientAdmin}'), ('${userIds.staff}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.user_id', true), '')::uuid
    $$;
    create function public.is_platform_admin() returns boolean language sql stable as $$
      select coalesce(current_setting('request.platform_admin', true), 'false') = 'true'
    $$;
    create table public.clients (
      id uuid primary key,
      name text not null,
      slug text not null unique,
      event_limit integer not null,
      billing_mode text not null,
      billing_status text not null,
      billing_plan text not null,
      paid_through date,
      term_started_at date,
      term_ends_at date,
      committed_events integer not null,
      prepaid_event_credits integer not null,
      trial_started_at date,
      trial_ends_at date
    );
    create table public.client_event_memberships (
      id integer generated always as identity primary key,
      user_id uuid not null,
      client_id uuid not null,
      event_id uuid,
      role text not null
    );
    create table public.events (
      id uuid primary key,
      client_id uuid not null,
      name text not null,
      event_end_date date not null
    );
    create table public.platform_pricing (
      id boolean primary key default true check (id),
      event_tiers jsonb not null,
      volume_plans jsonb not null
    );
    insert into public.platform_pricing values (
      true,
      '[{"id":"small","minLocations":1,"maxLocations":50,"listPrice":15000}]'::jsonb,
      '[{"id":"vol_12","eventsPerYear":12,"discountPct":5}]'::jsonb
    );
    insert into public.clients values (
      '${clientIds.existing}', 'Existing Client', 'existing-client', 4,
      'monthly', 'active', 'vol_12', date '2026-12-31', date '2026-01-01',
      date '2026-12-31', 12, 2, null, null
    );
    insert into public.client_event_memberships (user_id, client_id, event_id, role) values
      ('${userIds.clientAdmin}', '${clientIds.existing}', null, 'client_admin'),
      ('${userIds.staff}', '${clientIds.existing}', '${clientIds.event}', 'staff');
    insert into public.events values
      ('${clientIds.event}', '${clientIds.existing}', 'Recent event', current_date - 5),
      ('00000000-0000-0000-0000-000000000012', '${clientIds.existing}', 'Historical event', current_date - 60);
    create function public.has_client_membership(target_client_id uuid) returns boolean
    language sql stable security definer set search_path = public, pg_temp as $$
      select exists (select 1 from public.client_event_memberships m where m.user_id = auth.uid() and m.client_id = target_client_id)
    $$;
    create function public.has_event_access(target_event_id uuid, allowed_roles text[]) returns boolean
    language sql stable security definer set search_path = public, pg_temp as $$
      select exists (
        select 1 from public.events e join public.client_event_memberships m on m.client_id = e.client_id
        where e.id = target_event_id and m.user_id = auth.uid()
          and (m.event_id is null or m.event_id = e.id) and m.role = any(allowed_roles)
      )
    $$;
    create function public.can_read_test_history(target_event_id uuid) returns boolean
    language sql stable security definer set search_path = public, pg_temp as $$
      select exists (
        select 1 from public.events e join public.client_event_memberships m on m.client_id = e.client_id
        where e.id = target_event_id and m.user_id = auth.uid() and m.role = 'client_admin'
          and current_date <= e.event_end_date + 365
      )
    $$;
    alter table public.clients enable row level security;
    alter table public.client_event_memberships enable row level security;
    alter table public.events enable row level security;
    create policy "existing clients read" on public.clients for select to authenticated
      using (public.is_platform_admin() or public.has_client_membership(id));
    create policy "existing platform admins manage clients" on public.clients for all to authenticated
      using (public.is_platform_admin()) with check (public.is_platform_admin());
    create policy "existing members read memberships" on public.client_event_memberships for select to authenticated
      using (user_id = auth.uid() or public.has_client_membership(client_id));
    create policy "existing active event access" on public.events for select to authenticated
      using (public.has_event_access(id, array['client_admin','event_admin','ops','staff']) and event_end_date >= current_date - 30);
    create policy "existing historical admin access" on public.events for select to authenticated
      using (public.can_read_test_history(id));
    alter table public.platform_pricing enable row level security;
    create policy "existing admins manage pricing" on public.platform_pricing for all to authenticated
      using (public.is_platform_admin()) with check (public.is_platform_admin());
    grant usage on schema public, auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant select on public.clients, public.client_event_memberships, public.events to authenticated;
    grant insert, update on public.clients to authenticated;
    grant select, update on public.platform_pricing to authenticated;
  `);
  return database;
}

async function clientBaseline(database) {
  return (await database.query(`
    select id, name, slug, event_limit, billing_mode, billing_status, billing_plan,
      paid_through, term_started_at, term_ends_at, committed_events,
      prepaid_event_credits, trial_started_at, trial_ends_at
    from public.clients order by id
  `)).rows;
}

async function membershipBaseline(database) {
  return (await database.query(`
    select user_id, client_id, event_id, role from public.client_event_memberships
    order by user_id, client_id, event_id nulls first, role
  `)).rows;
}

async function visibleEvents(database, userId) {
  await database.query("select set_config('request.user_id', $1, false)", [userId]);
  return (await database.query('select name from public.events order by name')).rows.map(row => row.name);
}

test('billing foundation preserves existing client entitlements and access while securing new records', async () => {
  const database = await createDatabaseFixture();
  try {
    const clientsBefore = await clientBaseline(database);
    const membershipsBefore = await membershipBaseline(database);
    const clientAdminEventsBefore = await visibleEvents(database, userIds.clientAdmin);
    const staffEventsBefore = await visibleEvents(database, userIds.staff);
    const pricingBefore = (await database.query('select event_tiers, volume_plans from public.platform_pricing where id = true')).rows[0];
    const migration = await readFile(migrationPath, 'utf8');

    await database.exec(migration);
    await database.exec(migration);

    assert.deepEqual(await clientBaseline(database), clientsBefore);
    assert.deepEqual(await membershipBaseline(database), membershipsBefore);
    assert.deepEqual(await visibleEvents(database, userIds.clientAdmin), clientAdminEventsBefore);
    assert.deepEqual(await visibleEvents(database, userIds.staff), staffEventsBefore);
    assert.deepEqual((await database.query('select event_tiers, volume_plans from public.platform_pricing where id = true')).rows[0], pricingBefore);
    assert.deepEqual((await database.query('select account_status from public.clients where id = $1', [clientIds.existing])).rows, [{ account_status:'active' }]);
    const initialPricingVersion = await database.query("select configuration from public.billing_plan_versions where plan_id = (select id from public.billing_plans where plan_code = 'platform-event-pricing') and version_number = 1");
    assert.deepEqual(initialPricingVersion.rows[0].configuration, {
      event_tiers:pricingBefore.event_tiers,
      volume_plans:pricingBefore.volume_plans,
    });

    await database.exec('set role authenticated');
    await database.query("select set_config('request.user_id', $1, false), set_config('request.platform_admin', $2, false)", [userIds.clientAdmin, 'false']);
    assert.equal((await database.query('select count(*) as count from public.billing_plans')).rows[0].count, 0);
    assert.equal((await database.query('select count(*) as count from public.client_registration_submissions')).rows[0].count, 0);
    await assert.rejects(database.query("insert into public.billing_plans (plan_code, name) values ('forbidden', 'Forbidden')"), /row-level security/);
    await assert.rejects(database.query("insert into public.platform_audit_log (action, entity_type) values ('forbidden', 'test')"), /permission|row-level security/i);

    await database.query("select set_config('request.user_id', $1, false), set_config('request.platform_admin', $2, false)", [userIds.admin, 'true']);
    await database.exec(`
      begin;
      update public.platform_pricing set event_tiers = jsonb_set(event_tiers, '{0,listPrice}', '15500'::jsonb) where id = true;
      update public.platform_pricing set event_tiers = jsonb_set(event_tiers, '{0,listPrice}', '16000'::jsonb) where id = true;
      commit;
    `);
    const pricingVersions = await database.query(`
      select version_number, configuration->'event_tiers'->0->>'listPrice' as price
      from public.billing_plan_versions
      where plan_id = (select id from public.billing_plans where plan_code = 'platform-event-pricing')
      order by version_number
    `);
    assert.deepEqual(pricingVersions.rows.slice(-2), [
      { version_number:2, price:'15500' },
      { version_number:3, price:'16000' },
    ]);
    await database.query(
      "insert into public.clients (id, name, slug, event_limit, billing_mode, billing_status, billing_plan, committed_events, prepaid_event_credits) values ($1, 'New Draft', 'new-draft', 1, 'prepaid', 'pending', 'pay_per_event', 0, 0)",
      [clientIds.new],
    );
    assert.equal((await database.query('select account_status from public.clients where id = $1', [clientIds.new])).rows[0].account_status, 'draft');

    const plan = await database.query("insert into public.billing_plans (plan_code, name, created_by) values ('event-standard', 'Event Standard', $1) returning id, updated_at", [userIds.admin]);
    const planUpdate = await database.query("update public.billing_plans set description = 'Updated description' where id = $1 returning updated_at", [plan.rows[0].id]);
    assert.ok(new Date(planUpdate.rows[0].updated_at) > new Date(plan.rows[0].updated_at));
    const version = await database.query(
      "insert into public.billing_plan_versions (plan_id, version_number, billing_frequency, configuration, created_by) values ($1, 1, 'per_event', '{\"price_cents\":1500000,\"included_events\":1}'::jsonb, $2) returning id",
      [plan.rows[0].id, userIds.admin],
    );
    await database.query("update public.billing_plan_versions set status = 'published', effective_from = current_date where id = $1", [version.rows[0].id]);
    await assert.rejects(database.query("update public.billing_plan_versions set configuration = '{\"price_cents\":1}'::jsonb where id = $1", [version.rows[0].id]), /immutable/i);

    await database.query(
      `insert into public.client_registration_submissions
        (client_id, requested_plan_version_id, registered_business_name, primary_contact_name,
         primary_contact_email, terms_version, terms_accepted_at)
       values ($1, $2, 'New Draft Ltd', 'Primary Contact', 'primary@example.test', 'terms-v1', now())`,
      [clientIds.new, version.rows[0].id],
    );
    await assert.rejects(database.query("update public.client_registration_submissions set primary_contact_email = 'changed@example.test' where client_id = $1", [clientIds.new]), /immutable/i);
    await database.query("update public.client_registration_submissions set status = 'approved', reviewed_at = now(), reviewed_by = $1, review_note = 'Reviewed' where client_id = $2", [userIds.admin, clientIds.new]);
    await assert.rejects(database.query("update public.client_registration_submissions set status = 'submitted' where client_id = $1", [clientIds.new]), /decision is final/i);
    const subscription = await database.query(
      `insert into public.client_subscriptions
        (client_id, plan_version_id, status, billing_mode, billing_frequency, agreement_snapshot, starts_on, agreed_at, created_by)
       values ($1, $2, 'active', 'prepaid', 'per_event', '{\"price_cents\":1500000,\"allowance\":1}'::jsonb, current_date, now(), $3)
       returning updated_at`,
      [clientIds.new, version.rows[0].id, userIds.admin],
    );
    await assert.rejects(database.query("update public.client_subscriptions set agreement_snapshot = '{\"price_cents\":1}'::jsonb where client_id = $1", [clientIds.new]), /immutable/i);
    await assert.rejects(database.query("update public.client_subscriptions set status = 'draft' where client_id = $1", [clientIds.new]), /invalid subscription status transition/i);
    await database.exec('reset role');
    await assert.rejects(database.query('delete from public.client_subscriptions where client_id = $1', [clientIds.new]), /cannot be deleted/i);
    await database.exec('set role authenticated');
    const subscriptionUpdate = await database.query("update public.client_subscriptions set status = 'cancelled', status_reason = 'Test cancellation' where client_id = $1 returning updated_at", [clientIds.new]);
    assert.ok(new Date(subscriptionUpdate.rows[0].updated_at) > new Date(subscription.rows[0].updated_at));
    await assert.rejects(database.query("update public.client_subscriptions set status = 'active' where client_id = $1", [clientIds.new]), /terminal subscription/i);
    await database.query("update public.clients set account_status = 'pending_payment' where id = $1", [clientIds.new]);
    assert.ok((await database.query("select count(*) as count from public.platform_audit_log where client_id = $1", [clientIds.new])).rows[0].count >= 3);
    await assert.rejects(database.query('update public.platform_audit_log set reason = $1', ['tamper']), /permission|row-level security/i);
  } finally {
    await database.close();
  }
});
