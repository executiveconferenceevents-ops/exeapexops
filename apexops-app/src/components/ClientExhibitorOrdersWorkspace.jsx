import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { DEMO_MODE } from '../lib/demoStore';
import { getClientServiceOrders } from '../lib/exhibitorServices';
import { CreditCard, RefreshCw, Save } from 'lucide-react';
import './ClientExhibitorOrdersWorkspace.css';

const EMPTY_SETTINGS={
  eft_enabled:false,payfast_enabled:false,yoco_enabled:false,
  bank_account_name:'',bank_name:'',bank_account_number:'',bank_branch_code:'',
  bank_account_type:'cheque',eft_reference_prefix:'',payfast_configured:false,
  payfast_mode:'sandbox',yoco_configured:false,
};

function formatAmount(value) {
  return new Intl.NumberFormat('en-ZA',{style:'currency',currency:'ZAR'}).format(Number(value||0));
}

function formatInvoiceAmount(order) {
  return order.invoice ? Number(order.invoice.total_cents||0)/100 : Number(order.total_payable||0);
}

function schemaNotReady(error) {
  return ['PGRST205','42P01','PGRST202'].includes(error?.code)
    || /exhibitor_invoices|client_exhibitor_payment_settings|manage-exhibitor-payment-settings/i.test(error?.message||'');
}

export default function ClientExhibitorOrdersWorkspace({ clientId, events=[], canManageSettings=false }) {
  const [orders,setOrders]=useState([]);
  const [settings,setSettings]=useState(EMPTY_SETTINGS);
  const [payfast,setPayfast]=useState({merchantId:'',merchantKey:'',passphrase:'',mode:'sandbox'});
  const [yoco,setYoco]=useState({apiKey:'',webhookSecret:''});
  const [clearPayfast,setClearPayfast]=useState(false);
  const [clearYoco,setClearYoco]=useState(false);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const [settingsError,setSettingsError]=useState('');
  const [notice,setNotice]=useState('');
  const eventKey=events.map(event=>event.id).filter(Boolean).join(',');

  const load=useCallback(async()=>{
    setLoading(true);
    setError('');
    setSettingsError('');
    try {
      setOrders(await getClientServiceOrders(eventKey?eventKey.split(','):[]));
    } catch(loadError) {
      setError(schemaNotReady(loadError)
        ? 'Furniture invoices are not installed yet. Review the exhibitor invoice/payment migration before applying it.'
        : loadError?.message||'Could not load exhibitor orders.');
    }
    if (!DEMO_MODE&&clientId) {
      try {
        const {data,error:settingsLoadError}=await supabase.functions.invoke('manage-exhibitor-payment-settings',{
          body:{action:'read',clientId},
        });
        if (settingsLoadError) throw settingsLoadError;
        setSettings({...EMPTY_SETTINGS,...data?.settings});
        setPayfast(current=>({...current,mode:data?.settings?.payfast_mode||'sandbox'}));
      } catch(settingsLoadError) {
        setSettingsError(settingsLoadError?.context?.body?.message||settingsLoadError?.message||'Could not load payment settings.');
      }
    } else {
      setSettings(EMPTY_SETTINGS);
    }
    setLoading(false);
  },[clientId,eventKey]);

  useEffect(()=>{load();},[load]);

  async function saveSettings(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSettingsError('');
    setNotice('');
    try {
      const {data,error:saveError}=await supabase.functions.invoke('manage-exhibitor-payment-settings',{
        body:{
          action:'save',clientId,
          settings:{
            ...settings,
            bank_account_name:settings.bank_account_name.trim(),
            bank_name:settings.bank_name.trim(),
            bank_account_number:settings.bank_account_number.trim(),
            bank_branch_code:settings.bank_branch_code.trim(),
            eft_reference_prefix:settings.eft_reference_prefix.trim(),
          },
          payfast,yoco,clearPayfast,clearYoco,
        },
      });
      if (saveError) throw saveError;
      setSettings({...EMPTY_SETTINGS,...data?.settings});
      setPayfast({merchantId:'',merchantKey:'',passphrase:'',mode:data?.settings?.payfast_mode||'sandbox'});
      setYoco({apiKey:'',webhookSecret:''});
      setClearPayfast(false);
      setClearYoco(false);
      setNotice(data?.message||'Payment settings saved securely.');
    } catch(saveError) {
      setSettingsError(saveError?.context?.body?.message||saveError?.message||'Could not save payment settings.');
    } finally {
      setSaving(false);
    }
  }

  const eventNames=new Map(events.map(event=>[event.id,event.name]));
  return <div className="client-exhibitor-workspace">
    <div className="adm-page-heading">
      <div><span className="adm-section-count">{orders.length} FURNITURE ORDERS</span><h2 className="adm-page-title"><CreditCard size={18} aria-hidden="true"/>Exhibitor furniture orders</h2><p>Separate from APEXOPS platform billing. Orders are read-only here; Operations handles fulfilment and payment review.</p></div>
      <button className="tenant-refresh" type="button" onClick={load} disabled={loading||saving}><RefreshCw size={14}/> Refresh orders</button>
    </div>
    <p className="client-exhibitor-note">The 3% platform fee stays inside the exhibitor’s displayed total. It is not a separate exhibitor invoice line and is added to the client’s platform invoice only after the exhibitor invoice is fully paid.</p>
    {error&&<div className="tenant-feedback tenant-error" role="alert">{error}</div>}
    {notice&&<div className="tenant-feedback tenant-notice" role="status">{notice}</div>}
    {loading?<p className="tenant-loading">Loading exhibitor orders…</p>:<div className="adm-table-wrap"><table className="adm-data-table">
      <thead><tr><th>Order</th><th>Event</th><th>Stand / exhibitor</th><th>Fulfilment</th><th>Invoice / payment</th><th>Total</th></tr></thead>
      <tbody>{orders.map(order=><tr key={order.id}>
        <td><strong>{order.ref}</strong><small>{order.created_at?new Date(order.created_at).toLocaleDateString('en-ZA'):'—'}</small></td>
        <td>{eventNames.get(order.event_id)||'Event'}</td>
        <td><strong>{order.stand}</strong><small>{order.exhibitor_name}</small></td>
        <td>{String(order.status||'submitted').replaceAll('_',' ')}</td>
        <td>{order.invoice?<><strong>{order.invoice.invoice_number}</strong><small>{String(order.invoice.status||'unpaid').replaceAll('_',' ')}</small></>:<span>Invoice pending</span>}</td>
        <td><strong>{formatAmount(formatInvoiceAmount(order))}</strong></td>
      </tr>)}</tbody>
    </table>{!orders.length&&<p className="tenant-empty">No exhibitor furniture orders are available for this organisation.</p>}</div>}

    <section className="client-exhibitor-settings">
      <div><h3>Exhibitor payment methods</h3><p>Payments go directly to the organisation’s PayFast, Yoco, or bank account. Credentials are encrypted by an Edge Function and are never returned to the browser.</p></div>
      {DEMO_MODE?<p className="tenant-scope-note">Payment settings are read-only in Demo mode.</p>:!canManageSettings?<p className="tenant-scope-note">Only a current organisation administrator can edit payment settings.</p>:<form className="tenant-form" onSubmit={saveSettings}>
        <label className="client-exhibitor-toggle"><input type="checkbox" checked={settings.eft_enabled} onChange={event=>setSettings(current=>({...current,eft_enabled:event.target.checked}))}/><span>Enable EFT</span></label>
        <label>Account holder<input value={settings.bank_account_name} onChange={event=>setSettings(current=>({...current,bank_account_name:event.target.value}))}/></label>
        <label>Bank<input value={settings.bank_name} onChange={event=>setSettings(current=>({...current,bank_name:event.target.value}))}/></label>
        <label>Account number<input value={settings.bank_account_number} onChange={event=>setSettings(current=>({...current,bank_account_number:event.target.value}))}/></label>
        <label>Branch code<input value={settings.bank_branch_code} onChange={event=>setSettings(current=>({...current,bank_branch_code:event.target.value}))}/></label>
        <label>Account type<select value={settings.bank_account_type} onChange={event=>setSettings(current=>({...current,bank_account_type:event.target.value}))}><option value="cheque">Cheque / current</option><option value="savings">Savings</option><option value="transmission">Transmission</option></select></label>
        <label>EFT reference prefix<input maxLength="40" value={settings.eft_reference_prefix} onChange={event=>setSettings(current=>({...current,eft_reference_prefix:event.target.value}))}/></label>
        <label className="client-exhibitor-toggle"><input type="checkbox" checked={settings.payfast_enabled} onChange={event=>setSettings(current=>({...current,payfast_enabled:event.target.checked}))}/><span>Enable PayFast · {settings.payfast_configured?'credentials saved':'credentials required'}</span></label>
        <label>PayFast mode<select value={payfast.mode||settings.payfast_mode||'sandbox'} onChange={event=>setPayfast(current=>({...current,mode:event.target.value}))}><option value="sandbox">Sandbox</option><option value="live">Live</option></select></label>
        <label>Merchant ID<input autoComplete="off" value={payfast.merchantId} onChange={event=>setPayfast(current=>({...current,merchantId:event.target.value}))} placeholder={settings.payfast_configured?'Saved · leave blank to keep':'Required'}/></label>
        <label>Merchant key<input type="password" autoComplete="new-password" value={payfast.merchantKey} onChange={event=>setPayfast(current=>({...current,merchantKey:event.target.value}))} placeholder={settings.payfast_configured?'Saved · leave blank to keep':'Required'}/></label>
        <label>Passphrase<input type="password" autoComplete="new-password" value={payfast.passphrase} onChange={event=>setPayfast(current=>({...current,passphrase:event.target.value}))} placeholder={settings.payfast_configured?'Saved · leave blank to keep':'Required'}/></label>
        {settings.payfast_configured&&<label className="client-exhibitor-toggle"><input type="checkbox" checked={clearPayfast} onChange={event=>setClearPayfast(event.target.checked)}/><span>Remove saved PayFast credentials</span></label>}
        <label className="client-exhibitor-toggle"><input type="checkbox" checked={settings.yoco_enabled} onChange={event=>setSettings(current=>({...current,yoco_enabled:event.target.checked}))}/><span>Enable Yoco · {settings.yoco_configured?'credentials saved':'credentials required'}</span></label>
        <label>Yoco API key<input type="password" autoComplete="new-password" value={yoco.apiKey} onChange={event=>setYoco(current=>({...current,apiKey:event.target.value}))} placeholder={settings.yoco_configured?'Saved · leave blank to keep':'Required'}/></label>
        <label>Yoco webhook signing secret<input type="password" autoComplete="new-password" value={yoco.webhookSecret} onChange={event=>setYoco(current=>({...current,webhookSecret:event.target.value}))} placeholder={settings.yoco_configured?'Saved · leave blank to keep':'Required'}/></label>
        {settings.yoco_configured&&<label className="client-exhibitor-toggle"><input type="checkbox" checked={clearYoco} onChange={event=>setClearYoco(event.target.checked)}/><span>Remove saved Yoco credentials</span></label>}
        <p className="client-exhibitor-secret-note">Required Edge Function secret: <code>EXHIBITOR_PAYMENT_ENCRYPTION_KEY</code> (base64-encoded 32-byte key). Do not put this key in app code or browser settings.</p>
        {settingsError&&<div className="tenant-feedback tenant-error" role="alert">{settingsError}</div>}
        <button type="submit" disabled={saving}><Save size={14}/>{saving?'Saving securely…':'Save payment settings'}</button>
      </form>}
    </section>
  </div>;
}
