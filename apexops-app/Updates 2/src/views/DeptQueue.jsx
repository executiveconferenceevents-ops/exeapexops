import { useState } from 'react';
import { getQueries, updateQuery, getStaff, CATEGORIES, STATUS_FLOW, STATUS_COLORS } from '../lib/mock';
import StatusBadge from '../components/StatusBadge';

const NAVY = "#1B2A4A", GOLD = "#C9A84C";

export default function DeptQueue() {
  const [staffId, setStaffId]   = useState('');
  const [queries, setQueries]   = useState(getQueries());
  const [selected, setSelected] = useState(null);

  const refresh = () => setQueries(getQueries());

  const STAFF     = getStaff();
  const myStaff   = STAFF.find(s => s.id === staffId);
  const myCategory = myStaff?.category;
  const myQueries  = staffId
    ? queries.filter(q => q.assignedTo === staffId || (myCategory && q.category === myCategory && q.status !== 'COMPLETED'))
    : [];
  const active    = myQueries.filter(q => q.status !== 'COMPLETED');
  const done      = myQueries.filter(q => q.status === 'COMPLETED');

  function markDone(q) {
    updateQuery(q.id, { status: 'COMPLETED', completedAt: new Date() });
    setSelected(null);
    refresh();
  }
  function setStatus(id, status) {
    updateQuery(id, { status });
    setSelected(null);
    refresh();
  }

  return (
    <div style={{ fontFamily:'Arial,sans-serif', minHeight:'100vh', background:'#F4F6F8' }}>

      {/* Header */}
      <div style={{ background:NAVY, padding:'0 24px', display:'flex', alignItems:'center', gap:16, height:56 }}>
        <span style={{ color:GOLD, fontWeight:700, fontSize:18, letterSpacing:1 }}>APEXOPS™</span>
        <span style={{ color:'#aaa', fontSize:13 }}>My Queue</span>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ color:'rgba(255,255,255,.4)', fontSize:11 }}>Staff login coming soon ·</span>
          <select value={staffId} onChange={e=>setStaffId(e.target.value)} style={{
            background:'#fff', border:'none', borderRadius:6,
            padding:'7px 12px', fontSize:13, fontWeight:600, color:NAVY, cursor:'pointer',
          }}>
            <option value="">— Select your name —</option>
            {STAFF.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {!staffId ? (
        <div style={{ textAlign:'center', paddingTop:80, color:'#aaa' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>👤</div>
          <div style={{ fontSize:16, fontWeight:600 }}>Select your name above to see your queue</div>
        </div>
      ) : (
        <div style={{ padding:'16px 24px', maxWidth:900, margin:'0 auto' }}>

          {/* Staff header */}
          <div style={{ background:'#fff', borderRadius:8, padding:'16px 20px', marginBottom:16, display:'flex', alignItems:'center', gap:16, border:`1px solid #E0E0E0` }}>
            <div style={{ width:44,height:44,borderRadius:'50%',background:NAVY,display:'flex',alignItems:'center',justifyContent:'center',color:GOLD,fontWeight:700,fontSize:16 }}>
              {myStaff.name.split(' ').map(n=>n[0]).join('').slice(0,2)}
            </div>
            <div>
              <div style={{ fontWeight:700, fontSize:16, color:NAVY }}>{myStaff.name}</div>
              <div style={{ fontSize:12, color:'#888' }}>{myStaff.category}</div>
            </div>
            <div style={{ marginLeft:'auto', display:'flex', gap:24 }}>
              <Stat label="Active" value={active.length} color="#1E8449" />
              <Stat label="Done Today" value={done.length} color="#7F8C8D" />
            </div>
          </div>

          {/* Active queue */}
          <h3 style={{ color:NAVY, fontSize:13, fontWeight:700, marginBottom:8, letterSpacing:.5 }}>ACTIVE QUERIES ({active.length})</h3>
          {active.length === 0 && <div style={{ color:'#aaa', textAlign:'center', padding:24, background:'#fff', borderRadius:8, marginBottom:16 }}>No active queries — you're all clear 🎉</div>}
          {active.map((q,i) => (
            <DeptRow key={q.id} q={q} pos={i+1} onSelect={()=>setSelected(q)} onMarkDone={()=>markDone(q)} />
          ))}

          {/* Completed */}
          {done.length > 0 && <>
            <h3 style={{ color:'#7F8C8D', fontSize:13, fontWeight:700, margin:'20px 0 8px', letterSpacing:.5 }}>COMPLETED ({done.length})</h3>
            {done.map(q=>(
              <DeptRow key={q.id} q={q} done onSelect={()=>setSelected(q)} />
            ))}
          </>}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <div style={{ background:'#fff',borderRadius:10,width:480,maxWidth:'95vw',boxShadow:'0 8px 32px rgba(0,0,0,.2)' }}>
            <div style={{ background:NAVY,padding:'14px 20px',borderRadius:'10px 10px 0 0',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
              <span style={{ color:GOLD,fontWeight:700 }}>{selected.id} — {selected.exhibitor}</span>
              <button onClick={()=>setSelected(null)} style={{ background:'none',border:'none',color:'#aaa',fontSize:20,cursor:'pointer' }}>×</button>
            </div>
            <div style={{ padding:20 }}>
              <p style={{ fontSize:13,color:'#333',marginTop:0 }}><strong>Stand:</strong> {selected.stand}</p>
              <p style={{ fontSize:13,color:'#333' }}><strong>Issue:</strong> {selected.description}</p>
              <p style={{ fontSize:13,color:'#333' }}><strong>Est:</strong> {selected.est}</p>
              <p style={{ fontSize:13,color:'#333' }}><strong>Phone:</strong> <a href={`tel:${selected.phone}`}>{selected.phone}</a></p>
              <div style={{ marginTop:16 }}>
                <div style={{ fontSize:11,fontWeight:700,color:'#555',marginBottom:6,textTransform:'uppercase',letterSpacing:.5 }}>Update Status</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                  {STATUS_FLOW.filter(s=>s!==selected.status).map(s=>(
                    <button key={s} onClick={()=>setStatus(selected.id,s)} style={{
                      background: STATUS_COLORS[s].badge, color:'#fff',
                      border:'none', borderRadius:5, padding:'7px 14px',
                      fontSize:12, fontWeight:700, cursor:'pointer',
                    }}>{s}</button>
                  ))}
                </div>
              </div>
              {selected.status !== 'COMPLETED' && (
                <button onClick={()=>markDone(selected)} style={{
                  marginTop:16, width:'100%', background:'#27AE60', color:'#fff',
                  border:'none', borderRadius:6, padding:'11px', fontWeight:700,
                  fontSize:14, cursor:'pointer',
                }}>✓ Mark as COMPLETED</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DeptRow({ q, pos, done, onSelect, onMarkDone }) {
  const c = STATUS_COLORS[q.status] || STATUS_COLORS['LOGGED'];
  return (
    <div style={{
      background: done ? '#F8F8F8' : '#fff',
      borderRadius:8, marginBottom:8,
      border:`1px solid ${done ? '#E0E0E0' : c.bg}`,
      borderLeft:`4px solid ${c.badge}`,
      padding:'12px 16px', display:'flex', alignItems:'center', gap:12,
      opacity: done ? .7 : 1,
    }}>
      {pos && <div style={{ minWidth:28,height:28,borderRadius:'50%',background:NAVY,color:GOLD,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:12 }}>{pos}</div>}
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:600, fontSize:13, color:'#1A1A1A' }}>{q.exhibitor} <span style={{ color:'#888', fontWeight:400 }}>Stand {q.stand}</span></div>
        <div style={{ fontSize:12, color:'#555', marginTop:2 }}>{q.description}</div>
      </div>
      <div style={{ fontSize:12, color:'#888', minWidth:60 }}>{q.est}</div>
      <StatusBadge status={q.status} />
      {!done && (
        <button onClick={e=>{e.stopPropagation();onMarkDone();}} style={{
          background:'#27AE60',color:'#fff',border:'none',borderRadius:5,
          padding:'6px 12px',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',
        }}>✓ Done</button>
      )}
      <button onClick={onSelect} style={{
        background:'#F0F0F0',color:'#333',border:'none',borderRadius:5,
        padding:'6px 12px',fontSize:11,fontWeight:600,cursor:'pointer',
      }}>Detail</button>
    </div>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:24, fontWeight:700, color }}>{value}</div>
      <div style={{ fontSize:10, color:'#888', letterSpacing:.5 }}>{label}</div>
    </div>
  );
}
