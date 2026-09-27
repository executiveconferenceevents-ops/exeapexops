import { useState } from 'react';
import { getQueries, CATEGORIES, STATUS_COLORS, estMinutes } from '../lib/mock';

const NAVY = "#1B2A4A", GOLD = "#C9A84C";

// ── This is the PUBLIC exhibitor-facing view ──────────────────────────────────
// Accessible via QR code on exhibitor's stand: /status?stand=A1
// Shows: queue position, estimated wait, current status — READ ONLY
// No login required for exhibitors.

export default function ExhibitorStatus() {
  const [stand, setStand]       = useState('');
  const [searched, setSearched] = useState(false);

  const queries = getQueries();

  // Find active query for this stand
  const myQuery = queries.find(q => q.stand.toLowerCase() === stand.toLowerCase() && q.status !== 'COMPLETED');
  const allDone = queries.filter(q => q.stand.toLowerCase() === stand.toLowerCase() && q.status === 'COMPLETED');

  // Queue position among same category
  const queueForCat = myQuery
    ? queries
        .filter(q => q.category === myQuery.category && q.status !== 'COMPLETED')
        .sort((a,b) => new Date(a.loggedAt) - new Date(b.loggedAt))
    : [];
  const myPos = myQuery ? queueForCat.findIndex(q=>q.id===myQuery.id)+1 : null;

  // ETA: sum of est times for all queries ahead of this one
  const ahead = myPos ? queueForCat.slice(0, myPos-1) : [];
  const etaMins = ahead.reduce((sum,q) => sum + estMinutes(q.est), 0) + estMinutes(myQuery?.est||'1 hour');
  const etaStr = etaMins < 60 ? `${etaMins} min` : `${Math.round(etaMins/60*10)/10} hrs`;

  function search(e) {
    e.preventDefault();
    setSearched(true);
  }

  const sc = myQuery ? (STATUS_COLORS[myQuery.status] || STATUS_COLORS['LOGGED']) : null;

  return (
    <div style={{
      fontFamily:'Arial,sans-serif', minHeight:'100vh',
      background: `linear-gradient(135deg, ${NAVY} 0%, #2C3E6B 100%)`,
      display:'flex', flexDirection:'column', alignItems:'center',
    }}>

      {/* Header */}
      <div style={{ textAlign:'center', paddingTop:40, paddingBottom:24 }}>
        <div style={{ color:GOLD, fontWeight:700, fontSize:26, letterSpacing:2 }}>APEXOPS™</div>
        <div style={{ color:'rgba(255,255,255,.6)', fontSize:13, marginTop:4 }}>Exhibitor Query Status</div>
      </div>

      {/* Search card */}
      <div style={{ background:'#fff', borderRadius:12, width:360, maxWidth:'92vw', padding:28, boxShadow:'0 8px 32px rgba(0,0,0,.3)' }}>
        <form onSubmit={search}>
          <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#555', marginBottom:6, textTransform:'uppercase', letterSpacing:.5 }}>
            Your Stand Number
          </label>
          <input
            value={stand}
            onChange={e=>{setStand(e.target.value);setSearched(false);}}
            placeholder="e.g. A01, B02, C03…"
            style={{ width:'100%', border:'2px solid #E0E0E0', borderRadius:8, padding:'11px 14px', fontSize:16, fontWeight:600, color:NAVY, boxSizing:'border-box', outline:'none' }}
          />
          <button type="submit" style={{
            marginTop:12, width:'100%', background:NAVY, color:GOLD,
            border:'none', borderRadius:8, padding:13, fontWeight:700,
            fontSize:15, cursor:'pointer', letterSpacing:.5,
          }}>Check My Status</button>
        </form>
      </div>

      {/* Result */}
      {searched && stand && (
        <div style={{ width:360, maxWidth:'92vw', marginTop:16 }}>

          {myQuery ? (
            <>
              {/* Active query card */}
              <div style={{ background:'#fff', borderRadius:12, padding:24, boxShadow:'0 4px 16px rgba(0,0,0,.2)', borderTop:`6px solid ${sc.badge}` }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
                  <div>
                    <div style={{ fontSize:11, color:'#888', textTransform:'uppercase', letterSpacing:.5 }}>Query Reference</div>
                    <div style={{ fontWeight:700, fontSize:20, color:NAVY }}>{myQuery.id}</div>
                  </div>
                  <span style={{ background:sc.badge, color:'#fff', borderRadius:6, padding:'4px 12px', fontSize:12, fontWeight:700 }}>{myQuery.status}</span>
                </div>

                <div style={{ background:'#F8F8F8', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:13, color:'#333' }}>
                  {myQuery.description}
                </div>

                {/* Queue position */}
                <div style={{ display:'flex', gap:12, marginBottom:8 }}>
                  <StatCard label="Queue Position" value={`#${myPos}`} sub={`in ${myQuery.category} queue`} color={NAVY} />
                  <StatCard label="Estimated Wait" value={etaStr} sub={etaTime(etaMins)} color="#1E8449" />
                </div>

                {myQuery.status === 'IN PROGRESS' && (
                  <div style={{ background:'#D5F5E3', borderRadius:8, padding:'10px 14px', textAlign:'center', color:'#1E8449', fontWeight:700, fontSize:13 }}>
                    ✅ Your technician is on the way!
                  </div>
                )}
                {myQuery.status === 'ISSUES/DELAYED' && (
                  <div style={{ background:'#F9EBEA', borderRadius:8, padding:'10px 14px', textAlign:'center', color:'#922B21', fontWeight:700, fontSize:13 }}>
                    ⚠️ There is a delay — our ops team has been notified.
                  </div>
                )}

                <div style={{ marginTop:14, fontSize:11, color:'#aaa', textAlign:'center' }}>
                  Logged {timeAgo(myQuery.loggedAt)} · Category: {myQuery.category}
                </div>
              </div>
            </>
          ) : (
            <div style={{ background:'#fff', borderRadius:12, padding:28, textAlign:'center', boxShadow:'0 4px 16px rgba(0,0,0,.2)' }}>
              {allDone.length > 0 ? (
                <>
                  <div style={{ fontSize:40, marginBottom:8 }}>✅</div>
                  <div style={{ fontWeight:700, fontSize:18, color:'#1E8449' }}>All done!</div>
                  <div style={{ fontSize:13, color:'#666', marginTop:6 }}>
                    {allDone.length} {allDone.length===1?'query':'queries'} completed for Stand {stand}.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize:40, marginBottom:8 }}>🔍</div>
                  <div style={{ fontWeight:700, fontSize:16, color:NAVY }}>No active queries found</div>
                  <div style={{ fontSize:13, color:'#666', marginTop:6 }}>
                    Stand <strong>{stand}</strong> has no open queries.<br/>
                    Please ask the ops desk to log your query.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ color:'rgba(255,255,255,.3)', fontSize:11, marginTop:'auto', paddingBottom:20, paddingTop:32 }}>
        APEXOPS™ · Executive Conference Events · © 2026
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{ flex:1, background:'#F8F9FA', borderRadius:8, padding:'12px 14px', textAlign:'center' }}>
      <div style={{ fontSize:11, color:'#888', textTransform:'uppercase', letterSpacing:.5, marginBottom:4 }}>{label}</div>
      <div style={{ fontSize:28, fontWeight:700, color }}>{value}</div>
      <div style={{ fontSize:11, color:'#aaa', marginTop:2 }}>{sub}</div>
    </div>
  );
}

function etaTime(mins) {
  const t = new Date(Date.now() + mins * 60000);
  return `by ~${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`;
}

function timeAgo(date) {
  const mins = Math.round((Date.now() - new Date(date)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return `${Math.round(mins/60)} hr ago`;
}
