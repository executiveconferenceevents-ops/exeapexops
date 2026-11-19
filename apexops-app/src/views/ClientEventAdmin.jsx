import { Fragment, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getAvailableEvents, getEventAccessCode } from '../lib/eventScope';
import { DEMO_MODE, getDemoCollection, setDemoCollection } from '../lib/demoStore';
import { loadClientDirectory } from '../lib/clientDirectory';
import { getClientRebookingRequests, getSuppliers, removeSupplier, upsertSuppliers, uploadPublicImage } from '../lib/mock';
import { enqueue, isNetworkError } from '../lib/offline';
import { createInvoicePdf, downloadInvoicePdf } from '../lib/invoicePdf';
import ClientBillingWorkspace from '../components/ClientBillingWorkspace';
import ClientExhibitorOrdersWorkspace from '../components/ClientExhibitorOrdersWorkspace';
import { EVENT_TIERS, EXTRA_STAFF_SEAT_PRICE, getDefaultPricingConfig, INCLUDED_INTERNAL_SEATS, validatePricingConfig, VOLUME_PLANS } from '../lib/pricing';
import { Activity, BarChart3, Briefcase, Building2, CalendarDays, Check, Clock, CreditCard, Download, FileText, LayoutDashboard, Mail, MailPlus, Pencil, Plus, RefreshCw, Settings, Shield, ShoppingBag, Tag, Trash2, Truck, Upload, Users, UserPlus, X } from 'lucide-react';

const emptyClient = { name:'', slug:'', adminEmail:'', eventLimit:1 };
const emptyInvoiceForm = { client_id:'', billed_to_name:'', billed_to_email:'', invoice_date:'', due_date:'', description:'', payment_instructions:'', invoice_discount_cents:'0' };
const emptyInvoiceLine = { description:'', quantity:'1', unit_price_cents:'', discount_cents:'0' };
const emptyCreditNoteForm = { amount_cents:'', reason:'', description:'' };
const defaultInvoiceTaxSettings = { is_registered:false, tax_label:'Tax', tax_rate_basis_points:0, currency:'ZAR' };
const emptyPaymentForm = { invoice_id:'', amount_cents:'', payment_method:'eft', paid_on:new Date().toISOString().slice(0,10), reference:'', note:'' };
const emptyEvent = { client_id:'', name:'', slug:'', event_start_date:'', event_start_time:'', event_end_date:'', event_end_time:'', build_up_start_date:'', build_up_start_time:'', build_up_end_date:'', build_up_end_time:'', breakdown_start_date:'', breakdown_start_time:'', breakdown_end_date:'', breakdown_end_time:'', next_event_name:'', billing_exempt:false, logo_file:null };
const emptyInvite = { client_id:'', event_id:'', email:'', role:'staff' };
const emptySupplier = { name:'', contact:'', email:'', mobile:'', category:'Other' };
const platformNavGroups = [
  { label:'MAIN', items:[
    ['overview','Overview',LayoutDashboard], ['clients','Clients & organisations',Building2],
    ['events','Events',CalendarDays], ['users','Users & access',Users], ['registrations','Client registrations',UserPlus],
  ] },
  { label:'COMMERCIAL', items:[
    ['subscriptions','Subscriptions & agreements',Briefcase], ['invoices','Invoices',FileText],
    ['payments','Payments & EFT verification',CreditCard], ['pricing','Pricing plans',Tag],
    ['reports','Revenue & reports',BarChart3],
  ] },
  { label:'ADMINISTRATION', items:[
    ['activity','Activity & audit logs',Activity], ['security','Security & permissions',Shield],
    ['settings','System settings',Settings],
  ] },
];
const clientDetailTabs = [
  ['overview','Overview'], ['users','Users & access'], ['subscription','Subscription'],
  ['events','Events'], ['invoices','Invoices'], ['activity','Activity'],
];

function eventStatus(event) {
  const today = new Date().toISOString().slice(0, 10);
  const start = event.build_up_start_date || event.event_start_date;
  const end = event.breakdown_end_date || event.event_end_date;
  if (end && end < today) return ['Completed', 'past'];
  if (start && start <= today) return ['Live', 'live'];
  return ['Upcoming', 'upcoming'];
}

function formatCurrency(cents, currency='ZAR') {
  return new Intl.NumberFormat('en-ZA', { style:'currency', currency }).format(Number(cents || 0) / 100);
}

function timeInputValue(value) {
  return String(value || '').slice(0, 5);
}

function createSecureUuid() {
  const cryptoApi=window.crypto;
  if (typeof cryptoApi?.getRandomValues!=='function') throw new Error('Secure payment IDs are unavailable in this browser.');
  const bytes=cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&0x0f)|0x40;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export default function ClientEventAdmin({ onEventCreated, clientWorkspaceOnly = false, currentUserId }) {
  const [section, setSection] = useState('overview');
  const [clients, setClients] = useState([]);
  const [events, setEvents] = useState([]);
  const [dashboardEventFilter, setDashboardEventFilter] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [clientStatusFilter, setClientStatusFilter] = useState('all');
  const [selectedClientId, setSelectedClientId] = useState('');
  const [clientDetailTab, setClientDetailTab] = useState('overview');
  const [pricingConfig, setPricingConfig] = useState(getDefaultPricingConfig);
  const [memberships, setMemberships] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [privateSuppliers, setPrivateSuppliers] = useState([]);
  const [supplierClientId, setSupplierClientId] = useState('');
  const [managedClientId, setManagedClientId] = useState('');
  const [managedClientEventLimit, setManagedClientEventLimit] = useState(1);
  const [managedClientBilling, setManagedClientBilling] = useState({ billing_mode:'unmanaged', billing_status:'active', paid_through:'', prepaid_event_credits:0 });
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [clientForm, setClientForm] = useState(emptyClient);
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [editingEventId, setEditingEventId] = useState('');
  const [showEventForm, setShowEventForm] = useState(false);
  const [inviteForm, setInviteForm] = useState(emptyInvite);
  const [supplierForm, setSupplierForm] = useState(emptySupplier);
  const [editingSupplierId, setEditingSupplierId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [invoices, setInvoices] = useState([]);
  const [invoiceItems, setInvoiceItems] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [editingInvoiceId, setEditingInvoiceId] = useState('');
  const [invoiceClientFilter, setInvoiceClientFilter] = useState('all');
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoiceForm);
  const [invoiceLines, setInvoiceLines] = useState([{ ...emptyInvoiceLine }]);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceLoading, setInvoiceLoading] = useState(false);
  const [invoiceSending, setInvoiceSending] = useState(false);
  const [exhibitorFeeMonth, setExhibitorFeeMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [attachingExhibitorFees, setAttachingExhibitorFees] = useState(false);
  const [showCreditNoteForm, setShowCreditNoteForm] = useState(false);
  const [creditNoteForm, setCreditNoteForm] = useState(emptyCreditNoteForm);
  const [invoiceTaxSettings, setInvoiceTaxSettings] = useState(defaultInvoiceTaxSettings);
  const [taxSettingsSaving, setTaxSettingsSaving] = useState(false);
  const [payments, setPayments] = useState([]);
  const [paymentAllocations, setPaymentAllocations] = useState([]);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [evidenceLinks, setEvidenceLinks] = useState({});
  const [auditEntries, setAuditEntries] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [clientAuditEntries, setClientAuditEntries] = useState([]);
  const [clientAuditLoading, setClientAuditLoading] = useState(false);
  const [rebookingRequests, setRebookingRequests] = useState([]);
  const [rebookingLoading, setRebookingLoading] = useState(false);

  async function refresh() {
    if (!supabase && !DEMO_MODE) {
      setError('Client and event administration requires a connected Supabase project.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const availableEvents = (await getAvailableEvents()) || [];
      let currentMemberships = [];
      let platformAdmin = false;
      let visibleClients = [];
      let nextPricingConfig = getDefaultPricingConfig();
      let pricingLoadError = '';
      if (DEMO_MODE) {
        platformAdmin = !clientWorkspaceOnly;
        currentMemberships = getDemoCollection('memberships', [{ id:'demo-owner-membership', user_id:'demo-owner', client_id:'demo-client-ece', event_id:null, role:'client_admin' }]);
        if (clientWorkspaceOnly && currentUserId) currentMemberships = currentMemberships.filter(membership => membership.user_id === currentUserId);
        visibleClients = getDemoCollection('clients', [{ id:'demo-client-ece', name:'Executive Conference Events', slug:'executive-conference-events', event_limit:1, billing_mode:'unmanaged', billing_status:'active', billing_plan:'legacy', prepaid_event_credits:0, trial_started_at:null, trial_ends_at:null }]);
        nextPricingConfig = getDemoCollection('pricing', nextPricingConfig);
      } else {
        const [membershipResult, adminResult] = await Promise.all([
          supabase.from('client_event_memberships').select('id, user_id, client_id, event_id, role'),
          supabase.rpc('is_platform_admin'),
        ]);
        if (membershipResult.error) throw membershipResult.error;
        if (adminResult.error) throw adminResult.error;
        platformAdmin = Boolean(adminResult.data) && !clientWorkspaceOnly;
        currentMemberships = (membershipResult.data || []).filter(membership => !clientWorkspaceOnly || membership.user_id === currentUserId);
        if (platformAdmin) {
          visibleClients = await loadClientDirectory(supabase);
          const { data:pricing, error:pricingError } = await supabase.from('platform_pricing')
            .select('event_tiers, volume_plans').eq('id', true).maybeSingle();
          if (pricingError) pricingLoadError = 'Pricing settings are unavailable. Apply supabase/platform-pricing-migration.sql to enable the editor.';
          else if (pricing?.event_tiers && pricing?.volume_plans) nextPricingConfig = { eventTiers:pricing.event_tiers, volumePlans:pricing.volume_plans };
        }
      }
      const managedClientId = currentMemberships.find(membership => membership.role === 'client_admin' && !membership.event_id)?.client_id || '';
      if (clientWorkspaceOnly) visibleClients = visibleClients.filter(client => client.id === managedClientId);
      let managedClientEventLimit = 1;
      let managedClientBilling = { billing_mode:'unmanaged', billing_status:'active', billing_plan:'legacy', paid_through:null, term_ends_at:null, committed_events:0, prepaid_event_credits:0, trial_started_at:null, trial_ends_at:null };
      if (!DEMO_MODE && !platformAdmin && managedClientId) {
        const { data:managedClient, error:managedClientError } = await supabase.from('clients')
          .select('event_limit, billing_mode, billing_status, billing_plan, paid_through, term_ends_at, committed_events, prepaid_event_credits, trial_started_at, trial_ends_at')
          .eq('id', managedClientId).maybeSingle();
        if (managedClientError) throw managedClientError;
        managedClientEventLimit = managedClient?.event_limit || 1;
        managedClientBilling = managedClient || managedClientBilling;
      } else if (DEMO_MODE) {
        managedClientBilling = { ...managedClientBilling, ...(visibleClients[0] || {}) };
        if (!managedClientBilling.billing_mode) managedClientBilling.billing_mode = 'unmanaged';
        if (!managedClientBilling.billing_status) managedClientBilling.billing_status = 'active';
        managedClientEventLimit = visibleClients[0]?.event_limit || managedClientEventLimit;
      }
      let managedEvents = clientWorkspaceOnly ? availableEvents.filter(event => currentMemberships.some(membership => membership.client_id === event.client_id && (!membership.event_id || membership.event_id === event.id))) : availableEvents;
      if (!DEMO_MODE && managedEvents.length) {
        const { data: codeRows, error: codeError } = await supabase.rpc('get_event_access_codes', {
          requested_event_ids:managedEvents.map(event => event.id),
        });
        let rows = codeRows || [];
        if (codeError?.code === 'PGRST202') {
          const { data:legacyRows, error:legacyError } = await supabase.from('events').select('id, exhibitor_code').in('id', managedEvents.map(event => event.id));
          if (legacyError) throw legacyError;
          rows = legacyRows || [];
        } else if (codeError) throw codeError;
        const codeByEventId = new Map(rows.map(row => [row.event_id || row.id, row.exhibitor_code]));
        managedEvents = managedEvents.map(event => ({ ...event, exhibitor_code:codeByEventId.get(event.id) || '' }));
      }
      setClients(visibleClients);
      setEvents(managedEvents);
      setPricingConfig(nextPricingConfig);
      setMemberships(currentMemberships);
      setIsPlatformAdmin(platformAdmin);
      setManagedClientId(managedClientId);
      setManagedClientEventLimit(managedClientEventLimit);
      setManagedClientBilling(managedClientBilling);
      setSelectedClientId(current => current || visibleClients[0]?.id || '');
      setEventForm(current => ({ ...current, client_id:platformAdmin ? current.client_id || visibleClients[0]?.id || '' : managedClientId }));
      setInviteForm(current => ({ ...current, client_id:platformAdmin ? current.client_id || visibleClients[0]?.id || '' : managedClientId }));
      const supplierScope = platformAdmin ? supplierClientId || visibleClients[0]?.id || '' : managedClientId;
      setSupplierClientId(supplierScope);
      setPrivateSuppliers(supplierScope ? (await getSuppliers(supplierScope)) || [] : []);
      if (pricingLoadError) setError(pricingLoadError);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load client and event access.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!loading && section === 'billing' && managedClientId) loadInvoices();
  }, [loading, section, managedClientId]);

  async function loadClientRebookingRequests() {
    setRebookingLoading(true);
    setError('');
    try {
      const eventIds = events.filter(event => event.client_id === managedClientId).map(event => event.id);
      setRebookingRequests(await getClientRebookingRequests(eventIds));
    } catch (loadError) {
      setError(loadError?.message || 'Could not load rebooking enquiries.');
    } finally {
      setRebookingLoading(false);
    }
  }

  useEffect(() => {
    if (!loading && !isPlatformAdmin && section === 'rebookings' && managedClientId) loadClientRebookingRequests();
  }, [loading, isPlatformAdmin, section, managedClientId, events]);

  async function loadRegistrations() {
    setRegistrationLoading(true);
    setError('');
    try {
      if (DEMO_MODE) {
        setRegistrations(getDemoCollection('registrations',[]));
      } else {
        const { data,error:registrationError }=await supabase.from('client_registration_submissions')
          .select('id,client_id,registered_business_name,company_registration_number,primary_contact_name,primary_contact_email,billing_contact_email,contact_phone,terms_version,terms_accepted_at,status,submitted_at,reviewed_at,review_note,clients(name,account_status,billing_status)')
          .order('submitted_at',{ascending:false});
        if (registrationError) throw registrationError;
        setRegistrations(data||[]);
      }
    } catch (loadError) {
      setError(loadError?.message||'Could not load client registration requests.');
    } finally {
      setRegistrationLoading(false);
    }
  }

  async function loadInvoices() {
    setInvoiceLoading(true);
    setError('');
    try {
      let rows;
      if (DEMO_MODE) {
        rows = getDemoCollection('invoices', []);
        setInvoiceTaxSettings(getDemoCollection('invoice_tax_settings', defaultInvoiceTaxSettings));
      } else {
        if (!isPlatformAdmin && !managedClientId) {
          setInvoices([]);
          setInvoiceItems([]);
          return;
        }
        let invoiceQuery = supabase.from('client_invoices')
          .select('id, invoice_number, client_id, status, currency, invoice_date, due_date, billed_to_name, billed_to_email, description, payment_instructions, subtotal_cents, line_discount_cents, invoice_discount_cents, tax_label, tax_cents, total_cents, created_at, issued_at, clients(name)');
        if (!isPlatformAdmin) invoiceQuery = invoiceQuery.eq('client_id', managedClientId);
        const { data, error:invoiceError } = await invoiceQuery
          .order('invoice_date', { ascending:false }).order('created_at', { ascending:false });
        if (invoiceError) {
          if (invoiceError.code === 'PGRST205' || invoiceError.code === '42P01') throw new Error('Invoice records are not installed in this environment yet.');
          throw invoiceError;
        }
        rows = data || [];
        if (isPlatformAdmin) {
          const { data:taxSettings, error:taxSettingsError } = await supabase.from('platform_invoice_tax_settings')
            .select('is_registered, tax_label, tax_rate_basis_points, currency').eq('id',true).maybeSingle();
          if (taxSettingsError) throw taxSettingsError;
          setInvoiceTaxSettings(taxSettings || defaultInvoiceTaxSettings);
        }
      }
      setInvoices(rows);
      setSelectedInvoiceId(current => current && rows.some(invoice => invoice.id === current) ? current : '');
      if (!rows.length) setInvoiceItems([]);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load invoices.');
    } finally {
      setInvoiceLoading(false);
    }
  }

  async function loadPayments() {
    setPaymentLoading(true);
    setError('');
    try {
      if (!invoices.length) await loadInvoices();
      if (DEMO_MODE) {
        setPayments(getDemoCollection('payments', []));
        setPaymentAllocations(getDemoCollection('payment_allocations', []));
      } else {
        const { data:paymentRows, error:paymentsError } = await supabase.from('client_payments')
          .select('id,client_id,payment_method,status,amount_cents,currency,paid_on,reference,evidence_reference,note,provider_transaction_id,review_note,created_at')
          .order('created_at', { ascending:false });
        if (paymentsError) {
          if (paymentsError.code === 'PGRST205' || paymentsError.code === '42P01') throw new Error('Payment records are not installed in this environment yet.');
          throw paymentsError;
        }
        const paymentIds = (paymentRows || []).map(payment => payment.id);
        let allocationRows = [];
        if (paymentIds.length) {
          const { data, error:allocationsError } = await supabase.from('client_payment_allocations')
            .select('payment_id,invoice_id,amount_cents,status,client_invoices(invoice_number,billed_to_name)')
            .in('payment_id', paymentIds);
          if (allocationsError) throw allocationsError;
          allocationRows = data || [];
        }
        setPayments(paymentRows || []);
        setPaymentAllocations(allocationRows);
      }
    } catch (loadError) {
      setError(loadError?.message || 'Could not load payment records.');
    } finally {
      setPaymentLoading(false);
    }
  }

  useEffect(() => {
    if (!loading && isPlatformAdmin && ['overview','reports'].includes(section)) loadPayments();
  }, [loading, isPlatformAdmin, section]);

  async function loadAuditLog() {
    setAuditLoading(true);
    setError('');
    try {
      if (DEMO_MODE) {
        setAuditEntries(getDemoCollection('audit_log', []));
      } else {
        const { data, error:auditError } = await supabase.from('platform_audit_log')
          .select('id,actor_user_id,client_id,action,entity_type,entity_id,reason,created_at,clients(name)')
          .order('created_at', { ascending:false }).limit(200);
        if (auditError) throw auditError;
        setAuditEntries(data || []);
      }
    } catch (loadError) {
      setError(loadError?.message || 'Could not load platform audit activity.');
    } finally {
      setAuditLoading(false);
    }
  }

  async function loadClientAuditLog(clientId) {
    setClientAuditLoading(true);
    setError('');
    try {
      if (DEMO_MODE) {
        setClientAuditEntries(getDemoCollection('audit_log', []).filter(entry => entry.client_id === clientId));
      } else {
        const { data, error:auditError } = await supabase.from('platform_audit_log')
          .select('id,actor_user_id,client_id,action,entity_type,entity_id,reason,created_at')
          .eq('client_id',clientId).order('created_at', { ascending:false }).limit(100);
        if (auditError) throw auditError;
        setClientAuditEntries(data || []);
      }
    } catch (loadError) {
      setError(loadError?.message || 'Could not load client activity.');
    } finally {
      setClientAuditLoading(false);
    }
  }

  async function selectInvoice(invoiceId) {
    setSelectedInvoiceId(invoiceId);
    setInvoiceItems([]);
    setCreditNotes([]);
    if (!invoiceId) return;
    try {
      if (DEMO_MODE) {
        setInvoiceItems(getDemoCollection('invoice_items', []).filter(item => item.invoice_id === invoiceId));
        setCreditNotes(getDemoCollection('credit_notes', []).filter(note=>note.invoice_id===invoiceId));
      } else {
        const { data, error:itemError } = await supabase.from('client_invoice_items')
          .select('id, invoice_id, line_number, description, quantity, unit_price_cents, discount_cents, line_total_cents')
          .eq('invoice_id', invoiceId).order('line_number');
        if (itemError) throw itemError;
        setInvoiceItems(data || []);
        const { data:notes, error:notesError } = await supabase.from('client_credit_notes')
          .select('id, credit_note_number, invoice_id, amount_cents, reason, description, issued_on, status')
          .eq('invoice_id',invoiceId).order('issued_on',{ascending:false});
        if (notesError) throw notesError;
        setCreditNotes(notes||[]);
      }
    } catch (loadError) {
      setError(loadError?.message || 'Could not load invoice line items.');
    }
  }

  async function editInvoiceDraft(invoice) {
    if (invoice.status !== 'draft') return;
    setError('');
    try {
      let items;
      if (DEMO_MODE) {
        items=getDemoCollection('invoice_items',[]).filter(item=>item.invoice_id===invoice.id);
      } else {
        const { data, error:itemError } = await supabase.from('client_invoice_items')
          .select('description, quantity, unit_price_cents, discount_cents')
          .eq('invoice_id',invoice.id).order('line_number');
        if (itemError) throw itemError;
        items=data||[];
      }
      setEditingInvoiceId(invoice.id);
      setSelectedInvoiceId(invoice.id);
      setInvoiceClientFilter(invoice.client_id);
      setInvoiceForm({client_id:invoice.client_id,billed_to_name:invoice.billed_to_name||'',billed_to_email:invoice.billed_to_email||'',invoice_date:invoice.invoice_date||'',due_date:invoice.due_date||'',description:invoice.description||'',payment_instructions:invoice.payment_instructions||'',invoice_discount_cents:String(invoice.invoice_discount_cents||0)});
      setInvoiceLines(items.length?items.map(item=>({description:item.description,quantity:String(item.quantity),unit_price_cents:String(item.unit_price_cents),discount_cents:String(item.discount_cents||0)})):[{...emptyInvoiceLine}]);
      setInvoiceItems(items);
      setShowInvoiceForm(true);
    } catch (loadError) {
      setError(loadError?.message||'Could not load this invoice draft.');
    }
  }

  async function saveInvoiceTaxSettings(event) {
    event.preventDefault();
    const rate=Number(invoiceTaxSettings.tax_rate_basis_points);
    if (!Number.isInteger(rate)||rate<0||rate>10000||!invoiceTaxSettings.tax_label.trim()) {
      setError('Enter a tax label and a rate between 0 and 100 percent.');
      return;
    }
    setTaxSettingsSaving(true);
    setError('');
    setNotice('');
    try {
      const settings={...invoiceTaxSettings,tax_rate_basis_points:rate};
      if (DEMO_MODE) setDemoCollection('invoice_tax_settings',settings);
      else {
        const { data, error:settingsError } = await supabase.from('platform_invoice_tax_settings')
          .update({is_registered:settings.is_registered,tax_label:settings.tax_label.trim(),tax_rate_basis_points:rate,currency:settings.currency})
          .eq('id',true).select('is_registered,tax_label,tax_rate_basis_points,currency').single();
        if (settingsError) throw settingsError;
        setInvoiceTaxSettings(data);
      }
      if (DEMO_MODE) setInvoiceTaxSettings(settings);
      setNotice('Invoice tax settings saved. New drafts will snapshot this configuration.');
    } catch (saveError) {
      setError(saveError?.message||'Could not save invoice tax settings.');
    } finally {
      setTaxSettingsSaving(false);
    }
  }

  async function saveInvoiceDraft(event) {
    event.preventDefault();
    const items = invoiceLines.map(line => ({
      description:line.description.trim(),
      quantity:Number(line.quantity),
      unit_price_cents:Number(line.unit_price_cents),
      discount_cents:Number(line.discount_cents || 0),
    }));
    if (items.some(item => !item.description || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isInteger(item.unit_price_cents) || item.unit_price_cents < 0 || !Number.isInteger(item.discount_cents) || item.discount_cents < 0)) {
      setError('Complete each line with a description, positive quantity, and valid amount in cents.');
      return;
    }
    if (items.some(item => item.discount_cents > Math.round(item.quantity * item.unit_price_cents))) {
      setError('A line discount cannot exceed its line amount.');
      return;
    }
    const request = { ...invoiceForm, invoice_discount_cents:Number(invoiceForm.invoice_discount_cents || 0), items };
    if (!request.client_id || request.billed_to_name.trim().length < 2) {
      setError('Select an organisation and enter the billed-to name.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      let invoiceId;
      if (DEMO_MODE) {
        const demoInvoices=getDemoCollection('invoices',[]);
        const existingItems=getDemoCollection('invoice_items',[]);
        invoiceId=editingInvoiceId||`demo-invoice-${Date.now()}-${demoInvoices.length+1}`;
        const subtotal=items.reduce((sum,item)=>sum+Math.round(item.quantity*item.unit_price_cents),0);
        const lineDiscount=items.reduce((sum,item)=>sum+item.discount_cents,0);
        const invoiceDiscount=request.invoice_discount_cents;
        if (lineDiscount+invoiceDiscount>subtotal) throw new Error('Discounts cannot exceed invoice subtotal.');
        const taxRate=invoiceTaxSettings.is_registered?Number(invoiceTaxSettings.tax_rate_basis_points||0):0;
        const tax=Math.round((subtotal-lineDiscount-invoiceDiscount)*taxRate/10000);
        const total=subtotal-lineDiscount-invoiceDiscount+tax;
        const previousInvoice=demoInvoices.find(invoice=>invoice.id===invoiceId);
        if (editingInvoiceId && previousInvoice?.status!=='draft') throw new Error('Only draft invoices can be edited.');
        const invoice={...previousInvoice,id:invoiceId,invoice_number:previousInvoice?.invoice_number||`DEMO-${new Date().getFullYear()}-${String(demoInvoices.length+1).padStart(6,'0')}`,client_id:request.client_id,status:'draft',currency:invoiceTaxSettings.currency||'ZAR',invoice_date:request.invoice_date||new Date().toISOString().slice(0,10),due_date:request.due_date||null,billed_to_name:request.billed_to_name.trim(),billed_to_email:request.billed_to_email.trim()||null,description:request.description.trim(),invoice_discount_cents:invoiceDiscount,subtotal_cents:subtotal,line_discount_cents:lineDiscount,tax_label:invoiceTaxSettings.tax_label||'Tax',tax_rate_basis_points:taxRate,tax_cents:tax,total_cents:total};
        setDemoCollection('invoices',previousInvoice?demoInvoices.map(row=>row.id===invoiceId?invoice:row):[invoice,...demoInvoices]);
        setDemoCollection('invoice_items',[...existingItems.filter(item=>item.invoice_id!==invoiceId),...items.map((item,index)=>({...item,id:`${invoiceId}-line-${index+1}`,invoice_id:invoiceId,line_number:index+1,line_total_cents:Math.round(item.quantity*item.unit_price_cents)-item.discount_cents}))]);
      } else {
        const rpc=editingInvoiceId?'update_client_invoice_draft':'create_client_invoice';
        const args=editingInvoiceId?{target_invoice_id:editingInvoiceId,invoice_request:request}:{invoice_request:request};
        const { data, error:createError } = await supabase.rpc(rpc,args);
        if (createError) throw createError;
        invoiceId=editingInvoiceId||data;
      }
      setShowInvoiceForm(false);
      setEditingInvoiceId('');
      setInvoiceForm({ ...emptyInvoiceForm, client_id:request.client_id });
      setInvoiceLines([{ ...emptyInvoiceLine }]);
      await loadInvoices();
      if (invoiceId) await selectInvoice(invoiceId);
      setNotice(editingInvoiceId?'Invoice draft updated. Review it before issuing.':'Invoice draft created. Review its line items and totals before issuing.');
    } catch (saveError) {
      setError(saveError?.message || 'Could not create the invoice draft.');
    } finally {
      setSaving(false);
    }
  }

  async function issueInvoice(invoiceId) {
    if (!window.confirm('Issue this invoice? Its values and line items will be locked.')) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (DEMO_MODE) {
        const rows=getDemoCollection('invoices',[]).map(invoice=>invoice.id===invoiceId?{...invoice,status:'issued',issued_at:new Date().toISOString()}:invoice);
        setDemoCollection('invoices',rows);
        setInvoices(rows);
      } else {
        const { error:issueError } = await supabase.rpc('issue_client_invoice', { target_invoice_id:invoiceId });
        if (issueError) throw issueError;
        await loadInvoices();
      }
      setNotice('Invoice issued and locked.');
    } catch (issueError) {
      setError(issueError?.message || 'Could not issue the invoice.');
    } finally {
      setSaving(false);
    }
  }

  async function attachExhibitorFees(invoice) {
    if (!isPlatformAdmin || invoice.status !== 'draft' || !/^\d{4}-\d{2}$/.test(exhibitorFeeMonth)) return;
    if (DEMO_MODE) {
      setError('Attaching paid exhibitor fees is unavailable in demo mode.');
      return;
    }
    const clientName=clientById.get(invoice.client_id)?.name||invoice.billed_to_name;
    if (!window.confirm(`Attach all unbilled paid exhibitor-order fees for ${exhibitorFeeMonth} to draft invoice ${invoice.invoice_number} for ${clientName}? This reserves those fees to this invoice.`)) return;
    setAttachingExhibitorFees(true);
    setError('');
    setNotice('');
    try {
      const { data, error:feeError } = await supabase.rpc('attach_exhibitor_fees_to_client_invoice', {
        target_invoice_id:invoice.id,
        requested_fee_month:`${exhibitorFeeMonth}-01`,
      });
      if (feeError) throw feeError;
      const amountCents=Number(data||0);
      await loadInvoices();
      await selectInvoice(invoice.id);
      setNotice(amountCents
        ? `${formatCurrency(amountCents,invoice.currency||'ZAR')} in paid exhibitor-order fees added to ${invoice.invoice_number}.`
        : 'No unbilled paid exhibitor-order fees were found for that month and client.');
    } catch (feeError) {
      setError(feeError?.message||'Could not attach paid exhibitor-order fees.');
    } finally {
      setAttachingExhibitorFees(false);
    }
  }

  async function sendInvoiceEmail(invoice) {
    if (DEMO_MODE) {
      setError('Invoice email is unavailable in demo mode.');
      return;
    }
    if (!invoice.billed_to_email||invoice.status==='draft') {
      setError('Issue the invoice and add a billing email before sending.');
      return;
    }
    setInvoiceSending(true);
    setError('');
    setNotice('');
    try {
      let items=invoiceItems;
      if (selectedInvoiceId!==invoice.id) {
        const { data,error:itemsError }=await supabase.from('client_invoice_items')
          .select('id,invoice_id,line_number,description,quantity,unit_price_cents,discount_cents,line_total_cents')
          .eq('invoice_id',invoice.id).order('line_number');
        if (itemsError) throw itemsError;
        items=data||[];
      }
      const dataUri=createInvoicePdf(invoice,items).output('datauristring');
      const pdfBase64=dataUri.slice(dataUri.indexOf(',')+1);
      const { data,error:sendError }=await supabase.functions.invoke('send-client-invoice',{
        body:{invoiceId:invoice.id,pdfBase64},
      });
      if (sendError) throw sendError;
      setNotice(data?.message||`Invoice sent to ${invoice.billed_to_email}.`);
    } catch (sendError) {
      setError(sendError?.message||'Could not email this invoice.');
    } finally {
      setInvoiceSending(false);
    }
  }

  async function createCreditNote(event) {
    event.preventDefault();
    const invoice=invoices.find(item=>item.id===selectedInvoiceId);
    const amount=Number(creditNoteForm.amount_cents);
    if (!invoice||!Number.isInteger(amount)||amount<=0||creditNoteForm.reason.trim().length<2) {
      setError('Enter a positive credit amount and a reason.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (DEMO_MODE) {
        const allNotes=getDemoCollection('credit_notes',[]);
        const priorTotal=allNotes.filter(note=>note.invoice_id===invoice.id&&note.status==='issued').reduce((sum,note)=>sum+Number(note.amount_cents),0);
        if (priorTotal+amount>Number(invoice.total_cents)) throw new Error('Credit amount exceeds the remaining invoice value.');
        const note={id:`demo-credit-${Date.now()}-${allNotes.length+1}`,credit_note_number:`CN-DEMO-${new Date().getFullYear()}-${String(allNotes.length+1).padStart(6,'0')}`,invoice_id:invoice.id,client_id:invoice.client_id,status:'issued',currency:invoice.currency||'ZAR',issued_on:new Date().toISOString().slice(0,10),amount_cents:amount,reason:creditNoteForm.reason.trim(),description:creditNoteForm.description.trim(),issued_at:new Date().toISOString()};
        setDemoCollection('credit_notes',[note,...allNotes]);
        const status=priorTotal+amount===Number(invoice.total_cents)?'credited':'partially_credited';
        const updated=invoices.map(item=>item.id===invoice.id?{...item,status,status_reason:status==='credited'?note.reason:null}:item);
        setDemoCollection('invoices',updated);
        setInvoices(updated);
        setCreditNotes(notes=>[note,...notes]);
      } else {
        const { error:creditError } = await supabase.rpc('create_client_credit_note',{target_invoice_id:invoice.id,credit_request:{amount_cents:amount,reason:creditNoteForm.reason.trim(),description:creditNoteForm.description.trim()}});
        if (creditError) throw creditError;
        await loadInvoices();
        await selectInvoice(invoice.id);
      }
      setCreditNoteForm({...emptyCreditNoteForm});
      setShowCreditNoteForm(false);
      setNotice('Credit note issued and recorded in the audit history.');
    } catch (creditError) {
      setError(creditError?.message||'Could not issue the credit note.');
    } finally {
      setSaving(false);
    }
  }

  async function recordPayment(event) {
    event.preventDefault();
    const invoice = invoices.find(item => item.id === paymentForm.invoice_id);
    const amount = Number(paymentForm.amount_cents);
    if (!invoice || !Number.isSafeInteger(amount) || amount <= 0 || !paymentForm.paid_on || !paymentForm.reference.trim()) {
      setError('Choose an open invoice and enter a positive amount, payment date, and reference.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (DEMO_MODE) {
        const paymentId = `demo-payment-${createSecureUuid()}`;
        const idempotencyKey = createSecureUuid();
        const payment = { id:paymentId, client_id:invoice.client_id, payment_method:paymentForm.payment_method, status:'settled', amount_cents:amount, currency:invoice.currency||'ZAR', paid_on:paymentForm.paid_on, reference:paymentForm.reference.trim(), note:paymentForm.note.trim(), idempotency_key:idempotencyKey, created_at:new Date().toISOString() };
        const allocation = { payment_id:paymentId, invoice_id:invoice.id, amount_cents:amount, status:'settled', client_invoices:{invoice_number:invoice.invoice_number,billed_to_name:invoice.billed_to_name} };
        const nextPayments = [payment,...getDemoCollection('payments',[])];
        const nextAllocations = [allocation,...getDemoCollection('payment_allocations',[])];
        setDemoCollection('payments',nextPayments);
        setDemoCollection('payment_allocations',nextAllocations);
        setPayments(nextPayments);
        setPaymentAllocations(nextAllocations);
        const paid = nextAllocations.filter(row=>row.invoice_id===invoice.id&&row.status==='settled'&&nextPayments.some(item=>item.id===row.payment_id&&item.status==='settled')).reduce((sum,row)=>sum+Number(row.amount_cents),0);
        const credited = getDemoCollection('credit_notes',[]).filter(note=>note.invoice_id===invoice.id&&note.status==='issued').reduce((sum,note)=>sum+Number(note.amount_cents),0);
        const status = paid+credited>=Number(invoice.total_cents)?'paid':paid?'partially_paid':credited?'partially_credited':'issued';
        const nextInvoices = invoices.map(item=>item.id===invoice.id?{...item,status}:item);
        setInvoices(nextInvoices);
        setDemoCollection('invoices',nextInvoices);
      } else {
        const paymentRequest = {
          client_id:invoice.client_id,
          amount_cents:amount,
          currency:invoice.currency||'ZAR',
          payment_method:paymentForm.payment_method,
          paid_on:paymentForm.paid_on,
          reference:paymentForm.reference.trim(),
          note:paymentForm.note.trim(),
          idempotency_key:createSecureUuid(),
          allocations:[{invoice_id:invoice.id,amount_cents:amount}],
        };
        const { error:paymentError } = await supabase.rpc('record_client_payment',{payment_request:paymentRequest});
        if (paymentError) throw paymentError;
        await loadInvoices();
        await loadPayments();
      }
      setPaymentForm({...emptyPaymentForm,paid_on:new Date().toISOString().slice(0,10)});
      setNotice('Payment recorded and allocated to the invoice.');
    } catch (paymentError) {
      setError(paymentError?.message||'Could not record this payment.');
    } finally {
      setSaving(false);
    }
  }

  async function reviewEftPayment(payment, approve) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (DEMO_MODE) {
        const nextPayments=payments.map(item=>item.id===payment.id?{...item,status:approve?'settled':'rejected',review_note:approve?'Bank entry matched':'Rejected by Platform Admin'}:item);
        const nextAllocations=paymentAllocations.map(item=>item.payment_id===payment.id?{...item,status:approve?'settled':'released'}:item);
        setPayments(nextPayments);
        setPaymentAllocations(nextAllocations);
        setDemoCollection('payments',nextPayments);
        setDemoCollection('payment_allocations',nextAllocations);
        if (approve) {
          const affectedInvoices=[...new Set(nextAllocations.filter(item=>item.payment_id===payment.id).map(item=>item.invoice_id))];
          const nextInvoices=invoices.map(invoice=>{
            if (!affectedInvoices.includes(invoice.id)) return invoice;
            const paid=nextAllocations.filter(item=>item.invoice_id===invoice.id&&item.status==='settled'&&nextPayments.some(row=>row.id===item.payment_id&&row.status==='settled')).reduce((sum,item)=>sum+Number(item.amount_cents),0);
            return {...invoice,status:paid>=Number(invoice.total_cents)?'paid':'partially_paid'};
          });
          setInvoices(nextInvoices);
          setDemoCollection('invoices',nextInvoices);
        }
      } else {
        const { error:reviewError } = await supabase.rpc('review_client_eft_payment',{target_payment_id:payment.id,approve_payment:approve,review_note:approve?'Bank entry matched':'Rejected by Platform Admin'});
        if (reviewError) throw reviewError;
        await loadPayments();
        await loadInvoices();
      }
      setNotice(approve?'EFT submission approved and allocated.':'EFT submission rejected.');
    } catch (reviewError) {
      setError(reviewError?.message||'Could not review this EFT submission.');
    } finally {
      setSaving(false);
    }
  }

  async function createEftEvidenceLink(payment) {
    if (!payment.evidence_reference) return;
    setError('');
    try {
      const { data, error:linkError } = await supabase.storage.from('client-payment-evidence')
        .createSignedUrl(payment.evidence_reference,120);
      if (linkError) throw linkError;
      setEvidenceLinks(current=>({...current,[payment.id]:data.signedUrl}));
    } catch (linkError) {
      setError(linkError?.message||'Could not create a secure proof link.');
    }
  }

  async function reversePayment(payment) {
    const reason=window.prompt(`Reason for reversing ${formatCurrency(payment.amount_cents,payment.currency||'ZAR')}:`);
    if (!reason || reason.trim().length<2) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (DEMO_MODE) {
        const nextPayments=payments.map(item=>item.id===payment.id?{...item,status:'reversed',review_note:reason.trim()}:item);
        const nextAllocations=paymentAllocations.map(item=>item.payment_id===payment.id?{...item,status:'reversed'}:item);
        const affectedInvoices=[...new Set(nextAllocations.filter(item=>item.payment_id===payment.id).map(item=>item.invoice_id))];
        const nextInvoices=invoices.map(invoice=>{
          if (!affectedInvoices.includes(invoice.id)) return invoice;
          const paid=nextAllocations.filter(item=>item.invoice_id===invoice.id&&item.status==='settled'&&nextPayments.some(row=>row.id===item.payment_id&&row.status==='settled')).reduce((sum,item)=>sum+Number(item.amount_cents),0);
          return {...invoice,status:paid?'partially_paid':'issued'};
        });
        setPayments(nextPayments);
        setPaymentAllocations(nextAllocations);
        setInvoices(nextInvoices);
        setDemoCollection('payments',nextPayments);
        setDemoCollection('payment_allocations',nextAllocations);
        setDemoCollection('invoices',nextInvoices);
      } else {
        const { error:reverseError } = await supabase.rpc('reverse_client_payment',{target_payment_id:payment.id,reversal_reason:reason.trim()});
        if (reverseError) throw reverseError;
        await loadPayments();
        await loadInvoices();
      }
      setNotice('Payment reversed and invoice balance recalculated.');
    } catch (reverseError) {
      setError(reverseError?.message||'Could not reverse this payment.');
    } finally {
      setSaving(false);
    }
  }

  const billingForClient = clientId => isPlatformAdmin
    ? clients.find(client => client.id === clientId) || {}
    : managedClientBilling;
  const billingIsCurrent = clientId => {
    const account = billingForClient(clientId);
    if (account.billing_status !== 'active') return false;
    if (account.billing_mode === 'monthly') {
      const today = new Date().toISOString().slice(0, 10);
      return Boolean(account.paid_through && account.paid_through >= today && account.term_ends_at && account.term_ends_at >= today);
    }
    if (account.billing_mode === 'trial') {
      const today = new Date().toISOString().slice(0, 10);
      return Boolean(account.trial_started_at && account.trial_started_at <= today && account.trial_ends_at && account.trial_ends_at > today);
    }
    return account.billing_mode === 'unmanaged' || account.billing_mode === 'prepaid';
  };
  const canManageClient = clientId => isPlatformAdmin || (billingIsCurrent(clientId) && memberships.some(membership =>
    membership.client_id === clientId && membership.role === 'client_admin' && !membership.event_id));
  const canManageSuppliers = clientId => canManageClient(clientId);
  const canInviteToScope = (clientId, eventId) => isPlatformAdmin || (billingIsCurrent(clientId) && memberships.some(membership =>
    membership.client_id === clientId && membership.role === 'client_admin'
      && (!membership.event_id || membership.event_id === eventId)
      && (eventId || !membership.event_id)));
  const selectedEvent = events.find(event => event.id === inviteForm.event_id);
  const inviteClientEvents = events.filter(event => event.client_id === inviteForm.client_id);
  const dashboardEvents = events.filter(event => !dashboardEventFilter || event.id === dashboardEventFilter);

  function beginEditEvent(event) {
    setEditingEventId(event.id);
    setEventForm({
      client_id:event.client_id,
      name:event.name || '',
      slug:event.slug || '',
      event_start_date:event.event_start_date || '',
      event_start_time:timeInputValue(event.event_start_time),
      event_end_date:event.event_end_date || '',
      event_end_time:timeInputValue(event.event_end_time),
      build_up_start_date:event.build_up_start_date || '',
      build_up_start_time:timeInputValue(event.build_up_start_time),
      build_up_end_date:event.build_up_end_date || '',
      build_up_end_time:timeInputValue(event.build_up_end_time),
      breakdown_start_date:event.breakdown_start_date || event.event_end_date || '',
      breakdown_start_time:timeInputValue(event.breakdown_start_time),
      breakdown_end_date:event.breakdown_end_date || event.event_end_date || '',
      breakdown_end_time:timeInputValue(event.breakdown_end_time),
      next_event_name:event.next_event_name || '',
      billing_exempt:Boolean(event.billing_exempt),
      logo_file:null,
    });
    setSection('events');
    setShowEventForm(true);
    setError('');
    setNotice('');
  }

  function cancelEditEvent() {
    setEditingEventId('');
    setShowEventForm(false);
    setEventForm(current => ({ ...emptyEvent, client_id:current.client_id }));
  }

  function setEventDate(field, value) {
    setEventForm(current => {
      const next = { ...current, [field]:value };
      if (field === 'event_end_date') {
        if (!current.breakdown_start_date || current.breakdown_start_date === current.event_end_date) next.breakdown_start_date = value;
        if (!current.breakdown_end_date || current.breakdown_end_date === current.event_end_date) next.breakdown_end_date = value;
      }
      return next;
    });
  }

  async function addPrivateSupplier(event) {
    event.preventDefault();
    if (!supplierClientId || !canManageSuppliers(supplierClientId)) return;
    if (!supplierForm.name.trim()) {
      setError('Enter a supplier name.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await upsertSuppliers([{ ...supplierForm, id:editingSupplierId || `supplier-${crypto.randomUUID()}` }], supplierClientId);
      setSupplierForm(emptySupplier);
      setEditingSupplierId('');
      setPrivateSuppliers(await getSuppliers(supplierClientId));
      setNotice(editingSupplierId ? 'Private organizer supplier updated.' : 'Private organizer supplier added. It is available across this organizer’s events.');
    } catch (saveError) {
      setError(saveError?.message || 'Could not save the organizer supplier.');
    } finally {
      setSaving(false);
    }
  }

  async function deletePrivateSupplier(supplier) {
    if (!window.confirm(`Remove ${supplier.name} from this organizer’s private supplier list?`)) return;
    try {
      await removeSupplier(supplier.id, supplierClientId);
      setPrivateSuppliers(await getSuppliers(supplierClientId));
      if (editingSupplierId === supplier.id) {
        setEditingSupplierId('');
        setSupplierForm(emptySupplier);
      }
    } catch (deleteError) {
      setError(deleteError?.message || 'Could not remove the supplier.');
    }
  }

  async function createClient(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const name = clientForm.name.trim();
      const slug = clientForm.slug.trim().toLowerCase();
      const eventLimit = Number(clientForm.eventLimit);
      if (!Number.isInteger(eventLimit) || eventLimit < 1 || eventLimit > 1000) throw new Error('Set an event limit from 1 to 1000.');
      if (DEMO_MODE) {
        const clients = getDemoCollection('clients', []);
        if (clients.some(client => client.slug === slug)) throw new Error('That organization URL slug is already in use.');
        setDemoCollection('clients', [...clients, { id:`demo-client-${crypto.randomUUID()}`, name, slug, event_limit:eventLimit }]);
      } else {
        const input = { id:crypto.randomUUID(), name, slug, adminEmail:clientForm.adminEmail.trim(), eventLimit };
        const { error: createError } = await supabase.functions.invoke('create-client', { body:input });
        if (createError && isNetworkError(createError)) {
          await enqueue('client.create', input);
          setClientForm(emptyClient);
          setNotice('You are offline. The client will be created automatically when the connection returns.');
          return;
        }
        if (createError) {
          let message = createError.message;
          try { message = (await createError.context.json()).message || message; } catch { /* keep generic message */ }
          throw new Error(message);
        }
      }
      setClientForm(emptyClient);
      setNotice('Client organization created. Create an event and invite its first client admin.');
      await refresh();
    } catch (saveError) {
      setError(saveError?.message || 'Could not create the client organization.');
    } finally {
      setSaving(false);
    }
  }

  async function updateClientEventLimit(clientId, value) {
    const eventLimit = Number(value);
    if (!Number.isInteger(eventLimit) || eventLimit < 1 || eventLimit > 1000) {
      setError('Set an event limit from 1 to 1000.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase.from('clients').update({ event_limit:eventLimit }).eq('id', clientId);
      if (updateError) throw updateError;
      setClients(current => current.map(client => client.id === clientId ? { ...client, event_limit:eventLimit } : client));
      if (clientId === managedClientId) setManagedClientEventLimit(eventLimit);
      setNotice('Client event limit updated.');
    } catch (updateError) {
      setError(updateError?.message || 'Could not update the client event limit.');
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function updateClientBilling(clientId, patch) {
    if (!isPlatformAdmin) return;
    if (patch.prepaid_event_credits !== undefined && (!Number.isInteger(Number(patch.prepaid_event_credits)) || Number(patch.prepaid_event_credits) < 0)) {
      setError('Prepaid event credits must be a whole number of zero or more.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      let saved;
      if (DEMO_MODE) {
        const current = getDemoCollection('clients', []);
        const client = current.find(item => item.id === clientId);
        saved = { ...patch };
        if (saved.billing_mode === 'monthly' && saved.term_started_at !== (client?.term_started_at || null)) saved.prepaid_event_credits = 0;
        setDemoCollection('clients', current.map(item => item.id === clientId ? { ...item, ...saved } : item));
      } else {
        const { data, error: updateError } = await supabase.from('clients').update(patch).eq('id', clientId)
          .select('billing_plan, billing_mode, billing_status, prepaid_event_credits, paid_through, term_started_at, term_ends_at, committed_events, trial_started_at, trial_ends_at').single();
        if (updateError) throw updateError;
        saved = data;
      }
      setClients(current => current.map(client => client.id === clientId ? { ...client, ...saved } : client));
      setNotice('Client access settings saved. Payment has not been collected by this app.');
      return saved;
    } catch (updateError) {
      setError(updateError?.message || 'Could not update client access settings.');
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function reviewClientRegistration(registration, approve) {
    const prompt=approve?'Optional approval note:':'Reason for rejecting this request:';
    const note=window.prompt(prompt,'');
    if (note===null) return;
    if (!approve&&note.trim().length<2) {
      setError('Enter a brief reason before rejecting a registration.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const nextStatus=approve?'approved':'rejected';
      if (DEMO_MODE) {
        const accountStatus=approve?'pending_payment':'rejected';
        const nextRegistrations=registrations.map(item=>item.id===registration.id?{...item,status:nextStatus,review_note:note.trim()||null,reviewed_at:new Date().toISOString(),clients:{...item.clients,account_status:accountStatus}}:item);
        const nextClients=clients.map(client=>client.id===registration.client_id?{...client,account_status:approve?'pending_payment':'rejected'}:client);
        setRegistrations(nextRegistrations);
        setClients(nextClients);
        setDemoCollection('registrations',nextRegistrations);
        setDemoCollection('clients',nextClients);
      } else {
        const { error:reviewError }=await supabase.rpc('review_client_registration',{
          target_submission_id:registration.id,approve_request:approve,decision_note:note.trim()||null,
        });
        if (reviewError) throw reviewError;
        await Promise.all([loadRegistrations(),refresh()]);
      }
      setNotice(approve?'Registration approved. Set verified billing active, then explicitly activate the account.':'Registration rejected and recorded in the audit history.');
    } catch (reviewError) {
      setError(reviewError?.message||'Could not review this registration.');
    } finally {
      setSaving(false);
    }
  }

  async function activateClientRegistration(registration) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (DEMO_MODE) {
        const client=clients.find(item=>item.id===registration.client_id);
        if (client?.billing_status!=='active') throw new Error('Set verified billing active before activation.');
        const nextClients=clients.map(item=>item.id===registration.client_id?{...item,account_status:'active'}:item);
        const nextRegistrations=registrations.map(item=>item.id===registration.id?{...item,clients:{...item.clients,account_status:'active',billing_status:'active'}}:item);
        const invitation={client_id:registration.client_id,event_id:null,email:registration.primary_contact_email,role:'client_admin',created_at:new Date().toISOString()};
        setClients(nextClients);
        setRegistrations(nextRegistrations);
        setDemoCollection('clients',nextClients);
        setDemoCollection('registrations',nextRegistrations);
        setDemoCollection('invitations',[...getDemoCollection('invitations',[]),invitation]);
        setNotice(`Account activated and invitation recorded for ${registration.primary_contact_email}.`);
      } else {
        const { error:activationError }=await supabase.rpc('activate_client_registration',{target_client_id:registration.client_id});
        if (activationError) throw activationError;
        const { data,error:inviteError }=await supabase.functions.invoke('invite-event-member',{body:{
          clientId:registration.client_id,eventId:null,email:registration.primary_contact_email,role:'client_admin',
        }});
        await Promise.all([loadRegistrations(),refresh()]);
        if (inviteError) {
          setError(`Account activated, but the client admin invitation failed: ${inviteError.message}. Use Invite / update access to retry.`);
        } else {
          setNotice(data?.message||`Account activated and invitation sent to ${registration.primary_contact_email}.`);
        }
      }
    } catch (activationError) {
      setError(activationError?.message||'Could not activate this client account.');
    } finally {
      setSaving(false);
    }
  }

  async function sendRegistrationInvitation(registration) {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (DEMO_MODE) {
        setDemoCollection('invitations',[...getDemoCollection('invitations',[]),{client_id:registration.client_id,event_id:null,email:registration.primary_contact_email,role:'client_admin',created_at:new Date().toISOString()}]);
        setNotice(`Demo invitation recorded for ${registration.primary_contact_email}.`);
      } else {
        const { data,error:inviteError }=await supabase.functions.invoke('invite-event-member',{body:{
          clientId:registration.client_id,eventId:null,email:registration.primary_contact_email,role:'client_admin',
        }});
        if (inviteError) throw inviteError;
        setNotice(data?.message||`Client administrator invitation sent to ${registration.primary_contact_email}.`);
      }
    } catch (inviteError) {
      setError(inviteError?.message||'Could not send the client administrator invitation.');
    } finally {
      setSaving(false);
    }
  }

  async function updateMembershipRole(membership, role) {
    if (!isPlatformAdmin || !membership.id) return;
    if (!membership.event_id && role !== 'client_admin') {
      setError('Organization-wide access is reserved for client administrators.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const updated = memberships.map(item => item.id === membership.id ? { ...item, role } : item);
      if (DEMO_MODE) setDemoCollection('memberships', updated);
      else {
        const { data, error: roleError } = await supabase.from('client_event_memberships')
          .update({ role }).eq('id', membership.id).select('id').maybeSingle();
        if (roleError) throw roleError;
        if (!data) throw new Error('Membership was not updated. Refresh and check your access.');
      }
      setMemberships(updated);
      setNotice('User role updated.');
    } catch (roleError) {
      setError(roleError?.message || 'Could not update the user role.');
    } finally {
      setSaving(false);
    }
  }

  async function removeMembership(membership) {
    if (!isPlatformAdmin || !membership.id) return;
    const clientName = clientById.get(membership.client_id)?.name || 'this organization';
    if (!window.confirm(`Revoke this user's ${membership.role.replace('_',' ')} access to ${clientName}? The Supabase Auth account will not be deleted.`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const remaining = memberships.filter(item => item.id !== membership.id);
      if (DEMO_MODE) setDemoCollection('memberships', remaining);
      else {
        const { data, error: deleteError } = await supabase.from('client_event_memberships')
          .delete().eq('id', membership.id).select('id').maybeSingle();
        if (deleteError) throw deleteError;
        if (!data) throw new Error('Access was not revoked. Refresh and check your permissions.');
      }
      setMemberships(remaining);
      setNotice('Membership access revoked. The user account remains intact.');
    } catch (deleteError) {
      setError(deleteError?.message || 'Could not revoke membership access.');
    } finally {
      setSaving(false);
    }
  }

  function updatePricingTier(index, field, value) {
    setPricingConfig(current => ({
      ...current,
      eventTiers:current.eventTiers.map((tier, tierIndex) => tierIndex === index ? { ...tier, [field]:value } : tier),
    }));
  }

  function updateVolumePlan(index, field, value) {
    setPricingConfig(current => ({
      ...current,
      volumePlans:current.volumePlans.map((plan, planIndex) => planIndex === index ? { ...plan, [field]:value } : plan),
    }));
  }

  async function savePricingConfig() {
    const validationError = validatePricingConfig(pricingConfig);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (DEMO_MODE) {
        setDemoCollection('pricing', pricingConfig);
      } else {
        const { data, error:saveError } = await supabase.from('platform_pricing')
          .upsert({ id:true, event_tiers:pricingConfig.eventTiers, volume_plans:pricingConfig.volumePlans }, { onConflict:'id' })
          .select('event_tiers, volume_plans').single();
        if (saveError) throw saveError;
        setPricingConfig({ eventTiers:data.event_tiers, volumePlans:data.volume_plans });
      }
      setNotice('Pricing tiers and annual discounts saved.');
    } catch (saveError) {
      setError(saveError?.message || 'Could not save pricing settings.');
    } finally {
      setSaving(false);
    }
  }

  async function createEvent(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const eventValues = {
        client_id:eventForm.client_id,
        name:eventForm.name.trim(),
        slug:eventForm.slug.trim().toLowerCase(),
        event_start_date:eventForm.event_start_date,
        event_start_time:eventForm.event_start_time || null,
        event_end_date:eventForm.event_end_date,
        event_end_time:eventForm.event_end_time || null,
        build_up_start_date:eventForm.build_up_start_date,
        build_up_start_time:eventForm.build_up_start_time || null,
        build_up_end_date:eventForm.build_up_end_date,
        build_up_end_time:eventForm.build_up_end_time || null,
        breakdown_start_date:eventForm.breakdown_start_date,
        breakdown_start_time:eventForm.breakdown_start_time || null,
        breakdown_end_date:eventForm.breakdown_end_date,
        breakdown_end_time:eventForm.breakdown_end_time || null,
        next_event_name:eventForm.next_event_name.trim() || null,
        billing_exempt:Boolean(isPlatformAdmin && eventForm.billing_exempt),
        is_public:true,
      };
      const existingEvents = DEMO_MODE ? getDemoCollection('events', []) : await getAvailableEvents();
      if (existingEvents.some(item => item.slug === eventValues.slug)) throw new Error('That event URL slug is already in use.');
      eventValues.logo_url = eventForm.logo_file
        ? await uploadPublicImage('event-logos', 'logo', eventForm.logo_file, eventValues.slug)
        : null;
      let data;
      if (DEMO_MODE) {
        const currentEvents = getDemoCollection('events', []);
        const prefix = eventValues.name.replace(/[^A-Za-z]/g, '').slice(0, 5).toUpperCase() || 'EVENT';
        data = { ...eventValues, id:`demo-event-${crypto.randomUUID()}`, exhibitor_code:`${prefix}-${eventValues.event_start_date.replace(/-/g, '')}` };
        setDemoCollection('events', [...currentEvents, data]);
      } else {
        const { data:createdEvent, error: createError } = await supabase.from('events').insert(eventValues)
          .select('id, client_id, name, event_start_date, event_start_time, event_end_date, event_end_time, build_up_start_date, build_up_start_time, build_up_end_date, build_up_end_time, breakdown_start_date, breakdown_start_time, breakdown_end_date, breakdown_end_time, next_event_name, slug, is_public, logo_url, billing_exempt').single();
        if (createError) throw createError;
        data = createdEvent;
      }
      setEventForm(current => ({ ...emptyEvent, client_id:current.client_id }));
      setShowEventForm(false);
      await refresh();
      onEventCreated(data);
      setNotice(`Event created. Public links can use ?event=${data.slug}.`);
    } catch (saveError) {
      setError(saveError?.message || 'Could not create the event.');
    } finally {
      setSaving(false);
    }
  }

  async function updateEvent(event) {
    event.preventDefault();
    const currentEvent = events.find(item => item.id === editingEventId);
    if (!currentEvent) {
      setError('That event is no longer available. Refresh and try again.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const eventValues = {
        name:eventForm.name.trim(),
        slug:eventForm.slug.trim().toLowerCase(),
        event_start_date:eventForm.event_start_date,
        event_start_time:eventForm.event_start_time || null,
        event_end_date:eventForm.event_end_date,
        event_end_time:eventForm.event_end_time || null,
        build_up_start_date:eventForm.build_up_start_date,
        build_up_start_time:eventForm.build_up_start_time || null,
        build_up_end_date:eventForm.build_up_end_date,
        build_up_end_time:eventForm.build_up_end_time || null,
        breakdown_start_date:eventForm.breakdown_start_date,
        breakdown_start_time:eventForm.breakdown_start_time || null,
        breakdown_end_date:eventForm.breakdown_end_date,
        breakdown_end_time:eventForm.breakdown_end_time || null,
        next_event_name:eventForm.next_event_name.trim() || null,
      };
      if (isPlatformAdmin) eventValues.billing_exempt = Boolean(eventForm.billing_exempt);
      if (events.some(item => item.id !== currentEvent.id && item.slug === eventValues.slug)) {
        throw new Error('That event URL slug is already in use.');
      }
      if (eventForm.logo_file) eventValues.logo_url = await uploadPublicImage('event-logos', 'logo', eventForm.logo_file, eventValues.slug);

      let data;
      if (DEMO_MODE) {
        const currentEvents = getDemoCollection('events', []);
        data = { ...currentEvent, ...eventValues };
        setDemoCollection('events', currentEvents.map(item => item.id === currentEvent.id ? data : item));
      } else {
        const { data:updatedEvent, error:updateError } = await supabase.from('events').update(eventValues).eq('id', currentEvent.id)
          .select('id, client_id, name, event_start_date, event_start_time, event_end_date, event_end_time, build_up_start_date, build_up_start_time, build_up_end_date, build_up_end_time, breakdown_start_date, breakdown_start_time, breakdown_end_date, breakdown_end_time, next_event_name, slug, is_public, logo_url, billing_exempt, clients(name)').single();
        if (updateError) throw updateError;
        data = updatedEvent;
      }
      setEditingEventId('');
      setEventForm(current => ({ ...emptyEvent, client_id:currentEvent.client_id }));
      setShowEventForm(false);
      await refresh();
      onEventCreated(data);
      setNotice(`Event details updated for ${data.name}.`);
    } catch (saveError) {
      setError(saveError?.message || 'Could not update the event.');
    } finally {
      setSaving(false);
    }
  }

  async function updateEventLogo(event, file) {
    if (!file) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const logo_url = await uploadPublicImage('event-logos', 'logo', file, event.id);
      if (DEMO_MODE) {
        const currentEvents = getDemoCollection('events', []);
        setDemoCollection('events', currentEvents.map(item => item.id === event.id ? { ...item, logo_url } : item));
      } else {
        const { error: updateError } = await supabase.from('events').update({ logo_url }).eq('id', event.id);
        if (updateError) throw updateError;
      }
      await refresh();
      setNotice(`${event.name} logo updated. It will appear in the Exhibitors event list.`);
    } catch (saveError) {
      setError(saveError?.message || 'Could not update the event logo.');
    } finally {
      setSaving(false);
    }
  }

  async function rotateEventCode(event) {
    if (!window.confirm(`Rotate the exhibitor code for ${event.name}? The current code will stop working immediately.`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      let code;
      if (DEMO_MODE) {
        code = `APX-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;
        setDemoCollection('events', getDemoCollection('events', []).map(item => item.id === event.id ? { ...item, exhibitor_code:code } : item));
      } else {
        const { data, error:rotateError } = await supabase.rpc('rotate_event_exhibitor_code', { target_event_id:event.id });
        if (rotateError) throw rotateError;
        code = data;
      }
      if (!code) throw new Error('The new exhibitor code was generated but could not be retrieved. Refresh the page to load it.');
      setEvents(current => current.map(item => item.id === event.id ? { ...item, exhibitor_code:code } : item));
      setNotice(`Code rotated for ${event.name}. The previous code is no longer valid; share the new code with exhibitors.`);
    } catch (rotateError) {
      setError(rotateError?.message || 'Could not regenerate the exhibitor code.');
    } finally {
      setSaving(false);
    }
  }

  async function inviteMember(event) {
    event.preventDefault();
    if (!inviteForm.event_id && inviteForm.role !== 'client_admin') {
      setError('Choose an event for event administrators, operations, or staff invitations.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const invitation = {
        client_id:inviteForm.client_id,
        event_id:inviteForm.event_id || null,
        email:inviteForm.email.trim(),
        role:inviteForm.role,
        created_at:new Date().toISOString(),
      };
      if (DEMO_MODE) {
        const invitations = getDemoCollection('invitations', []);
        setDemoCollection('invitations', [...invitations, invitation]);
        setNotice(`Demo invitation recorded for ${invitation.email}.`);
      } else {
        const { data, error: inviteError } = await supabase.functions.invoke('invite-event-member', { body: {
          clientId:invitation.client_id,
          eventId:invitation.event_id,
          email:invitation.email,
          role:invitation.role,
        } });
        if (inviteError) throw inviteError;
        setNotice(data?.message || `Invitation sent to ${invitation.email}.`);
      }
      setInviteForm(current => ({ ...current, email:'' }));
    } catch (inviteError) {
      const serverMessage = inviteError?.context?.body?.message;
      setError(serverMessage || inviteError?.message || 'Could not invite this user.');
    } finally {
      setSaving(false);
    }
  }

  const navGroups = isPlatformAdmin ? platformNavGroups : [{ label:'WORKSPACE', items:[
    ['overview','Overview',LayoutDashboard], ['events','Events',CalendarDays],
    ['billing','Invoices & payments',CreditCard], ['suppliers','Suppliers',Truck], ['team','Team access',MailPlus],
    ['exhibitor-orders','Furniture orders',ShoppingBag], ['rebookings','Rebooking enquiries',Mail],
  ] }];
  const currentNavItem = navGroups.flatMap(group => group.items).find(([key]) => key === section);
  const sectionTitle = currentNavItem?.[1] || 'Overview';
  const liveEvents = dashboardEvents.filter(event => eventStatus(event)[1] === 'live').length;
  const billableEventCount = events.filter(event => !event.billing_exempt).length;
  const internalEventCount = events.filter(event => event.billing_exempt).length;
  const activeClientCount = clients.filter(client => client.billing_status === 'active').length;
  const selectedClient = clients.find(client => client.id === selectedClientId) || clients[0] || null;
  const selectedClientEvents = selectedClient ? events.filter(event => event.client_id === selectedClient.id) : [];
  const selectedClientMemberships = selectedClient ? memberships.filter(membership => membership.client_id === selectedClient.id) : [];
  const filteredClients = clients.filter(client => {
    const query = clientSearch.trim().toLowerCase();
    const matchesQuery = !query || `${client.name} ${client.slug}`.toLowerCase().includes(query);
    return matchesQuery && (clientStatusFilter === 'all' || client.billing_status === clientStatusFilter);
  });
  const visibleInvoices = invoices.filter(invoice => invoiceClientFilter === 'all' || invoice.client_id === invoiceClientFilter);
  const auditNeedle = auditSearch.trim().toLowerCase();
  const visibleAuditEntries = auditEntries.filter(entry => !auditNeedle || [
    entry.action, entry.entity_type, entry.entity_id, entry.actor_user_id, entry.reason, entry.clients?.name,
  ].some(value => String(value || '').toLowerCase().includes(auditNeedle)));
  const paymentTotalsByCurrency = payments.reduce((totals, payment) => {
    const currency = payment.currency || 'ZAR';
    const summary = totals[currency] || { settledCents:0, settledCount:0, pendingEftCents:0, pendingEftCount:0 };
    if (payment.status === 'settled') {
      summary.settledCents += Number(payment.amount_cents || 0);
      summary.settledCount += 1;
    }
    if (payment.status === 'pending_review' && payment.payment_method === 'eft') {
      summary.pendingEftCents += Number(payment.amount_cents || 0);
      summary.pendingEftCount += 1;
    }
    totals[currency] = summary;
    return totals;
  }, {});
  const paymentCurrencySummaries = Object.entries(paymentTotalsByCurrency);
  const issuedInvoiceCount = invoices.filter(invoice => !['draft','cancelled'].includes(invoice.status)).length;
  const selectedInvoice = invoices.find(invoice => invoice.id === selectedInvoiceId) || null;
  const clientById = new Map(clients.map(client => [client.id, client]));
  const eventById = new Map(events.map(event => [event.id, event]));
  const draftLineSubtotal = invoiceLines.reduce((sum,line)=>sum+Math.round(Number(line.quantity||0)*Number(line.unit_price_cents||0)),0);
  const draftLineDiscount = invoiceLines.reduce((sum,line)=>sum+Number(line.discount_cents||0),0);
  const quotaClientId = isPlatformAdmin ? eventForm.client_id : managedClientId;
  const quotaClient = clients.find(client => client.id === quotaClientId);
  const currentEventLimit = isPlatformAdmin ? Number(quotaClient?.event_limit || 1) : managedClientEventLimit;
  const currentClientEvents = events.filter(event => event.client_id === quotaClientId && !event.billing_exempt).length;
  const eventLimitReached = Boolean(quotaClientId && currentClientEvents >= currentEventLimit && !eventForm.billing_exempt);

  return (
    <div className="adm-shell">
      <aside className="adm-sidebar">
        <div className="adm-brand-lockup"><span className="adm-brand-mark"><LayoutDashboard size={17} /></span><div className="adm-brand">APEX OPS<sup>™</sup><small>{isPlatformAdmin ? 'PLATFORM OWNER' : 'CLIENT WORKSPACE'}</small></div></div>
        <nav aria-label={isPlatformAdmin ? 'Platform administration' : 'Client workspace'}>
          {navGroups.map(group=><div className="adm-nav-group" key={group.label}>
            <span className="adm-nav-label">{group.label}</span>
            {group.items.map(([key,label,Icon])=><button key={key} type="button" className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} onClick={()=>{setSection(key);if(key==='invoices'){setInvoiceClientFilter('all');loadInvoices();}if(key==='payments')loadPayments();if(key==='registrations')loadRegistrations();if(key==='activity')loadAuditLog();}}><Icon size={16} aria-hidden="true" /><span>{label}</span></button>)}
          </div>)}
        </nav>
        {isPlatformAdmin && <div className="adm-sidebar-foot"><span className="adm-sidebar-dot" /> Platform controls</div>}
      </aside>
    <main className="tenant-admin-page adm-main">
      <header className="tenant-admin-heading adm-topbar">
        <div>
          <div className="tenant-admin-kicker">{isPlatformAdmin ? 'APEX OPS / PLATFORM OWNER' : 'APEX OPS / CLIENT WORKSPACE'}</div>
          <h1>{sectionTitle}</h1>
          <p>{isPlatformAdmin ? 'Platform administration' : 'Manage events, suppliers and team access for your organisation.'}</p>
        </div>
        <button className="tenant-refresh" type="button" onClick={refresh} disabled={loading || saving} title="Refresh"><RefreshCw size={15} /> Refresh</button>
      </header>

      {error && <div className="tenant-feedback tenant-error" role="alert">{error}</div>}
      {notice && <div className="tenant-feedback tenant-notice" role="status">{notice}</div>}
      {loading ? <div className="tenant-loading">Loading clients, events and access…</div> : <>
        <section className="adm-overview" hidden={section !== 'overview'}>
          <div className="adm-stats">
            {isPlatformAdmin && <div className="adm-stat"><div className="adm-stat-head"><span>Client organisations</span><Building2 size={17} aria-hidden="true" /></div><strong>{clients.length}</strong><small>Registered organisations</small></div>}
            <div className="adm-stat"><div className="adm-stat-head"><span>Active client access</span><Users size={17} aria-hidden="true" /></div><strong>{isPlatformAdmin ? activeClientCount : (billingIsCurrent(managedClientId) ? 1 : 0)}</strong><small>From current billing status</small></div>
            <div className="adm-stat"><div className="adm-stat-head"><span>Live now</span><CalendarDays size={17} aria-hidden="true" /></div><strong>{liveEvents}</strong><small>Based on event dates</small></div>
            <div className="adm-stat"><div className="adm-stat-head"><span>Billable events</span><CreditCard size={17} aria-hidden="true" /></div><strong>{isPlatformAdmin ? billableEventCount : events.filter(event=>!event.billing_exempt).length}</strong><small>{isPlatformAdmin ? `${internalEventCount} internal ECE exempt` : 'Current event scope'}</small></div>
          </div>
          <div className="adm-overview-grid">
            <section className="tenant-section adm-panel">
              <div className="tenant-section-heading"><CalendarDays size={17} /><div><h2>{isPlatformAdmin ? 'Event portfolio' : 'Your events'}</h2><p>{isPlatformAdmin ? 'Current event status across accessible client workspaces.' : 'Current operational status.'}</p></div></div>
              {isPlatformAdmin && <label className="tenant-admin-filter">Filter events<select aria-label="Filter dashboard events" value={dashboardEventFilter} onChange={event=>setDashboardEventFilter(event.target.value)}><option value="">All events</option>{events.map(event=><option key={event.id} value={event.id}>{event.clients?.name ? `${event.clients.name} · ` : ''}{event.name}</option>)}</select></label>}
              <div className="tenant-list">
                {dashboardEvents.map(event => { const [label, tone] = eventStatus(event); return <div className="tenant-list-row" key={event.id}><div className="tenant-event-details"><strong>{event.name}</strong><span>{event.clients?.name ? `${event.clients.name} · ` : ''}{event.event_start_date} to {event.event_end_date}</span></div><span className={`adm-chip adm-chip-${tone}`}>{label}</span></div>; })}
                {!dashboardEvents.length && <p className="tenant-empty">No events match this filter.</p>}
              </div>
            </section>
            {isPlatformAdmin && <section className="tenant-section adm-panel adm-finance-panel">
              <div className="tenant-section-heading"><CreditCard size={17} /><div><h2>Commercial overview</h2><p>Verified records currently available to this portal.</p></div></div>
              {paymentCurrencySummaries.length ? paymentCurrencySummaries.map(([currency,summary])=><Fragment key={currency}>
                <div className="adm-finance-foot"><span>Settled payments · {currency} ({summary.settledCount})</span><strong>{formatCurrency(summary.settledCents,currency)}</strong></div>
                <div className="adm-finance-foot"><span>EFT awaiting review · {currency} ({summary.pendingEftCount})</span><strong>{formatCurrency(summary.pendingEftCents,currency)}</strong></div>
              </Fragment>) : <div className="adm-finance-empty"><span className="adm-finance-mark"><FileText size={17} /></span><div><strong>No payment records yet</strong><p>Settled receipts and EFTs awaiting review will appear here.</p></div></div>}
              <div className="adm-finance-foot"><span>Non-draft invoices</span><strong>{issuedInvoiceCount}</strong></div>
              <div className="adm-finance-foot"><span>Non-billable internal events</span><strong>{internalEventCount}</strong></div>
            </section>}
          </div>
        </section>
        {isPlatformAdmin && <section className="tenant-section" hidden={section !== 'clients'}>
          <div className="adm-page-heading"><div><span className="adm-section-count">{clients.length} ORGANISATIONS</span><h2 className="adm-page-title"><Building2 size={18} aria-hidden="true" />Clients & organisations</h2><p>Client ownership, access, event allowance, and current billing terms.</p></div></div>
          <div className="adm-table-tools"><label className="adm-search"><span className="sr-only">Search clients</span><input type="search" value={clientSearch} onChange={event=>setClientSearch(event.target.value)} placeholder="Search organisations" /></label><label className="adm-filter-select"><span className="sr-only">Filter by access status</span><select value={clientStatusFilter} onChange={event=>setClientStatusFilter(event.target.value)}><option value="all">All access states</option>{['active','pending','past_due','suspended','cancelled'].map(status=><option key={status} value={status}>{status.replace('_',' ')}</option>)}</select></label></div>
          <div className="adm-table-wrap">
            <table className="adm-data-table">
              <thead><tr><th>Organisation</th><th>Plan</th><th>Events</th><th>Access</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{filteredClients.map(client=>{
                const billableCount=events.filter(event=>event.client_id===client.id&&!event.billing_exempt).length;
                const selected=selectedClient?.id===client.id;
                return <tr key={client.id} className={selected?'selected':''}>
                  <td><button className="adm-client-select" type="button" onClick={()=>{setSelectedClientId(client.id);setClientDetailTab('overview');}}><strong>{client.name}</strong><small>{client.slug}</small></button></td>
                  <td><span className="adm-plan-tag">{(client.billing_plan||'legacy').replace(/_/g,' ')}</span></td>
                  <td>{billableCount} / {client.event_limit||1}</td>
                  <td><span className={`adm-status-pill adm-status-${client.billing_status||'pending'}`}>{(client.billing_status||'pending').replace('_',' ')}</span></td>
                  <td><button className="adm-manage-client" type="button" onClick={()=>{setSelectedClientId(client.id);setClientDetailTab('overview');}}>Manage <span aria-hidden="true">→</span></button></td>
                </tr>;
              })}</tbody>
            </table>
            {!filteredClients.length&&<p className="tenant-empty">No organisations match these filters.</p>}
          </div>
          {selectedClient&&<div className="adm-client-detail">
            <div className="adm-detail-heading"><div><span className="adm-section-count">CLIENT ACCOUNT</span><h3>{selectedClient.name}</h3><p>{selectedClient.slug} · {selectedClient.id}</p></div><span className={`adm-status-pill adm-status-${selectedClient.billing_status||'pending'}`}>{(selectedClient.billing_status||'pending').replace('_',' ')}</span></div>
            <div className="adm-detail-tabs" role="tablist" aria-label={`${selectedClient.name} details`}>
              {clientDetailTabs.map(([key,label])=><button key={key} type="button" role="tab" aria-selected={clientDetailTab===key} className={clientDetailTab===key?'active':''} onClick={()=>{if(key==='invoices'){setInvoiceClientFilter(selectedClient.id);setSection('invoices');loadInvoices();}else {setClientDetailTab(key);if(key==='activity')loadClientAuditLog(selectedClient.id);}}}>{label}</button>)}
            </div>
            {clientDetailTab==='overview'&&<div className="adm-detail-grid">
              <div className="adm-detail-fact"><span>Organisation URL</span><strong>{selectedClient.slug}</strong></div>
              <div className="adm-detail-fact"><span>Current access</span><strong>{selectedClient.billing_status||'pending'}</strong></div>
              <div className="adm-detail-fact"><span>Billing mode</span><strong>{(selectedClient.billing_mode||'unmanaged').replace('_',' ')}</strong></div>
              <div className="adm-detail-fact"><span>Billable events</span><strong>{selectedClientEvents.filter(event=>!event.billing_exempt).length} of {selectedClient.event_limit||1}</strong></div>
              <label className="tenant-quota-control adm-detail-quota">Event allowance<input type="number" min="1" max="1000" value={selectedClient.event_limit||1} disabled={saving} onChange={event=>setClients(current=>current.map(item=>item.id===selectedClient.id?{...item,event_limit:event.target.value}:item))} onBlur={event=>updateClientEventLimit(selectedClient.id,event.target.value)} /></label>
            </div>}
            {clientDetailTab === 'users' && (
              <>
                <MembershipTable memberships={selectedClientMemberships} clientById={clientById} eventById={eventById} saving={saving} onRoleChange={updateMembershipRole} onRemove={removeMembership} />
                {isPlatformAdmin && (
                  <form className="tenant-form tenant-invite-form adm-invite-form" onSubmit={inviteMember}>
                    <h3>Invite or update a user</h3>
                    <label>Organisation<select required value={inviteForm.client_id} onChange={event=>setInviteForm({ ...inviteForm, client_id:event.target.value, event_id:'' })}><option value="">Select organisation</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
                    <label>Event scope<select value={inviteForm.event_id} onChange={event=>setInviteForm({ ...inviteForm, event_id:event.target.value })}><option value="">Organisation-wide</option>{inviteClientEvents.map(event=><option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
                    <label>Role<select value={inviteForm.role} onChange={event=>setInviteForm({ ...inviteForm, role:event.target.value })}><option value="client_admin">Client admin</option><option value="event_admin">Event admin</option><option value="ops">Operations</option><option value="staff">Staff</option></select></label>
                    <label>Email<input required type="email" value={inviteForm.email} onChange={event=>setInviteForm({ ...inviteForm, email:event.target.value })} /></label>
                    <button type="submit" disabled={saving||!inviteForm.client_id}><MailPlus size={15} /> Invite / update access</button>
                  </form>
                )}
              </>
            )}
            {clientDetailTab==='subscription'&&<BillingControls client={selectedClient} saving={saving} onSave={updateClientBilling} volumePlans={pricingConfig.volumePlans} />}
            {clientDetailTab==='events'&&<EventTable events={selectedClientEvents} />}
            {clientDetailTab==='activity'&&<div>
              {clientAuditLoading?<p className="tenant-loading">Loading client activity…</p>:<div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>Date</th><th>Actor</th><th>Action</th><th>Record</th><th>Reason</th></tr></thead><tbody>
                {clientAuditEntries.map(entry=><tr key={entry.id}><td>{entry.created_at?new Date(entry.created_at).toLocaleString('en-ZA'):'—'}</td><td><code>{entry.actor_user_id?`${entry.actor_user_id.slice(0,8)}…`:'System'}</code></td><td>{entry.action}</td><td>{entry.entity_type}{entry.entity_id&&<small>{entry.entity_id.slice(0,8)}…</small>}</td><td>{entry.reason||'—'}</td></tr>)}
              </tbody></table>{!clientAuditEntries.length&&<p className="tenant-empty">No client activity has been recorded yet.</p>}</div>}
            </div>}
          </div>}
          {isPlatformAdmin && <form className="tenant-form tenant-inline-form" onSubmit={createClient}>
            <h3>Create client workspace</h3>
            <label>Organisation name<input required maxLength="160" value={clientForm.name} onChange={event=>setClientForm({ ...clientForm, name:event.target.value })} /></label>
            <label>URL slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={clientForm.slug} onChange={event=>setClientForm({ ...clientForm, slug:event.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'') })} /></label>
            <label>Event limit<input required type="number" min="1" max="1000" value={clientForm.eventLimit} onChange={event=>setClientForm({ ...clientForm, eventLimit:event.target.value })} /><small>Maximum number of events this client can create.</small></label>
            <label>First client admin email<input required type="email" value={clientForm.adminEmail} onChange={event=>setClientForm({ ...clientForm, adminEmail:event.target.value })} /><small>We’ll invite this person to manage the client’s events and team.</small></label>
            <button type="submit" disabled={saving}><Plus size={15} /> Create client</button>
          </form>}
        </section>}

        {isPlatformAdmin && <section className="tenant-section" hidden={section !== 'pricing'}>
          <div className="tenant-section-heading"><CalendarDays size={17} /><div><h2>Proposed launch pricing</h2><p>Edit event size bands and annual discounts. ZAR per event; VAT, if applicable, is additional.</p></div><button className="tenant-add-event" type="button" disabled={saving} onClick={savePricingConfig}><Check size={15} /> Save pricing</button></div>
          <div className="tenant-pricing-table-wrap"><table className="tenant-pricing-table">
            <thead><tr><th>Event category</th><th>Minimum stands / build locations</th><th>Maximum</th><th>Price (ZAR)</th></tr></thead>
            <tbody>{pricingConfig.eventTiers.map((tier,index)=><tr key={tier.id}>
              <td><input aria-label={`Category ${tier.id}`} value={tier.name} onChange={event=>updatePricingTier(index,'name',event.target.value)} /></td>
              <td><input aria-label={`Minimum locations ${tier.id}`} type="number" min="1" step="1" value={tier.minLocations} onChange={event=>updatePricingTier(index,'minLocations',event.target.value === '' ? '' : Number(event.target.value))} /></td>
              <td><input aria-label={`Maximum locations ${tier.id}`} type="number" min="1" step="1" placeholder="No limit" value={tier.maxLocations ?? ''} onChange={event=>updatePricingTier(index,'maxLocations',event.target.value === '' ? null : Number(event.target.value))} /></td>
              <td><input aria-label={`Price ZAR ${tier.id}`} type="number" min="0" step="1" placeholder="Custom quote" value={tier.listPrice ?? ''} onChange={event=>updatePricingTier(index,'listPrice',event.target.value === '' ? null : Number(event.target.value))} /></td>
            </tr>)}</tbody>
          </table></div>
          <p className="tenant-scope-note">Floor area, halls, operational zones and complexity also require assessment; a custom quote may apply.</p>
          <h3>Annual commitment</h3>
          <div className="tenant-pricing-table-wrap"><table className="tenant-pricing-table"><thead><tr><th>Minimum events / year</th><th>Maximum</th><th>Discount (%)</th></tr></thead><tbody><tr><td>1</td><td>11</td><td>0</td></tr>{pricingConfig.volumePlans.map((plan,index)=><tr key={plan.id}>
            <td><input aria-label={`Minimum annual events ${plan.id}`} type="number" min="1" step="1" value={plan.eventsPerYear} onChange={event=>updateVolumePlan(index,'eventsPerYear',event.target.value === '' ? '' : Number(event.target.value))} /></td>
            <td><input aria-label={`Maximum annual events ${plan.id}`} type="number" min="1" step="1" value={plan.maxEvents} onChange={event=>updateVolumePlan(index,'maxEvents',event.target.value === '' ? '' : Number(event.target.value))} /></td>
            <td><input aria-label={`Discount percent ${plan.id}`} type="number" min="0" max="100" step="0.1" value={plan.discountPct} onChange={event=>updateVolumePlan(index,'discountPct',event.target.value === '' ? '' : Number(event.target.value))} /></td>
          </tr>)}</tbody></table></div>
          <p className="tenant-scope-note">Includes {INCLUDED_INTERNAL_SEATS} internal operational accounts; additional internal accounts are R{EXTRA_STAFF_SEAT_PRICE} per user per event. Exhibitor access is free.</p>
        </section>}

        {isPlatformAdmin&&<>
          <section className="tenant-section adm-workspace-section" hidden={section!=='users'}>
            <div className="adm-page-heading"><div><span className="adm-section-count">{memberships.length} MEMBERSHIPS</span><h2 className="adm-page-title"><Users size={18} aria-hidden="true" />Users & access</h2><p>Role assignments and event scope from current client memberships.</p></div></div>
            <MembershipTable memberships={memberships} clientById={clientById} eventById={eventById} saving={saving} onRoleChange={updateMembershipRole} onRemove={removeMembership} />
          </section>
          <section className="tenant-section adm-workspace-section" hidden={section!=='registrations'}>
            <div className="adm-page-heading"><div><span className="adm-section-count">{registrations.filter(item=>item.status==='submitted').length} AWAITING REVIEW</span><h2 className="adm-page-title"><UserPlus size={18} aria-hidden="true"/>Client registrations</h2><p>Review requests, verify billing, then explicitly activate access and invite the client administrator.</p></div><button className="tenant-refresh" type="button" onClick={loadRegistrations} disabled={registrationLoading||saving}><RefreshCw size={14}/> Refresh requests</button></div>
            {registrationLoading?<p className="tenant-loading">Loading registration requests…</p>:<div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>Organisation / contact</th><th>Submitted</th><th>Review status</th><th>Account / billing</th><th>Action</th></tr></thead><tbody>
              {registrations.map(registration=>{
                const account=registration.clients||clients.find(client=>client.id===registration.client_id)||{};
                return <tr key={registration.id}><td><strong>{registration.registered_business_name}</strong><small>{registration.primary_contact_name} · {registration.primary_contact_email}</small>{registration.company_registration_number&&<small>Reg. {registration.company_registration_number}</small>}</td><td>{new Date(registration.submitted_at).toLocaleDateString('en-ZA')}</td><td><span className={`adm-status-pill adm-status-${registration.status}`}>{registration.status}</span><small>{registration.review_note||''}</small></td><td>{account.account_status||'unknown'}<small>Billing: {account.billing_status||'unknown'}</small></td><td>{registration.status==='submitted'?<><button className="adm-manage-client" type="button" disabled={saving} onClick={()=>reviewClientRegistration(registration,true)}>Approve</button><button className="adm-manage-client" type="button" disabled={saving} onClick={()=>reviewClientRegistration(registration,false)}>Reject</button></>:registration.status==='approved'&&account.account_status==='pending_payment'?<button className="adm-manage-client" type="button" disabled={saving||account.billing_status!=='active'} title={account.billing_status==='active'?'Activate and invite client admin':'Mark billing active after verification before activation'} onClick={()=>activateClientRegistration(registration)}>Activate & invite</button>:registration.status==='approved'&&account.account_status==='active'?<button className="adm-manage-client" type="button" disabled={saving} onClick={()=>sendRegistrationInvitation(registration)}>Send client admin invite</button>:<span>—</span>}</td></tr>;
              })}
            </tbody></table>{!registrations.length&&<p className="tenant-empty">No client registration requests.</p>}</div>}
          </section>
          <section className="tenant-section adm-workspace-section" hidden={section!=='subscriptions'}>
            <div className="adm-page-heading"><div><span className="adm-section-count">CURRENT ENTITLEMENTS</span><h2 className="adm-page-title"><Briefcase size={18} aria-hidden="true" />Subscriptions & agreements</h2><p>Current access terms stored on client records. Signed historical agreements are not available in this system.</p></div></div>
            <div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>Organisation</th><th>Plan</th><th>Mode</th><th>Allowance / credits</th><th>Term</th><th>Access</th></tr></thead><tbody>
              {clients.map(client=><tr key={client.id}><td><strong>{client.name}</strong></td><td>{(client.billing_plan||'legacy').replace(/_/g,' ')}</td><td>{(client.billing_mode||'unmanaged').replace('_',' ')}</td><td>{client.billing_mode==='monthly'?`${client.committed_events||0} committed · ${client.prepaid_event_credits||0} extra`:`${client.event_limit||1} events · ${client.prepaid_event_credits||0} credits`}</td><td>{client.term_started_at&&client.term_ends_at?`${client.term_started_at} – ${client.term_ends_at}`:client.trial_ends_at?`Trial to ${client.trial_ends_at}`:client.paid_through?`Paid through ${client.paid_through}`:'No term recorded'}</td><td><span className={`adm-status-pill adm-status-${client.billing_status||'pending'}`}>{(client.billing_status||'pending').replace('_',' ')}</span></td></tr>)}
            </tbody></table>{!clients.length&&<p className="tenant-empty">No client entitlement records available.</p>}</div>
          </section>
          <section className="tenant-section adm-workspace-section" hidden={section!=='reports'}>
            <div className="adm-page-heading"><div><span className="adm-section-count">USAGE / LIVE DATA</span><h2 className="adm-page-title"><BarChart3 size={18} aria-hidden="true" />Event usage</h2><p>Usage counts use event records and exclude explicitly exempt internal events.</p></div></div>
            <div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>Organisation</th><th>Billable events</th><th>Internal exempt</th><th>Allowance</th><th>Usage</th></tr></thead><tbody>
              {clients.map(client=>{const billable=events.filter(event=>event.client_id===client.id&&!event.billing_exempt).length;const exempt=events.filter(event=>event.client_id===client.id&&event.billing_exempt).length;const allowance=Number(client.event_limit||1);return <tr key={client.id}><td><strong>{client.name}</strong></td><td>{billable}</td><td>{exempt}</td><td>{allowance}</td><td><div className="adm-usage-track"><span style={{width:`${Math.min(100,Math.round((billable/allowance)*100))}%`}} /></div><small>{billable} / {allowance}</small></td></tr>;})}
            </tbody></table>{!clients.length&&<p className="tenant-empty">No client usage data available.</p>}</div>
            <div className="adm-report-note"><strong>Collection summary · not accounting revenue</strong><span>Settled receipts and EFTs awaiting review are shown separately by currency from the payment ledger.</span></div>
            <div className="adm-stats">
              {paymentCurrencySummaries.map(([currency,summary])=><Fragment key={currency}>
                <div className="adm-stat"><div className="adm-stat-head"><span>Settled payments · {currency}</span><CreditCard size={17} aria-hidden="true" /></div><strong>{formatCurrency(summary.settledCents,currency)}</strong><small>{summary.settledCount} settled records</small></div>
                <div className="adm-stat"><div className="adm-stat-head"><span>EFT awaiting review · {currency}</span><FileText size={17} aria-hidden="true" /></div><strong>{formatCurrency(summary.pendingEftCents,currency)}</strong><small>{summary.pendingEftCount} pending submissions</small></div>
              </Fragment>)}
              <div className="adm-stat"><div className="adm-stat-head"><span>Non-draft invoices</span><FileText size={17} aria-hidden="true" /></div><strong>{issuedInvoiceCount}</strong><small>Issued, paid, overdue, or credited</small></div>
            </div>
          </section>
          <section className="tenant-section adm-workspace-section" hidden={section!=='invoices'}>
            <div className="adm-page-heading">
              <div><span className="adm-section-count">{visibleInvoices.length} INVOICES</span><h2 className="adm-page-title"><FileText size={18} aria-hidden="true" />Invoices</h2><p>Create a draft, review its line items and totals, then issue it to lock its financial values.</p></div>
              <button className="tenant-add-event" type="button" disabled={!clients.length||invoiceLoading} onClick={()=>{setEditingInvoiceId('');setInvoiceForm({...emptyInvoiceForm,client_id:selectedClient?.id||clients[0]?.id||'',billed_to_name:selectedClient?.name||clients[0]?.name||''});setInvoiceLines([{...emptyInvoiceLine}]);setShowInvoiceForm(value=>!value);}}><Plus size={15}/>{showInvoiceForm?'Close form':'New invoice'}</button>
            </div>
            <details className="adm-tax-settings">
              <summary><Settings size={15} aria-hidden="true"/> Tax configuration</summary>
              <form className="adm-invoice-tax-form" onSubmit={saveInvoiceTaxSettings}>
                <label className="adm-tax-toggle"><input type="checkbox" checked={Boolean(invoiceTaxSettings.is_registered)} onChange={event=>setInvoiceTaxSettings(current=>({...current,is_registered:event.target.checked}))}/><span>Charge configured tax on new invoices</span></label>
                <label>Tax label<input required maxLength="40" value={invoiceTaxSettings.tax_label} onChange={event=>setInvoiceTaxSettings(current=>({...current,tax_label:event.target.value}))}/></label>
                <label>Tax rate (%)<input type="number" min="0" max="100" step="0.01" value={Number(invoiceTaxSettings.tax_rate_basis_points||0)/100} onChange={event=>setInvoiceTaxSettings(current=>({...current,tax_rate_basis_points:Math.round(Number(event.target.value||0)*100)}))}/></label>
                <p>Changes apply to new drafts only. Existing invoices keep their saved tax snapshot.</p>
                <button type="submit" disabled={taxSettingsSaving}><Check size={14}/> Save tax settings</button>
              </form>
            </details>
            {showInvoiceForm&&<form className="tenant-form adm-invoice-form" onSubmit={saveInvoiceDraft}>
              <h3>New invoice draft</h3>
              <label>Organisation<select aria-label="Invoice organisation" required value={invoiceForm.client_id} onChange={event=>{const client=clientById.get(event.target.value);setInvoiceForm(current=>({...current,client_id:event.target.value,billed_to_name:current.billed_to_name||client?.name||''}));}}><option value="">Select organisation</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
              <label>Billed-to name<input aria-label="Billed-to name" required minLength="2" maxLength="200" value={invoiceForm.billed_to_name} onChange={event=>setInvoiceForm({...invoiceForm,billed_to_name:event.target.value})}/></label>
              <label>Billing email<input type="email" value={invoiceForm.billed_to_email} onChange={event=>setInvoiceForm({...invoiceForm,billed_to_email:event.target.value})}/></label>
              <label>Invoice date<input type="date" value={invoiceForm.invoice_date} onChange={event=>setInvoiceForm({...invoiceForm,invoice_date:event.target.value})}/></label>
              <label>Due date<input type="date" min={invoiceForm.invoice_date||undefined} value={invoiceForm.due_date} onChange={event=>setInvoiceForm({...invoiceForm,due_date:event.target.value})}/></label>
              <label>Invoice description<input aria-label="Invoice description" maxLength="300" value={invoiceForm.description} onChange={event=>setInvoiceForm({...invoiceForm,description:event.target.value})}/></label>
              <label className="adm-invoice-full">Payment instructions<textarea rows="2" value={invoiceForm.payment_instructions} onChange={event=>setInvoiceForm({...invoiceForm,payment_instructions:event.target.value})}/></label>
              <div className="adm-invoice-lines">
                <div className="adm-invoice-lines-head"><div><strong>Line items</strong><small>Amounts are entered in cents. Tax uses the current platform tax setting.</small></div><button className="tenant-edit-event" type="button" onClick={()=>setInvoiceLines(current=>[...current,{...emptyInvoiceLine}])}><Plus size={14}/> Add line</button></div>
                {invoiceLines.map((line,index)=><div className="adm-invoice-line" key={index}>
                  <label>Description<input aria-label={`Line ${index+1} description`} required maxLength="300" value={line.description} onChange={event=>setInvoiceLines(current=>current.map((item,itemIndex)=>itemIndex===index?{...item,description:event.target.value}:item))}/></label>
                  <label>Quantity<input aria-label={`Line ${index+1} quantity`} required type="number" min="0.01" step="0.01" value={line.quantity} onChange={event=>setInvoiceLines(current=>current.map((item,itemIndex)=>itemIndex===index?{...item,quantity:event.target.value}:item))}/></label>
                  <label>Unit price (cents)<input aria-label={`Line ${index+1} unit price cents`} required type="number" min="0" step="1" value={line.unit_price_cents} onChange={event=>setInvoiceLines(current=>current.map((item,itemIndex)=>itemIndex===index?{...item,unit_price_cents:event.target.value}:item))}/></label>
                  <label>Line discount (cents)<input aria-label={`Line ${index+1} discount cents`} type="number" min="0" step="1" value={line.discount_cents} onChange={event=>setInvoiceLines(current=>current.map((item,itemIndex)=>itemIndex===index?{...item,discount_cents:event.target.value}:item))}/></label>
                  <button className="adm-revoke-access" type="button" disabled={invoiceLines.length===1} onClick={()=>setInvoiceLines(current=>current.filter((_,itemIndex)=>itemIndex!==index))}>Remove line</button>
                </div>)}
              </div>
              <label>Invoice discount (cents)<input type="number" min="0" step="1" value={invoiceForm.invoice_discount_cents} onChange={event=>setInvoiceForm({...invoiceForm,invoice_discount_cents:event.target.value})}/></label>
              <div className="adm-invoice-preview"><span>Line subtotal {formatCurrency(draftLineSubtotal)} · Line discounts {formatCurrency(draftLineDiscount)}</span><strong>Pre-tax after invoice discount {formatCurrency(Math.max(0,draftLineSubtotal-draftLineDiscount-Number(invoiceForm.invoice_discount_cents||0)))}</strong></div>
              <button type="submit" disabled={saving||!invoiceForm.client_id}><FileText size={15}/> Save draft</button>
            </form>}
            <div className="adm-table-tools"><label className="adm-filter-select"><span className="sr-only">Filter invoices by organisation</span><select value={invoiceClientFilter} onChange={event=>setInvoiceClientFilter(event.target.value)}><option value="all">All organisations</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label><span className="adm-invoice-note">Drafts are editable; issued financial values are locked.</span></div>
            {invoiceLoading?<p className="tenant-loading">Loading invoices…</p>:<div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>Invoice</th><th>Organisation</th><th>Date / due</th><th>Status</th><th>Total</th><th>Action</th></tr></thead><tbody>
              {visibleInvoices.map(invoice=>{const client=clientById.get(invoice.client_id);return <tr key={invoice.id} className={selectedInvoiceId===invoice.id?'selected':''}><td><button className="adm-client-select" type="button" onClick={()=>selectInvoice(invoice.id)}><strong>{invoice.invoice_number}</strong><small>{invoice.description||'Invoice'}</small></button></td><td>{client?.name||invoice.clients?.name||invoice.billed_to_name}</td><td>{invoice.invoice_date||'—'}<small>Due {invoice.due_date||'not set'}</small></td><td><span className={`adm-status-pill adm-status-${invoice.status}`}>{invoice.status}</span></td><td><strong>{formatCurrency(invoice.total_cents,invoice.currency||'ZAR')}</strong></td><td>{invoice.status==='draft'?<><button className="adm-manage-client" type="button" disabled={saving} onClick={()=>editInvoiceDraft(invoice)}><Pencil size={14}/> Edit</button><button className="adm-manage-client" type="button" disabled={saving} onClick={()=>issueInvoice(invoice.id)}><Check size={14}/> Issue</button></>:<button className="adm-manage-client" type="button" onClick={()=>selectInvoice(invoice.id)}>View</button>}</td></tr>;})}
            </tbody></table>{!visibleInvoices.length&&<p className="tenant-empty">{error||'No invoices match this organisation.'}</p>}</div>}
            {selectedInvoice&&<section id="adm-invoice-print" className="adm-invoice-detail">
              <div className="adm-detail-heading">
                <div><span className="adm-section-count">APEX OPS · INVOICE</span><h3>{selectedInvoice.invoice_number}</h3><p>{selectedInvoice.billed_to_name} · {selectedInvoice.billed_to_email||''}</p><p>{selectedInvoice.description||'Invoice'} · {selectedInvoice.invoice_date} · Due {selectedInvoice.due_date||'not set'}</p></div>
                <div className="adm-invoice-print-actions"><span className={`adm-status-pill adm-status-${selectedInvoice.status}`}>{selectedInvoice.status}</span>{selectedInvoice.status!=='draft'&&<button className="tenant-edit-event" type="button" onClick={()=>downloadInvoicePdf(selectedInvoice,invoiceItems)}><Download size={14}/> Download PDF</button>}{selectedInvoice.status!=='draft'&&selectedInvoice.billed_to_email&&<button className="tenant-edit-event" type="button" disabled={invoiceSending} onClick={()=>sendInvoiceEmail(selectedInvoice)}><Mail size={14}/>{invoiceSending?'Sending…':'Send invoice'}</button>}{selectedInvoice.status==='draft'&&<button className="tenant-edit-event" type="button" onClick={()=>editInvoiceDraft(selectedInvoice)}><Pencil size={14}/> Edit draft</button>}</div>
              </div>
              <div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>Item</th><th>Quantity</th><th>Unit price</th><th>Discount</th><th>Line total</th></tr></thead><tbody>{invoiceItems.map(item=><tr key={item.id}><td>{item.description}</td><td>{item.quantity}</td><td>{formatCurrency(item.unit_price_cents,selectedInvoice.currency||'ZAR')}</td><td>{formatCurrency(item.discount_cents,selectedInvoice.currency||'ZAR')}</td><td>{formatCurrency(item.line_total_cents,selectedInvoice.currency||'ZAR')}</td></tr>)}</tbody></table>{!invoiceItems.length&&<p className="tenant-empty">No invoice items loaded.</p>}</div>
              {isPlatformAdmin&&selectedInvoice.status==='draft'&&<div className="adm-credit-note-section">
                <div className="adm-invoice-lines-head"><div><strong>Paid exhibitor-order fees</strong><small>Only 3% fees from fully paid exhibitor invoices accrue here. They are never added before settlement.</small></div></div>
                <label>Paid month<input type="month" value={exhibitorFeeMonth} onChange={event=>setExhibitorFeeMonth(event.target.value)} aria-label="Paid exhibitor fee month"/></label>
                <button className="tenant-edit-event" type="button" disabled={attachingExhibitorFees||!exhibitorFeeMonth} onClick={()=>attachExhibitorFees(selectedInvoice)}><Plus size={14}/>{attachingExhibitorFees?'Attaching…':'Attach unbilled fees to this draft'}</button>
              </div>}
              <div className="adm-invoice-totals"><span>Subtotal {formatCurrency(selectedInvoice.subtotal_cents,selectedInvoice.currency||'ZAR')}</span><span>Line discounts {formatCurrency(selectedInvoice.line_discount_cents,selectedInvoice.currency||'ZAR')}</span><span>Invoice discount {formatCurrency(selectedInvoice.invoice_discount_cents,selectedInvoice.currency||'ZAR')}</span><span>{selectedInvoice.tax_label||'Tax'} {formatCurrency(selectedInvoice.tax_cents,selectedInvoice.currency||'ZAR')}</span><strong>Total {formatCurrency(selectedInvoice.total_cents,selectedInvoice.currency||'ZAR')}</strong></div>
              {['issued','partially_credited'].includes(selectedInvoice.status)&&<div className="adm-credit-note-section">
                <div className="adm-invoice-lines-head"><div><strong>Credit notes</strong><small>Issued credit notes are audit logged and capped at the invoice total.</small></div><button className="tenant-edit-event" type="button" disabled={saving} onClick={()=>setShowCreditNoteForm(value=>!value)}><Plus size={14}/>{showCreditNoteForm?'Close':'New credit note'}</button></div>
                {showCreditNoteForm&&<form className="tenant-form adm-credit-note-form" onSubmit={createCreditNote}>
                  <label>Credit amount (cents)<input aria-label="Credit amount cents" required type="number" min="1" step="1" value={creditNoteForm.amount_cents} onChange={event=>setCreditNoteForm(current=>({...current,amount_cents:event.target.value}))}/></label>
                  <label>Reason<input aria-label="Credit note reason" required minLength="2" maxLength="500" value={creditNoteForm.reason} onChange={event=>setCreditNoteForm(current=>({...current,reason:event.target.value}))}/></label>
                  <label>Description<input value={creditNoteForm.description} onChange={event=>setCreditNoteForm(current=>({...current,description:event.target.value}))}/></label>
                  <button type="submit" disabled={saving}><FileText size={14}/> Issue credit note</button>
                </form>}
                {creditNotes.length>0&&<div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>Credit note</th><th>Date</th><th>Reason</th><th>Status</th><th>Amount</th></tr></thead><tbody>{creditNotes.map(note=><tr key={note.id}><td><strong>{note.credit_note_number}</strong></td><td>{note.issued_on}</td><td>{note.reason}</td><td>{note.status}</td><td>{formatCurrency(note.amount_cents,note.currency||selectedInvoice.currency||'ZAR')}</td></tr>)}</tbody></table></div>}
              </div>}
            </section>}
          </section>
          <section className="tenant-section adm-workspace-section" hidden={section!=='payments'}>
            <div className="adm-page-heading"><div><span className="adm-section-count">{payments.length} PAYMENT RECORDS</span><h2 className="adm-page-title"><CreditCard size={18} aria-hidden="true" />Payments & EFT verification</h2><p>Record confirmed receipts, review submitted EFT proof, and retain an auditable allocation history.</p></div><button className="tenant-refresh" type="button" onClick={loadPayments} disabled={paymentLoading||saving}><RefreshCw size={14}/> Refresh payments</button></div>
            <form className="tenant-form adm-payment-form" onSubmit={recordPayment}>
              <h3>Record received payment</h3>
              <label>Invoice<select required value={paymentForm.invoice_id} onChange={event=>setPaymentForm(current=>({...current,invoice_id:event.target.value}))}><option value="">Select open invoice</option>{invoices.filter(invoice=>['issued','partially_paid','partially_credited'].includes(invoice.status)).map(invoice=><option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {invoice.billed_to_name} · {formatCurrency(invoice.total_cents,invoice.currency||'ZAR')}</option>)}</select></label>
              <label>Method<select value={paymentForm.payment_method} onChange={event=>setPaymentForm(current=>({...current,payment_method:event.target.value}))}><option value="eft">EFT</option><option value="cash">Cash</option><option value="other">Other</option></select></label>
              <label>Amount (cents)<input aria-label="Payment amount cents" required type="number" min="1" step="1" value={paymentForm.amount_cents} onChange={event=>setPaymentForm(current=>({...current,amount_cents:event.target.value}))}/></label>
              <label>Paid on<input required type="date" value={paymentForm.paid_on} onChange={event=>setPaymentForm(current=>({...current,paid_on:event.target.value}))}/></label>
              <label>Bank / receipt reference<input required maxLength="160" value={paymentForm.reference} onChange={event=>setPaymentForm(current=>({...current,reference:event.target.value}))}/></label>
              <label>Note<input maxLength="500" value={paymentForm.note} onChange={event=>setPaymentForm(current=>({...current,note:event.target.value}))}/></label>
              <button type="submit" disabled={saving||!invoices.some(invoice=>['issued','partially_paid','partially_credited'].includes(invoice.status))}><Check size={15}/> Record payment</button>
            </form>
            {paymentLoading?<p className="tenant-loading">Loading payment records…</p>:<div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>Payment</th><th>Organisation</th><th>Method / date</th><th>Reference / evidence</th><th>Status</th><th>Amount</th><th>Action</th></tr></thead><tbody>
              {payments.map(payment=>{
                const allocations=paymentAllocations.filter(item=>item.payment_id===payment.id);
                const client=clientById.get(payment.client_id);
                return <tr key={payment.id}><td><strong>{payment.id.slice(0,8)}</strong><small>{allocations.map(item=>item.client_invoices?.invoice_number||invoices.find(invoice=>invoice.id===item.invoice_id)?.invoice_number||'Invoice').join(', ')||'Unallocated'}</small></td><td>{client?.name||'Client'}</td><td>{payment.payment_method.toUpperCase()}<small>{payment.paid_on}</small></td><td>{payment.reference||'—'}<small>{payment.evidence_reference?'Proof attached':payment.note||''}</small>{payment.evidence_reference&&<><button className="adm-manage-client" type="button" onClick={()=>createEftEvidenceLink(payment)}>Create secure proof link</button>{evidenceLinks[payment.id]&&<a href={evidenceLinks[payment.id]} target="_blank" rel="noreferrer">Open proof</a>}</>}</td><td><span className={`adm-status-pill adm-status-${payment.status}`}>{payment.status.replace('_',' ')}</span></td><td><strong>{formatCurrency(payment.amount_cents,payment.currency||'ZAR')}</strong></td><td>{payment.status==='pending_review'?<><button className="adm-manage-client" type="button" disabled={saving} onClick={()=>reviewEftPayment(payment,true)}>Approve</button><button className="adm-manage-client" type="button" disabled={saving} onClick={()=>reviewEftPayment(payment,false)}>Reject</button></>:payment.status==='settled'?<button className="adm-manage-client" type="button" disabled={saving} onClick={()=>reversePayment(payment)}>Reverse</button>:<span>—</span>}</td></tr>;
              })}
            </tbody></table>{!payments.length&&<p className="tenant-empty">{error||'No payment records yet.'}</p>}</div>}
          </section>
          <section className="tenant-section adm-workspace-section" hidden={section!=='activity'}>
            <div className="adm-page-heading"><div><span className="adm-section-count">{auditEntries.length} RECENT EVENTS</span><h2 className="adm-page-title"><Activity size={18} aria-hidden="true" />Activity & audit log</h2><p>Platform changes recorded by billing, registration, invoice, and payment workflows.</p></div><button className="tenant-refresh" type="button" onClick={loadAuditLog} disabled={auditLoading}><RefreshCw size={14}/> Refresh activity</button></div>
            <div className="adm-table-tools"><label className="adm-search"><span className="sr-only">Search audit activity</span><input type="search" aria-label="Search audit activity" value={auditSearch} onChange={event=>setAuditSearch(event.target.value)} placeholder="Search actions, organisations, or records" /></label></div>
            {auditLoading?<p className="tenant-loading">Loading audit activity…</p>:<div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>Date</th><th>Actor</th><th>Organisation</th><th>Action</th><th>Record</th><th>Reason</th></tr></thead><tbody>
              {visibleAuditEntries.map(entry=><tr key={entry.id}><td>{entry.created_at?new Date(entry.created_at).toLocaleString('en-ZA'):'—'}</td><td><code>{entry.actor_user_id?`${entry.actor_user_id.slice(0,8)}…`:'System'}</code></td><td>{entry.clients?.name||'—'}</td><td>{entry.action}</td><td>{entry.entity_type}{entry.entity_id&&<small>{entry.entity_id.slice(0,8)}…</small>}</td><td>{entry.reason||'—'}</td></tr>)}
            </tbody></table>{!visibleAuditEntries.length&&<p className="tenant-empty">{auditEntries.length?'No audit entries match this search.':'No platform activity has been recorded yet.'}</p>}</div>}
          </section>
          <section className="tenant-section adm-workspace-section" hidden={section!=='security'}>
            <div className="adm-page-heading"><div><span className="adm-section-count">CURRENT MEMBERSHIPS</span><h2 className="adm-page-title"><Shield size={18} aria-hidden="true" />Security & permissions</h2><p>Current role assignments. Tenant and event access remain enforced by Supabase policies.</p></div></div>
            <div className="adm-role-grid">{['client_admin','event_admin','ops','staff'].map(role=><div className="adm-role-count" key={role}><span>{role.replace('_',' ')}</span><strong>{memberships.filter(membership=>membership.role===role).length}</strong></div>)}</div>
            <MembershipTable memberships={memberships} clientById={clientById} eventById={eventById} saving={saving} onRoleChange={updateMembershipRole} onRemove={removeMembership} />
          </section>
          <section className="tenant-section adm-workspace-section" hidden={section!=='settings'}><ModuleEmptyState title="No platform settings table connected" detail="Global settings are not stored in a platform settings record yet." /></section>
        </>}

        {!isPlatformAdmin&&<section className="tenant-section adm-workspace-section" hidden={section!=='billing'}>
          <ClientBillingWorkspace clientId={managedClientId} invoices={invoices} onRefresh={loadInvoices}/>
        </section>}

        {!isPlatformAdmin&&<section className="tenant-section adm-workspace-section" hidden={section!=='exhibitor-orders'}>
          <ClientExhibitorOrdersWorkspace
            clientId={managedClientId}
            events={events.filter(event=>event.client_id===managedClientId)}
            canManageSettings={canManageClient(managedClientId)}
          />
        </section>}

        {!isPlatformAdmin&&<section className="tenant-section adm-workspace-section" hidden={section!=='rebookings'}>
          <div className="tenant-section-heading"><Mail size={17} /><div><h2>Rebooking enquiries</h2><p>Expressions of interest from exhibitors. These are not confirmed bookings.</p></div><button type="button" className="tenant-edit-event" disabled={rebookingLoading} onClick={loadClientRebookingRequests}><RefreshCw size={14} /> Refresh</button></div>
          {rebookingLoading ? <p className="tenant-empty">Loading rebooking enquiries…</p> : <div className="tenant-list">
            {rebookingRequests.map(request=><article className="tenant-list-row tenant-rebooking-row" key={request.id}>
              <div className="tenant-event-details">
                <strong>{request.company} · Stand {request.current_stand}</strong>
                <span>{request.contact_person}{request.contact_title ? ` · ${request.contact_title}` : ''} · <a href={`mailto:${request.email}`}>{request.email}</a>{request.mobile ? ` · ${request.mobile}` : ''}</span>
                <span>Interest: {request.interest} · Preferred stand: {request.preferred_stand || 'Not specified'} · {request.stand_size || 'Size not specified'} · {request.booth_type || 'Booth type not specified'}</span>
                {request.sponsorship_interest && <span>Sponsorship: {request.sponsorship_interest}</span>}
                {request.discussion_topics?.length > 0 && <span>Topics: {Array.isArray(request.discussion_topics) ? request.discussion_topics.join(', ') : request.discussion_topics}</span>}
                {request.notes && <span>Notes: {request.notes}</span>}
              </div>
              <time dateTime={request.created_at}>{new Date(request.created_at).toLocaleString()}</time>
            </article>)}
            {!rebookingRequests.length && <p className="tenant-empty">No exhibitor rebooking enquiries have been received for your events.</p>}
          </div>}
        </section>}

        <section className="tenant-section" hidden={section !== 'events'}>
          <div className="tenant-section-heading"><CalendarDays size={17} /><div><h2>Event workspaces</h2><p>Each event has isolated staff, exhibitors, requests and reports.</p></div>{!showEventForm && <button className="tenant-add-event" type="button" onClick={()=>{setEditingEventId('');setEventForm({...emptyEvent,client_id:isPlatformAdmin?(selectedClientId||clients[0]?.id||''):managedClientId});setSection('events');setShowEventForm(true);}}><Plus size={15} /> New event</button>}</div>
          <div className="tenant-list">
            {events.map(event => <div className="tenant-list-row" key={event.id}><div className="tenant-event-details"><strong>{event.name}{event.next_event_name ? ` · Rebooking ${event.next_event_name}` : ''}</strong><span>Event {event.event_start_date}{event.event_start_time ? ` ${event.event_start_time}` : ''} to {event.event_end_date}{event.event_end_time ? ` ${event.event_end_time}` : ''} · Build-up {event.build_up_start_date}{event.build_up_start_time ? ` ${event.build_up_start_time}` : ''} to {event.build_up_end_date}{event.build_up_end_time ? ` ${event.build_up_end_time}` : ''} · Breakdown {event.breakdown_start_date}{event.breakdown_start_time ? ` ${event.breakdown_start_time}` : ''} to {event.breakdown_end_date}{event.breakdown_end_time ? ` ${event.breakdown_end_time}` : ''}</span>{event.billing_exempt && <span className="tenant-internal-badge">Internal ECE · non-billable</span>}</div><span className="tenant-event-access"><code>?event={event.slug}</code><code>Exhibitor code: {event.exhibitor_code}</code><button className="tenant-regenerate-code" type="button" disabled={saving || (!isPlatformAdmin && !canInviteToScope(event.client_id, event.id))} onClick={()=>rotateEventCode(event)}><RefreshCw size={12} /> Rotate code</button></span><div className="tenant-event-actions"><button className="tenant-edit-event" type="button" disabled={saving || (event.billing_exempt && !isPlatformAdmin)} onClick={()=>beginEditEvent(event)}><Pencil size={14} /> Edit</button><label className="tenant-event-logo-action" title={`${event.logo_url ? 'Change' : 'Upload'} ${event.name} logo`}>{event.logo_url ? <img src={event.logo_url} alt={`${event.name} logo`} /> : <Upload size={14} />}<span>{event.logo_url ? 'Change logo' : 'Upload logo'}</span><input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${event.logo_url ? 'Change' : 'Upload'} logo for ${event.name}`} disabled={saving} onChange={inputEvent=>{const file=inputEvent.target.files?.[0];if(file)updateEventLogo(event,file);inputEvent.target.value='';}} /></label></div></div>)}
            {!events.length && <p className="tenant-empty">No events are assigned to your account.</p>}
          </div>
          {showEventForm && <form className="tenant-form tenant-inline-form" onSubmit={editingEventId ? updateEvent : createEvent}>
            <h3>{editingEventId ? 'Edit event' : 'Create event'}</h3>
            {isPlatformAdmin ? <label>Client<select required value={eventForm.client_id} disabled={Boolean(editingEventId)} onChange={event=>setEventForm({ ...eventForm, client_id:event.target.value })}><option value="">Select client</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label> : <p className="tenant-scope-note">New events will be created within your assigned organization.</p>}
            <label>Event name<input required maxLength="160" value={eventForm.name} onChange={event=>setEventForm({ ...eventForm, name:event.target.value })} /></label>
            {quotaClientId && <p className="tenant-scope-note">Event allowance: {currentClientEvents} of {currentEventLimit} used.</p>}
            <label>URL slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={eventForm.slug} onChange={event=>setEventForm({ ...eventForm, slug:event.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'') })} />{editingEventId && <small>Changing this slug changes the event link.</small>}</label>
            <label>Event logo (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>setEventForm({ ...eventForm, logo_file:event.target.files?.[0] || null })} /><small>PNG, JPG, or WebP; maximum 2 MB.</small></label>
            <label><span className="tenant-schedule-label">Event start date <CalendarDays size={14} aria-hidden="true" /></span><input type="date" required value={eventForm.event_start_date} onChange={event=>setEventDate('event_start_date',event.target.value)} /></label>
            <label><span className="tenant-schedule-label">Opening time <Clock size={14} aria-hidden="true" /></span><input type="time" value={eventForm.event_start_time} onChange={event=>setEventForm({ ...eventForm, event_start_time:event.target.value })} /></label>
            <label><span className="tenant-schedule-label">Event end date <CalendarDays size={14} aria-hidden="true" /></span><input type="date" required min={eventForm.event_start_date || undefined} value={eventForm.event_end_date} onChange={event=>setEventDate('event_end_date',event.target.value)} /></label>
            <label><span className="tenant-schedule-label">Closing time <Clock size={14} aria-hidden="true" /></span><input type="time" value={eventForm.event_end_time} onChange={event=>setEventForm({ ...eventForm, event_end_time:event.target.value })} /></label>
            <label><span className="tenant-schedule-label">Build-up start <CalendarDays size={14} aria-hidden="true" /></span><input type="date" required max={eventForm.event_start_date || undefined} value={eventForm.build_up_start_date} onChange={event=>setEventDate('build_up_start_date',event.target.value)} /></label>
            <label><span className="tenant-schedule-label">Build-up start time <Clock size={14} aria-hidden="true" /></span><input type="time" value={eventForm.build_up_start_time} onChange={event=>setEventForm({ ...eventForm, build_up_start_time:event.target.value })} /></label>
            <label><span className="tenant-schedule-label">Build-up end <CalendarDays size={14} aria-hidden="true" /></span><input type="date" required min={eventForm.build_up_start_date || undefined} max={eventForm.event_start_date || undefined} value={eventForm.build_up_end_date} onChange={event=>setEventDate('build_up_end_date',event.target.value)} /></label>
            <label><span className="tenant-schedule-label">Build-up end time <Clock size={14} aria-hidden="true" /></span><input type="time" value={eventForm.build_up_end_time} onChange={event=>setEventForm({ ...eventForm, build_up_end_time:event.target.value })} /></label>
            <label><span className="tenant-schedule-label">Breakdown start (defaults to event end) <CalendarDays size={14} aria-hidden="true" /></span><input type="date" required min={eventForm.event_end_date || eventForm.event_start_date || undefined} value={eventForm.breakdown_start_date} onChange={event=>setEventDate('breakdown_start_date',event.target.value)} /></label>
            <label><span className="tenant-schedule-label">Breakdown start time <Clock size={14} aria-hidden="true" /></span><input type="time" value={eventForm.breakdown_start_time} onChange={event=>setEventForm({ ...eventForm, breakdown_start_time:event.target.value })} /></label>
            <label><span className="tenant-schedule-label">Breakdown end (defaults to event end) <CalendarDays size={14} aria-hidden="true" /></span><input type="date" required min={eventForm.breakdown_start_date || undefined} value={eventForm.breakdown_end_date} onChange={event=>setEventDate('breakdown_end_date',event.target.value)} /></label>
            <label><span className="tenant-schedule-label">Breakdown end time <Clock size={14} aria-hidden="true" /></span><input type="time" value={eventForm.breakdown_end_time} onChange={event=>setEventForm({ ...eventForm, breakdown_end_time:event.target.value })} /></label>
            <label>Next event name<input maxLength="160" value={eventForm.next_event_name} onChange={event=>setEventForm({ ...eventForm, next_event_name:event.target.value })} placeholder="Optional rebooking destination" /></label>
            {isPlatformAdmin && <label className="tenant-internal-toggle"><input type="checkbox" checked={Boolean(eventForm.billing_exempt)} onChange={event=>setEventForm({ ...eventForm, billing_exempt:event.target.checked })} /><span>Internal ECE event (non-billable)<small>Excluded from client billing and event quota. Platform Admin only.</small></span></label>}
            <button type="submit" disabled={saving || !eventForm.client_id || !canManageClient(eventForm.client_id) || (!editingEventId && eventLimitReached)}>{editingEventId ? <Pencil size={15} /> : <Plus size={15} />} {editingEventId ? 'Save changes' : eventLimitReached ? 'Event limit reached' : 'Create event'}</button>
            {editingEventId && <button className="tenant-cancel-edit" type="button" disabled={saving} onClick={cancelEditEvent}><X size={15} /> Cancel edit</button>}
          </form>}
        </section>

        <section className="tenant-section" hidden={section !== 'suppliers'}>
          <div className="tenant-section-heading"><Building2 size={17} /><div><h2>Private suppliers</h2><p>Visible only to this organizer and reusable across its events.</p></div></div>
          {isPlatformAdmin && <label className="tenant-supplier-owner">Organizer<select value={supplierClientId} onChange={async event=>{setSupplierClientId(event.target.value);setPrivateSuppliers(await getSuppliers(event.target.value));}}><option value="">Select organization</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}
          {canManageSuppliers(supplierClientId) ? <form className="tenant-form tenant-inline-form" onSubmit={addPrivateSupplier}>
            <h3>{editingSupplierId ? 'Edit private supplier' : 'Add a private supplier'}</h3>
            <label>Supplier name<input required value={supplierForm.name} onChange={event=>setSupplierForm({ ...supplierForm, name:event.target.value })} /></label>
            <label>Contact person<input value={supplierForm.contact} onChange={event=>setSupplierForm({ ...supplierForm, contact:event.target.value })} /></label>
            <label>Email<input type="email" value={supplierForm.email} onChange={event=>setSupplierForm({ ...supplierForm, email:event.target.value })} /></label>
            <label>Mobile<input value={supplierForm.mobile} onChange={event=>setSupplierForm({ ...supplierForm, mobile:event.target.value })} /></label>
            <label>Service category<input value={supplierForm.category} onChange={event=>setSupplierForm({ ...supplierForm, category:event.target.value })} /></label>
            <button type="submit" disabled={saving || !supplierClientId}>{editingSupplierId ? <Pencil size={15} /> : <Plus size={15} />} {editingSupplierId ? 'Save changes' : 'Add supplier'}</button>
            {editingSupplierId && <button className="tenant-cancel-edit" type="button" disabled={saving} onClick={()=>{setEditingSupplierId('');setSupplierForm(emptySupplier);}}>Cancel edit</button>}
          </form> : <p className="tenant-scope-note">Supplier changes are read-only. Add/edit access requires a current client administrator membership.</p>}
          <div className="tenant-list">
            {privateSuppliers.map(supplier=><div className="tenant-list-row" key={supplier.id}><div className="tenant-event-details"><strong>{supplier.name}</strong><span>{[supplier.category, supplier.contact, supplier.email, supplier.mobile].filter(Boolean).join(' · ')}</span></div>{canManageSuppliers(supplierClientId) && <div className="tenant-event-actions"><button className="tenant-edit-event" type="button" onClick={()=>{setEditingSupplierId(supplier.id);setSupplierForm({name:supplier.name||'',contact:supplier.contact||'',email:supplier.email||'',mobile:supplier.mobile||'',category:supplier.category||'Other'});setError('');setNotice('');}}><Pencil size={14}/><span>Edit</span></button><button className="tenant-remove-supplier" type="button" onClick={()=>deletePrivateSupplier(supplier)} title={`Remove ${supplier.name}`}><Trash2 size={14} /><span>Remove</span></button></div>}</div>)}
            {!privateSuppliers.length && <p className="tenant-empty">No private suppliers have been added for this organizer.</p>}
          </div>
        </section>

        <section className="tenant-section" hidden={section !== 'team'}>
          <div className="tenant-section-heading"><MailPlus size={17} /><div><h2>Invite team members</h2><p>Access is limited to the selected client and event scope.</p></div></div>
          <form className="tenant-form tenant-invite-form" onSubmit={inviteMember}>
            {isPlatformAdmin ? <label>Client<select required value={inviteForm.client_id} onChange={event=>setInviteForm({ ...inviteForm, client_id:event.target.value, event_id:'' })}><option value="">Select client</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label> : <p className="tenant-scope-note">Invitations are limited to your assigned organization.</p>}
            <label>Event<select value={inviteForm.event_id} onChange={event=>setInviteForm({ ...inviteForm, event_id:event.target.value })}><option value="">Organization-wide</option>{inviteClientEvents.map(event=><option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
            <label>Role<select value={inviteForm.role} onChange={event=>setInviteForm({ ...inviteForm, role:event.target.value })}><option value="staff">Staff</option><option value="ops">Operations</option><option value="event_admin">Event admin</option><option value="client_admin">Client admin</option></select></label>
            <label>Email<input required type="email" value={inviteForm.email} onChange={event=>setInviteForm({ ...inviteForm, email:event.target.value })} /></label>
            {selectedEvent && <p className="tenant-scope-note">Invitation scope: {selectedEvent.name}</p>}
            <button type="submit" disabled={saving || !inviteForm.client_id || !canInviteToScope(inviteForm.client_id, inviteForm.event_id)}><MailPlus size={15} /> Send invitation</button>
          </form>
        </section>
      </>}
    </main>
    </div>
  );
}

function MembershipTable({ memberships, clientById, eventById, saving=false, onRoleChange, onRemove }) {
  return <div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>User ID</th><th>Organisation</th><th>Event scope</th><th>Role</th><th>Actions</th></tr></thead><tbody>
    {memberships.map((membership,index)=>{
      const event=eventById.get(membership.event_id);
      return <MembershipRow key={membership.id||`${membership.user_id}-${membership.client_id}-${membership.event_id||'org'}-${index}`} membership={membership} clientName={clientById.get(membership.client_id)?.name||membership.client_id} eventName={event?.name||'Organisation-wide'} saving={saving} onRoleChange={onRoleChange} onRemove={onRemove} />;
    })}
  </tbody></table>{!memberships.length&&<p className="tenant-empty">No memberships are available in this scope.</p>}</div>;
}

function MembershipRow({ membership, clientName, eventName, saving, onRoleChange, onRemove }) {
  const [role, setRole] = useState(membership.role);
  useEffect(() => setRole(membership.role), [membership.role]);
  const roleOptions = membership.event_id ? ['client_admin','event_admin','ops','staff'] : ['client_admin'];
  return <tr>
    <td><code className="adm-user-id" title={membership.user_id}>{membership.user_id?.slice(0,8)||'Unavailable'}…</code></td>
    <td>{clientName}</td>
    <td>{eventName}</td>
    <td><select className="adm-role-select" aria-label={`Role for ${membership.user_id||'user'}`} value={role} disabled={saving} onChange={event=>setRole(event.target.value)}>{roleOptions.map(option=><option key={option} value={option}>{option.replace('_',' ')}</option>)}</select></td>
    <td className="adm-membership-actions"><button type="button" className="adm-manage-client" disabled={saving||role===membership.role} onClick={()=>onRoleChange(membership,role)}>Save role</button><button type="button" className="adm-revoke-access" disabled={saving} onClick={()=>onRemove(membership)}>Revoke</button></td>
  </tr>;
}

function EventTable({ events }) {
  return <div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>Event</th><th>Dates</th><th>Billing</th><th>Status</th></tr></thead><tbody>
    {events.map(event=>{const [label,tone]=eventStatus(event);return <tr key={event.id}><td><strong>{event.name}</strong><small>{event.slug}</small></td><td>{event.event_start_date} – {event.event_end_date}</td><td>{event.billing_exempt?'Internal / exempt':'Billable'}</td><td><span className={`adm-chip adm-chip-${tone}`}>{label}</span></td></tr>;})}
  </tbody></table>{!events.length&&<p className="tenant-empty">No events are assigned to this organisation.</p>}</div>;
}

function ModuleEmptyState({ title, detail }) {
  return <div className="adm-empty-state"><span><FileText size={19} /></span><div><h3>{title}</h3><p>{detail}</p></div></div>;
}

function BillingControls({ client, saving, onSave, volumePlans = VOLUME_PLANS }) {
  const [form, setForm] = useState({
    billing_plan:client.billing_plan || 'legacy',
    billing_mode:client.billing_mode || 'unmanaged',
    billing_status:client.billing_status || 'pending',
    prepaid_event_credits:client.prepaid_event_credits ?? 0,
    paid_through:client.paid_through || '',
    term_started_at:client.term_started_at || '',
    term_ends_at:client.term_ends_at || '',
    committed_events:client.committed_events ?? 0,
    trial_started_at:client.trial_started_at || '',
    trial_ends_at:client.trial_ends_at || '',
  });
  const [error, setError] = useState('');
  const monthly = form.billing_mode === 'monthly';
  const today = new Date().toISOString().slice(0, 10);
  const trialActive = form.billing_mode === 'trial' && form.billing_status === 'active' && form.trial_started_at <= today && form.trial_ends_at > today;
  const trialExpired = form.billing_mode === 'trial' && form.trial_ends_at && form.trial_ends_at <= today;

  async function startDemoTrial() {
    if (form.trial_started_at) return;
    const trialStartedAt = new Date().toISOString().slice(0, 10);
    const trialEnd = new Date(`${trialStartedAt}T00:00:00.000Z`);
    trialEnd.setUTCDate(trialEnd.getUTCDate() + 30);
    setError('');
    const saved = await onSave(client.id, {
      billing_mode:'trial',
      billing_plan:'legacy',
      billing_status:'active',
      trial_started_at:trialStartedAt,
      trial_ends_at:trialEnd.toISOString().slice(0, 10),
      prepaid_event_credits:0,
      paid_through:null,
      term_started_at:null,
      term_ends_at:null,
      committed_events:0,
    });
    if (saved) setForm(current => ({ ...current, ...saved, paid_through:saved.paid_through || '', term_started_at:saved.term_started_at || '', term_ends_at:saved.term_ends_at || '', trial_started_at:saved.trial_started_at || '', trial_ends_at:saved.trial_ends_at || '' }));
  }

  async function submit(event) {
    event.preventDefault();
    const credits = Number(form.prepaid_event_credits);
    if (!Number.isInteger(credits) || credits < 0) {
      setError('Enter a non-negative whole number of credits.');
      return;
    }
    if (monthly && form.billing_status === 'active' && (!form.term_started_at || !form.term_ends_at || !form.paid_through || form.term_started_at > form.term_ends_at)) {
      setError('Enter valid term dates and a paid-through date before activating a monthly plan.');
      return;
    }
    const plan = volumePlans.find(item => item.id === form.billing_plan);
    const committedEvents = Number(form.committed_events);
    if (monthly && (!Number.isInteger(committedEvents) || committedEvents < 1 || (plan && (committedEvents < plan.eventsPerYear || committedEvents > plan.maxEvents)))) {
      setError(plan ? `Enter a commitment from ${plan.eventsPerYear} to ${plan.maxEvents} events.` : 'Enter a positive number of committed events.');
      return;
    }
    setError('');
    const saved = await onSave(client.id, {
      billing_plan:form.billing_plan,
      billing_mode:form.billing_mode,
      billing_status:form.billing_status,
      prepaid_event_credits:credits,
      paid_through:form.paid_through || null,
      term_started_at:form.term_started_at || null,
      term_ends_at:form.term_ends_at || null,
      committed_events:monthly ? committedEvents : 0,
      trial_started_at:form.trial_started_at || null,
      trial_ends_at:form.trial_ends_at || null,
    });
    if (saved) setForm(current => ({ ...current, ...saved, paid_through:saved.paid_through || '', term_started_at:saved.term_started_at || '', term_ends_at:saved.term_ends_at || '', trial_started_at:saved.trial_started_at || '', trial_ends_at:saved.trial_ends_at || '' }));
  }

  return <details>
    <summary>Billing and access: {trialActive ? '30-day trial' : trialExpired ? 'trial expired' : client.billing_status || 'pending'}</summary>
    <form className="tenant-form" onSubmit={submit}>
      <label>Plan<select value={form.billing_mode === 'trial' ? 'trial' : form.billing_plan} onChange={event=>{ const nextPlan=event.target.value; const plan=volumePlans.find(item=>item.id === nextPlan); const billingMode=nextPlan === 'trial' ? 'trial' : nextPlan === 'legacy' ? 'unmanaged' : nextPlan === 'pay_per_event' ? 'prepaid' : 'monthly'; setForm({ ...form, billing_plan:nextPlan === 'trial' ? 'legacy' : nextPlan, billing_mode:billingMode, committed_events:plan?.eventsPerYear || 0 }); }}>
        {form.trial_started_at && <option value="trial">30-day demo trial</option>}
        <option value="legacy">Legacy / unmanaged</option><option value="pay_per_event">Pay per event</option>
        {volumePlans.map(plan=><option key={plan.id} value={plan.id}>{plan.eventsPerYear}–{plan.maxEvents} events / year ({plan.discountPct}%)</option>)}
        {monthly && form.billing_plan !== 'enterprise' && !volumePlans.some(plan=>plan.id === form.billing_plan) && <option value={form.billing_plan}>Previous plan ({form.billing_plan})</option>}
        <option value="enterprise">Enterprise / negotiated</option>
      </select></label>
      <label>Access status<select value={form.billing_status} onChange={event=>setForm({ ...form, billing_status:event.target.value })}>
        {['pending','active','past_due','suspended','cancelled'].map(status=><option key={status} value={status}>{status.replace('_', ' ')}</option>)}
      </select></label>
      {form.billing_plan === 'pay_per_event' && <label>Prepaid event credits<input type="number" min="0" step="1" required value={form.prepaid_event_credits} onChange={event=>setForm({ ...form, prepaid_event_credits:event.target.value })} /></label>}
      {monthly && <><label>Committed events<input type="number" min="1" step="1" required value={form.committed_events} onChange={event=>setForm({ ...form, committed_events:event.target.value })} /></label><label>Approved additional event credits<input type="number" min="0" step="1" required value={form.prepaid_event_credits} onChange={event=>setForm({ ...form, prepaid_event_credits:event.target.value })} /><small>Credits reset when the term start changes.</small></label><label>Term start<input type="date" value={form.term_started_at} onChange={event=>setForm({ ...form, term_started_at:event.target.value })} /></label><label>Term end<input type="date" value={form.term_ends_at} onChange={event=>setForm({ ...form, term_ends_at:event.target.value })} /></label><label>Paid through<input type="date" value={form.paid_through} onChange={event=>setForm({ ...form, paid_through:event.target.value })} /></label></>}
      {(trialActive || trialExpired) && <p className="tenant-trial-status">{trialActive ? `Demo trial active until ${form.trial_ends_at}.` : `Demo trial expired on ${form.trial_ends_at}; active access is off.`}</p>}
      {!form.trial_started_at && <button className="tenant-start-trial" type="button" disabled={saving} onClick={startDemoTrial}><CalendarDays size={15} /> Start 30-day demo trial</button>}
      {error && <p className="tenant-error" role="alert">{error}</p>}
      <button type="submit" disabled={saving}>Save access settings</button>
    </form>
  </details>;
}