import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getAvailableEvents } from '../lib/eventScope';
import ClientEventAdmin from './ClientEventAdmin';
import { downloadInvoicePdf } from '../lib/invoicePdf';
import { uploadPublicImage } from '../lib/mock';
import ClientBillingWorkspace from '../components/ClientBillingWorkspace';
import { getDemoCollection, setDemoCollection } from '../lib/demoStore';

const sampleClient = {
  id:'client-1', name:'Northstar Events', slug:'northstar-events', event_limit:4,
  billing_mode:'monthly', billing_status:'active', billing_plan:'vol_12',
  committed_events:12, prepaid_event_credits:1, paid_through:'2027-01-01',
  term_started_at:'2026-01-01', term_ends_at:'2027-01-01',
};
const sampleMembership = {
  user_id:'user-12345678', client_id:'client-1', event_id:null, role:'client_admin',
};
jest.mock('../lib/supabase', () => ({ supabase:null }));
jest.mock('../lib/invoicePdf', () => ({ downloadInvoicePdf:jest.fn() }));
jest.mock('../lib/demoStore', () => {
  const collections = new Map();
  const defaults = {
    clients:[{ id:'client-1', name:'Northstar Events', slug:'northstar-events', event_limit:4, billing_mode:'monthly', billing_status:'active', billing_plan:'vol_12', committed_events:12, prepaid_event_credits:1, paid_through:'2027-01-01', term_started_at:'2026-01-01', term_ends_at:'2027-01-01' }],
    memberships:[{ id:'membership-1', user_id:'user-12345678', client_id:'client-1', event_id:'event-1', role:'staff' }],
    events:[{ id:'event-1', client_id:'client-1', name:'Northstar Expo', slug:'northstar-expo', event_start_date:'2099-06-10', event_end_date:'2099-06-12', billing_exempt:false },{ id:'event-2', client_id:'client-1', name:'Internal Review', slug:'internal-review', event_start_date:'2099-06-01', event_end_date:'2099-06-01', billing_exempt:true }],
  };
  return {
    DEMO_MODE:true,
    getDemoCollection:(name, initial=[])=>{
      if (!collections.has(name)) collections.set(name, defaults[name] || initial);
      return collections.get(name);
    },
    setDemoCollection:(name,rows)=>{collections.set(name,rows);return rows;},
  };
});
jest.mock('../lib/mock', () => ({
  getSuppliers:jest.fn().mockResolvedValue([]),
  removeSupplier:jest.fn(),
  upsertSuppliers:jest.fn(),
  uploadPublicImage:jest.fn(),
}));
jest.mock('../lib/offline', () => ({ enqueue:jest.fn(), isNetworkError:jest.fn(() => false) }));

function clickButton(container, label) {
  const button=[...container.querySelectorAll('button')].find(item=>item.textContent.includes(label));
  if (!button) throw new Error(`Button not found: ${label}`);
  button.click();
}

function setInputValue(input, value) {
  const setter=Object.getOwnPropertyDescriptor(input.constructor.prototype,'value').set;
  setter.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
}

test('Platform Owner console exposes grouped navigation and data-backed detail views', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const originalConfirm=window.confirm;
  window.confirm=jest.fn(()=>true);
  expect(await getAvailableEvents()).toHaveLength(2);
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);

  await act(async()=>{root.render(<ClientEventAdmin onEventCreated={jest.fn()} />);});
  await act(async()=>{await Promise.resolve();await Promise.resolve();});
  expect(container.querySelectorAll('.adm-nav-group')).toHaveLength(3);
  expect(container.textContent).toContain('PLATFORM OWNER');
  expect(container.textContent).toContain('Client organisations');
  expect(container.textContent).toContain('Internal Review');

  await act(async()=>{clickButton(container,'Invoices');});
  expect(container.textContent).toContain('New invoice');
  const taxPanel=container.querySelector('.adm-tax-settings');
  await act(async()=>{taxPanel.querySelector('summary').click();});
  const taxRegistered=taxPanel.querySelector('input[type="checkbox"]');
  await act(async()=>{taxRegistered.checked=true;taxRegistered.dispatchEvent(new Event('change',{bubbles:true}));});
  setInputValue(taxPanel.querySelector('input[maxlength="40"]'),'VAT');
  setInputValue(taxPanel.querySelector('input[type="number"]'),'15');
  await act(async()=>{clickButton(taxPanel,'Save tax settings');});
  expect(container.textContent).toContain('Invoice tax settings saved.');
  await act(async()=>{clickButton(container,'New invoice');});
  expect(container.textContent).toContain('New invoice draft');
  expect(container.textContent).toContain('Line items');
  expect(container.textContent).not.toContain('R45,000');
  const invoiceForm=container.querySelector('.adm-invoice-form');
  setInputValue(invoiceForm.querySelector('[aria-label="Billed-to name"]'),'Northstar Events');
  setInputValue(invoiceForm.querySelector('[aria-label="Line 1 description"]'),'Conference operations');
  setInputValue(invoiceForm.querySelector('[aria-label="Line 1 unit price cents"]'),'10000');
  await act(async()=>{clickButton(container,'Save draft');});
  expect(container.textContent).toContain('DEMO-2026-000001');
  expect(container.textContent).toContain('Invoice draft created.');
  expect(container.textContent).toContain('VAT');
  await act(async()=>{clickButton(container,'Edit');});
  const editForm=container.querySelector('.adm-invoice-form');
  setInputValue(editForm.querySelector('[aria-label="Invoice description"]'),'Revised conference invoice');
  await act(async()=>{clickButton(container,'Save draft');});
  expect(container.textContent).toContain('Invoice draft updated.');
  expect(container.textContent).toContain('Revised conference invoice');
  await act(async()=>{clickButton(container,'Issue');});
  expect(container.textContent).toContain('Invoice issued and locked.');
  expect(container.textContent).toContain('issued');
  await act(async()=>{clickButton(container,'Download PDF');});
  expect(downloadInvoicePdf).toHaveBeenCalledWith(
    expect.objectContaining({ invoice_number:'DEMO-2026-000001', status:'issued' }),
    expect.arrayContaining([expect.objectContaining({ description:'Conference operations' })]),
  );
  await act(async()=>{clickButton(container,'New credit note');});
  const creditForm=container.querySelector('.adm-credit-note-form');
  setInputValue(creditForm.querySelector('[aria-label="Credit amount cents"]'),'5000');
  setInputValue(creditForm.querySelector('[aria-label="Credit note reason"]'),'Service adjustment');
  await act(async()=>{clickButton(container,'Issue credit note');});
  expect(container.textContent).toContain('Credit note issued and recorded');
  expect(container.textContent).toContain('CN-DEMO-2026-000001');
  expect(container.textContent).toContain('partially_credited');

  await act(async()=>{clickButton(container,'Payments & EFT verification');});
  expect(container.textContent).toContain('Record received payment');
  const paymentForm=container.querySelector('.adm-payment-form');
  const paymentInvoice=paymentForm.querySelector('select');
  await act(async()=>{paymentInvoice.value=paymentInvoice.options[1].value;paymentInvoice.dispatchEvent(new Event('change',{bubbles:true}));});
  const originalCrypto=window.crypto;
  Object.defineProperty(window,'crypto',{configurable:true,value:{getRandomValues:bytes=>{bytes.fill(1);return bytes;}}});
  setInputValue(paymentForm.querySelector('[aria-label="Payment amount cents"]'),'5000');
  setInputValue(paymentForm.querySelector('input[type="date"]'),'2026-11-15');
  setInputValue(paymentForm.querySelector('input[maxlength="160"]'),'BANK-001');
  await act(async()=>{clickButton(paymentForm,'Record payment');});
  Object.defineProperty(window,'crypto',{configurable:true,value:originalCrypto});
  expect(container.textContent).toContain('BANK-001');
  expect(container.textContent).toContain('settled');
  expect(container.textContent).toContain('Payment recorded and allocated');

  const originalAuditEntries=getDemoCollection('audit_log',[]);
  setDemoCollection('audit_log',[{
    id:1,actor_user_id:'user-12345678',client_id:'client-1',action:'invoice_issued',entity_type:'client_invoices',
    entity_id:'invoice-12345678',reason:'Approved invoice',created_at:'2026-11-17T10:00:00Z',
    clients:{name:'Northstar Events'},previous_values:{private_value:'do not display'},
  }]);
  await act(async()=>{clickButton(container,'Activity & audit logs');});
  expect(container.textContent).toContain('invoice_issued');
  expect(container.textContent).toContain('Northstar Events');
  expect(container.textContent).toContain('Approved invoice');
  expect(container.textContent).not.toContain('do not display');
  setDemoCollection('audit_log',originalAuditEntries);

  await act(async()=>{clickButton(container,'Clients & organisations');});
  expect(container.textContent).toContain('Northstar Events');
  expect(container.textContent).toContain('4');
  const clientActivityTab=[...container.querySelectorAll('.adm-detail-tabs button')].find(button=>button.textContent==='Activity');
  await act(async()=>{clientActivityTab.click();});
  expect(container.textContent).toContain('invoice_issued');
  expect(container.textContent).not.toContain('do not display');
  await act(async()=>{clickButton(container,'Users & access');});
  expect(container.textContent).toContain('user-123…');
  const roleSelect=container.querySelector('select[aria-label="Role for user-12345678"]');
  await act(async()=>{roleSelect.value='ops';roleSelect.dispatchEvent(new Event('change',{bubbles:true}));});
  await act(async()=>{clickButton(container,'Save role');});
  expect(container.textContent).toContain('User role updated.');
  await act(async()=>{clickButton(container,'Revoke');});
  expect(container.textContent).toContain('Membership access revoked. The user account remains intact.');

  await act(async()=>{root.unmount();});
  container.remove();
  window.confirm=originalConfirm;
});

test('Client billing submits private EFT proof into pending review', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const originalCrypto=window.crypto;
  Object.defineProperty(window,'crypto',{configurable:true,value:{getRandomValues:bytes=>{bytes.fill(2);return bytes;}}});
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  const invoice={id:'invoice-client-1',invoice_number:'ECE-2026-000001',client_id:'client-1',status:'issued',currency:'ZAR',invoice_date:'2026-11-15',due_date:'2026-11-30',billed_to_name:'Northstar Events',total_cents:12000};
  setDemoCollection('invoice_items',[{id:'invoice-line-1',invoice_id:invoice.id,line_number:1,description:'Event operations',quantity:1,unit_price_cents:12000,discount_cents:0,line_total_cents:12000}]);
  try {
    await act(async()=>{root.render(<ClientBillingWorkspace clientId="client-1" invoices={[invoice]} onRefresh={jest.fn()}/>);});
    await act(async()=>{await Promise.resolve();});
    await act(async()=>{clickButton(container,'Download PDF');});
    expect(downloadInvoicePdf).toHaveBeenCalledWith(invoice,expect.arrayContaining([expect.objectContaining({description:'Event operations'})]));
    const form=container.querySelector('.adm-payment-form');
    const invoiceSelect=form.querySelector('select');
    await act(async()=>{invoiceSelect.value='invoice-client-1';invoiceSelect.dispatchEvent(new Event('change',{bubbles:true}));});
    setInputValue(form.querySelector('[aria-label="EFT amount paid cents"]'),'12000');
    setInputValue(form.querySelector('input[type="date"]'),'2026-11-15');
    setInputValue(form.querySelector('input[maxlength="160"]'),'BANK-EFT-01');
    const proofInput=form.querySelector('input[type="file"]');
    Object.defineProperty(proofInput,'files',{configurable:true,value:[new File(['proof'],'bank-proof.pdf',{type:'application/pdf'})]});
    await act(async()=>{proofInput.dispatchEvent(new Event('change',{bubbles:true}));});
    await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    expect(container.textContent).toContain('EFT proof submitted securely');
    expect(container.textContent).toContain('pending review');
    expect(getDemoCollection('payments',[]).some(payment=>payment.reference==='BANK-EFT-01'&&payment.status==='pending_review')).toBe(true);
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
    Object.defineProperty(window,'crypto',{configurable:true,value:originalCrypto});
  }
});

test('client administrators can add private suppliers in their workspace', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const previousClients=getDemoCollection('clients',[]);
  const previousMemberships=getDemoCollection('memberships',[]);
  const previousEvents=getDemoCollection('events',[]);
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    setDemoCollection('clients',[sampleClient]);
    setDemoCollection('memberships',[sampleMembership]);
    setDemoCollection('events',[]);
    await act(async()=>{root.render(<ClientEventAdmin clientWorkspaceOnly currentUserId={sampleMembership.user_id}/>);});
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    await act(async()=>{clickButton(container,'Suppliers');});

    expect(container.textContent).toContain('Add a private supplier');
    expect(container.textContent).not.toContain('Supplier changes are read-only');
    const addSupplierButton=[...container.querySelectorAll('button')].find(button=>button.textContent.includes('Add supplier'));
    expect(addSupplierButton).toBeTruthy();
    expect(addSupplierButton.disabled).toBe(false);
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
    setDemoCollection('clients',previousClients);
    setDemoCollection('memberships',previousMemberships);
    setDemoCollection('events',previousEvents);
  }
});

test('creates a demo event with its selected logo', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const originalCrypto=window.crypto;
  Object.defineProperty(window,'crypto',{configurable:true,value:{randomUUID:()=> 'demo-event-uuid'}});
  const previousEvents=getDemoCollection('events',[]);
  setDemoCollection('events',[]);
  uploadPublicImage.mockResolvedValueOnce('https://assets.example.test/demo-event-logo.png');
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<ClientEventAdmin onEventCreated={jest.fn()}/>);});
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    await act(async()=>{clickButton(container,'Events');});
    await act(async()=>{clickButton(container,'New event');});

    const form=[...container.querySelectorAll('form.tenant-inline-form')].find(item=>item.querySelector('h3')?.textContent==='Create event');
    const field=label=>[...form.querySelectorAll('label')].find(item=>item.textContent.trim().startsWith(label)).querySelector('input');
    await act(async()=>{
      setInputValue(field('Event name'),'Demo Event');
      setInputValue(field('URL slug'),'demo-event');
    });
    const dates={
      'Event start date':'2027-03-01',
      'Event end date':'2027-03-02',
      'Build-up start':'2027-02-28',
      'Build-up end':'2027-02-28',
      'Breakdown start':'2027-03-03',
      'Breakdown end':'2027-03-03',
    };
    await act(async()=>{Object.entries(dates).forEach(([label,value])=>setInputValue(field(label),value));});
    const logo=new File(['logo'],'demo-logo.png',{type:'image/png'});
    const logoInput=form.querySelector('input[type="file"]');
    Object.defineProperty(logoInput,'files',{configurable:true,value:[logo]});
    await act(async()=>{logoInput.dispatchEvent(new Event('change',{bubbles:true}));});
    await act(async()=>{form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});

    expect(uploadPublicImage).toHaveBeenCalledWith('event-logos','logo',logo,'demo-event');
    expect(getDemoCollection('events',[])).toEqual(expect.arrayContaining([
      expect.objectContaining({name:'Demo Event',slug:'demo-event',logo_url:'https://assets.example.test/demo-event-logo.png'}),
    ]));
    expect(container.textContent).toContain('Event created.');
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
    setDemoCollection('events',previousEvents);
    Object.defineProperty(window,'crypto',{configurable:true,value:originalCrypto});
  }
});

test('Platform Owner finance summaries use ledger statuses and keep currencies separate', async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const originalInvoices=getDemoCollection('invoices',[]);
  const originalPayments=getDemoCollection('payments',[]);
  setDemoCollection('invoices',[
    {id:'issued-zar',client_id:'client-1',status:'issued',total_cents:10000,currency:'ZAR'},
    {id:'draft-usd',client_id:'client-1',status:'draft',total_cents:9000,currency:'USD'},
  ]);
  setDemoCollection('payments',[
    {id:'settled-zar',client_id:'client-1',payment_method:'payfast',status:'settled',amount_cents:10000,currency:'ZAR'},
    {id:'pending-zar',client_id:'client-1',payment_method:'eft',status:'pending_review',amount_cents:2500,currency:'ZAR'},
    {id:'settled-usd',client_id:'client-1',payment_method:'eft',status:'settled',amount_cents:5000,currency:'USD'},
    {id:'rejected-usd',client_id:'client-1',payment_method:'eft',status:'rejected',amount_cents:8000,currency:'USD'},
  ]);
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<ClientEventAdmin onEventCreated={jest.fn()}/>);});
    await act(async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();});
    expect(container.textContent).toContain('Settled payments · ZAR (1)');
    expect(container.textContent).toContain('EFT awaiting review · ZAR (1)');
    expect(container.textContent).toContain('Settled payments · USD (1)');
    expect(container.textContent).not.toContain('rejected-usd');
    await act(async()=>{clickButton(container,'Revenue & reports');});
    expect(container.textContent).toContain('Collection summary · not accounting revenue');
    expect(container.textContent).toContain('Non-draft invoices');
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
    setDemoCollection('invoices',originalInvoices);
    setDemoCollection('payments',originalPayments);
  }
});

test('Platform Owner reviews a registration, verifies billing, then explicitly activates and invites', async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const originalPrompt=window.prompt;
  window.prompt=jest.fn(()=> 'Application details verified');
  setDemoCollection('clients',[{...sampleClient,account_status:'awaiting_approval',billing_status:'active'}]);
  setDemoCollection('registrations',[{
    id:'registration-1',client_id:'client-1',registered_business_name:'Northstar Events',primary_contact_name:'Alex Example',
    primary_contact_email:'alex@example.test',status:'submitted',submitted_at:'2026-11-16T10:00:00Z',
    clients:{name:'Northstar Events',account_status:'awaiting_approval',billing_status:'active'},
  }]);
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<ClientEventAdmin onEventCreated={jest.fn()}/>);});
    await act(async()=>{await Promise.resolve();});
    await act(async()=>{clickButton(container,'Client registrations');});
    expect(container.textContent).toContain('Northstar Events');
    await act(async()=>{clickButton(container,'Approve');});
    expect(container.textContent).toContain('Registration approved.');
    expect(container.textContent).toContain('pending_payment');
    await act(async()=>{clickButton(container,'Activate & invite');});
    expect(container.textContent).toContain('Account activated and invitation recorded');
    expect(getDemoCollection('invitations',[])).toEqual(expect.arrayContaining([expect.objectContaining({email:'alex@example.test',role:'client_admin'})]));
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
    window.prompt=originalPrompt;
  }
});

test('client-only workspace hides owner controls and other organisations events', async()=>{
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  const originalClients=getDemoCollection('clients',[]);
  const originalMemberships=getDemoCollection('memberships',[]);
  const originalEvents=getDemoCollection('events',[]);
  const originalInvoices=getDemoCollection('invoices',[]);
  setDemoCollection('clients',[sampleClient,{id:'client-2',name:'Other organisation',event_limit:1}]);
  setDemoCollection('memberships',[
    {id:'own',user_id:'dual-user',client_id:'client-1',event_id:null,role:'client_admin'},
    {id:'other',user_id:'another-user',client_id:'client-2',event_id:null,role:'client_admin'},
  ]);
  setDemoCollection('events',[
    {id:'own-event',client_id:'client-1',name:'Own event',slug:'own-event'},
    {id:'other-event',client_id:'client-2',name:'Other event',slug:'other-event'},
  ]);
  setDemoCollection('invoices',[{id:'own-invoice',invoice_number:'ECE-TEST-000001',client_id:'client-1',status:'issued',currency:'ZAR',invoice_date:'2026-11-17',billed_to_name:'Northstar Events',description:'Staging test invoice',subtotal_cents:1000,line_discount_cents:0,invoice_discount_cents:0,tax_cents:0,total_cents:1000}]);
  const container=document.createElement('div');
  document.body.appendChild(container);
  const root=createRoot(container);
  try {
    await act(async()=>{root.render(<ClientEventAdmin onEventCreated={jest.fn()} clientWorkspaceOnly currentUserId="dual-user"/>);});
    await act(async()=>{clickButton(container,'Invoices & payments');});
    await act(async()=>{await Promise.resolve();});
    await act(async()=>{await Promise.resolve();await Promise.resolve();});
    expect(container.textContent).toContain('ECE-TEST-000001');
    expect(container.textContent).toContain('CLIENT WORKSPACE');
    expect(container.textContent).toContain('Own event');
    expect(container.textContent).not.toContain('Other event');
    expect(container.textContent).not.toContain('PLATFORM OWNER');
    expect(container.textContent).not.toContain('Payments & EFT verification');
  } finally {
    await act(async()=>{root.unmount();});
    container.remove();
    setDemoCollection('clients',originalClients);
    setDemoCollection('memberships',originalMemberships);
    setDemoCollection('events',originalEvents);
    setDemoCollection('invoices',originalInvoices);
  }
});
