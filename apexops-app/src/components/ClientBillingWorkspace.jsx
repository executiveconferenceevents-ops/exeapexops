import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { DEMO_MODE, getDemoCollection, setDemoCollection } from '../lib/demoStore';
import { downloadInvoicePdf } from '../lib/invoicePdf';
import { CreditCard, Download, RefreshCw, Upload } from 'lucide-react';

const emptyForm = { invoice_id:'', amount_cents:'', paid_on:new Date().toISOString().slice(0,10), reference:'' };
const acceptedTypes = ['application/pdf','image/jpeg','image/png'];

function formatCurrency(cents, currency='ZAR') {
  return new Intl.NumberFormat('en-ZA',{style:'currency',currency}).format(Number(cents||0)/100);
}

function secureUuid() {
  const cryptoApi=window.crypto;
  if (typeof cryptoApi?.getRandomValues!=='function') throw new Error('Secure upload IDs are unavailable in this browser.');
  const bytes=cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&0x0f)|0x40;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export default function ClientBillingWorkspace({ clientId, invoices, onRefresh }) {
  const [payments,setPayments]=useState([]);
  const [allocations,setAllocations]=useState([]);
  const [form,setForm]=useState(emptyForm);
  const [proof,setProof]=useState(null);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [downloadingInvoiceId,setDownloadingInvoiceId]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');

  async function loadPayments() {
    if (!clientId) { setPayments([]); setAllocations([]); return; }
    setLoading(true);
    setError('');
    try {
      if (DEMO_MODE) {
        setPayments(getDemoCollection('payments',[]).filter(payment=>payment.client_id===clientId));
        setAllocations(getDemoCollection('payment_allocations',[]));
      } else {
        const { data:rows,error:paymentsError } = await supabase.from('client_payments')
          .select('id,client_id,payment_method,status,amount_cents,currency,paid_on,reference,review_note,created_at')
          .eq('client_id',clientId).order('created_at',{ascending:false});
        if (paymentsError) throw paymentsError;
        const paymentIds=(rows||[]).map(payment=>payment.id);
        let allocationRows=[];
        if (paymentIds.length) {
          const { data,error:allocationError } = await supabase.from('client_payment_allocations')
            .select('payment_id,invoice_id,amount_cents,status').in('payment_id',paymentIds);
          if (allocationError) throw allocationError;
          allocationRows=data||[];
        }
        setPayments(rows||[]);
        setAllocations(allocationRows);
      }
    } catch (loadError) {
      setError(loadError?.message||'Could not load payment history.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(()=>{loadPayments();},[clientId]);

  async function downloadInvoice(invoice) {
    setDownloadingInvoiceId(invoice.id);
    setError('');
    try {
      let items=[];
      if (DEMO_MODE) {
        items=getDemoCollection('invoice_items',[]).filter(item=>item.invoice_id===invoice.id);
      } else {
        const { data,error:itemsError }=await supabase.from('client_invoice_items')
          .select('id,invoice_id,line_number,description,quantity,unit_price_cents,discount_cents,line_total_cents')
          .eq('invoice_id',invoice.id).order('line_number');
        if (itemsError) throw itemsError;
        items=data||[];
      }
      downloadInvoicePdf(invoice,items);
    } catch (downloadError) {
      setError(downloadError?.message||'Could not download this invoice.');
    } finally {
      setDownloadingInvoiceId('');
    }
  }

  async function startPayfastCheckout(invoice) {
    if (DEMO_MODE) {
      setNotice('Online payments are unavailable in demo mode.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data,error:checkoutError } = await supabase.functions.invoke('create-payfast-checkout',{
        body:{invoiceId:invoice.id,idempotencyKey:secureUuid()},
      });
      if (checkoutError) throw checkoutError;
      const actionUrl=new URL(data?.actionUrl||'');
      if (actionUrl.protocol!=='https:'||!['sandbox.payfast.co.za','www.payfast.co.za'].includes(actionUrl.hostname)
        ||!data?.fields||typeof data.fields!=='object'||!data.fields.signature) {
        throw new Error('The secure PayFast checkout response is invalid.');
      }
      const checkoutForm=document.createElement('form');
      checkoutForm.method='post';
      checkoutForm.action=actionUrl.toString();
      checkoutForm.hidden=true;
      for (const [name,value] of Object.entries(data.fields)) {
        const field=document.createElement('input');
        field.type='hidden';
        field.name=name;
        field.value=String(value);
        checkoutForm.appendChild(field);
      }
      document.body.appendChild(checkoutForm);
      checkoutForm.submit();
      checkoutForm.remove();
    } catch (checkoutError) {
      setError(checkoutError?.message||'Could not start online payment.');
      setSaving(false);
    }
  }

  async function submitEft(event) {
    event.preventDefault();
    const invoice=invoices.find(item=>item.id===form.invoice_id);
    const amount=Number(form.amount_cents);
    if (!invoice||!Number.isSafeInteger(amount)||amount<=0||!form.paid_on||!form.reference.trim()) {
      setError('Choose an invoice and enter a positive amount, transfer date, and bank reference.');
      return;
    }
    if (!proof||!acceptedTypes.includes(proof.type)||proof.size>10*1024*1024) {
      setError('Attach a PDF, JPG, or PNG proof no larger than 10 MB.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    let uploadedPath='';
    try {
      if (DEMO_MODE) {
        const paymentId=`demo-payment-${secureUuid()}`;
        const payment={id:paymentId,client_id:clientId,payment_method:'eft',status:'pending_review',amount_cents:amount,currency:invoice.currency||'ZAR',paid_on:form.paid_on,reference:form.reference.trim(),evidence_reference:'private demo proof',idempotency_key:secureUuid(),created_at:new Date().toISOString()};
        const allocation={payment_id:paymentId,invoice_id:invoice.id,amount_cents:amount,status:'pending'};
        const nextPayments=[payment,...getDemoCollection('payments',[])];
        const nextAllocations=[allocation,...getDemoCollection('payment_allocations',[])];
        setDemoCollection('payments',nextPayments);
        setDemoCollection('payment_allocations',nextAllocations);
        setPayments(nextPayments.filter(item=>item.client_id===clientId));
        setAllocations(nextAllocations);
      } else {
        const extension=proof.type==='application/pdf'?'pdf':proof.type==='image/jpeg'?'jpg':'png';
        uploadedPath=`${clientId}/${invoice.id}/${secureUuid()}.${extension}`;
        const { error:uploadError } = await supabase.storage.from('client-payment-evidence')
          .upload(uploadedPath,proof,{contentType:proof.type,upsert:false});
        if (uploadError) throw uploadError;
        const { error:submitError } = await supabase.rpc('submit_client_eft_payment',{
          target_invoice_id:invoice.id,
          payment_amount_cents:amount,
          payment_date:form.paid_on,
          payment_reference:form.reference.trim(),
          proof_reference:uploadedPath,
          idempotency_key:secureUuid(),
        });
        if (submitError) throw submitError;
        await Promise.all([loadPayments(),onRefresh()]);
      }
      setForm({...emptyForm,paid_on:new Date().toISOString().slice(0,10)});
      setProof(null);
      const fileInput=event.currentTarget.querySelector('input[type="file"]');
      if (fileInput) fileInput.value='';
      setNotice('EFT proof submitted securely. It will show as pending until reviewed.');
    } catch (submitError) {
      if (uploadedPath) await supabase.storage.from('client-payment-evidence').remove([uploadedPath]).catch(()=>{});
      setError(submitError?.message||'Could not submit EFT proof.');
    } finally {
      setSaving(false);
    }
  }

  const openInvoices=invoices.filter(invoice=>['issued','partially_paid','partially_credited'].includes(invoice.status));
  return <>
    <div className="adm-page-heading"><div><span className="adm-section-count">{invoices.length} INVOICES</span><h2 className="adm-page-title"><CreditCard size={18} aria-hidden="true"/>Invoices & payments</h2><p>Review invoices and submit EFT details for secure approval.</p></div><button className="tenant-refresh" type="button" onClick={()=>{onRefresh();loadPayments();}} disabled={loading||saving}><RefreshCw size={14}/> Refresh billing</button></div>
    {error&&<div className="tenant-feedback tenant-error" role="alert">{error}</div>}
    {notice&&<div className="tenant-feedback tenant-notice" role="status">{notice}</div>}
    <div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>Invoice</th><th>Date / due</th><th>Status</th><th>Total</th><th>Action</th></tr></thead><tbody>
      {invoices.map(invoice=><tr key={invoice.id}><td><strong>{invoice.invoice_number}</strong><small>{invoice.description||'Invoice'}</small></td><td>{invoice.invoice_date}<small>Due {invoice.due_date||'not set'}</small></td><td><span className={`adm-status-pill adm-status-${invoice.status}`}>{invoice.status.replace('_',' ')}</span></td><td><strong>{formatCurrency(invoice.total_cents,invoice.currency||'ZAR')}</strong></td><td>{invoice.status!=='draft'&&<button className="adm-manage-client" type="button" disabled={downloadingInvoiceId===invoice.id} onClick={()=>downloadInvoice(invoice)}><Download size={14}/>{downloadingInvoiceId===invoice.id?'Preparing…':'Download PDF'}</button>}{openInvoices.includes(invoice)&&<button className="adm-manage-client" type="button" disabled={saving||DEMO_MODE} onClick={()=>startPayfastCheckout(invoice)}>Pay online</button>}</td></tr>)}
    </tbody></table>{!invoices.length&&<p className="tenant-empty">No invoices are available for this organisation.</p>}</div>
    <form className="tenant-form adm-payment-form" onSubmit={submitEft}>
      <h3>Submit EFT proof</h3>
      <label>Invoice<select required value={form.invoice_id} onChange={event=>setForm(current=>({...current,invoice_id:event.target.value}))}><option value="">Select open invoice</option>{openInvoices.map(invoice=><option key={invoice.id} value={invoice.id}>{invoice.invoice_number} · {formatCurrency(invoice.total_cents,invoice.currency||'ZAR')}</option>)}</select></label>
      <label>Amount paid (cents)<input aria-label="EFT amount paid cents" required type="number" min="1" step="1" value={form.amount_cents} onChange={event=>setForm(current=>({...current,amount_cents:event.target.value}))}/></label>
      <label>Transfer date<input required type="date" value={form.paid_on} onChange={event=>setForm(current=>({...current,paid_on:event.target.value}))}/></label>
      <label>Bank reference<input required maxLength="160" value={form.reference} onChange={event=>setForm(current=>({...current,reference:event.target.value}))}/></label>
      <label>Proof of payment<input required type="file" accept="application/pdf,image/jpeg,image/png" onChange={event=>setProof(event.target.files?.[0]||null)}/><small>PDF, JPG, or PNG up to 10 MB.</small></label>
      <button type="submit" disabled={saving||!openInvoices.length}><Upload size={15}/> Submit for review</button>
    </form>
    <h3>Payment history</h3>
    {loading?<p className="tenant-loading">Loading payments…</p>:<div className="adm-table-wrap"><table className="adm-data-table"><thead><tr><th>Date</th><th>Invoice</th><th>Reference</th><th>Status</th><th>Amount</th></tr></thead><tbody>
      {payments.map(payment=>{
        const invoiceIds=allocations.filter(item=>item.payment_id===payment.id).map(item=>item.invoice_id);
        const invoiceNumbers=invoiceIds.map(id=>invoices.find(invoice=>invoice.id===id)?.invoice_number).filter(Boolean).join(', ');
        return <tr key={payment.id}><td>{payment.paid_on}</td><td>{invoiceNumbers||'Invoice'}</td><td>{payment.reference||'—'}<small>{payment.status==='pending_review'?'Proof received':payment.review_note||''}</small></td><td><span className={`adm-status-pill adm-status-${payment.status}`}>{payment.status.replace('_',' ')}</span></td><td><strong>{formatCurrency(payment.amount_cents,payment.currency||'ZAR')}</strong></td></tr>;
      })}
    </tbody></table>{!payments.length&&<p className="tenant-empty">No payments or EFT submissions yet.</p>}</div>}
  </>;
}