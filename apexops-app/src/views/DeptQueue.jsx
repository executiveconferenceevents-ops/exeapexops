import { useEffect, useState } from 'react';
import { getExhibitors, getQueries, getStaff, normalizeStand, updateQuery, STATUS_FLOW, STATUS_COLORS } from '../lib/mock';
import StatusBadge from '../components/StatusBadge';
import { ClipboardList, CheckCircle2, CircleUserRound, Clock3, HardHat } from 'lucide-react';
import { NAVY, NAVY_DEEP, GOLD_PALE, BLUE, TEAL, GREEN, BG, FONT } from '../theme';

export default function DeptQueue() {
  const [staffId, setStaffId]   = useState('');
  const [queries, setQueries]   = useState([]);
  const [staff, setStaff]       = useState([]);
  const [exhibitors, setExhibitors] = useState([]);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    refresh();
    getStaff().then(setStaff);
  }, []);

  const refresh = async () => {
    const [nextQueries, nextExhibitors] = await Promise.all([getQueries(), getExhibitors()]);
    setQueries(nextQueries);
    setExhibitors(nextExhibitors);
  };
  const myStaff = staff.find(s => s.id === staffId);
  const myQueries = staffId ? queries.filter(q => String(q.assignedTo || '') === String(staffId)) : [];
  const active = myQueries.filter(q => q.status !== 'COMPLETED');
  const done = myQueries.filter(q => q.status === 'COMPLETED');

  async function markDone(q) {
    await updateQuery(q.id, { status: 'COMPLETED', completedAt: new Date() });
    setSelected(null);
    refresh();
  }
  async function setStatus(id, status) {
    await updateQuery(id, { status });
    setSelected(null);
    refresh();
  }

  return (
    <div style={{ fontFamily:FONT, minHeight:'100vh', background:BG }}>

      {/* Header */}
      <div style={{ background:`linear-gradient(110deg, ${NAVY_DEEP}, ${NAVY})`, padding:'0 32px', display:'flex', alignItems:'center', gap:16, minHeight:76, boxShadow:'0 2px 14px rgba(13,26,50,.16)' }}>
        <div><div style={{ color:GOLD_PALE, fontWeight:700, fontSize:19, letterSpacing:2 }}>APEXOPS™</div><div style={{ color:'rgba(255,255,255,.56)', fontSize:10, letterSpacing:1.8, textTransform:'uppercase', marginTop:3 }}>Personal work queue</div></div>
        <span style={{ color:'rgba(255,255,255,.65)', fontSize:12 }}>My Queue</span>
        <select value={staffId} onChange={e=>setStaffId(e.target.value)} style={{
          marginLeft:'auto', background:'#fff', border:'1px solid rgba(215,197,160,.65)', borderRadius:5,
          padding:'9px 12px', fontSize:13, fontWeight:600, color:NAVY, cursor:'pointer', minWidth:220,
        }}>
          <option value="">— Select your name —</option>
          {staff.map(s=><option key={s.id} value={s.id}>{s.name}{s.supplier_name ? ` (${s.supplier_name})` : ''}</option>)}
        </select>
      </div>

      {!staffId ? (
        <div style={{ maxWidth:700, margin:'48px auto', background:'#fff', border:'1px dashed #cbd6d8', borderRadius:8, padding:'48px 24px', textAlign:'center', color:'#6f7b82' }}>
          <CircleUserRound size={34} color={BLUE} strokeWidth={1.6} />
          <div style={{ color:NAVY, fontSize:17, fontWeight:700, marginTop:14 }}>Select your name to view your queue</div>
          <div style={{ fontSize:13, marginTop:6 }}>Your assigned exhibitor requests and current work will appear here.</div>
        </div>
      ) : (
        <div style={{ padding:'28px 32px 64px', maxWidth:1120, margin:'0 auto' }}>

          {/* Staff header */}
          <div style={{ background:'#fff', borderRadius:8, padding:'20px 22px', marginBottom:24, display:'flex', alignItems:'center', gap:16, border:'1px solid #e1e6e5', borderTop:`3px solid ${BLUE}`, boxShadow:'0 4px 16px rgba(13,26,50,.05)' }}>
            {myStaff.supplier_logo_url && <img src={myStaff.supplier_logo_url} alt={`${myStaff.supplier_name || 'Supplier'} logo`} title={myStaff.supplier_name || 'Supplier'} style={{ width:48, height:48, objectFit:'contain', borderRadius:8, border:'1px solid #dfe7eb', background:'#fff', padding:4 }} />}
            <div style={{ width:48,height:48,borderRadius:'50%',background:NAVY,display:'flex',alignItems:'center',justifyContent:'center',color:GOLD_PALE,fontWeight:700,fontSize:16,overflow:'hidden' }}>
              {myStaff.photo_url ? <img src={myStaff.photo_url} alt={`${myStaff.name} profile`} style={{ width:'100%', height:'100%', objectFit:'cover' }} /> : myStaff.name.split(' ').map(n=>n[0]).join('').slice(0,2)}
            </div>
            <div>
              <div style={{ fontWeight:700, fontSize:17, color:NAVY }}>{myStaff.name}</div>
              <div style={{ fontSize:12, color:'#687780', marginTop:3 }}>{myStaff.supplier_name || 'Supplier not assigned'}</div>
              <div style={{ fontSize:11, color:'#536b79', marginTop:3 }}>Department: {myStaff.category}</div>
              <div style={{ fontSize:12, marginTop:5, display:'flex', gap:12 }}>
                {myStaff.email ? <a href={`mailto:${firstContact(myStaff.email)}`} style={contactLink}>Email: {myStaff.email}</a> : <span style={{ color:'#8a97a0' }}>Email not recorded</span>}
                {myStaff.mobile ? <a href={whatsappLink(myStaff.mobile)} target="_blank" rel="noreferrer" style={contactLink}>WhatsApp: {myStaff.mobile}</a> : <span style={{ color:'#8a97a0' }}>Mobile not recorded</span>}
              </div>
            </div>
            <div style={{ marginLeft:'auto', display:'flex', gap:24 }}>
              <Stat label="Active" value={active.length} color={GREEN} />
              <Stat label="Done Today" value={done.length} color={TEAL} />
            </div>
          </div>

          {/* Active queue */}
          <SectionTitle icon={<Clock3 size={16} />} label={`ACTIVE QUERIES (${active.length})`} color={GREEN} />
          {active.length === 0 && <div style={{ color:'#6f7b82', textAlign:'center', padding:'34px 24px', background:'#fff', border:'1px dashed #cbd6d8', borderRadius:8, marginBottom:20 }}><CheckCircle2 size={28} color={TEAL} /><div style={{ color:NAVY, fontWeight:700, marginTop:10 }}>You’re all clear</div><div style={{ fontSize:13, marginTop:5 }}>No active exhibitor requests are assigned to you.</div></div>}
          {active.map((q,i) => (
            <DeptRow key={q.id} q={q} exhibitors={exhibitors} pos={i+1} onSelect={()=>setSelected(q)} onMarkDone={()=>markDone(q)} />
          ))}

          {/* Completed */}
          {done.length > 0 && <>
            <SectionTitle icon={<CheckCircle2 size={16} />} label={`COMPLETED (${done.length})`} color={TEAL} />
            {done.map(q=>(
              <DeptRow key={q.id} q={q} exhibitors={exhibitors} done onSelect={()=>setSelected(q)} />
            ))}
          </>}
        </div>
      )}

      {/* Detail modal */}
      {selected && (
        <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:100,display:'flex',alignItems:'center',justifyContent:'center' }}>
          <div style={{ background:'#fff',borderRadius:10,width:480,maxWidth:'95vw',boxShadow:'0 8px 32px rgba(0,0,0,.2)' }}>
              <div style={{ background:NAVY,padding:'14px 20px',borderRadius:'10px 10px 0 0',display:'flex',alignItems:'center',justifyContent:'space-between' }}>
              <span style={{ color:'#fff',fontWeight:700 }}>{selected.id} — {selected.exhibitor}</span>
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

function DeptRow({ q, exhibitors, pos, done, onSelect, onMarkDone }) {
  const c = STATUS_COLORS[q.status] || STATUS_COLORS['LOGGED'];
  const exhibitor = exhibitors.find(item => normalizeStand(item.stand) === normalizeStand(q.stand));
  return (
    <div style={{
      background:'#fff',
      borderRadius:7, marginBottom:9,
      border:`1px solid ${done ? '#e1e6e5' : c.bg}`,
      borderLeft:`3px solid ${done ? TEAL : c.badge}`,
      padding:'15px 16px', display:'flex', alignItems:'center', gap:14,
      opacity: done ? .7 : 1,
      boxShadow:'0 2px 8px rgba(13,26,50,.035)',
    }}>
      {pos && <div style={{ minWidth:30,height:30,borderRadius:'50%',background:'#D9EAF6',color:BLUE,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,fontSize:12 }}>{pos}</div>}
      {exhibitor?.logo_url ? <img src={exhibitor.logo_url} alt={`${q.exhibitor} logo`} title={`${q.exhibitor} logo`} style={{ width:54, height:54, objectFit:'contain', borderRadius:9, border:'1px solid #d8e3e9', background:'#fff', padding:5, flex:'0 0 54px', boxShadow:'0 3px 10px rgba(13,26,50,.08)' }} /> : <div style={{ width:54, height:54, borderRadius:9, background:'#f1f5f7', color:'#718089', display:'grid', placeItems:'center', fontSize:10, flex:'0 0 54px' }}>Logo</div>}
      <div style={{ flex:1 }}>
        <div style={{ fontWeight:800, fontSize:14, color:NAVY }}>{q.exhibitor} <span style={{ color:'#78858b', fontWeight:500, fontSize:12 }}>· Stand {q.stand}</span></div>
        <div style={{ fontSize:12, color:'#555', marginTop:2 }}>{q.description}</div>
      </div>
      <div style={{ fontSize:12, color:'#888', minWidth:60 }}>{q.est}</div>
      <StatusBadge status={q.status} />
      {!done && (
        <button onClick={e=>{e.stopPropagation();onMarkDone();}} style={{
          background:GREEN,color:'#fff',border:'none',borderRadius:5,
          padding:'6px 12px',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',
        }}>✓ Done</button>
      )}
      <button onClick={onSelect} style={{
        background:'#fff',color:NAVY,border:'1px solid #d6dfdf',borderRadius:5,
        padding:'6px 12px',fontSize:11,fontWeight:600,cursor:'pointer',
      }}>Detail</button>
    </div>
  );
}

function SectionTitle({ icon, label, color }) {
  return <div style={{ display:'flex', alignItems:'center', gap:7, color, fontSize:11, fontWeight:700, letterSpacing:1.1, marginBottom:9, paddingBottom:8, borderBottom:'1px solid #dce4e5' }}>{icon}<span>{label}</span></div>;
}

function Stat({ label, value, color }) {
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontSize:24, fontWeight:700, color }}>{value}</div>
      <div style={{ fontSize:10, color:'#888', letterSpacing:.5 }}>{label}</div>
    </div>
  );
}

const contactLink = { color:BLUE, textDecoration:'none', fontWeight:600 };
function firstContact(value) { return String(value).split(/[;,]/)[0].trim(); }
function whatsappLink(value) {
  const digits = whatsappDigits(firstContact(value));
  return digits ? `https://wa.me/${digits}` : `tel:${encodeURIComponent(value)}`;
}
function whatsappDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^0[6-8]\d{8}$/.test(digits) ? `27${digits.slice(1)}` : digits;
}
