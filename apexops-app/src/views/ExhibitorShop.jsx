// ─── Exhibitor furniture ordering (public, phone first) ──────────────────────
// Find your stand (name or number) → choose items → delivery & contact → order form.
// Exhibitors only ever see the final price (VAT and platform fee are built in).
// [APEX exhibitor services 1]
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Printer, Search, ShoppingBag } from 'lucide-react';
import { getActiveEvent } from '../lib/eventScope';
import { getPublicExhibitors, normalizeStand } from '../lib/mock';
import { formatDay, formatDayTime, getPublicCatalogue, rand, submitPublicOrder } from '../lib/exhibitorServices';
import './exhibitor-services.css';

export default function ExhibitorShop({ initialStand = '', onBack }) {
  const event = getActiveEvent();
  const [step, setStep] = useState('find');
  const [exhibitors, setExhibitors] = useState([]);
  const [search, setSearch] = useState('');
  const [exhibitor, setExhibitor] = useState(null);
  const [catalogue, setCatalogue] = useState(null);
  const [category, setCategory] = useState('All');
  const [options, setOptions] = useState({});
  const [cart, setCart] = useState({});
  const [form, setForm] = useState({ contact_name: '', contact_email: '', contact_phone: '', date: '', time: '08:00', notes: '', accept_terms: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let live = true;
    Promise.all([getPublicExhibitors(), getPublicCatalogue()]).then(([ex, cat]) => {
      if (!live) return;
      setExhibitors(ex); setCatalogue(cat);
      const match = initialStand && ex.find(e => normalizeStand(e.stand) === normalizeStand(initialStand));
      if (match) { setExhibitor(match); setStep('shop'); }
    }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [initialStand]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 1) return [];
    return exhibitors.filter(e => e.name?.toLowerCase().includes(q) || normalizeStand(e.stand).toLowerCase().includes(q.replace(/\s/g, ''))).slice(0, 30);
  }, [search, exhibitors]);

  const items = catalogue?.items || [];
  const categories = ['All', ...new Set(items.map(i => i.category))];
  const lineKey = (item, option) => `${item.id}|${option || ''}`;
  const cartLines = Object.entries(cart).filter(([, qty]) => qty > 0).map(([k, qty]) => { const [id, option] = k.split('|'); const item = items.find(i => i.id === id); return item ? { key: k, item, option, qty } : null; }).filter(Boolean);
  const count = cartLines.reduce((t, l) => t + l.qty, 0);
  const total = cartLines.reduce((t, l) => t + l.item.price * l.qty, 0);
  const qtyFor = item => Object.entries(cart).filter(([k]) => k.startsWith(`${item.id}|`)).reduce((t, [, q]) => t + q, 0);
  const change = (item, delta) => {
    const option = options[item.id] ?? item.options?.[0] ?? '';
    const k = lineKey(item, option);
    setCart(c => ({ ...c, [k]: Math.max(0, (c[k] || 0) + delta) }));
  };

  const minDate = new Date().toISOString().slice(0, 10);
  const submit = async () => {
    setError('');
    if (!form.contact_name.trim() || !/^\S+@\S+\.\S+$/.test(form.contact_email)) return setError('Please add your name and a valid email address.');
    if (!form.date) return setError('Please choose a delivery date.');
    if (!form.accept_terms) return setError('Please accept the order terms.');
    setBusy(true);
    try {
      const res = await submitPublicOrder({
        stand: exhibitor.stand, contact_name: form.contact_name.trim(), contact_email: form.contact_email.trim(), contact_phone: form.contact_phone.trim(),
        delivery_at: new Date(`${form.date}T${form.time || '08:00'}:00`).toISOString(), notes: form.notes.trim(), accept_terms: true,
        items: cartLines.map(l => ({ id: l.item.id, option: l.option, qty: l.qty })),
      });
      setResult({ ...res, lines: cartLines, total, delivery: `${form.date}T${form.time}:00`, contact: { ...form } });
      setCart({}); setStep('done'); window.scrollTo(0, 0);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const Hero = ({ title, accent, sub }) => (
    <header className="es-hero">
      {onBack && step !== 'done' && <button className="es-btn es-btn--sm es-btn--quiet es-no-print" style={{ color: '#fff', marginLeft: -12 }} onClick={step === 'find' || (step === 'shop' && initialStand) ? onBack : () => setStep(step === 'checkout' ? 'shop' : 'find')}><ArrowLeft size={16} /> Back</button>}
      <div className="es-eyebrow">{event?.name || 'Exhibitor services'}</div>
      <h1>{title} <em>{accent}</em></h1>
      {sub && <p>{sub}</p>}
    </header>
  );

  if (catalogue && !catalogue.open) {
    return (
      <div className="es es-public"><Hero title="Ordering is" accent="closed" sub={catalogue.window?.closesAt ? `Ordering for this event was open until ${formatDay(catalogue.window.closesAt)}.` : 'Please contact the organiser.'} />
        <main className="es-public-main"><div className="es-card es-pad">Please contact the organiser if you still need furniture for your stand.</div></main></div>
    );
  }

  // ── Step 1: find your stand ────────────────────────────────────────────────
  if (step === 'find') {
    return (
      <div className="es es-public">
        <Hero title="Order" accent="furniture" sub="Find your company or stand number to start." />
        <main className="es-public-main">
          <div className="es-card es-pad es-stack">
            <label className="es-label">Company name or stand number
              <div style={{ position: 'relative' }}>
                <Search size={18} strokeWidth={1.75} style={{ position: 'absolute', left: 14, top: 14, color: '#8a969c' }} />
                <input className="es-input" style={{ paddingLeft: 42 }} autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="e.g. Eskom or B12" />
              </div>
            </label>
            {error && <div className="es-alert es-alert--error">{error}</div>}
            {search && (matches.length ? (
              <ul className="es-search-list es-card">
                {matches.map(e => <li key={e.stand}><button onClick={() => { setExhibitor(e); setStep('shop'); window.scrollTo(0, 0); }}><span className="es-stand-pill">{e.stand}</span><span>{e.name}</span></button></li>)}
              </ul>
            ) : <p className="es-small es-muted" style={{ margin: 0 }}>No stand found. Check the spelling or ask the organiser to add you.</p>)}
          </div>
        </main>
      </div>
    );
  }

  // ── Done: order form ───────────────────────────────────────────────────────
  if (step === 'done' && result) {
    return (
      <div className="es es-public">
        <Hero title="Order" accent="received" sub={`Order ${result.ref} · Stand ${exhibitor.stand}`} />
        <main className="es-public-main">
          <div className="es-alert es-alert--ok es-no-print"><Check size={16} style={{ verticalAlign: -3 }} /> Thank you. Your order has been sent to the organiser. Please print or save this order form for your records.</div>
          <div className="es-card es-pad es-stack">
            <div className="es-row"><div className="es-grow"><div className="es-eyebrow">Order form</div><h2 className="es-h2">{result.ref}</h2></div><span className="es-badge es-badge--navy">Stand {exhibitor.stand}</span></div>
            <div className="es-grid2 es-small">
              <div><span className="es-muted">Exhibitor</span><br /><strong>{result.exhibitor_name || exhibitor.name}</strong></div>
              <div><span className="es-muted">Contact</span><br /><strong>{result.contact.contact_name}</strong><br />{result.contact.contact_email}<br />{result.contact.contact_phone}</div>
              <div><span className="es-muted">Deliver by</span><br /><strong>{formatDayTime(result.delivery)}</strong></div>
              <div><span className="es-muted">Event</span><br /><strong>{event?.name}</strong></div>
            </div>
            <div>
              {result.lines.map(l => (
                <div key={l.key} className="es-summary-line">
                  {l.item.photo_url ? <img className="es-thumb" src={l.item.photo_url} alt="" /> : <span className="es-thumb es-thumb--empty" />}
                  <div className="es-grow"><strong>{l.item.name}</strong><br /><small className="es-muted">{l.item.code}{l.option ? ` · ${l.option}` : ''} · {l.qty} × {rand(l.item.price)}</small></div>
                  <strong>{rand(l.item.price * l.qty)}</strong>
                </div>
              ))}
              <div className="es-summary-line"><span className="es-grow"><strong>Total payable</strong></span><strong style={{ fontSize: 20 }}>{rand(result.total_payable ?? result.total)}</strong></div>
            </div>
            <p className="es-small es-muted" style={{ margin: 0 }}>{catalogue?.order_terms}</p>
            <div className="es-row es-no-print">
              <button className="es-btn es-btn--primary" onClick={() => window.print()}><Printer size={16} strokeWidth={1.75} /> Print or save as PDF</button>
              <button className="es-btn" onClick={() => { setResult(null); setStep('shop'); }}>Order more</button>
              {onBack && <button className="es-btn es-btn--quiet" onClick={onBack}>Done</button>}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Step 3: delivery & contact ─────────────────────────────────────────────
  if (step === 'checkout') {
    return (
      <div className="es es-public">
        <Hero title="Delivery &" accent="details" sub={`${exhibitor.name} · Stand ${exhibitor.stand}`} />
        <main className="es-public-main">
          <div className="es-card es-pad">
            {cartLines.map(l => (
              <div key={l.key} className="es-summary-line">
                {l.item.photo_url ? <img className="es-thumb" src={l.item.photo_url} alt="" /> : <span className="es-thumb es-thumb--empty" />}
                <div className="es-grow"><strong>{l.item.name}</strong><br /><small className="es-muted">{l.option || l.item.code} · {l.qty} × {rand(l.item.price)}</small></div>
                <strong>{rand(l.item.price * l.qty)}</strong>
              </div>
            ))}
            <div className="es-summary-line"><span className="es-grow"><strong>Total</strong></span><strong style={{ fontSize: 20 }}>{rand(total)}</strong></div>
          </div>
          <div className="es-card es-pad es-stack">
            <div className="es-grid2">
              <label className="es-label">Delivery date<input type="date" className="es-input" min={minDate} value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label>
              <label className="es-label">Deliver by (time)<input type="time" className="es-input" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></label>
              <label className="es-label">Your name<input className="es-input" autoComplete="name" value={form.contact_name} onChange={e => setForm({ ...form, contact_name: e.target.value })} /></label>
              <label className="es-label">Email (for your order form)<input type="email" className="es-input" autoComplete="email" value={form.contact_email} onChange={e => setForm({ ...form, contact_email: e.target.value })} /></label>
              <label className="es-label">Mobile number on site<input type="tel" className="es-input" autoComplete="tel" value={form.contact_phone} onChange={e => setForm({ ...form, contact_phone: e.target.value })} /></label>
            </div>
            <label className="es-label">Anything we should know? (optional)<textarea className="es-textarea" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="e.g. place the counter on the aisle side" /></label>
            <label className="es-check"><input type="checkbox" checked={form.accept_terms} onChange={e => setForm({ ...form, accept_terms: e.target.checked })} /> <span>{catalogue?.order_terms || 'Orders cannot be cancelled or refunded once confirmed.'}</span></label>
            {error && <div className="es-alert es-alert--error">{error}</div>}
            <button className="es-btn es-btn--primary es-btn--wide" disabled={busy} onClick={submit}>{busy ? 'Sending…' : `Place order · ${rand(total)}`}</button>
          </div>
        </main>
      </div>
    );
  }

  // ── Step 2: shop ───────────────────────────────────────────────────────────
  const visible = items.filter(i => category === 'All' || i.category === category);
  return (
    <div className="es es-public">
      <Hero title="Order" accent="furniture" sub={exhibitor ? `${exhibitor.name} · Stand ${exhibitor.stand}` : ''} />
      <main className="es-public-main">
        {categories.length > 2 && <div className="es-tabs" style={{ background: '#fff' }}>{categories.map(c => <button key={c} className={category === c ? 'is-on' : ''} onClick={() => setCategory(c)}>{c}</button>)}</div>}
        {!catalogue ? <div className="es-card es-pad es-muted">Loading…</div> : visible.length === 0 ? <div className="es-card es-pad es-muted">The organiser has not added items yet.</div> : (
          <div className="es-products">
            {visible.map(item => {
              const q = qtyFor(item);
              const option = options[item.id] ?? item.options?.[0] ?? '';
              const qOption = cart[lineKey(item, option)] || 0;
              return (
                <div key={item.id} className="es-card es-product">
                  <div className="es-product-photo">{item.photo_url ? <img src={item.photo_url} alt={item.name} loading="lazy" /> : <span className="es-muted es-small">{item.code}</span>}{q > 0 && <span className="es-product-count">{q}</span>}</div>
                  <div className="es-product-body">
                    <strong>{item.name}</strong>
                    <small className="es-muted">{item.code}{item.size ? ` · ${item.size}` : ''}</small>
                    <div className="es-product-price">{rand(item.price)} <small>each</small></div>
                    {item.options?.length > 1 && (
                      <select className="es-select" style={{ minHeight: 38, fontSize: 13, margin: '4px 0' }} value={option} onChange={e => setOptions({ ...options, [item.id]: e.target.value })} aria-label={`Option for ${item.name}`}>
                        {item.options.map(o => <option key={o}>{o}</option>)}
                      </select>
                    )}
                    {qOption > 0 ? (
                      <div className="es-stepper"><button aria-label={`One less ${item.name}`} onClick={() => change(item, -1)}>−</button><strong>{qOption}</strong><button aria-label={`One more ${item.name}`} onClick={() => change(item, 1)}>+</button></div>
                    ) : <button className="es-btn es-btn--sm" style={{ marginTop: 'auto' }} onClick={() => change(item, 1)}>Add</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
      {count > 0 && (
        <div className="es-cartbar">
          <div className="es-cartbar-inner"><button className="es-btn es-btn--primary es-btn--wide" onClick={() => { setStep('checkout'); window.scrollTo(0, 0); }}><ShoppingBag size={18} strokeWidth={1.75} /> {count} item{count === 1 ? '' : 's'} · {rand(total)} · Continue</button></div>
        </div>
      )}
    </div>
  );
}
