import { useState } from 'react';
import { ArrowLeft, Building2, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';

const initialForm={businessName:'',companyRegistrationNumber:'',primaryContactName:'',primaryContactEmail:'',billingContactEmail:'',contactPhone:'',acknowledged:false};

function secureUuid() {
  const cryptoApi=window.crypto;
  if (typeof cryptoApi?.getRandomValues!=='function') throw new Error('Secure request IDs are unavailable in this browser.');
  const bytes=cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&0x0f)|0x40;
  bytes[8]=(bytes[8]&0x3f)|0x80;
  const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export default function ClientRegistrationForm({onBack}) {
  const [form,setForm]=useState(initialForm);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [submitted,setSubmitted]=useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!supabase) { setError('Registration is unavailable in demo mode.'); return; }
    setBusy(true);
    setError('');
    try {
      const {data,error:submitError}=await supabase.functions.invoke('register-client',{
        body:{...form,registrationRequestId:secureUuid()},
      });
      if (submitError) throw new Error(submitError.message||'Could not submit your request.');
      if (!data?.submissionId) throw new Error(data?.message||'Could not submit your request.');
      setSubmitted(true);
    } catch (submitError) {
      setError(submitError?.message||'Could not submit your request.');
    } finally {
      setBusy(false);
    }
  }

  if (submitted) return <section className="lg-registration-result" role="status">
    <span className="lg-registration-mark"><Building2 size={20}/></span>
    <h2>Request received</h2>
    <p>A platform administrator will review your request. This submission does not create access or a service agreement.</p>
    <button type="button" className="lg-link" onClick={onBack}><ArrowLeft size={14}/> Back to sign in</button>
  </section>;

  return <section className="lg-registration">
    <button type="button" className="lg-link" onClick={onBack}><ArrowLeft size={14}/> Back to sign in</button>
    <h2 className="lg-title">Request an account</h2>
    <p className="lg-sub">Share your organization and contact details for Platform Owner review.</p>
    {error&&<div className="lg-alert" role="alert">{error}</div>}
    <form className="lg-registration-form" onSubmit={submit}>
      <label className="lg-label">Organization name<input required minLength="2" maxLength="200" value={form.businessName} onChange={event=>setForm(current=>({...current,businessName:event.target.value}))}/></label>
      <label className="lg-label">Company registration number <span>(optional)</span><input maxLength="100" value={form.companyRegistrationNumber} onChange={event=>setForm(current=>({...current,companyRegistrationNumber:event.target.value}))}/></label>
      <label className="lg-label">Primary contact name<input required minLength="2" maxLength="160" value={form.primaryContactName} onChange={event=>setForm(current=>({...current,primaryContactName:event.target.value}))}/></label>
      <label className="lg-label">Primary contact email<input required type="email" maxLength="254" value={form.primaryContactEmail} onChange={event=>setForm(current=>({...current,primaryContactEmail:event.target.value}))}/></label>
      <label className="lg-label">Billing contact email <span>(optional)</span><input type="email" maxLength="254" value={form.billingContactEmail} onChange={event=>setForm(current=>({...current,billingContactEmail:event.target.value}))}/></label>
      <label className="lg-label">Contact phone <span>(optional)</span><input type="tel" maxLength="40" value={form.contactPhone} onChange={event=>setForm(current=>({...current,contactPhone:event.target.value}))}/></label>
      <label className="lg-registration-ack"><input type="checkbox" required checked={form.acknowledged} onChange={event=>setForm(current=>({...current,acknowledged:event.target.checked}))}/><span>This is an account request only. Access is subject to review, verified billing, and explicit activation; this request is not a service agreement.</span></label>
      <button type="submit" className="lg-primary" disabled={busy}><Send size={15}/>{busy?'Submitting…':'Submit request'}</button>
    </form>
  </section>;
}
