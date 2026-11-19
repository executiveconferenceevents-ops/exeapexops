// ─── Exhibitor services (organiser / client) ─────────────────────────────────
// Orders · Stock list · Packages · Fascia & links · Settings
// [APEX exhibitor services 1]
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Boxes, CalendarClock, Check, Copy, Download, FileText, Link2, Package, Pencil, Plus, Printer, Settings, ShoppingBag, Trash2, Upload } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { downloadWorkbook } from '../lib/workbook';
import { getActiveEvent } from '../lib/eventScope';
import {
  DEFAULT_SETTINGS, PACKAGE_TEMPLATE_COLUMNS, SHELL_SIZES, STANDARD_FEATURES, createStandardPackages, featureFromLabel, hasLogo, packageFulfillmentRows, PACKAGE_TEMPLATE_EXAMPLE, STOCK_TEMPLATE_COLUMNS, STOCK_TEMPLATE_EXAMPLE,
  deliveryRows, eventAccessWindow, formatDay, formatDayTime, getCatalogue, getEventExhibitorPayments, getExhibitorFileUrl, getExhibitorPaymentProofUrl, getExhibitorProfiles, getOrderSettings,
  getOrders, getPackages, importCatalogue, importPackages, packageInfrastructure, parsePackageRows, parseStockRows,
  portalLink, priceBreakdown, rand, rand2, readServiceImportRows, removeCatalogueItem, removePackage, reviewExhibitorEft, saveCatalogueItem, saveExhibitorProfile, saveOrderSettings,
  savePackage, stockTotals, updateOrder, uploadCataloguePhoto,
} from '../lib/exhibitorServices';
import './exhibitor-services.css';

const STATUS_LABEL = { submitted: 'New', confirmed: 'Confirmed', picking: 'Picking', loaded: 'Loaded', delivered: 'Delivered', cancelled: 'Cancelled' };
const STATUS_TONE = { submitted: 'es-badge--navy', confirmed: 'es-badge--blue', picking: 'es-badge--amber', loaded: 'es-badge--amber', delivered: 'es-badge--green', cancelled: '' };
const FASCIA_LABEL = { pending: 'Waiting', submitted: 'To approve', approved: 'Approved' };
const FASCIA_TONE = { pending: '', submitted: 'es-badge--amber', approved: 'es-badge--green' };

async function fileRows(file) { return readServiceImportRows(file); }
function templateRow(columns, example) { return Object.fromEntries(columns.map((c, i) => [c, example[i]])); }

export default function ExhibitorServices({ initialTab = 'orders', onOpenShop }) {
  const [tab, setTab] = useState(initialTab);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [catalogue, setCatalogue] = useState([]);
  const [packages, setPackages] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [orders, setOrders] = useState([]);
  const [exhibitorPayments, setExhibitorPayments] = useState({ invoices:[], payments:[] });
  const [paymentLoadError, setPaymentLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const event = getActiveEvent();
  const accessWindow = eventAccessWindow(event, settings);

  const load = useCallback(async () => {
    try {
      const [s, c, p, pr, o] = await Promise.all([getOrderSettings(), getCatalogue(), getPackages(), getExhibitorProfiles(), getOrders()]);
      setSettings(s); setCatalogue(c); setPackages(p); setProfiles(pr); setOrders(o);
      try {
        setExhibitorPayments(await getEventExhibitorPayments());
        setPaymentLoadError('');
      } catch (paymentError) {
        setPaymentLoadError(/exhibitor_invoices|exhibitor_payments|PGRST20|42P01/i.test(`${paymentError?.code||''} ${paymentError?.message||''}`)
          ? 'Exhibitor invoice and EFT review tables are not installed yet. Review the exhibitor invoice/payment migration before applying it.'
          : paymentError.message||'Could not load exhibitor payment records.');
      }
    } catch (error) { setMessage({ tone: 'error', text: error.message }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (text, tone = 'ok') => { setMessage({ tone, text }); window.clearTimeout(flash.t); flash.t = window.setTimeout(() => setMessage(null), 4500); };
  const run = async (fn, ok) => { try { await fn(); if (ok) flash(ok); await load(); } catch (error) { flash(error.message, 'error'); } };

  const openOrders = orders.filter(o => !['delivered', 'cancelled'].includes(o.status));
  const fasciaToApprove = profiles.filter(p => p.fascia_status === 'submitted').length;
  const tabs = [
    { key: 'orders', label: 'Orders', Icon: ShoppingBag, count: orders.filter(o => o.status === 'submitted').length },
    { key: 'stock', label: 'Stock list', Icon: Boxes },
    { key: 'packages', label: 'Packages', Icon: Package },
    { key: 'fascia', label: 'Fascia & links', Icon: Link2, count: fasciaToApprove },
    { key: 'settings', label: 'Settings', Icon: Settings },
  ];

  return (
    <div className="es es-page">
      <PageHeader eyebrow="Exhibitor services" title="Orders &" accent="packages" subtitle="Furniture orders, stand packages, fascia names and logos — in one place." />

      <div className="es-kpis">
        <div className="es-card es-kpi"><span>Orders received</span><strong>{orders.length}</strong><small>{openOrders.length} still to deliver</small></div>
        <div className="es-card es-kpi"><span>Exhibitors pay</span><strong>{rand(orders.reduce((t, o) => t + Number(o.total_payable || 0), 0))}</strong><small>Incl. VAT where it applies</small></div>
        <div className="es-card es-kpi"><span>Fascia names</span><strong>{profiles.filter(p => p.fascia_status !== 'pending').length}/{profiles.length}</strong><small>{fasciaToApprove} waiting for approval</small></div>
        <div className="es-card es-kpi"><span>Event access</span><strong style={{ fontSize: 20 }}>{accessWindow.state === 'open' ? 'Open' : accessWindow.state === 'archived' ? 'Archived' : accessWindow.state === 'upcoming' ? 'Not open yet' : 'Set dates'}</strong><small>{formatDay(accessWindow.opensAt)} → {formatDay(accessWindow.closesAt)}</small></div>
      </div>

      <div className="es-tabs es-no-print" role="tablist">
        {tabs.map(({ key, label, Icon, count }) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'is-on' : ''} onClick={() => setTab(key)}>
            <Icon size={16} strokeWidth={1.75} /> {label}{count ? <span className="es-tab-count">{count}</span> : null}
          </button>
        ))}
      </div>

      {message && <div className={`es-alert es-alert--${message.tone}`} role="status">{message.text}</div>}
      {loading ? <div className="es-card es-pad es-muted">Loading…</div> : (
        <>
          {tab === 'orders' && <OrdersTab orders={orders} settings={settings} run={run} onOpenShop={onOpenShop} exhibitorPayments={exhibitorPayments} paymentLoadError={paymentLoadError} />}
          {tab === 'stock' && <StockTab catalogue={catalogue} settings={settings} run={run} flash={flash} />}
          {tab === 'packages' && <PackagesTab packages={packages} profiles={profiles} catalogue={catalogue} run={run} flash={flash} event={event} />}
          {tab === 'fascia' && <FasciaTab profiles={profiles} packages={packages} run={run} flash={flash} />}
          {tab === 'settings' && <SettingsTab settings={settings} accessWindow={accessWindow} run={run} />}
        </>
      )}
    </div>
  );
}

// ── Orders ───────────────────────────────────────────────────────────────────
function OrdersTab({ orders, settings, run, onOpenShop, exhibitorPayments, paymentLoadError }) {
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const [proofLinks, setProofLinks] = useState({});
  const [paymentActionError, setPaymentActionError] = useState('');
  const shown = orders.filter(o => filter === 'all' || (filter === 'open' ? !['delivered', 'cancelled'].includes(o.status) : o.status === filter));
  const invoicesByOrder = new Map(exhibitorPayments.invoices.map(invoice=>[invoice.order_id,invoice]));
  const paymentsByInvoice = new Map();
  exhibitorPayments.payments.forEach(payment=>{
    const list=paymentsByInvoice.get(payment.invoice_id)||[];
    list.push(payment);
    paymentsByInvoice.set(payment.invoice_id,list);
  });
  const review = (payment,approve) => {
    const note=approve?'':window.prompt('Reason for rejecting this EFT proof (optional):');
    if (note===null) return;
    setPaymentActionError('');
    void run(()=>reviewExhibitorEft(payment.id,approve,note),approve?'EFT approved. The exhibitor invoice is marked paid.':'EFT proof rejected; the exhibitor can submit a new proof.');
  };
  const openProof = async payment => {
    try {
      const url=await getExhibitorPaymentProofUrl(payment.evidence_path);
      if (!url) throw new Error('No secure proof link was returned.');
      setProofLinks(current=>({...current,[payment.id]:url}));
    } catch (error) {
      setPaymentActionError(error.message||'Could not open EFT proof.');
    }
  };
  const exportFinance = () => downloadWorkbook(`orders-with-values-${new Date().toISOString().slice(0, 10)}.xlsx`, [
    { name: 'Orders', rows: orders.map(o => ({ Order: o.ref, Date: formatDayTime(o.created_at), Stand: o.stand, Exhibitor: o.exhibitor_name, Contact: o.contact_name, Email: o.contact_email, Phone: o.contact_phone, 'Deliver by': o.delivery_at ? formatDayTime(o.delivery_at) : '', Status: STATUS_LABEL[o.status], 'Supplier price excl VAT': Number(o.total_excl_vat), VAT: Number(o.total_vat), 'Platform fee (internal)': Number(o.total_fee), 'Exhibitor pays': Number(o.total_payable) })) },
    { name: 'Lines', rows: orders.flatMap(o => (o.items || []).map(it => ({ Order: o.ref, Stand: o.stand, Code: it.code, Item: it.name, Option: it.option || '', Qty: it.qty, 'Unit excl VAT': Number(it.unit_price_excl_vat), 'Unit exhibitor pays': Number(it.unit_payable), 'Line exhibitor pays': Number(it.unit_payable) * it.qty }))) },
  ]);
  const exportPick = () => downloadWorkbook(`pick-list-no-values-${new Date().toISOString().slice(0, 10)}.xlsx`, [
    { name: 'Totals to load', rows: stockTotals(orders).map(r => ({ 'Item code': r.code, Item: r.name, Option: r.option, 'Total qty': r.qty })) },
    { name: 'Per stand', rows: deliveryRows(orders) },
  ]);

  return (
    <div className="es-stack">
      <div className="es-row es-no-print">
        <select className="es-select" style={{ width: 200 }} value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter orders">
          <option value="all">All orders</option><option value="open">Still to deliver</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span className="es-grow" />
        {onOpenShop && <button className="es-btn es-btn--quiet" onClick={onOpenShop}><ShoppingBag size={16} strokeWidth={1.75} /> Order for an exhibitor</button>}
        <button className="es-btn" onClick={exportPick}><Download size={16} strokeWidth={1.75} /> Pick list (no prices)</button>
        <button className="es-btn es-btn--primary" onClick={exportFinance}><Download size={16} strokeWidth={1.75} /> Orders with values</button>
      </div>
      {paymentLoadError&&<div className="es-alert es-alert--note" role="status">{paymentLoadError}</div>}
      {paymentActionError&&<div className="es-alert es-alert--error" role="alert">{paymentActionError}</div>}
      <div className="es-card es-table-wrap">
        <table className="es-table">
          <thead><tr><th>Order</th><th>Stand</th><th>Exhibitor</th><th>Deliver by</th><th>Items</th><th className="num">Exhibitor pays</th><th>Invoice / payment</th><th>Status</th><th /></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={9} className="es-muted" style={{ padding: 28, textAlign: 'center' }}>No orders yet. Share the exhibitor link and orders will arrive here.</td></tr>}
            {shown.map(o => (
              <React.Fragment key={o.id}>
                {(() => {
                  const invoice=invoicesByOrder.get(o.id);
                  const pendingPayment=(paymentsByInvoice.get(invoice?.id)||[]).find(payment=>payment.status==='pending_review');
                  return <>
                <tr>
                  <td><strong>{o.ref}</strong><br /><small className="es-muted">{formatDayTime(o.created_at)}</small></td>
                  <td><strong>{o.stand}</strong></td>
                  <td>{o.exhibitor_name}<br /><small className="es-muted">{o.contact_name} · {o.contact_email}</small></td>
                  <td>{o.delivery_at ? formatDayTime(o.delivery_at) : <span className="es-muted">Not set</span>}</td>
                  <td>{(o.items || []).reduce((t, i) => t + i.qty, 0)}</td>
                  <td className="num"><strong>{rand(o.total_payable)}</strong></td>
                  <td>{invoice?<><strong>{invoice.invoice_number}</strong><br/><span className="es-badge">{String(invoice.status).replaceAll('_',' ')}</span>{pendingPayment&&<div className="es-payment-review">
                    <button className="es-btn es-btn--sm es-btn--quiet" onClick={()=>openProof(pendingPayment)}>Create secure proof link</button>
                    <button className="es-btn es-btn--sm es-btn--primary" onClick={()=>review(pendingPayment,true)}>Approve</button>
                    <button className="es-btn es-btn--sm es-btn--quiet" onClick={()=>review(pendingPayment,false)}>Reject</button>
                    {proofLinks[pendingPayment.id]&&<a href={proofLinks[pendingPayment.id]} target="_blank" rel="noreferrer">Open secure proof link</a>}
                  </div>}</>:<span className="es-muted">Pending</span>}</td>
                  <td>
                    <select className="es-select" style={{ minHeight: 36, width: 140 }} value={o.status} onChange={e => run(() => updateOrder(o.id, { status: e.target.value }), `${o.ref} updated.`)} aria-label={`Status of ${o.ref}`}>
                      {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td><button className="es-btn es-btn--sm es-btn--quiet" onClick={() => setOpen(open === o.id ? null : o.id)}>{open === o.id ? 'Hide' : 'View'}</button></td>
                </tr>
                {open === o.id && (
                  <tr><td colSpan={9} style={{ background: '#fbfaf7' }}>
                    <table className="es-lines">
                      <thead><tr><th>Item</th><th>Option</th><th>Qty</th><th className="num">Supplier excl VAT</th><th className="num">Exhibitor pays</th></tr></thead>
                      <tbody>{(o.items || []).map(it => <tr key={it.id}><td>{it.code} · {it.name}</td><td>{it.option || '—'}</td><td>{it.qty}</td><td className="num">{rand2(it.unit_price_excl_vat * it.qty)}</td><td className="num">{rand(it.unit_payable * it.qty)}</td></tr>)}</tbody>
                    </table>
                    <p className="es-small es-muted" style={{ margin: '10px 6px 0' }}>
                      Supplier {rand2(o.total_excl_vat)} · VAT {rand2(o.total_vat)} · <span title="Internal — never shown to exhibitors">Platform fee {Math.round((settings.platform_fee_rate || 0) * 100)}% {rand2(o.total_fee)}</span> · Exhibitor pays <strong>{rand(o.total_payable)}</strong>
                      {o.notes ? <><br />Note from exhibitor: {o.notes}</> : null}
                    </p>
                  </td></tr>
                )}
                  </>;
                })()}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Stock list ───────────────────────────────────────────────────────────────
function StockTab({ catalogue, settings, run, flash }) {
  const [draft, setDraft] = useState(null);
  const template = () => downloadWorkbook('APEXOPS-stock-list-template.xlsx', [{ name: 'Stock list', rows: [templateRow(STOCK_TEMPLATE_COLUMNS, STOCK_TEMPLATE_EXAMPLE)] }]);
  const onImport = async e => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    try {
      const items = parseStockRows(await fileRows(file));
      if (!items.length) throw new Error('No items found. Use the template — columns must be in the same order.');
      await run(() => importCatalogue(items), `${items.length} items imported. Add photos below where needed.`);
    } catch (error) { flash(error.message, 'error'); }
  };
  const onPhoto = async (item, file) => { if (!file) return; await run(async () => saveCatalogueItem({ ...item, photo_url: await uploadCataloguePhoto(item.code, file) }), 'Photo saved.'); };

  return (
    <div className="es-stack">
      <div className="es-alert es-alert--note">
        Enter the supplier price <strong>excluding VAT</strong>. Exhibitors only see the final price: price{settings.prices_exclude_vat ? ` + VAT ${Math.round(settings.vat_rate * 100)}%` : ''} + the platform fee, rounded to the rand. The grey columns are for you only.
      </div>
      <div className="es-row es-no-print">
        <button className="es-btn" onClick={template}><FileText size={16} strokeWidth={1.75} /> Download template</button>
        <label className="es-btn es-file"><Upload size={16} strokeWidth={1.75} /> Import Excel / CSV<input type="file" accept=".xlsx,.xls,.csv" onChange={onImport} /></label>
        <span className="es-grow" />
        <button className="es-btn es-btn--primary" onClick={() => setDraft({ category: 'Furniture', code: '', name: '', options: [], size: '', price_excl_vat: '', stock_qty: '' })}><Plus size={16} strokeWidth={1.75} /> Add item</button>
      </div>
      {draft && (
        <div className="es-card es-pad es-stack">
          <h2 className="es-h2">{draft.id ? 'Edit' : 'New'} <em>item</em></h2>
          <div className="es-grid2">
            <label className="es-label">Category<input className="es-input" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} /></label>
            <label className="es-label">Item code<input className="es-input" value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })} /></label>
            <label className="es-label">Item name<input className="es-input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="es-label">Options (separate with |)<input className="es-input" value={(draft.options || []).join(' | ')} onChange={e => setDraft({ ...draft, options: e.target.value.split('|').map(x => x.trim()).filter(Boolean) })} /></label>
            <label className="es-label">Size / notes<input className="es-input" value={draft.size || ''} onChange={e => setDraft({ ...draft, size: e.target.value })} /></label>
            <label className="es-label">Price excl VAT (R)<input className="es-input" inputMode="decimal" value={draft.price_excl_vat} onChange={e => setDraft({ ...draft, price_excl_vat: e.target.value })} /></label>
            <label className="es-label">Stock available<input className="es-input" inputMode="numeric" value={draft.stock_qty ?? ''} onChange={e => setDraft({ ...draft, stock_qty: e.target.value })} /></label>
          </div>
          <p className="es-small es-muted" style={{ margin: 0 }}>Exhibitor will pay <strong>{rand(priceBreakdown(draft.price_excl_vat, settings).exhibitorPrice)}</strong></p>
          <div className="es-row"><button className="es-btn es-btn--primary" onClick={() => run(() => saveCatalogueItem(draft), 'Item saved.').then(() => setDraft(null))}><Check size={16} /> Save</button><button className="es-btn es-btn--quiet" onClick={() => setDraft(null)}>Cancel</button></div>
        </div>
      )}
      <div className="es-card es-table-wrap">
        <table className="es-table">
          <thead><tr><th>Item</th><th>Options</th><th className="num">Price excl VAT</th><th className="num internal">VAT</th><th className="num internal">Platform fee</th><th className="num">Exhibitor pays</th><th className="num">Stock</th><th>Shown</th><th /></tr></thead>
          <tbody>
            {catalogue.length === 0 && <tr><td colSpan={9} className="es-muted" style={{ padding: 28, textAlign: 'center' }}>No stock list yet. Download the template, fill it in and import it.</td></tr>}
            {catalogue.map(item => {
              const b = priceBreakdown(item.price_excl_vat, settings);
              return (
                <tr key={item.id}>
                  <td>
                    <div className="es-item">
                      <label title="Add or change photo" style={{ cursor: 'pointer', position: 'relative' }}>
                        {item.photo_url ? <img className="es-thumb" src={item.photo_url} alt="" /> : <span className="es-thumb es-thumb--empty">Add photo</span>}
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => onPhoto(item, e.target.files?.[0])} />
                      </label>
                      <div><strong>{item.name}</strong><small>{item.code}{item.size ? ` · ${item.size}` : ''} · {item.category}</small></div>
                    </div>
                  </td>
                  <td className="es-small">{(item.options || []).join(', ') || '—'}</td>
                  <td className="num">{rand2(b.base)}</td>
                  <td className="num internal">{rand2(b.vat)}</td>
                  <td className="num internal">{rand2(b.fee)}</td>
                  <td className="num"><strong>{rand(b.exhibitorPrice)}</strong></td>
                  <td className="num">{item.stock_qty ?? '—'}</td>
                  <td><input type="checkbox" checked={item.active !== false} onChange={e => run(() => saveCatalogueItem({ ...item, active: e.target.checked }))} aria-label={`Show ${item.name} to exhibitors`} /></td>
                  <td className="es-row" style={{ flexWrap: 'nowrap' }}>
                    <button className="es-btn es-btn--sm es-btn--quiet" onClick={() => setDraft(item)}>Edit</button>
                    <button className="es-btn es-btn--sm es-btn--quiet" aria-label={`Remove ${item.name}`} onClick={() => window.confirm(`Remove ${item.name}?`) && run(() => removeCatalogueItem(item.id), 'Item removed.')}><Trash2 size={15} strokeWidth={1.75} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Packages ─────────────────────────────────────────────────────────────────
// Each event has its own packages. Cards are read-only; click Edit to change.
function PackagesTab({ packages, profiles, catalogue, run, flash, event }) {
  const [editing, setEditing] = useState(null); // package being edited (copy) or null
  const counts = useMemo(() => profiles.reduce((m, p) => { if (p.package_code) m[p.package_code] = (m[p.package_code] || 0) + 1; return m; }, {}), [profiles]);
  const infrastructure = useMemo(() => packageInfrastructure(profiles, packages), [profiles, packages]);
  const unassigned = profiles.filter(p => !p.package_code).length;
  const missingSizes = SHELL_SIZES.filter(sqm => !packages.some(p => p.code === `SHELL${sqm}`));
  const template = () => downloadWorkbook('APEXOPS-packages-template.xlsx', [{ name: 'Packages', rows: [templateRow(PACKAGE_TEMPLATE_COLUMNS, PACKAGE_TEMPLATE_EXAMPLE)] }]);
  const onImport = async e => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    try { const list = parsePackageRows(await fileRows(file)); if (!list.length) throw new Error('No packages found. Use the template.'); await run(() => importPackages(list), `${list.length} packages imported.`); }
    catch (error) { flash(error.message, 'error'); }
  };
  const byCode = new Map(packages.map(p => [p.code, p]));
  const exportInfra = () => downloadWorkbook(`infrastructure-${new Date().toISOString().slice(0, 10)}.xlsx`, [
    { name: 'Items to pack', rows: infrastructure.lines.map(r => ({ Item: r.label, 'Total qty': r.qty })) },
    { name: 'Features to prepare', rows: infrastructure.features.map(r => ({ Feature: r.label, Stands: r.qty })) },
    { name: 'Per stand', rows: profiles.filter(p => p.package_code).flatMap(p => { const pkg = byCode.get(p.package_code); return [
      ...packageFulfillmentRows(p, pkg).map(it => ({ Stand: p.stand, Exhibitor: p.name, Package: p.package_code, Type: 'Package stock', 'Item / feature': it.label, Qty: it.qty, Packed:it.packed ? 'Yes' : 'No', 'On stand':it.on_stand ? 'Yes' : 'No', Returned:it.returned ? 'Yes' : 'No', 'Fascia name': p.fascia_name || '' })),
      ...(pkg?.features || []).map(f => ({ Stand: p.stand, Exhibitor: p.name, Package: p.package_code, Type: 'Feature', 'Item / feature': f.label, Qty: 1, 'Fascia name': p.fascia_name || '' })),
      ...(!hasLogo(pkg) && p.logo_paid ? [{ Stand: p.stand, Exhibitor: p.name, Package: p.package_code, Type: 'Feature (paid extra)', 'Item / feature': 'Logo printed on fascia', Qty: 1, 'Fascia name': p.fascia_name || '' }] : []),
    ]; }) },
  ]);

  return (
    <div className="es-stack">
      <div className="es-alert es-alert--note">Packages belong to <strong>this event only</strong>. Start from the standard shell schemes, then click <strong>Edit</strong> to tick features and add or remove lines. Assign a package to each exhibitor on the <strong>Fascia &amp; links</strong> tab.</div>
      <div className="es-row es-no-print">
        {missingSizes.length > 0 && <button className="es-btn es-btn--blue" onClick={() => run(() => createStandardPackages(packages), `${missingSizes.length} standard shell scheme packages added (${missingSizes.join(', ')}m²).`)}><Package size={16} strokeWidth={1.75} /> Add standard shell schemes</button>}
        <button className="es-btn" onClick={template}><FileText size={16} strokeWidth={1.75} /> Template</button>
        <label className="es-btn es-file"><Upload size={16} strokeWidth={1.75} /> Import<input type="file" accept=".xlsx,.xls,.csv" onChange={onImport} /></label>
        <span className="es-grow" />
        <button className="es-btn es-btn--primary" onClick={() => setEditing({ code: '', name: '', size_sqm: '', description: '', features: STANDARD_FEATURES.filter(f => ['fascia_name', 'carpet', 'lighting', 'power'].includes(f.key)), items: [{ qty: 1, label: '' }] })}><Plus size={16} strokeWidth={1.75} /> New package</button>
      </div>

      {editing && <PackageEditor value={editing} catalogue={catalogue} onCancel={() => setEditing(null)} onSave={pkg => run(() => savePackage(pkg), `${pkg.name || 'Package'} saved.`).then(() => setEditing(null))} />}

      <div className="es-pkg-grid">
        {packages.length === 0 && <div className="es-card es-pad es-muted">No packages yet. Click “Add standard shell schemes” to start with 6, 9, 12, 18, 24 and 32m².</div>}
        {packages.map(p => (
          <div key={p.id} className="es-card es-pkg">
            <div className="es-row"><span className="es-badge es-badge--navy">{p.code}</span>{p.size_sqm ? <span className="es-badge">{p.size_sqm}m²</span> : null}<span className="es-grow" /><span className="es-badge">{counts[p.code] || 0} stand{counts[p.code] === 1 ? '' : 's'}</span></div>
            <h2 className="es-h2">{p.name}</h2>
            {p.description && <p className="es-small es-muted" style={{ margin: 0 }}>{p.description}</p>}
            <div className="es-feature-list">
              {(p.features || []).map(f => <span key={f.key} className={`es-feature ${f.key === 'fascia_logo' ? 'is-logo' : ''}`}><Check size={13} strokeWidth={2.25} /> {f.label}</span>)}
              {!hasLogo(p) && <span className="es-feature is-off">No logo on fascia</span>}
            </div>
            <ul>{(p.items || []).map((it, i) => <li key={i}><b>{it.qty}×</b>{it.label}</li>)}</ul>
            <div className="es-row es-no-print" style={{ marginTop: 'auto' }}>
              <button className="es-btn es-btn--sm" onClick={() => setEditing(JSON.parse(JSON.stringify(p)))}><Pencil size={14} strokeWidth={1.75} /> Edit</button>
              <button className="es-btn es-btn--sm es-btn--quiet" onClick={() => setEditing({ ...JSON.parse(JSON.stringify(p)), id: undefined, code: `${p.code}-B`, name: `${p.name} (copy)` })}><Copy size={14} strokeWidth={1.75} /> Duplicate</button>
              <span className="es-grow" />
              <button className="es-btn es-btn--sm es-btn--quiet" aria-label={`Remove ${p.name}`} onClick={() => (counts[p.code] ? flash(`${counts[p.code]} stands use ${p.code}. Move them to another package first.`, 'error') : window.confirm(`Remove package ${p.name}?`) && run(() => removePackage(p.id), 'Package removed.'))}><Trash2 size={15} strokeWidth={1.75} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="es-card es-pad es-stack">
        <div className="es-row">
          <div className="es-grow"><div className="es-eyebrow">Infrastructure print</div><h2 className="es-h2">Stock to prepare for <em>{event?.name || 'this event'}</em></h2>
            <p className="es-small es-muted" style={{ margin: '4px 0 0' }}>Totals from every exhibitor's package, for the warehouse to pack.{unassigned ? ` ${unassigned} stand${unassigned === 1 ? ' has' : 's have'} no package yet.` : ''}</p></div>
          <button className="es-btn es-no-print" onClick={exportInfra}><Download size={16} strokeWidth={1.75} /> Excel</button>
          <button className="es-btn es-btn--primary es-no-print" onClick={() => window.print()}><Printer size={16} strokeWidth={1.75} /> Print</button>
        </div>
        <div className="es-grid2" style={{ alignItems: 'start' }}>
          <table className="es-lines">
            <thead><tr><th>Package stock to pack</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>{infrastructure.lines.length === 0 ? <tr><td colSpan={2} className="es-muted">Assign packages to exhibitors to see totals.</td></tr> : infrastructure.lines.map(r => <tr key={r.label}><td>{r.label}</td><td style={{ textAlign: 'right' }}><strong>{r.qty}</strong></td></tr>)}</tbody>
          </table>
          <table className="es-lines">
            <thead><tr><th>Package feature to prepare</th><th style={{ textAlign: 'right' }}>Stands</th></tr></thead>
            <tbody>{infrastructure.features.length === 0 ? <tr><td colSpan={2} className="es-muted">—</td></tr> : infrastructure.features.map(r => <tr key={r.label}><td>{r.label}</td><td style={{ textAlign: 'right' }}><strong>{r.qty}</strong></td></tr>)}</tbody>
          </table>
        </div>
      </div>
      <div className="es-card es-pad es-stack">
        <div className="es-row">
          <div className="es-grow"><div className="es-eyebrow">Warehouse pack-out</div><h2 className="es-h2">Package stock by stand</h2>
            <p className="es-small es-muted" style={{ margin:'4px 0 0' }}>Track package items separately from exhibitor furniture orders and truck deliveries.</p></div>
          <button className="es-btn es-no-print" onClick={exportInfra}><Download size={16} strokeWidth={1.75} /> Download pack list</button>
        </div>
        <div className="es-packout-table-wrap">
          <table className="es-lines es-packout-table">
            <thead><tr><th>Stand / exhibitor</th><th>Package item</th><th>Qty</th><th>Packed</th><th>On stand</th><th>Returned</th></tr></thead>
            <tbody>
              {profiles.filter(profile=>profile.package_code).flatMap(profile=>{
                const pkg=byCode.get(profile.package_code);
                return packageFulfillmentRows(profile,pkg).map(item=><tr key={`${profile.stand}-${item.id}`}>
                  <td><strong>{profile.stand}</strong><small>{profile.name}</small></td><td>{item.label}</td><td>{item.qty}</td>
                  {['packed','on_stand','returned'].map(status=><td key={status} className="tick"><label className="es-check"><input type="checkbox" checked={item[status]} aria-label={`Mark ${status === 'on_stand' ? 'on stand' : status} for stand ${profile.stand}, ${item.label}`} onChange={event=>{
                    const current=profile.package_fulfillment||{};
                    const previous=current[item.id]||{};
                    const package_fulfillment={...current,[item.id]:{...previous,[status]:event.target.checked}};
                    run(()=>saveExhibitorProfile(profile.stand,{package_fulfillment}),`Pack-out updated for stand ${profile.stand}.`);
                  }}/></label></td>)}
                </tr>);
              })}
              {!profiles.some(profile=>profile.package_code&&byCode.has(profile.package_code))&&<tr><td colSpan={6} className="es-muted">Assign a package to an exhibitor to create its stand pack list.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PackageEditor({ value, catalogue, onSave, onCancel }) {
  const [pkg, setPkg] = useState(value);
  const [custom, setCustom] = useState('');
  const set = patch => setPkg(p => ({ ...p, ...patch }));
  const ticked = new Set((pkg.features || []).map(f => f.key));
  const customFeatures = (pkg.features || []).filter(f => !STANDARD_FEATURES.some(s => s.key === f.key));
  const toggle = f => set({ features: ticked.has(f.key) ? pkg.features.filter(x => x.key !== f.key) : [...(pkg.features || []), f] });
  const setLine = (i, patch) => set({ items: pkg.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const addCustom = () => { const label = custom.trim(); if (!label) return; const f = featureFromLabel(label); if (!ticked.has(f.key)) set({ features: [...(pkg.features || []), f] }); setCustom(''); };
  const itemNames = [...new Set([...(catalogue || []).map(c => c.name), 'Chair', 'Table', 'Info counter', 'Waste bin', 'Brochure stand', 'Spotlight', 'Plug point', 'Shelf', 'Lockable cupboard'])];

  return (
    <div className="es-card es-pad es-stack es-editor">
      <h2 className="es-h2">{pkg.id ? 'Edit' : 'New'} <em>package</em></h2>
      <div className="es-grid2">
        <label className="es-label">Package name<input className="es-input" value={pkg.name} onChange={e => set({ name: e.target.value })} placeholder="Shell scheme 9m²" /></label>
        <label className="es-label">Code (short)<input className="es-input" value={pkg.code} onChange={e => set({ code: e.target.value.toUpperCase() })} placeholder="SHELL9" /></label>
        <label className="es-label">Size (m²)<input className="es-input" inputMode="numeric" value={pkg.size_sqm || ''} onChange={e => set({ size_sqm: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="9" /></label>
        <label className="es-label">Description<input className="es-input" value={pkg.description || ''} onChange={e => set({ description: e.target.value })} /></label>
      </div>

      <div>
        <div className="es-eyebrow" style={{ marginBottom: 8 }}>Included features — tick what applies</div>
        <div className="es-tickgrid">
          {[...STANDARD_FEATURES, ...customFeatures].map(f => (
            <label key={f.key} className={`es-tick ${ticked.has(f.key) ? 'is-on' : ''}`}><input type="checkbox" checked={ticked.has(f.key)} onChange={() => toggle(f)} /> {f.label}</label>
          ))}
        </div>
        <div className="es-row" style={{ marginTop: 10 }}>
          <input className="es-input" style={{ maxWidth: 320 }} value={custom} onChange={e => setCustom(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCustom()} placeholder="Add your own option, e.g. Digital screen" aria-label="New feature" />
          <button className="es-btn es-btn--sm" onClick={addCustom}><Plus size={14} /> Add option</button>
        </div>
        {!ticked.has('fascia_logo') && <p className="es-small es-muted" style={{ margin: '8px 0 0' }}>Logo not ticked: exhibitors on this package see that their logo won't be printed unless they pay extra.</p>}
      </div>

      <div>
        <div className="es-eyebrow" style={{ marginBottom: 8 }}>Items in the package</div>
        <datalist id="es-item-names">{itemNames.map(n => <option key={n} value={n} />)}</datalist>
        <div className="es-stack" style={{ gap: 8 }}>
          {pkg.items.map((it, i) => (
            <div key={i} className="es-line-edit">
              <div className="es-qty">
                <button aria-label="One less" onClick={() => setLine(i, { qty: Math.max(1, Number(it.qty) - 1) })}>−</button>
                <input inputMode="numeric" value={it.qty} onChange={e => setLine(i, { qty: e.target.value.replace(/\D/g, '') })} aria-label="Quantity" />
                <button aria-label="One more" onClick={() => setLine(i, { qty: Number(it.qty || 0) + 1 })}>+</button>
              </div>
              <input className="es-input" list="es-item-names" value={it.label} onChange={e => setLine(i, { label: e.target.value })} placeholder="Item, e.g. Chair" aria-label="Item" />
              <button className="es-btn es-btn--sm es-btn--quiet" aria-label="Remove line" onClick={() => set({ items: pkg.items.filter((_, j) => j !== i) })}><Trash2 size={15} strokeWidth={1.75} /></button>
            </div>
          ))}
          <button className="es-btn es-btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => set({ items: [...pkg.items, { qty: 1, label: '' }] })}><Plus size={14} /> Add line</button>
        </div>
      </div>

      <div className="es-row">
        <button className="es-btn es-btn--primary" onClick={() => onSave({ ...pkg, items: pkg.items.filter(it => String(it.label).trim()) })}><Check size={16} /> Save package</button>
        <button className="es-btn es-btn--quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Fascia names, logos & private links ─────────────────────────────────────
function FasciaTab({ profiles, packages, run, flash }) {
  const [query, setQuery] = useState('');
  const byCode = new Map(packages.map(p => [p.code, p]));
  const shown = profiles.filter(p => !query || `${p.stand} ${p.name} ${p.fascia_name || ''}`.toLowerCase().includes(query.toLowerCase()));
  const copy = async p => {
    if (!p.portal_token) return flash('This stand has no private link yet. Save it once and try again.', 'error');
    try { await navigator.clipboard.writeText(portalLink(p.portal_token)); flash(`Private link for stand ${p.stand} copied. Send it only to ${p.name}.`); }
    catch { window.prompt('Copy this private link:', portalLink(p.portal_token)); }
  };
  const mailto = p => `mailto:${encodeURIComponent(p.email || '')}?subject=${encodeURIComponent(`Your stand ${p.stand}: fascia name and logo`)}&body=${encodeURIComponent(`Hi ${p.contact || ''},\n\nPlease confirm your fascia board name and upload your high-resolution logo and documents here:\n${portalLink(p.portal_token)}\n\nThis link is private to your stand — please don't share it.\n\nKind regards`)}`;
  const openFile = async f => { const url = await getExhibitorFileUrl(f); if (url) window.open(url, '_blank', 'noopener'); else flash('Preview not available in demo for large files.', 'error'); };
  const exportFascia = () => downloadWorkbook(`fascia-names-${new Date().toISOString().slice(0, 10)}.xlsx`, [{ name: 'Fascia', rows: profiles.map(p => { const pkg = byCode.get(p.package_code); return { Stand: p.stand, Exhibitor: p.name, Package: p.package_code || '', 'Fascia name': p.fascia_name || '', Status: FASCIA_LABEL[p.fascia_status] || '', 'Logo to print': hasLogo(pkg) || p.logo_paid ? 'Yes' : 'No', 'Logo uploaded': p.files?.some(f => f.kind === 'logo') ? 'Yes' : 'No' }; }) }]);

  return (
    <div className="es-stack">
      <div className="es-alert es-alert--note">Each exhibitor gets a <strong>private link</strong> to confirm their fascia name and upload high-res logos and documents. Share each link only with the intended exhibitor. Logos are only printed when the package includes it or the logo was paid for.</div>
      <div className="es-row es-no-print">
        <input className="es-input" style={{ maxWidth: 320 }} placeholder="Search stand or exhibitor" value={query} onChange={e => setQuery(e.target.value)} aria-label="Search exhibitors" />
        <span className="es-grow" />
        <button className="es-btn" onClick={exportFascia}><Download size={16} strokeWidth={1.75} /> Fascia list for printing</button>
      </div>
      <div className="es-card es-table-wrap">
        <table className="es-table">
          <thead><tr><th>Stand</th><th>Exhibitor</th><th>Package</th><th>Fascia name</th><th>Logo</th><th>Files</th><th>Private link</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="es-muted" style={{ padding: 28, textAlign: 'center' }}>No exhibitors yet. Import them on the Exhibitors page.</td></tr>}
            {shown.map(p => {
              const pkg = byCode.get(p.package_code);
              const logoIncluded = Boolean(hasLogo(pkg) || p.logo_paid);
              return (
                <tr key={p.stand}>
                  <td><strong>{p.stand}</strong></td>
                  <td>{p.name}<br /><small className="es-muted">{p.email || 'No email'}</small></td>
                  <td>
                    <select className="es-select" style={{ minHeight: 36, minWidth: 150 }} value={p.package_code || ''} onChange={e => run(() => saveExhibitorProfile(p.stand, { package_code: e.target.value || null }), `Stand ${p.stand} package saved.`)} aria-label={`Package for stand ${p.stand}`}>
                      <option value="">No package</option>{packages.map(k => <option key={k.code} value={k.code}>{k.code} · {k.name}</option>)}
                    </select>
                  </td>
                  <td>
                    {p.fascia_name ? <strong style={{ letterSpacing: 1, textTransform: 'uppercase' }}>{p.fascia_name}</strong> : <span className="es-muted">—</span>}<br />
                    <span className={`es-badge ${FASCIA_TONE[p.fascia_status] || ''}`}>{FASCIA_LABEL[p.fascia_status] || 'Waiting'}</span>
                    {p.fascia_status === 'submitted' && <button className="es-btn es-btn--sm es-btn--quiet" onClick={() => run(() => saveExhibitorProfile(p.stand, { fascia_status: 'approved' }), `Fascia for ${p.stand} approved.`)}>Approve</button>}
                  </td>
                  <td>
                    {hasLogo(pkg) ? <span className="es-badge es-badge--green">In package</span> : (
                      <label className="es-check es-small"><input type="checkbox" checked={Boolean(p.logo_paid)} onChange={e => run(() => saveExhibitorProfile(p.stand, { logo_paid: e.target.checked }), e.target.checked ? 'Marked as paid — logo will be printed.' : 'Logo will not be printed.')} /> Paid extra</label>
                    )}
                    {!logoIncluded && <small className="es-muted">Not printed</small>}
                  </td>
                  <td className="es-small">
                    {(p.files || []).length === 0 ? <span className="es-muted">None</span> : (p.files || []).map(f => <div key={f.id || f.storage_path || f.file_name}><button className="es-btn es-btn--sm es-btn--quiet" style={{ padding: 0, minHeight: 24 }} onClick={() => openFile(f)}>{f.kind === 'logo' ? 'Logo' : 'Doc'} · {f.file_name}</button></div>)}
                  </td>
                  <td className="es-row" style={{ flexWrap: 'nowrap' }}>
                    <button className="es-btn es-btn--sm" onClick={() => copy(p)}><Copy size={14} strokeWidth={1.75} /> Copy</button>
                    {p.email && p.portal_token && <a className="es-btn es-btn--sm es-btn--quiet" href={mailto(p)}>Email</a>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Settings ─────────────────────────────────────────────────────────────────
function SettingsTab({ settings, accessWindow, run }) {
  const [form, setForm] = useState(settings);
  useEffect(() => setForm(settings), [settings]);
  const toInput = v => (v ? new Date(v).toISOString().slice(0, 10) : '');
  const save = () => run(() => saveOrderSettings({
    supplier_vat_registered: form.supplier_vat_registered ?? form.prices_exclude_vat ?? false,
    prices_exclude_vat: form.supplier_vat_registered ?? form.prices_exclude_vat ?? false,
    vat_rate: Number(form.vat_rate),
    platform_fee_rate: 0.03,
    orders_open_at: form.orders_open_at || null, orders_close_at: form.orders_close_at || null,
    supplier_name: form.supplier_name || null, order_terms: form.order_terms, logo_terms: form.logo_terms,
  }), 'Settings saved.');
  return (
    <div className="es-stack" style={{ maxWidth: 760 }}>
      <div className="es-card es-pad es-stack">
        <div className="es-row"><CalendarClock size={20} strokeWidth={1.5} color="#b49a6a" /><h2 className="es-h2">Event <em>access window</em></h2></div>
        <p className="es-small es-muted" style={{ margin: 0 }}>By default the event opens for exhibitors <strong>3 months before</strong> it starts and stays open until <strong>1 month after</strong> it ends. After that it is archived: read-only, kept for reports. Leave blank to use the default.</p>
        <div className="es-grid2">
          <label className="es-label">Opens on<input type="date" className="es-input" value={toInput(form.orders_open_at)} onChange={e => setForm({ ...form, orders_open_at: e.target.value ? `${e.target.value}T00:00:00` : null })} /></label>
          <label className="es-label">Closes on<input type="date" className="es-input" value={toInput(form.orders_close_at)} onChange={e => setForm({ ...form, orders_close_at: e.target.value ? `${e.target.value}T23:59:59` : null })} /></label>
        </div>
        <p className="es-small" style={{ margin: 0 }}><Archive size={14} strokeWidth={1.75} style={{ verticalAlign: -2 }} /> Currently: <strong>{formatDay(accessWindow.opensAt)} → {formatDay(accessWindow.closesAt)}</strong> ({accessWindow.state})</p>
      </div>
      <div className="es-card es-pad es-stack">
        <h2 className="es-h2">Pricing</h2>
        <label className="es-check"><input type="checkbox" checked={form.supplier_vat_registered ?? form.prices_exclude_vat ?? false} onChange={e => setForm({ ...form, supplier_vat_registered: e.target.checked, prices_exclude_vat: e.target.checked })} /> The supplier is VAT registered — add VAT to the stock list prices</label>
        <div className="es-grid2">
          <label className="es-label">VAT rate (%)<input className="es-input" inputMode="decimal" value={Math.round(form.vat_rate * 1000) / 10} onChange={e => setForm({ ...form, vat_rate: Number(e.target.value) / 100 })} /></label>
          <label className="es-label">Platform fee (%) — internal<input className="es-input" value="3%" disabled readOnly /></label>
          <label className="es-label">Supplier name (shown on order form)<input className="es-input" value={form.supplier_name || ''} onChange={e => setForm({ ...form, supplier_name: e.target.value })} /></label>
        </div>
      </div>
      <div className="es-card es-pad es-stack">
        <h2 className="es-h2">Wording exhibitors <em>see</em></h2>
        <label className="es-label">Order terms (exhibitor must tick)<textarea className="es-textarea" value={form.order_terms} onChange={e => setForm({ ...form, order_terms: e.target.value })} /></label>
        <label className="es-label">Logo note on the private link<textarea className="es-textarea" value={form.logo_terms} onChange={e => setForm({ ...form, logo_terms: e.target.value })} /></label>
      </div>
      <button className="es-btn es-btn--primary" style={{ alignSelf: 'flex-start' }} onClick={save}><Check size={16} /> Save settings</button>
    </div>
  );
}
