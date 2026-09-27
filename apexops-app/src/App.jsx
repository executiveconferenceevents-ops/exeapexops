import { useEffect, useState } from 'react';
import OpsPortal from './views/OpsPortal';
import DeptQueue from './views/DeptQueue';
import ExhibitorStatus from './views/ExhibitorStatus';
import StaffSetup from './views/StaffSetup';
import PeopleSetup from './views/PeopleSetup';
import ExhibitorSetup from './views/ExhibitorSetup';
import RebookingForm from './views/RebookingForm';
import ClientQuery from './views/ClientQuery';
import { supabase } from './lib/supabase';
import { DEMO_MODE } from './lib/demoStore';
import { ArrowLeft, Building2, ClipboardPlus, HardHat, LogOut, Monitor } from 'lucide-react';
import { NAVY, NAVY_DEEP, GOLD, GOLD_PALE, FONT, DISPLAY_FONT } from './theme';

// ── Role selector / login screen ──────────────────────────────────────────────
// In production this becomes a real Supabase auth login.
// For now: pick your role to enter the right view.

export default function App() {
  const [role, setRole] = useState(null);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    if (DEMO_MODE) {
      setAuthReady(true);
      return undefined;
    }
    if (!supabase) { setAuthReady(true); return undefined; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) setRole(null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setRole(null);
  }

  if (!authReady) return null;
  if (role === 'exhibitor') return <WithBack onBack={()=>setRole(null)}><ExhibitorStatus /></WithBack>;
  if (role === 'client-query') return <WithBack onBack={()=>setRole(null)}><ClientQuery /></WithBack>;
  if (role === 'rebooking') return <WithBack onBack={()=>setRole(null)}><RebookingForm /></WithBack>;
  if (session && role === 'ops') return <WithBack onBack={()=>setRole(null)} onSignOut={signOut}><OpsPortal onOpenStaff={()=>setRole('staff')} onOpenExhibitors={()=>setRole('exhibitors')} /></WithBack>;
  if (session && role === 'staff') return <WithBack onBack={()=>setRole('ops')} onSignOut={signOut}><StaffSetup /></WithBack>;
    if (session && role === 'people') return <WithBack onBack={()=>setRole('ops')} onSignOut={signOut}><PeopleSetup onBack={()=>setRole('ops')} /></WithBack>;
  if (session && role === 'exhibitors') return <WithBack onBack={()=>setRole('ops')} onSignOut={signOut}><ExhibitorSetup onBack={()=>setRole('ops')} /></WithBack>;
  if (session && role === 'dept') return <WithBack onBack={()=>setRole(null)} onSignOut={signOut}><DeptQueue /></WithBack>;

  return (
    <div style={{
      fontFamily:FONT, minHeight:'100vh', color:'#fff', position:'relative', overflow:'hidden',
      background:`radial-gradient(circle at 90% 12%, rgba(180,154,106,.14), transparent 28%), linear-gradient(120deg, ${NAVY_DEEP} 0%, ${NAVY} 58%, #273958 100%)`,
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'56px 24px 32px',
    }}>
      {session && <button onClick={signOut} style={{ position:'absolute', top:22, right:24, display:'inline-flex', alignItems:'center', gap:7, background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.84)', border:'1px solid rgba(255,255,255,.3)', borderRadius:5, padding:'9px 13px', fontSize:12, fontWeight:700, cursor:'pointer' }}><LogOut size={14} /> Sign out</button>}
      <div style={{ width:'100%', maxWidth:980, position:'relative', zIndex:1 }}>
        <div style={{ color:GOLD_PALE, fontSize:11, letterSpacing:3.2, textTransform:'uppercase', marginBottom:24 }}>
          Executive Conference Events · APEXOPS™
        </div>
        <div style={{ maxWidth:620, marginBottom:42 }}>
          <div style={{ fontFamily:DISPLAY_FONT, fontWeight:600, fontSize:'clamp(48px, 8vw, 88px)', lineHeight:.84, letterSpacing:-1.5 }}>
            Every Query.<br />
            <em style={{ color:GOLD_PALE, fontWeight:500 }}>Resolved.</em><br />
            On Time.
          </div>
          <div style={{ width:54, height:3, background:GOLD, marginTop:30, marginBottom:18 }} />
          <div style={{ fontFamily:DISPLAY_FONT, fontStyle:'italic', color:'rgba(255,255,255,.72)', fontSize:19 }}>
            Exhibitor query management, with poise under pressure.
          </div>
        </div>

        <div style={{ textAlign:'left', marginBottom:20 }}>
          <div style={{ color:'rgba(255,255,255,.48)', fontSize:10, letterSpacing:2.2, textTransform:'uppercase' }}>Choose your access point</div>
          {DEMO_MODE && <div style={{ color:GOLD_PALE, fontSize:11, marginTop:8 }}>DEMO MODE · Changes stay in this browser tab and never reach live Supabase.</div>}
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:10, width:420, maxWidth:'100%', position:'relative', zIndex:1 }}>
        {session && <RoleCard icon={<Monitor size={24} strokeWidth={1.8} />} title="Ops Portal" sub="Internal team — manage queries and assignments" onClick={()=>setRole('ops')} primary />}
        {session && <RoleCard icon={<HardHat size={24} strokeWidth={1.8} />} title="My Queue" sub="Internal staff — see assigned tasks and update status" onClick={()=>setRole('dept')} />}
        <RoleCard
          icon={<Building2 size={24} strokeWidth={1.8} />}
          title="Check My Status"
          sub="Exhibitors — see your queue position and estimated wait time"
          onClick={()=>setRole('exhibitor')}
          light
        />
        <RoleCard
          icon={<ClipboardPlus size={24} strokeWidth={1.8} />}
          title="Log a Query"
          sub="Tell the Ops Desk about an issue at your stand"
          onClick={()=>setRole('client-query')}
          light
        />
        <RoleCard
          icon={<Building2 size={24} strokeWidth={1.8} />}
          title="Rebook Your Stand"
          sub="Tell us how you would like to participate at ESG Africa 2027"
          onClick={()=>setRole('rebooking')}
          light
        />
        {!session && <TeamLogin onSignedIn={setSession} />}
      </div>

      <div style={{ color:'rgba(255,255,255,.32)', fontSize:10, letterSpacing:.4, marginTop:48, position:'relative', zIndex:1 }}>
        APEXOPS™ © 2026 Executive Conference Events (Pty) Ltd · All rights reserved
      </div>
      {DEMO_MODE && <DemoNotice />}
    </div>
  );
}

function TeamLogin({ onSignedIn }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function signIn(event) {
    event.preventDefault();
    if (DEMO_MODE) {
      onSignedIn({ demo: true });
      return;
    }
    if (!supabase) {
      setError('Team sign-in is unavailable until Supabase is configured.');
      return;
    }
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);
    else onSignedIn(data.session);
  }

  if (!open) return <button onClick={()=>setOpen(true)} style={{ background:'transparent', color:'rgba(255,255,255,.7)', border:'1px solid rgba(255,255,255,.25)', borderRadius:8, padding:11, cursor:'pointer' }}>Team sign in</button>;
  return <form onSubmit={signIn} style={{ background:'#fff', borderRadius:8, padding:16, display:'grid', gap:8 }}>
    <strong style={{ color:NAVY, fontSize:13 }}>Team sign in</strong>
    <input required type="email" placeholder="Work email" value={email} onChange={e=>setEmail(e.target.value)} />
    <input required type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
    {error && <span style={{ color:'#C0392B', fontSize:11 }}>{error}</span>}
    <button type="submit" style={{ background:NAVY, color:'#fff', border:'none', borderRadius:6, padding:9, fontWeight:700, cursor:'pointer' }}>Sign in</button>
  </form>;
}

function RoleCard({ icon, title, sub, onClick, primary, light }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={()=>setHover(true)}
      onMouseLeave={()=>setHover(false)}
      style={{
        background: primary ? '#fff' : light ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.1)',
        border: primary ? '1px solid rgba(255,255,255,.8)' : '1px solid rgba(255,255,255,.22)',
        borderRadius:4, padding:'17px 20px', cursor:'pointer', textAlign:'left',
        transform: hover ? 'translateY(-2px)' : 'none',
        boxShadow: hover ? '0 6px 20px rgba(0,0,0,.3)' : '0 2px 8px rgba(0,0,0,.2)',
        transition:'all .15s',
        display:'flex', alignItems:'center', gap:14,
      }}
    >
      <span style={{ color: primary ? NAVY : GOLD_PALE, display:'inline-flex', alignItems:'center' }}>{icon}</span>
      <div>
        <div style={{ fontWeight:700, fontSize:14, letterSpacing:.2, color: primary ? NAVY : '#fff', marginBottom:3 }}>{title}</div>
        <div style={{ fontSize:12, color: primary ? 'rgba(27,42,74,.7)' : 'rgba(255,255,255,.6)', lineHeight:1.4 }}>{sub}</div>
      </div>
      <span style={{ marginLeft:'auto', color: primary ? NAVY : 'rgba(255,255,255,.4)', fontSize:18 }}>›</span>
    </button>
  );
}

function WithBack({ onBack, onSignOut, children }) {
  return (
    <div>
      <div className="global-nav-actions" style={{ position:'fixed', top:16, right:20, zIndex:200, display:'flex', gap:8, padding:5, background:'rgba(255,255,255,.94)', border:'1px solid #d6dfdf', borderRadius:8, boxShadow:'0 4px 16px rgba(13,26,50,.16)' }}>
        <button onClick={onBack} style={{
          background:'#fff', color:NAVY,
          border:'1px solid #d6dfdf', borderRadius:5,
          padding:'10px 14px', fontSize:12, fontWeight:800,
          cursor:'pointer', boxShadow:'0 3px 10px rgba(13,26,50,.12)', display:'inline-flex', alignItems:'center', gap:6,
        }}><ArrowLeft size={14} /> Back to Home</button>
        {onSignOut && <button onClick={onSignOut} style={{ background:NAVY, color:'#fff', border:'1px solid rgba(255,255,255,.2)', borderRadius:5, padding:'10px 14px', fontSize:12, fontWeight:800, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6 }}><LogOut size={14} /> Sign out</button>}
      </div>
      {children}
      {DEMO_MODE && <DemoNotice />}
    </div>
  );
}

function DemoNotice() {
  return <div role="status" style={{ position:'fixed', left:14, bottom:14, zIndex:300, padding:'8px 11px', borderRadius:5, background:NAVY, color:GOLD_PALE, border:'1px solid rgba(215,197,160,.65)', boxShadow:'0 4px 14px rgba(0,0,0,.2)', fontSize:10, fontWeight:800, letterSpacing:.4 }}>
    DEMO ONLY · Data stays in this browser tab
  </div>;
}
