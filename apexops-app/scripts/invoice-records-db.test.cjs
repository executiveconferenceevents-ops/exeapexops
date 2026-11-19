const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migrationPath = path.join(__dirname, '../supabase/platform-invoice-records-migration.sql');
const adminId = '00000000-0000-0000-0000-000000000001';
const nonAdminId = '00000000-0000-0000-0000-000000000002';
const clientId = '00000000-0000-0000-0000-000000000010';

async function createFixture() {
  const database = new PGlite();
  await database.exec(`
    create role authenticated;
    create role anon;
    create role service_role;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${adminId}'), ('${nonAdminId}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.user_id', true), '')::uuid
    $$;
    create function public.is_platform_admin() returns boolean language sql stable as $$
      select coalesce(current_setting('request.platform_admin', true), 'false') = 'true'
    $$;
    create table public.clients (id uuid primary key, name text not null);
    insert into public.clients values ('${clientId}', 'Fixture Client');
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
    grant execute on function auth.uid() to authenticated;
  `);
  return database;
}

test('invoice records are admin-only, immutable after issue, auditable, and calculate configured tax', async () => {
  const database = await createFixture();
  try {
    const migration = await readFile(migrationPath, 'utf8');
    await database.exec(migration);
    await database.exec(migration);

    await database.exec('set role authenticated');
    await database.query("select set_config('request.user_id', $1, false), set_config('request.platform_admin', 'false', false)", [nonAdminId]);
    assert.equal((await database.query('select count(*) as count from public.client_invoices')).rows[0].count, 0);
    assert.equal((await database.query('select count(*) as count from public.client_invoice_items')).rows[0].count, 0);
    await assert.rejects(database.query("insert into public.client_invoices (client_id,billed_to_name) values ($1,'Blocked')", [clientId]), /row-level security|permission/i);
    await assert.rejects(database.query("select public.create_client_invoice('{}'::jsonb)"), /platform administrator/i);
    await assert.rejects(database.query("select public.create_client_credit_note($1,'{}'::jsonb)",[clientId]),/platform administrator/i);

    await database.query("select set_config('request.user_id', $1, false), set_config('request.platform_admin', 'true', false)", [adminId]);
    await database.exec("update public.platform_invoice_tax_settings set is_registered=true,tax_label='VAT',tax_rate_basis_points=1500 where id=true");
    await database.exec('reset role');
    const taxAudit = await database.query("select previous_values,new_values from public.platform_audit_log where action='invoice.tax_settings_changed'");
    assert.deepEqual(taxAudit.rows[0].previous_values, { is_registered:false, tax_label:'Tax', tax_rate_basis_points:0, currency:'ZAR' });
    assert.deepEqual(taxAudit.rows[0].new_values, { is_registered:true, tax_label:'VAT', tax_rate_basis_points:1500, currency:'ZAR' });
    await database.exec('set role authenticated');
    const request = {
      client_id:clientId,
      billed_to_name:'Fixture Client',
      billed_to_email:'billing@example.test',
      invoice_date:'2026-11-15',
      due_date:'2026-11-30',
      description:'Test event invoice',
      invoice_discount_cents:1000,
      items:[
        { description:'Venue operations', quantity:2, unit_price_cents:10000, discount_cents:1000 },
        { description:'On-site support', quantity:1, unit_price_cents:20000 },
      ],
    };
    const first = await database.query('select public.create_client_invoice($1::jsonb) as id', [JSON.stringify(request)]);
    const invoiceId = first.rows[0].id;
    const invoice = await database.query(`
      select invoice_number,status,subtotal_cents,line_discount_cents,invoice_discount_cents,
        tax_label,tax_rate_basis_points,tax_cents,total_cents,updated_at
      from public.client_invoices where id = $1
    `, [invoiceId]);
    const firstInvoice = invoice.rows[0];
    assert.equal(firstInvoice.invoice_number, 'ECE-2026-000001');
    assert.equal(firstInvoice.status, 'draft');
    assert.equal(Number(firstInvoice.subtotal_cents), 40000);
    assert.equal(Number(firstInvoice.line_discount_cents), 1000);
    assert.equal(Number(firstInvoice.invoice_discount_cents), 1000);
    assert.equal(Number(firstInvoice.tax_rate_basis_points), 1500);
    assert.equal(firstInvoice.tax_label, 'VAT');
    assert.equal(Number(firstInvoice.tax_cents), 5700);
    assert.equal(Number(firstInvoice.total_cents), 43700);

    const updatedRequest={...request,description:'Revised draft',invoice_discount_cents:500,items:[{description:'Revised venue operations',quantity:1,unit_price_cents:20000}]};
    await database.query('select public.update_client_invoice_draft($1,$2::jsonb)',[invoiceId,JSON.stringify(updatedRequest)]);
    const revised=await database.query('select invoice_number,description,subtotal_cents,tax_cents,total_cents from public.client_invoices where id=$1',[invoiceId]);
    assert.equal(revised.rows[0].invoice_number,'ECE-2026-000001');
    assert.equal(revised.rows[0].description,'Revised draft');
    assert.equal(Number(revised.rows[0].subtotal_cents),20000);
    assert.equal(Number(revised.rows[0].tax_cents),2925);
    assert.equal(Number(revised.rows[0].total_cents),22425);

    const second = await database.query('select public.create_client_invoice($1::jsonb) as id', [JSON.stringify({ ...request, invoice_discount_cents:0 })]);
    assert.equal((await database.query('select invoice_number from public.client_invoices where id = $1', [second.rows[0].id])).rows[0].invoice_number, 'ECE-2026-000002');
    const firstItem=(await database.query('select id from public.client_invoice_items where invoice_id=$1 limit 1',[invoiceId])).rows[0];
    await assert.rejects(database.query('update public.client_invoice_items set invoice_id=$1 where id=$2',[second.rows[0].id,firstItem.id]),/cannot be moved between invoices/i);

    const issued = await database.query('select public.issue_client_invoice($1) as status', [invoiceId]);
    assert.equal(issued.rows[0].status, 'issued');
    await assert.rejects(database.query("update public.client_invoices set status='paid' where id=$1",[invoiceId]),/Invalid invoice status transition/i);
    const firstCredit=await database.query("select public.create_client_credit_note($1,$2::jsonb) as id",[invoiceId,JSON.stringify({amount_cents:7000,reason:'Partial service adjustment'})]);
    assert.equal((await database.query('select status from public.client_invoices where id=$1',[invoiceId])).rows[0].status,'partially_credited');
    assert.equal((await database.query('select credit_note_number from public.client_credit_notes where id=$1',[firstCredit.rows[0].id])).rows[0].credit_note_number,'CN-ECE-2026-000001');
    await assert.rejects(database.query("select public.create_client_credit_note($1,$2::jsonb)",[invoiceId,JSON.stringify({amount_cents:15426,reason:'Over remaining value'})]),/exceeds the remaining invoice value/i);
    const finalCredit=await database.query("select public.create_client_credit_note($1,$2::jsonb) as id",[invoiceId,JSON.stringify({amount_cents:15425,reason:'Final adjustment'})]);
    assert.equal((await database.query('select status from public.client_invoices where id=$1',[invoiceId])).rows[0].status,'credited');
    assert.equal((await database.query('select credit_note_number from public.client_credit_notes where id=$1',[finalCredit.rows[0].id])).rows[0].credit_note_number,'CN-ECE-2026-000002');
    await assert.rejects(database.query("update public.client_invoice_items set unit_price_cents = 1 where invoice_id = $1", [invoiceId]), /immutable/i);
    await assert.rejects(database.query("update public.client_invoices set description = 'Changed after issue' where id = $1", [invoiceId]), /immutable/i);
    await assert.rejects(database.query('select public.update_client_invoice_draft($1,$2::jsonb)',[invoiceId,JSON.stringify(request)]),/Only draft invoices can be edited/i);
    await assert.rejects(database.query('delete from public.client_invoices where id = $1', [invoiceId]), /permission/i);

    await database.exec('reset role');
    const audit = await database.query("select action from public.platform_audit_log where client_id = $1 order by id", [clientId]);
    assert.ok(audit.rows.some(row => row.action === 'invoice.draft_created'));
    assert.ok(audit.rows.some(row => row.action === 'invoice.item_added'));
    assert.ok(audit.rows.some(row => row.action === 'invoice.item_removed'));
    assert.ok(audit.rows.some(row => row.action === 'invoice.changed'));
    assert.equal((await database.query('select count(*) as count from public.invoice_number_counters')).rows[0].count, 1);
  } finally {
    await database.close();
  }
});
