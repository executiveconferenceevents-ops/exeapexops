import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getStaff, addStaff, updateStaff, removeStaff, CATEGORIES,
} from '../lib/mock';

const NAVY = "#1B2A4A", GOLD = "#C9A84C";

export default function StaffSetup() {
  const navigate  = useNavigate();
  const [staff, setStaff]       = useState(getStaff());
  const [filterCat, setFilterCat] = useState('ALL');
  const [showForm, setShowForm]  = useState(false);
  const [editing, setEditing]    = useState(null);   // staff member being edited
  const [form, setForm]          = useState({ name:'', category:'' });
  const [confirmDel, setConfirmDel] = useState(null); // id pending delete confirm

  const refresh = () => setStaff(getStaff());

  const shown = filterCat === 'ALL' ? staff : staff.filter(s => s.category === filterCat);

  // Group for the summary bar
  const byDept = CATEGORIES.reduce((acc, c) => {
    acc[c] = staff.filter(s => s.category === c).length;
    return acc;
  }, {});

  function openAdd() {
    setForm({ name:'', category: filterCat !== 'ALL' ? filterCat : '' });
    setEditing(null);
    setShowForm(true);
  }
  function openEdit(s) {
    setForm({ name: s.name, category: s.category });
    setEditing(s);
    setShowForm(true);
  }
  function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.category) return;
    if (editing) {
      updateStaff(editing.id, form);
    } else {
      addStaff(form);
    }
    setShowForm(false);
    setEditing(null);
    refresh();
  }
  function confirmDelete(id) {
    setConfirmDel(id);
  }
  function doDelete() {
    removeStaff(confirmDel);
    setConfirmDel(null);
    refresh();
  }

  const deptColors = [
    '#2E86C1','#27AE60','#E67E22','#E74C3C','#8E44AD',
    '#1ABC9C','#F39C12','#2980B9','#16A085','#D35400','#7F8C8D','#C0392B',
  ];
  const deptColor = (cat) => deptColors[CATEGORIES.indexOf(cat) % deptColors.length];

  return (
    <div style={{ fontFamily:'Arial,sans-serif', minHeight:'100vh', background:'#F4F6F8' }}>

      {/* Header */}
      <div style={{ background:NAVY, padding:'0 24px', display:'flex', alignItems:'center', justifyContent:'space-between', height:56 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <span style={{ color:GOLD, fontWeight:700, fontSize:18, letterSpacing:1 }}>APEXOPS™</span>
          <span style={{ color:'#aaa', fontSize:13 }}>Staff Setup</span>
        </div>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={()=>navigate('/ops')} style={{
            background:'rgba(255,255,255,.15)', color:'#fff', border:'1px solid rgba(255,255,255,.25)',
            borderRadius:6, padding:'7px 14px', fontWeight:600, fontSize:12, cursor:'pointer',
          }}>← Back to Ops Portal</button>
          <button onClick={openAdd} style={{
            background:GOLD, color:NAVY, border:'none', borderRadius:6,
            padding:'8px 18px', fontWeight:700, fontSize:13, cursor:'pointer',
          }}>+ Add Staff Member</button>
        </div>
      </div>

      {/* Dept summary bar */}
      <div style={{ background:'#fff', borderBottom:'1px solid #E0E0E0', padding:'12px 24px', display:'flex', gap:8, flexWrap:'wrap' }}>
        <button
          onClick={()=>setFilterCat('ALL')}
          style={{ border:'none', borderRadius:20, padding:'4px 14px', fontSize:12, fontWeight:700,
            background: filterCat==='ALL' ? NAVY : '#F0F0F0',
            color: filterCat==='ALL' ? '#fff' : '#555', cursor:'pointer' }}
        >All ({staff.length})</button>
        {CATEGORIES.map(c => (
          <button key={c}
            onClick={()=>setFilterCat(c)}
            style={{ border:'none', borderRadius:20, padding:'4px 14px', fontSize:12, fontWeight:600,
              background: filterCat===c ? deptColor(c) : '#F0F0F0',
              color: filterCat===c ? '#fff' : '#555', cursor:'pointer', opacity: byDept[c]===0 ? .5 : 1 }}
          >{c} ({byDept[c]})</button>
        ))}
      </div>

      {/* Staff list */}
      <div style={{ padding:'20px 24px', maxWidth:900, margin:'0 auto' }}>

        {shown.length === 0 && (
          <div style={{ textAlign:'center', background:'#fff', borderRadius:10, padding:40, color:'#aaa' }}>
            <div style={{ fontSize:32, marginBottom:10 }}>👤</div>
            <div style={{ fontWeight:600, fontSize:15, color:NAVY, marginBottom:6 }}>
              No staff in {filterCat === 'ALL' ? 'the roster' : filterCat}
            </div>
            <div style={{ fontSize:13, marginBottom:16 }}>
              {filterCat !== 'ALL' ? `Add someone to handle ${filterCat} queries.` : 'Add your first team member.'}
            </div>
            <button onClick={openAdd} style={{
              background:GOLD, color:NAVY, border:'none', borderRadius:6,
              padding:'9px 20px', fontWeight:700, fontSize:13, cursor:'pointer',
            }}>+ Add Staff Member</button>
          </div>
        )}

        {/* Group by department when showing all */}
        {filterCat === 'ALL'
          ? CATEGORIES.filter(c => staff.some(s=>s.category===c)).map(cat => (
              <div key={cat} style={{ marginBottom:24 }}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
                  <div style={{ width:10, height:10, borderRadius:'50%', background:deptColor(cat) }} />
                  <h3 style={{ fontSize:12, fontWeight:700, color:'#555', textTransform:'uppercase', letterSpacing:.5, margin:0 }}>
                    {cat} · {byDept[cat]} staff
                  </h3>
                </div>
                {staff.filter(s=>s.category===cat).map(s => (
                  <StaffRow key={s.id} s={s} deptColor={deptColor(cat)} onEdit={()=>openEdit(s)} onDelete={()=>confirmDelete(s.id)} />
                ))}
              </div>
            ))
          : shown.map(s => (
              <StaffRow key={s.id} s={s} deptColor={deptColor(s.category)} onEdit={()=>openEdit(s)} onDelete={()=>confirmDelete(s.id)} />
            ))
        }
      </div>

      {/* Add / Edit modal */}
      {showForm && (
        <Modal title={editing ? `Edit — ${editing.name}` : 'Add Staff Member'} onClose={()=>setShowForm(false)}>
          <form onSubmit={submit}>
            <Field label="Full Name" required>
              <input
                required autoFocus
                value={form.name}
                onChange={e=>setForm({...form, name:e.target.value})}
                placeholder="e.g. Thabo Dlamini"
                style={inputStyle}
              />
            </Field>
            <Field label="Department / Category" required>
              <select
                required
                value={form.category}
                onChange={e=>setForm({...form, category:e.target.value})}
                style={inputStyle}
              >
                <option value="">Select department…</option>
                {CATEGORIES.map(c=><option key={c}>{c}</option>)}
              </select>
            </Field>
            <div style={{ background:'#EAF4FB', borderRadius:6, padding:'8px 12px', fontSize:12, color:'#1A5276', marginBottom:16 }}>
              ℹ️ This person will only appear in the assignment list for <strong>{form.category || 'their department'}</strong> queries.
            </div>
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button type="button" onClick={()=>setShowForm(false)} style={btnSecondary}>Cancel</button>
              <button type="submit" style={btnPrimary}>{editing ? 'Save Changes' : 'Add to Roster'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete confirmation */}
      {confirmDel && (
        <Modal title="Remove Staff Member" onClose={()=>setConfirmDel(null)}>
          <p style={{ fontSize:14, color:'#333', marginBottom:20 }}>
            Remove <strong>{staff.find(s=>s.id===confirmDel)?.name}</strong> from the roster?
            <br/><span style={{ fontSize:12, color:'#888' }}>Any queries currently assigned to them will remain assigned — update those separately.</span>
          </p>
          <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
            <button onClick={()=>setConfirmDel(null)} style={btnSecondary}>Cancel</button>
            <button onClick={doDelete} style={{ ...btnPrimary, background:'#E74C3C' }}>Remove</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StaffRow({ s, deptColor, onEdit, onDelete }) {
  const initials = s.name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
  return (
    <div style={{
      background:'#fff', borderRadius:8, marginBottom:8,
      border:'1px solid #E8E8E8', borderLeft:`4px solid ${deptColor}`,
      padding:'12px 16px', display:'flex', alignItems:'center', gap:14,
    }}>
      <div style={{
        width:38, height:38, borderRadius:'50%', background:deptColor,
        display:'flex', alignItems:'center', justifyContent:'center',
        color:'#fff', fontWeight:700, fontSize:14, flexShrink:0,
      }}>{initials}</div>
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:700, fontSize:14, color:'#1A1A1A' }}>{s.name}</div>
        <div style={{ fontSize:12, color:'#888', marginTop:1 }}>{s.category}</div>
      </div>
      <button onClick={onEdit} style={{
        background:'#F0F0F0', color:'#333', border:'none', borderRadius:5,
        padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer',
      }}>Edit</button>
      <button onClick={onDelete} style={{
        background:'#FEF0F0', color:'#E74C3C', border:'1px solid #FADBD8',
        borderRadius:5, padding:'6px 14px', fontSize:12, fontWeight:600, cursor:'pointer',
      }}>Remove</button>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center' }}>
      <div style={{ background:'#fff',borderRadius:10,width:480,maxWidth:'95vw',boxShadow:'0 8px 32px rgba(0,0,0,.2)' }}>
        <div style={{ background:NAVY,padding:'14px 20px',borderRadius:'10px 10px 0 0',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
          <span style={{ color:GOLD,fontWeight:700,fontSize:14 }}>{title}</span>
          <button onClick={onClose} style={{ background:'none',border:'none',color:'#aaa',fontSize:20,cursor:'pointer',lineHeight:1 }}>×</button>
        </div>
        <div style={{ padding:20 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom:14 }}>
      <label style={{ display:'block',fontSize:11,fontWeight:700,color:'#555',marginBottom:4,textTransform:'uppercase',letterSpacing:.5 }}>
        {label}{required && <span style={{ color:'#E74C3C' }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width:'100%', border:'1px solid #ddd', borderRadius:6,
  padding:'9px 12px', fontSize:14, boxSizing:'border-box', fontFamily:'Arial,sans-serif',
};
const btnPrimary   = { background:NAVY, color:'#fff', border:'none', borderRadius:6, padding:'9px 20px', fontWeight:700, fontSize:13, cursor:'pointer' };
const btnSecondary = { background:'#F0F0F0', color:'#333', border:'none', borderRadius:6, padding:'9px 20px', fontWeight:600, fontSize:13, cursor:'pointer' };
