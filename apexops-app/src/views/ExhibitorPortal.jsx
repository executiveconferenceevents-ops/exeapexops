// ─── Exhibitor private link: fascia name, logo & documents ───────────────────
// Opened with ?portal=<token>. Only the exhibitor who receives the link can see it.
// [APEX exhibitor services 1]
import React, { useCallback, useEffect, useState } from 'react';
import { Check, Download, FileText, ImagePlus, Info, Lock, Upload } from 'lucide-react';
import { formatDay, formatDayTime, getExhibitorInvoices, getExhibitorPortal, packageFulfillmentRows, rand, saveExhibitorFascia, startExhibitorPayfastCheckout, startExhibitorYocoCheckout, submitExhibitorEftProof, uploadExhibitorFile } from '../lib/exhibitorServices';
import './exhibitor-services.css';

const LOGO_TYPES = '.ai,.eps,.pdf,.svg,.png,.jpg,.jpeg,.tif,.tiff';
const DOC_TYPES = '.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip';
const ARTWORK_TYPES = '.ai,.eps,.pdf,.svg,.png,.jpg,.jpeg,.tif,.tiff,.zip';

export default function ExhibitorPortal({ token, onOrderFurniture }) {
  const [data, setData] = useState(null);
  const [fascia, setFascia] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [invoices, setInvoices] = useState([]);
  const [eftProof, setEftProof] = useState(null);
  const [eftReference, setEftReference] = useState('');

  const load = useCallback(async () => {
    try {
      const [d,invoiceRows] = await Promise.all([getExhibitorPortal(token),getExhibitorInvoices(token)]);
      setData(d); setFascia(d.fascia_name || ''); setInvoices(invoiceRows); setError('');
    }
    catch (e) { setError(e.message); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const saveFascia = async () => {
    setBusy('fascia'); setNotice('');
    try { await saveExhibitorFascia(token, fascia); setNotice('Fascia name saved. The organiser will check it before printing.'); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const upload = async (kind, files) => {
    if (!files?.length) return;
    setBusy(kind); setNotice(''); setError('');
    try { for (const f of files) await uploadExhibitorFile(token, kind, f); setNotice(`${files.length} file${files.length === 1 ? '' : 's'} uploaded.`); await load(); }
    catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const submitEft = async invoiceId => {
    if (!eftReference.trim()||!eftProof) { setError('Add a bank reference and proof of payment.'); return; }
    setBusy('eft'); setNotice(''); setError('');
    try {
      await submitExhibitorEftProof(token,invoiceId,eftReference.trim(),eftProof);
      setEftReference(''); setEftProof(null);
      setNotice('Proof submitted for organiser approval.');
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(''); }
  };
  const startPayfast = async invoiceId => {
    setBusy('payfast'); setError('');
    try { await startExhibitorPayfastCheckout(token,invoiceId); }
    catch (e) { setError(e.message); setBusy(''); }
  };
  const startYoco = async invoiceId => {
    setBusy('yoco'); setError('');
    try { await startExhibitorYocoCheckout(token,invoiceId); }
    catch (e) { setError(e.message); setBusy(''); }
  };
  const downloadInvoice = async invoice => {
    try {
      const { downloadExhibitorInvoicePdf } = await import('../lib/exhibitorInvoicePdf');
      downloadExhibitorInvoicePdf(invoice);
    } catch (e) {
      setError(e.message || 'Could not download the invoice.');
    }
  };

  if (error && !data) {
    return <div className="es es-public"><header className="es-hero"><div className="es-eyebrow">Exhibitor services</div><h1>Link <em>not valid</em></h1><p>{error}</p></header>
      <main className="es-public-main"><div className="es-card es-pad">Please ask the organiser to send your stand's link again.</div></main></div>;
  }
  if (!data) return <div className="es es-public"><header className="es-hero"><h1>Loading…</h1></header></div>;

  const closed = data.open === false;
  const logos = data.files.filter(f => f.kind === 'logo');
  const vinylArtwork = data.files.filter(f => f.kind === 'artwork_vinyl');
  const fabricArtwork = data.files.filter(f => f.kind === 'artwork_fabric');
  const docs = data.files.filter(f => f.kind === 'document');

  return (
    <div className="es es-public">
      <header className="es-hero">
        <div className="es-eyebrow">{data.event?.name}{data.event?.start ? ` · ${formatDay(data.event.start)}` : ''}</div>
        <h1>{data.exhibitor_name || 'Your stand'} <em>· {data.stand}</em></h1>
        <p><Lock size={13} style={{ verticalAlign: -2 }} /> This page is private to your stand. Please don't share the link.</p>
      </header>
      <main className="es-public-main">
        {closed && <div className="es-alert es-alert--note">This event is archived. You can still see your details, but changes are closed.</div>}
        {notice && <div className="es-alert es-alert--ok" role="status"><Check size={15} style={{ verticalAlign: -3 }} /> {notice}</div>}
        {error && <div className="es-alert es-alert--error">{error}</div>}

        {/* Package */}
        <div className="es-card es-pad es-stack">
          <div className="es-eyebrow">Your package</div>
          {data.package ? (
            <>
              <h2 className="es-h2">{data.package.name}</h2>
              {data.package.description && <p className="es-small es-muted" style={{ margin: 0 }}>{data.package.description}</p>}
              {data.package.features?.length > 0 && <div className="es-feature-list">{data.package.features.map(f => <span key={f.key} className={`es-feature ${f.key === 'fascia_logo' ? 'is-logo' : ''}`}><Check size={13} strokeWidth={2.25} /> {f.label}</span>)}</div>}
              <div className="es-package-status-list" aria-label="Package stock status">
                {packageFulfillmentRows({package_fulfillment:data.package_fulfillment},data.package).map(item=><div className="es-package-status-row" key={item.id}>
                  <strong>{item.qty}× {item.label}</strong>
                  <div><span className={`es-badge ${item.packed?'es-badge--green':''}`}>{item.packed?'Packed':'Not packed'}</span><span className={`es-badge ${item.on_stand?'es-badge--blue':''}`}>{item.on_stand?'On stand':'Not placed'}</span><span className={`es-badge ${item.returned?'es-badge--amber':''}`}>{item.returned?'Returned':'Not returned'}</span></div>
                </div>)}
              </div>
            </>
          ) : <p className="es-muted" style={{ margin: 0 }}>The organiser hasn't linked a package to your stand yet.</p>}
          {onOrderFurniture && !closed && <button className="es-btn" style={{ alignSelf: 'flex-start' }} onClick={onOrderFurniture}>Need more? Order furniture</button>}
        </div>

        {/* Fascia */}
        <div className="es-card es-pad es-stack">
          <div className="es-row"><div className="es-grow"><div className="es-eyebrow">Fascia board</div><h2 className="es-h2">Name on your <em>fascia</em></h2></div>
            <span className={`es-badge ${data.fascia_status === 'approved' ? 'es-badge--green' : data.fascia_status === 'submitted' ? 'es-badge--amber' : ''}`}>{data.fascia_status === 'approved' ? 'Approved' : data.fascia_status === 'submitted' ? 'Sent for approval' : 'Please confirm'}</span></div>
          <p className="es-small es-muted" style={{ margin: 0 }}>Type it exactly as it must be printed. Maximum 40 characters.</p>
          <input className="es-input" maxLength={40} value={fascia} disabled={closed || data.fascia_status === 'approved'} onChange={e => setFascia(e.target.value)} placeholder="Company name" aria-label="Fascia name" />
          <div className="es-fascia" aria-hidden>{fascia || 'Your company name'}</div>
          {data.fascia_status === 'approved'
            ? <p className="es-small es-muted" style={{ margin: 0 }}>Approved for printing. Contact the organiser if it must change.</p>
            : <button className="es-btn es-btn--primary" style={{ alignSelf: 'flex-start' }} disabled={closed || busy === 'fascia' || !fascia.trim()} onClick={saveFascia}><Check size={16} /> {busy === 'fascia' ? 'Saving…' : 'Confirm fascia name'}</button>}
        </div>

        {/* Logo */}
        <div className="es-card es-pad es-stack">
          <div className="es-eyebrow">Logo</div>
          <h2 className="es-h2">High-resolution <em>logo</em></h2>
          <div className="es-alert es-alert--note" style={{ display: 'flex', gap: 10 }}>
            <Info size={18} strokeWidth={1.75} style={{ flex: '0 0 18px', marginTop: 1 }} />
            <span>
              {data.logo_terms || 'Logos are only printed on fascia boards when included in your package or paid for.'}{' '}
              {data.logo_included ? <strong>Your logo is included and will be printed.</strong> : <strong>A logo is not included in your package, so it will not be supplied or printed on your fascia unless you arrange and pay for it with the organiser.</strong>}
            </span>
          </div>
          <p className="es-small es-muted" style={{ margin: 0 }}>Best: vector (AI, EPS, SVG or PDF). Otherwise PNG/JPG at least 3000 px wide. Up to 50 MB.</p>
          <label className={`es-btn es-file ${closed ? '' : 'es-btn--blue'}`} style={{ alignSelf: 'flex-start' }} aria-disabled={closed}>
            <ImagePlus size={16} strokeWidth={1.75} /> {busy === 'logo' ? 'Uploading…' : 'Upload logo'}
            <input type="file" accept={LOGO_TYPES} disabled={closed || Boolean(busy)} onChange={e => { upload('logo', [...e.target.files]); e.target.value = ''; }} />
          </label>
          {logos.map(f => <div key={f.file_name + f.uploaded_at} className="es-small"><Check size={14} color="#1f9d5b" style={{ verticalAlign: -2 }} /> {f.file_name} <span className="es-muted">· {formatDayTime(f.uploaded_at)}</span></div>)}
        </div>

        {/* Artwork */}
        <div className="es-card es-pad es-stack">
          <div className="es-eyebrow">Print artwork</div>
          <h2 className="es-h2">Stand <em>graphics</em></h2>
          <p className="es-small es-muted" style={{ margin: 0 }}>Upload print-ready artwork for vinyl graphics or fabric banners. Operations can download these files for production.</p>
          <div className="es-grid2">
            <label className={`es-btn es-file ${closed ? '' : 'es-btn--blue'}`} aria-disabled={closed}>
              <Upload size={16} /> {busy === 'artwork_vinyl' ? 'Uploading…' : 'Upload vinyl artwork'}
              <input type="file" multiple accept={ARTWORK_TYPES} disabled={closed || Boolean(busy)} onChange={e => { upload('artwork_vinyl', [...e.target.files]); e.target.value = ''; }} />
            </label>
            <label className={`es-btn es-file ${closed ? '' : 'es-btn--blue'}`} aria-disabled={closed}>
              <Upload size={16} /> {busy === 'artwork_fabric' ? 'Uploading…' : 'Upload fabric banner artwork'}
              <input type="file" multiple accept={ARTWORK_TYPES} disabled={closed || Boolean(busy)} onChange={e => { upload('artwork_fabric', [...e.target.files]); e.target.value = ''; }} />
            </label>
          </div>
          {[...vinylArtwork, ...fabricArtwork].map(file => <div key={file.file_name + file.uploaded_at} className="es-small"><FileText size={14} style={{ verticalAlign: -2 }} /> {file.file_name} <span className="es-muted">· {file.kind === 'artwork_vinyl' ? 'Vinyl' : 'Fabric banner'} · {formatDayTime(file.uploaded_at)}</span></div>)}
        </div>

        {/* Documents */}
        <div className="es-card es-pad es-stack">
          <div className="es-eyebrow">Documents</div>
          <h2 className="es-h2">Stand <em>documents</em></h2>
          <p className="es-small es-muted" style={{ margin: 0 }}>Artwork, stand drawings, safety documents or anything the organiser asked for.</p>
          <label className="es-btn es-file" style={{ alignSelf: 'flex-start' }}>
            <Upload size={16} strokeWidth={1.75} /> {busy === 'document' ? 'Uploading…' : 'Upload documents'}
            <input type="file" multiple accept={DOC_TYPES} disabled={closed || Boolean(busy)} onChange={e => { upload('document', [...e.target.files]); e.target.value = ''; }} />
          </label>
          {docs.map(f => <div key={f.file_name + f.uploaded_at} className="es-small"><FileText size={14} strokeWidth={1.75} style={{ verticalAlign: -2 }} /> {f.file_name} <span className="es-muted">· {formatDayTime(f.uploaded_at)}</span></div>)}
        </div>

        {/* Orders */}
        {invoices.length > 0 && (
          <div className="es-card es-pad es-stack">
            <div className="es-eyebrow">Invoices</div>
            {invoices.map(invoice => (
              <div key={invoice.id} className="es-stack" style={{ borderTop:'1px solid #e3eaed', paddingTop:12 }}>
                <div className="es-summary-line">
                  <strong>{invoice.invoice_number}</strong>
                  <span className="es-grow es-small es-muted">{invoice.invoice_date}</span>
                  <span className="es-badge">{invoice.status === 'proof_uploaded' ? 'Proof submitted' : invoice.status}</span>
                  <strong>{rand(invoice.total_cents/100)}</strong>
                </div>
                <button className="es-btn es-btn--quiet es-invoice-download" type="button" onClick={()=>downloadInvoice(invoice)}><Download size={15}/> Download invoice</button>
                {invoice.items?.length>0&&<div className="es-small es-muted">{invoice.items.map(item=>`${item.quantity}× ${item.description}`).join(' · ')}</div>}
                {invoice.status==='proof_uploaded'&&<p className="es-small es-muted" role="status">Your EFT proof is with the Operations team for review.</p>}
                {invoice.status==='unpaid' ? (
                  <div className="es-grid2">
                    {invoice.payment_methods?.payfast&&<button className="es-btn es-btn--primary" disabled={Boolean(busy)} onClick={()=>startPayfast(invoice.id)}>{busy==='payfast'?'Opening…':'Pay with PayFast'}</button>}
                    {invoice.payment_methods?.yoco&&<button className="es-btn" disabled={Boolean(busy)} onClick={()=>startYoco(invoice.id)}>{busy==='yoco'?'Opening…':'Pay with Yoco'}</button>}
                    {invoice.payment_methods?.eft&&<>
                      <div className="es-alert es-alert--note es-payment-bank-details">
                        <strong>Bank transfer details</strong>
                        <span>{invoice.bank_details?.account_name||'Account holder not set'} · {invoice.bank_details?.bank_name||'Bank not set'}</span>
                        <span>Account: {invoice.bank_details?.account_number||'Not set'}{invoice.bank_details?.branch_code?` · Branch: ${invoice.bank_details.branch_code}`:''}</span>
                        {invoice.bank_details?.reference_prefix&&<span>Use reference: {invoice.bank_details.reference_prefix}{invoice.invoice_number}</span>}
                      </div>
                      <input className="es-input" maxLength={160} value={eftReference} onChange={e=>setEftReference(e.target.value)} placeholder="Bank / EFT reference" aria-label="Bank EFT reference" />
                      <label className="es-btn es-file"><Upload size={16}/> {eftProof?eftProof.name:'Attach proof'}<input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e=>setEftProof(e.target.files?.[0]||null)} /></label>
                      <button className="es-btn" disabled={Boolean(busy)||!eftReference.trim()||!eftProof} onClick={()=>submitEft(invoice.id)}>{busy==='eft'?'Submitting…':'Submit EFT proof'}</button>
                    </>}
                    {!invoice.payment_methods?.eft&&!invoice.payment_methods?.payfast&&!invoice.payment_methods?.yoco&&<p className="es-small es-muted">Payment methods are not available yet. Please contact the organiser.</p>}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
        <div className="es-card es-pad es-stack">
          <div><div className="es-eyebrow">Furniture orders</div><h2 className="es-h2">Orders &amp; delivery updates</h2></div>
          {data.orders?.length > 0 ? data.orders.map(order=>(
            <section className="es-portal-order" key={order.ref}>
              <div className="es-summary-line">
                <strong>{order.ref}</strong>
                <span className="es-grow es-small es-muted">Submitted {order.created_at ? formatDayTime(order.created_at) : '—'}</span>
                <span className="es-badge">{String(order.status||'submitted').replace(/_/g,' ')}</span>
                <strong>{rand(order.total_payable)}</strong>
              </div>
              <p className="es-small es-muted">{order.delivery_at ? `Scheduled delivery: ${formatDayTime(order.delivery_at)}` : 'Delivery is with the next truck to the event; a delivery time is not selected when ordering.'}</p>
              {(order.items||[]).map((item,index)=><div className="es-portal-order-item" key={item.id||`${order.ref}-${index}`}>
                <strong>{item.qty}× {item.name || item.label}{item.option ? ` · ${item.option}` : ''}</strong>
                <span className={`es-badge ${item.picked?'es-badge--green':''}`}>{item.picked?'Picked':'Awaiting pick'}</span>
                <span className={`es-badge ${item.loaded?'es-badge--blue':''}`}>{item.loaded?'Loaded':'Not loaded'}</span>
                <span className={`es-badge ${item.delivered?'es-badge--green':''}`}>{item.delivered?'Delivered':'Not delivered'}</span>
              </div>)}
            </section>
          )) : <p className="es-small es-muted" style={{ margin:0 }}>No furniture orders have been placed for this stand.</p>}
        </div>
      </main>
    </div>
  );
}
