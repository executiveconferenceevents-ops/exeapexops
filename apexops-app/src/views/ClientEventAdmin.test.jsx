import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getAvailableEvents } from '../lib/eventScope';
import ClientEventAdmin from './ClientEventAdmin';
import { downloadInvoicePdf } from '../lib/invoicePdf';
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

  await act(async()=>{clickButton(container,'Clients & organisations');});
  expect(container.textContent).toContain('Northstar Events');
  expect(container.textContent).toContain('4');
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
