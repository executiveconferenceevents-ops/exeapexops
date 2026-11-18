// ─── Deliveries (warehouse & delivery team) ──────────────────────────────────
// No prices anywhere on this screen. Tick picked → loaded → delivered per line.
// [APEX exhibitor services 1]
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Printer, RefreshCw, Truck } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { downloadWorkbook } from '../lib/workbook';
import { deliveryRows, formatDayTime, getOrders, stockTotals, updateOrder, updateOrderItem } from '../lib/exhibitorServices';
import './exhibitor-services.css';

const STEPS = [['picked', 'Picked'], ['loaded', 'Loaded'], ['delivered', 'Delivered']];
const dayKey = d => (d ? new Date(d).toISOString().slice(0, 10) : 'none');
const dayLabel = k => (k === 'none' ? 'No date' : new Date(`${k}T12:00:00`).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' }));

function statusFromItems(items) {
  if (items.length && items.every(i => i.delivered)) return 'delivered';
  if (items.length && items.every(i => i.loaded)) return 'loaded';
  if (items.some(i => i.picked || i.loaded)) return 'picking';
  return null;
}

export default function Deliveries() {
  const [orders, setOrders] = useState([]);
  const [day, setDay] = useState('all');
  const [hideDone, setHideDone] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setOrders((await getOrders()).filter(o => o.status !== 'cancelled')); setError(''); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const t = window.setInterval(load, 30000); return () => window.clearInterval(t); }, [load]);

  const days = useMemo(() => [...new Set(orders.map(o => dayKey(o.delivery_at)))].sort(), [orders]);
  const shown = orders
    .filter(o => day === 'all' || dayKey(o.delivery_at) === day)
    .filter(o => !hideDone || o.status !== 'delivered')
    .sort((a, b) => String(a.delivery_at || '9').localeCompare(String(b.delivery_at || '9')) || a.stand.localeCompare(b.stand, undefined, { numeric: true }));
  const totals = stockTotals(shown);
  const lines = shown.reduce((t, o) => t + (o.items || []).length, 0);
  const loadedLines = shown.reduce((t, o) => t + (o.items || []).filter(i => i.loaded).length, 0);

  const tick = async (order, item, field, value) => {
    const patch = { [field]: value };
    if (value && field === 'loaded') patch.picked = true;
    if (value && field === 'delivered') { patch.picked = true; patch.loaded = true; }
    const items = order.items.map(i => (i.id === item.id ? { ...i, ...patch } : i));
    setOrders(list => list.map(o => (o.id === order.id ? { ...o, items } : o)));
    try {
      await updateOrderItem(order.id, item.id, patch);
      const next = statusFromItems(items);
      if (next && next !== order.status) await updateOrder(order.id, { status: next });
      await load();
    } catch (e) { setError(e.message); load(); }
  };
  const exportExcel = () => downloadWorkbook(`deliveries-${day === 'all' ? 'all' : day}.xlsx`, [
    { name: 'Totals to load', rows: totals.map(r => ({ 'Item code': r.code, Item: r.name, Option: r.option, 'Total qty': r.qty })) },
    { name: 'Per stand', rows: deliveryRows(shown) },
  ]);

  return (
    <div className="es es-page">
      <PageHeader eyebrow="Warehouse & delivery" title="Deliveries" accent="to site" subtitle="What to pull from the warehouse, load and deliver — stand by stand." />

      <div className="es-kpis">
        <div className="es-card es-kpi"><span>Stands to deliver</span><strong>{shown.length}</strong><small>{day === 'all' ? 'All days' : dayLabel(day)}</small></div>
        <div className="es-card es-kpi"><span>Lines loaded</span><strong>{loadedLines}/{lines}</strong><small>{lines ? Math.round((loadedLines / lines) * 100) : 0}% ready</small></div>
        <div className="es-card es-kpi"><span>Items to pull</span><strong>{totals.reduce((t, r) => t + r.qty, 0)}</strong><small>{totals.length} different items</small></div>
      </div>

      <div className="es-row es-no-print">
        <div className="es-tabs" role="tablist">
          <button className={day === 'all' ? 'is-on' : ''} onClick={() => setDay('all')}>All days</button>
          {days.map(d => <button key={d} className={day === d ? 'is-on' : ''} onClick={() => setDay(d)}>{dayLabel(d)}</button>)}
        </div>
        <label className="es-check es-small" style={{ alignItems: 'center' }}><input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} /> Hide delivered</label>
        <span className="es-grow" />
        <button className="es-btn es-btn--sm" onClick={load}><RefreshCw size={15} strokeWidth={1.75} /> Refresh</button>
        <button className="es-btn es-btn--sm" onClick={exportExcel}><Download size={15} strokeWidth={1.75} /> Excel</button>
        <button className="es-btn es-btn--sm es-btn--primary" onClick={() => window.print()}><Printer size={15} strokeWidth={1.75} /> Print</button>
      </div>

      {error && <div className="es-alert es-alert--error">{error}</div>}

      {totals.length > 0 && (
        <div className="es-card es-pad">
          <div className="es-eyebrow">Pull from warehouse</div>
          <table className="es-lines" style={{ marginTop: 8 }}>
            <thead><tr><th>Code</th><th>Item</th><th>Option</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
            <tbody>{totals.map(r => <tr key={`${r.code}${r.option}`}><td>{r.code}</td><td>{r.name}</td><td>{r.option || '—'}</td><td style={{ textAlign: 'right' }}><strong>{r.qty}</strong></td></tr>)}</tbody>
          </table>
        </div>
      )}

      {loading ? <div className="es-card es-pad es-muted">Loading…</div> : shown.length === 0 ? (
        <div className="es-card es-pad es-row"><Truck size={22} strokeWidth={1.5} color="#b49a6a" /><span className="es-muted">Nothing to deliver{hideDone ? ' (delivered orders are hidden)' : ''}.</span></div>
      ) : shown.map(order => (
        <div key={order.id} className="es-card es-order">
          <div className="es-order-head">
            <span className="es-order-stand">Stand {order.stand}</span>
            <strong>{order.exhibitor_name}</strong>
            <span className="es-muted es-small">{order.ref} · Deliver by {order.delivery_at ? formatDayTime(order.delivery_at) : 'not set'}</span>
            <span className="es-grow" />
            <span className={`es-badge ${order.status === 'delivered' ? 'es-badge--green' : order.status === 'loaded' ? 'es-badge--amber' : ''}`}>{order.status === 'submitted' ? 'New' : order.status[0].toUpperCase() + order.status.slice(1)}</span>
          </div>
          {order.contact_name && <div className="es-small es-muted">On-site contact: {order.contact_name}{order.contact_phone ? ` · ${order.contact_phone}` : ''}{order.notes ? ` · Note: ${order.notes}` : ''}</div>}
          <table className="es-lines">
            <thead><tr><th>Item</th><th>Option</th><th>Qty</th>{STEPS.map(([k, l]) => <th key={k} className="tick">{l}</th>)}</tr></thead>
            <tbody>
              {(order.items || []).map(item => (
                <tr key={item.id}>
                  <td><strong>{item.code}</strong> · {item.name}</td><td>{item.option || '—'}</td><td><strong>{item.qty}</strong></td>
                  {STEPS.map(([k, l]) => <td key={k} className="tick"><input type="checkbox" checked={Boolean(item[k])} onChange={e => tick(order, item, k, e.target.checked)} aria-label={`${l}: ${item.name}, stand ${order.stand}`} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
