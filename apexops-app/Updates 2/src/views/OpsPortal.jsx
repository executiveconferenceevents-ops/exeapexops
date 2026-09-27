import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getQueries, addQuery, updateQuery,
  CATEGORIES, getStaff, EST_OPTIONS, STATUS_FLOW, STATUS_COLORS, EXHIBITORS,
} from '../lib/mock';
import StatusBadge from '../components/StatusBadge';

const NAVY = "#1B2A4A", GOLD = "#C9A84C";

export default function OpsPortal() {
  const navigate = useNavigate();
  const [queries, setQueries]   = useState(getQueries());
  const [tab, setTab]           = useState('queue');   // 'queue' | 'log'
  const [filter, setFilter]     = useState('ALL');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState(null);

  const refresh = () => setQueries(getQueries());

  // ── New query form state ───────────────────────────────────────────────────
  const blank = { stand:'', exhibitor:'', contact:'', phone:'', category:'', description:'', est:'1 hour' };
  const [form, setForm] = useState(blank);

  function submitQuery(e) {
    e.preventDefault();
    addQuery(form);
    setForm(blank);
    setShowForm(false);
    refresh();
  }

  // ── Edit / assign panel ────────────────────────────────────────────────────
  function saveEdit(id, patch) {
    updateQuery(id, patch);
    setSelected(null);
    refresh();
  }

  const active   = queries.filter(q => q.status !== 'COMPLETED');
  const complete = queries.filter(q => q.status === 'COMPLETED');
  const shown    = filter === 'ALL' ? queries : queries.filter(q => q.category === filter);

  const kpis = [
    { label: 'TOTAL',       value: queries.length,                                color: NAVY },
    { label: 'LOGGED',      value: queries.filter(q=>q.status==='LOGGED').length,     color: '#AEB6BF' },
    { label: 'IN PROGRESS', value: queries.filter(q=>q.status==='IN PROGRESS').length,color: '#27AE60' },
    { label: 'ISSUES',      value: queries.filter(q=>q.status==='ISSUES/DELAYED').length,color:'#E74C3C'},
    { label: 'COMPLETED',   value: complete.length,                               color: '#7F8C8D' },
  ];

  return (
    <div style={{ fontFamily:'Arial,sans-serif', minHeight:'100vh', background:'#F4F6F8' }}>

      {/* Header */}
      <div style={{ background:NAVY, padding:'0 24px', display:'flex', alignItems:'center', justifyContent:'space-between', height:56 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ color:GOLD, fontWeight:700, fontSize:18, letterSpacing:1 }}>APEXOPS™</span>
          <span style={{ color:'#aaa', fontSize:13 }}>Ops Portal</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ background:'rgba(255,255,255,.12)', color:'rgba(255,255,255,.6)', fontSize:11, padding:'3px 8px', borderRadius:4, letterSpacing:.3 }}>
            ⚠ Demo mode — data resets on refresh
          </span>
          <button onClick={()=>navigate('/staff')} style={{
            background:'rgba(255,255,255,.15)', color:'#fff', border:'1px solid rgba(255,255,255,.25)',
            borderRadius:6, padding:'7px 14px', fontWeight:600, fontSize:12, cursor:'pointer',
          }}>👥 Staff Setup</button>
          <button onClick={()=>setShowForm(true)} style={{
            background:GOLD, color:NAVY, border:'none', borderRadius:6,
            padding:'8px 18px', fontWeight:700, fontSize:13, cursor:'pointer',
          }}>+ Log Query</button>
        </div>
      </div>

      {/* KPI bar */}
      <div style={{ display:'flex', gap:0, background:'#fff', borderBottom:'1px solid #E0E0E0' }}>
        {kpis.map(k => (
          <div key={k.label} style={{ flex:1, textAlign:'center', padding:'10px 0', borderRight:'1px solid #E0E0E0' }}>
            <div style={{ fontSize:24, fontWeight:700, color:k.color }}>{k.value}</div>
            <div style={{ fontSize:10, color:'#888', letterSpacing:0.5 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs + filter */}
      <div style={{ background:'#fff', borderBottom:'1px solid #E0E0E0', padding:'0 24px', display:'flex', alignItems:'center', gap:24 }}>
        {['queue','log'].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{
            border:'none', background:'none', padding:'12px 0',
            borderBottom: tab===t ? `3px solid ${GOLD}` : '3px solid transparent',
            color: tab===t ? NAVY : '#888', fontWeight: tab===t ? 700 : 400,
            fontSize:13, cursor:'pointer', textTransform:'capitalize',
          }}>{t==='queue'?'Active Queue':'All Queries'}</button>
        ))}
        <select value={filter} onChange={e=>setFilter(e.target.value)} style={{
          marginLeft:'auto', border:'1px solid #ddd', borderRadius:6,
          padding:'6px 10px', fontSize:12, color:NAVY,
        }}>
          <option value="ALL">All Categories</option>
          {CATEGORIES.map(c=><option key={c}>{c}</option>)}
        </select>
      </div>

      {/* Query list */}
      <div style={{ padding:'16px 24px', maxWidth:1100, margin:'0 auto' }}>
        {(tab==='queue' ? shown.filter(q=>q.status!=='COMPLETED') : shown).map(q => (
          <QueryRow key={q.id} q={q} onSelect={()=>setSelected(q)} />
        ))}
        {tab==='queue' && shown.filter(q=>q.status!=='COMPLETED').length===0 &&
          <div style={{ textAlign:'center', color:'#aaa', padding:40, fontSize:14 }}>No active queries</div>
        }
      </div>

      {/* Log new query modal */}
      {showForm && (
        <Modal title="Log New Query" onClose={()=>setShowForm(false)}>
          <form onSubmit={submitQuery}>
            <Field label="Exhibitor" required>
              <select required value={form.exhibitor} onChange={e=>{
                const ex = EXHIBITORS.find(x=>x.name===e.target.value);
                setForm({...form, exhibitor:e.target.value, stand:ex?.stand||'', contact:ex?.contact||'', phone:ex?.phone||''});
              }}>
                <option value="">Select exhibitor…</option>
                {EXHIBITORS.map(ex=><option key={ex.stand} value={ex.name}>{ex.name}</option>)}
              </select>
            </Field>
            <Field label="Stand Number">
              <input readOnly value={form.stand} placeholder="Auto-filled from exhibitor" style={{ background:'#F8F8F8', color:'#888' }} />
            </Field>
            <Field label="Contact Name"><input value={form.contact} onChange={e=>setForm({...form,contact:e.target.value})} /></Field>
            <Field label="Phone"><input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} /></Field>
            <Field label="Category" required>
              <select required value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>
                <option value="">Select…</option>
                {CATEGORIES.map(c=><option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Description" required>
              <textarea required rows={3} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} />
            </Field>
            <Field label="Estimated Fix Time">
              <select value={form.est} onChange={e=>setForm({...form,est:e.target.value})}>
                {EST_OPTIONS.map(o=><option key={o}>{o}</option>)}
              </select>
            </Field>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
              <button type="button" onClick={()=>setShowForm(false)} style={btnSecondary}>Cancel</button>
              <button type="submit" style={btnPrimary}>Submit Query</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit / assign modal */}
      {selected && (
        <EditPanel q={selected} onSave={saveEdit} onClose={()=>setSelected(null)} />
      )}
    </div>
  );
}

function QueryRow({ q, onSelect }) {
  const c = STATUS_COLORS[q.status] || STATUS_COLORS['LOGGED'];
  const staffName = q.assignedTo ? getStaff().find(s=>s.id===q.assignedTo)?.name : '—';
  const mins = { "15 min":15,"30 min":30,"1 hour":60,"2 hours":120,"3 hours":180,"4 hours":240,"Half day":240,"Full day":480 };
  const eta = mins[q.est] ? `~${q.est}` : q.est;

  return (
    <div onClick={onSelect} style={{
      background:'#fff', borderRadius:8, marginBottom:8,
      border:`1px solid ${c.bg}`, borderLeft:`4px solid ${c.badge}`,
      padding:'12px 16px', cursor:'pointer', display:'flex',
      alignItems:'center', gap:16,
      transition:'box-shadow .15s',
    }}
    onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,.1)'}
    onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}
    >
      <div style={{ minWidth:64, fontWeight:700, color:'#1B2A4A', fontSize:13 }}>{q.id}</div>
      <div style={{ minWidth:80, fontSize:12, color:'#888' }}>Stand {q.stand}</div>
      <div style={{ flex:2, fontWeight:600, fontSize:13, color:'#1A1A1A' }}>{q.exhibitor}</div>
      <div style={{ flex:3, fontSize:12, color:'#555' }}>{q.description}</div>
      <div style={{ minWidth:100, fontSize:12, color:'#888' }}>{q.category}</div>
      <div style={{ minWidth:90, fontSize:12, color:'#555' }}>{staffName}</div>
      <div style={{ minWidth:60, fontSize:12, color:'#888' }}>{eta}</div>
      <StatusBadge status={q.status} />
    </div>
  );
}

function EditPanel({ q, onSave, onClose }) {
  const [status, setStatus]     = useState(q.status);
  const [assignedTo, setAssigned] = useState(q.assignedTo || '');
  const [notes, setNotes]       = useState(q.notes || '');
  const allStaff    = getStaff();
  const staffForCat = allStaff.filter(s => s.category === q.category);

  return (
    <Modal title={`${q.id} — ${q.exhibitor}`} onClose={onClose} wide>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
        <InfoBlock label="Stand" value={`Stand ${q.stand}`} />
        <InfoBlock label="Contact" value={`${q.contact}  ${q.phone}`} />
        <InfoBlock label="Category" value={q.category} />
        <InfoBlock label="Est. Fix" value={q.est} />
      </div>
      <Field label="Description">
        <div style={{ background:'#F8F8F8', border:'1px solid #E0E0E0', borderRadius:6, padding:'8px 10px', fontSize:13, color:'#333' }}>{q.description}</div>
      </Field>
      <Field label={`Assign To — ${q.category} staff only`}>
        <select value={assignedTo} onChange={e=>setAssigned(e.target.value)}>
          <option value="">— Unassigned —</option>
          {staffForCat.length > 0
            ? staffForCat.map(s=><option key={s.id} value={s.id}>{s.name}</option>)
            : <option disabled>No staff in this department — add via Staff Setup</option>
          }
        </select>
        {staffForCat.length === 0 && (
          <div style={{ fontSize:11, color:'#E74C3C', marginTop:4 }}>
            ⚠ No {q.category} staff on roster. Go to Staff Setup to add someone.
          </div>
        )}
      </Field>
      <Field label="Status">
        <select value={status} onChange={e=>setStatus(e.target.value)}>
          {STATUS_FLOW.map(s=><option key={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Notes">
        <textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Internal notes…" />
      </Field>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:16 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={()=>onSave(q.id,{ status, assignedTo: assignedTo||null, notes })} style={btnPrimary}>Save Changes</button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center' }}>
      <div style={{ background:'#fff',borderRadius:10,width:wide?680:520,maxWidth:'95vw',maxHeight:'90vh',overflowY:'auto',boxShadow:'0 8px 32px rgba(0,0,0,.2)' }}>
        <div style={{ background:NAVY,padding:'14px 20px',borderRadius:'10px 10px 0 0',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
          <span style={{ color:GOLD,fontWeight:700,fontSize:14 }}>{title}</span>
          <button onClick={onClose} style={{ background:'none',border:'none',color:'#aaa',fontSize:20,cursor:'pointer',lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:20 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, required }) {
  return (
    <div style={{ marginBottom:12 }}>
      <label style={{ display:'block',fontSize:11,fontWeight:700,color:'#555',marginBottom:4,textTransform:'uppercase',letterSpacing:.5 }}>
        {label}{required&&<span style={{color:'#E74C3C'}}>*</span>}
      </label>
      <div style={{ display:'contents' }}>
        {children}
      </div>
    </div>
  );
}

function InfoBlock({ label, value }) {
  return (
    <div>
      <div style={{ fontSize:10,color:'#888',textTransform:'uppercase',letterSpacing:.5,marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:13,fontWeight:600,color:'#1A1A1A' }}>{value}</div>
    </div>
  );
}

const inputBase = {
  width:'100%', border:'1px solid #ddd', borderRadius:6,
  padding:'8px 10px', fontSize:13, boxSizing:'border-box',
  fontFamily:'Arial,sans-serif',
};
// Apply styles via global CSS in index.css instead of inline for inputs
const btnPrimary   = { background:NAVY, color:'#fff',    border:'none', borderRadius:6, padding:'9px 20px', fontWeight:700, fontSize:13, cursor:'pointer' };
const btnSecondary = { background:'#F0F0F0', color:'#333', border:'none', borderRadius:6, padding:'9px 20px', fontWeight:600, fontSize:13, cursor:'pointer' };
