import { BrowserRouter, Routes, Route, useNavigate, Link } from 'react-router-dom';
import OpsPortal from './views/OpsPortal';
import DeptQueue from './views/DeptQueue';
import ExhibitorStatus from './views/ExhibitorStatus';
import StaffSetup from './views/StaffSetup';

const NAVY = "#1B2A4A", GOLD = "#C9A84C";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"        element={<Home />} />
        <Route path="/ops"     element={<WithBack><OpsPortal /></WithBack>} />
        <Route path="/queue"   element={<WithBack><DeptQueue /></WithBack>} />
        <Route path="/status"  element={<ExhibitorStatus />} />
        <Route path="/staff"   element={<StaffSetup />} />
      </Routes>
    </BrowserRouter>
  );
}

function Home() {
  const navigate = useNavigate();
  return (
    <div style={{
      fontFamily:'Arial,sans-serif', minHeight:'100vh',
      background:`linear-gradient(135deg, ${NAVY} 0%, #2C3E6B 100%)`,
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
    }}>
      {/* Logo */}
      <div style={{ textAlign:'center', marginBottom:40 }}>
        <div style={{ color:GOLD, fontWeight:700, fontSize:32, letterSpacing:3 }}>APEXOPS™</div>
        <div style={{ color:'rgba(255,255,255,.5)', fontSize:14, marginTop:6, letterSpacing:1 }}>
          EXECUTIVE CONFERENCE EVENTS
        </div>
      </div>

      {/* Role cards */}
      <div style={{ display:'flex', flexDirection:'column', gap:14, width:340, maxWidth:'92vw' }}>
        <RoleCard
          icon="🖥️"
          title="Ops Portal"
          sub="ECE & GL Events — log queries, assign staff, manage all categories"
          onClick={()=>navigate('/ops')}
          primary
        />
        <RoleCard
          icon="👷"
          title="My Queue"
          sub="Technicians & dept staff — see your assigned tasks, mark complete"
          onClick={()=>navigate('/queue')}
        />
        <RoleCard
          icon="🏢"
          title="Check My Status"
          sub="Exhibitors — see your queue position and estimated wait time"
          onClick={()=>navigate('/status')}
          light
        />
      </div>

      <div style={{ color:'rgba(255,255,255,.2)', fontSize:11, marginTop:48 }}>
        APEXOPS™ © 2026 Executive Conference Events (Pty) Ltd · All rights reserved
      </div>
    </div>
  );
}

function RoleCard({ icon, title, sub, onClick, primary, light }) {
  const [hover, setHover] = [false, ()=>{}];
  return (
    <button
      onClick={onClick}
      style={{
        background: primary ? GOLD : light ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.12)',
        border: primary ? 'none' : '1px solid rgba(255,255,255,.2)',
        borderRadius:10, padding:'18px 20px', cursor:'pointer', textAlign:'left',
        boxShadow:'0 2px 8px rgba(0,0,0,.2)',
        transition:'all .15s',
        display:'flex', alignItems:'center', gap:14,
      }}
      onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,.3)';}}
      onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,.2)';}}
    >
      <span style={{ fontSize:28 }}>{icon}</span>
      <div>
        <div style={{ fontWeight:700, fontSize:15, color: primary ? NAVY : '#fff', marginBottom:3 }}>{title}</div>
        <div style={{ fontSize:12, color: primary ? 'rgba(27,42,74,.7)' : 'rgba(255,255,255,.6)', lineHeight:1.4 }}>{sub}</div>
      </div>
      <span style={{ marginLeft:'auto', color: primary ? NAVY : 'rgba(255,255,255,.4)', fontSize:18 }}>›</span>
    </button>
  );
}

function WithBack({ children }) {
  const navigate = useNavigate();
  return (
    <div>
      <div style={{ position:'fixed', bottom:20, right:20, zIndex:200 }}>
        <button onClick={()=>navigate('/')} style={{
          background:'rgba(27,42,74,.85)', color:'#C9A84C',
          border:'1px solid rgba(201,168,76,.3)', borderRadius:20,
          padding:'7px 16px', fontSize:12, fontWeight:700,
          cursor:'pointer', backdropFilter:'blur(4px)',
        }}>← Switch View</button>
      </div>
      {children}
    </div>
  );
}
