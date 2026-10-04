import { useEffect, useState } from 'react';
import OpsPortal from './views/OpsPortal';
import ClientEventAdmin from './views/ClientEventAdmin';
import DeptQueue from './views/DeptQueue';
import ExhibitorStatus from './views/ExhibitorStatus';
import StaffSetup from './views/StaffSetup';
import PeopleSetup from './views/PeopleSetup';
import ExhibitorSetup from './views/ExhibitorSetup';
import RebookingForm from './views/RebookingForm';
import ClientQuery from './views/ClientQuery';
import { supabase } from './lib/supabase';
import { DEMO_MODE } from './lib/demoStore';
import { clearActiveEvent, getActiveEvent, getAvailableEvents, getEventSlug, getPublicEvents, resolvePublicEvent, setActiveEvent } from './lib/eventScope';
import { ArrowLeft, Building2, ClipboardPlus, HardHat, LogIn, LogOut, Monitor } from 'lucide-react';
import { NAVY, NAVY_DEEP, GOLD, GOLD_PALE, FONT, DISPLAY_FONT } from './theme';

// ── Role selector / login screen ──────────────────────────────────────────────
// In production this becomes a real Supabase auth login.
// For now: pick your role to enter the right view.

export default function App() {
  const [role, setRole] = useState(null);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [canManageTenants, setCanManageTenants] = useState(false);
  const [events, setEvents] = useState([]);
  const [publicEvents, setPublicEvents] = useState([]);
  const [publicEventSlug, setPublicEventSlug] = useState('');
  const [publicAccessCode, setPublicAccessCode] = useState('');
  const [verifyingPublicEvent, setVerifyingPublicEvent] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventLoading, setEventLoading] = useState(true);
  const [eventError, setEventError] = useState('');

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

  useEffect(() => {
    let cancelled = false;
    setEventLoading(true);
    setEventError('');
    const loadEventContext = async () => {
      try {
        if (session) {
          const availableEvents = await getAvailableEvents();
          if (cancelled) return;
          let platformAdmin = false;
          let organizationAdmin = false;
          if (supabase) {
            const [adminResult, membershipResult] = await Promise.all([
              supabase.rpc('is_platform_admin'),
              supabase.from('client_event_memberships').select('client_id, event_id, role'),
            ]);
            if (cancelled) return;
            if (adminResult.error) throw adminResult.error;
            if (membershipResult.error) throw membershipResult.error;
            platformAdmin = Boolean(adminResult.data);
            organizationAdmin = (membershipResult.data || []).some(membership => membership.role === 'client_admin' && !membership.event_id);
          }
          setIsPlatformAdmin(platformAdmin);
          setCanManageTenants(platformAdmin || organizationAdmin);
          setEvents(availableEvents);
          const currentEvent = getActiveEvent();
          const nextEvent = availableEvents.find(event => event.slug === getEventSlug())
            || availableEvents.find(event => event.id === currentEvent?.id)
            || (availableEvents.length === 1 ? availableEvents[0] : null);
          setSelectedEvent(nextEvent);
          setActiveEvent(nextEvent);
        } else {
          setEvents([]);
          setIsPlatformAdmin(false);
          setCanManageTenants(false);
          clearActiveEvent();
          const availablePublicEvents = await getPublicEvents();
          if (cancelled) return;
          setPublicEvents(availablePublicEvents);
          const linkedSlug = new URLSearchParams(window.location.search).get('event') || '';
          setPublicEventSlug(availablePublicEvents.some(event => event.slug === linkedSlug) ? linkedSlug : '');
          setPublicAccessCode('');
          setSelectedEvent(null);
        }
      } catch (eventLoadError) {
        if (!cancelled) setEventError(eventLoadError?.message || 'Could not load events for this account.');
      } finally {
        if (!cancelled) setEventLoading(false);
      }
    };
    loadEventContext();
    return () => { cancelled = true; };
  }, [session]);

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setRole(null);
    setSelectedEvent(null);
    clearActiveEvent();
  }

  function selectEvent(eventId) {
    const nextEvent = events.find(event => event.id === eventId) || null;
    setSelectedEvent(nextEvent);
    setActiveEvent(nextEvent);
    setRole(null);
  }

  function selectPublicEvent(slug) {
    setPublicEventSlug(slug);
    setPublicAccessCode('');
    setSelectedEvent(null);
    setEventError('');
    clearActiveEvent();
  }

  async function verifyPublicEvent() {
    if (!publicEventSlug || !publicAccessCode.trim()) return;
    setVerifyingPublicEvent(true);
    setEventError('');
    try {
      const publicEvent = await resolvePublicEvent(publicEventSlug, publicAccessCode);
      if (!publicEvent) throw new Error('That event code is not valid for the selected event.');
      setSelectedEvent(publicEvent);
      setActiveEvent(publicEvent);
      setPublicAccessCode('');
    } catch (verificationError) {
      setEventError(verificationError?.message || 'Could not verify this event code.');
    } finally {
      setVerifyingPublicEvent(false);
    }
  }

  async function openPublicRole(nextRole) {
    if (!selectedEvent?.accessCode) {
      setEventError('Select an event and enter its organiser-issued code to continue.');
      return;
    }
    setRole(nextRole);
  }

  if (!authReady) return null;
  if (role === 'exhibitor') return <WithBack onBack={()=>setRole(null)} onSignOut={session ? signOut : undefined}><ExhibitorStatus /></WithBack>;
  if (role === 'client-query') return <WithBack onBack={()=>setRole(null)} onSignOut={session ? signOut : undefined}><ClientQuery /></WithBack>;
  if (role === 'rebooking') return <WithBack onBack={()=>setRole(null)} onSignOut={session ? signOut : undefined}><RebookingForm /></WithBack>;
  if (session && role === 'tenant-admin') return <WithBack onBack={()=>setRole('ops')} onSignOut={signOut}><ClientEventAdmin /></WithBack>;
  if (session && role === 'ops') return <WithBack onBack={()=>setRole(null)} onSignOut={signOut}><OpsPortal onOpenStaff={()=>setRole('staff')} onOpenExhibitors={()=>setRole('exhibitors')} /></WithBack>;
  if (session && role === 'staff') return <WithBack onBack={()=>setRole('ops')} onSignOut={signOut}><StaffSetup /></WithBack>;
    if (session && role === 'people') return <WithBack onBack={()=>setRole('ops')} onSignOut={signOut}><PeopleSetup onBack={()=>setRole('ops')} /></WithBack>;
  if (session && role === 'exhibitors') return <WithBack onBack={()=>setRole('ops')} onSignOut={signOut}><ExhibitorSetup onBack={()=>setRole('ops')} /></WithBack>;
  if (session && role === 'dept') return <WithBack onBack={()=>setRole(null)} onSignOut={signOut}><DeptQueue /></WithBack>;

  return (
    <div className={session ? 'access-page access-hub' : 'access-page access-login'} style={{
      fontFamily:FONT, minHeight:'100vh', color:'#fff', position:'relative', overflow:'hidden',
      background:`radial-gradient(circle at 90% 12%, rgba(180,154,106,.14), transparent 28%), linear-gradient(120deg, ${NAVY_DEEP} 0%, ${NAVY} 58%, #273958 100%)`,
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'56px 24px 32px',
    }}>
      {session && <button className="access-hub-signout" onClick={signOut} style={{ position:'absolute', top:22, right:24, display:'inline-flex', alignItems:'center', gap:7, background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.84)', border:'1px solid rgba(255,255,255,.3)', borderRadius:5, padding:'9px 13px', fontSize:12, fontWeight:700, cursor:'pointer' }}><LogOut size={14} /> Sign out</button>}
      <div className="access-hub-content" style={{ width:'100%', maxWidth:980, position:'relative', zIndex:1 }}>
        <div className="access-hub-eyebrow" style={{ color:GOLD_PALE, fontSize:11, letterSpacing:3.2, textTransform:'uppercase', marginBottom:24 }}>
          Executive Conference Events · APEXOPS™
        </div>
        <div className="access-hub-intro" style={{ maxWidth:620, marginBottom:42 }}>
          <div className="access-hub-headline" style={{ fontFamily:DISPLAY_FONT, fontWeight:600, fontSize:'clamp(48px, 8vw, 88px)', lineHeight:.84, letterSpacing:-1.5 }}>
            {session ? <>Choose your<br /><em style={{ color:GOLD_PALE, fontWeight:500 }}>workspace.</em></> : <>Welcome to<br /><em style={{ color:GOLD_PALE, fontWeight:500 }}>APEXOPS<sup className="access-brand-trademark">™</sup>.</em></>}
          </div>
          <div style={{ width:54, height:3, background:GOLD, marginTop:30, marginBottom:18 }} />
          <div className="access-hub-subtitle" style={{ fontFamily:DISPLAY_FONT, fontStyle:'italic', color:'rgba(255,255,255,.72)', fontSize:19 }}>
            {session ? 'APEXOPS™ by Executive Conference Events' : 'Operations for exhibitors, event teams and partners.'}
          </div>
        </div>

        {session && <div className="event-picker">
          <label htmlFor="active-event">Event workspace</label>
          <select id="active-event" value={selectedEvent?.id || ''} onChange={event=>selectEvent(event.target.value)} disabled={eventLoading}>
            <option value="">{eventLoading ? 'Loading your events...' : 'Select an event'}</option>
            {events.map(event => <option key={event.id} value={event.id}>{event.clients?.name ? `${event.clients.name} · ` : ''}{event.name}</option>)}
          </select>
          {!eventLoading && !events.length && <p>No event access is assigned to this account.</p>}
        </div>}
        {!session && <div className="public-event-gate">
          {selectedEvent?.accessCode ? <div className="public-event-unlocked">
            <div><span>Event access verified</span><strong>{selectedEvent.clients?.name ? `${selectedEvent.clients.name} · ` : ''}{selectedEvent.name}</strong></div>
            <button type="button" onClick={()=>selectPublicEvent('')}>Change event</button>
          </div> : <>
            <label htmlFor="public-event">Client event</label>
            <select id="public-event" value={publicEventSlug} onChange={event=>selectPublicEvent(event.target.value)} disabled={eventLoading || verifyingPublicEvent}>
              <option value="">{eventLoading ? 'Loading events...' : 'Select your event'}</option>
              {publicEvents.map(event => <option key={event.slug} value={event.slug}>{event.client_name} · {event.event_name} · {event.event_start_date} to {event.event_end_date}</option>)}
            </select>
            <label htmlFor="public-event-code">Event code</label>
            <div className="public-event-code-row">
              <input id="public-event-code" autoComplete="off" value={publicAccessCode} onChange={event=>setPublicAccessCode(event.target.value.toUpperCase())} placeholder="Enter the code from your organiser" disabled={eventLoading || verifyingPublicEvent} />
              <button type="button" onClick={verifyPublicEvent} disabled={eventLoading || verifyingPublicEvent || !publicEventSlug || !publicAccessCode.trim()}>{verifyingPublicEvent ? 'Checking...' : 'Continue'}</button>
            </div>
          </>}
          {!eventLoading && !publicEvents.length && <p>No public events are available yet.</p>}
        </div>}
        {eventError && <div className="event-context-error" role="alert">{eventError}</div>}

        <div className="access-hub-choice-heading" style={{ textAlign:'left', marginBottom:20 }}>
          <div style={{ color:'rgba(255,255,255,.48)', fontSize:10, letterSpacing:2.2, textTransform:'uppercase' }}>{session ? 'Operations access' : 'Choose your access point'}</div>
        </div>
      </div>

      <div className={`access-card-stack${session ? ' access-card-grid' : ''}`} style={{ display:'flex', flexDirection:'column', gap:10, width:420, maxWidth:'100%', position:'relative', zIndex:1 }}>
        {!session && <TeamLogin onSignedIn={setSession} />}
        {session && <RoleCard icon={<Monitor size={24} strokeWidth={1.8} />} title="Ops Portal" sub="Internal team — manage queries and assignments" onClick={()=>setRole('ops')} primary disabled={!selectedEvent || eventLoading} />}
        {session && <RoleCard icon={<HardHat size={24} strokeWidth={1.8} />} title="My Queue" sub="Internal staff — see assigned tasks and update status" onClick={()=>setRole('dept')} light disabled={!selectedEvent || eventLoading} />}
        {session && canManageTenants && <RoleCard icon={<Building2 size={24} strokeWidth={1.8} />} title={isPlatformAdmin ? 'Clients & Events' : 'Event management'} sub={isPlatformAdmin ? 'Manage paid client organizations, events and invitations' : 'Create events and manage your organization’s team'} onClick={()=>setRole('tenant-admin')} light />}
        <RoleCard
          icon={<Building2 size={24} strokeWidth={1.8} />}
          title="Check My Status"
          sub="Exhibitors — see your queue position and estimated wait time"
          onClick={()=>openPublicRole('exhibitor')}
          light
          disabled={eventLoading || (!session && !selectedEvent?.accessCode)}
        />
        <RoleCard
          icon={<ClipboardPlus size={24} strokeWidth={1.8} />}
          title="Log a Query"
          sub="Tell the Ops Desk about an issue at your stand"
          onClick={()=>openPublicRole('client-query')}
          light
          disabled={eventLoading || (!session && !selectedEvent?.accessCode)}
        />
        <RoleCard
          icon={<Building2 size={24} strokeWidth={1.8} />}
          title="Rebook Your Stand"
          sub={`Tell us how you would like to participate at ${selectedEvent?.next_event_name || 'the next event'}`}
          onClick={()=>openPublicRole('rebooking')}
          light
          disabled={eventLoading || (!session && !selectedEvent?.accessCode)}
        />
      </div>

      <div className="access-hub-footer" style={{ color:'rgba(255,255,255,.32)', fontSize:10, letterSpacing:.4, marginTop:48, position:'relative', zIndex:1 }}>
        APEXOPS™ © 2026 Executive Conference Events (Pty) Ltd · All rights reserved
      </div>
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

  if (!open) return <button className="team-sign-in-link" onClick={()=>setOpen(true)} style={{ background:'transparent', color:'rgba(255,255,255,.7)', border:'1px solid rgba(255,255,255,.25)', borderRadius:8, padding:11, cursor:'pointer' }}><LogIn size={14} /> Team sign in</button>;
  return <form className="team-login-form" onSubmit={signIn} style={{ background:'#fff', borderRadius:8, padding:16, display:'grid', gap:8 }}>
    <strong style={{ color:NAVY, fontSize:13 }}>Team sign in</strong>
    <input required type="email" placeholder="Work email" value={email} onChange={e=>setEmail(e.target.value)} />
    <input required type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
    {error && <span style={{ color:'#C0392B', fontSize:11 }}>{error}</span>}
    <button type="submit" style={{ background:NAVY, color:'#fff', border:'none', borderRadius:6, padding:9, fontWeight:700, cursor:'pointer' }}><LogIn size={14} /> Sign in</button>
  </form>;
}

function RoleCard({ icon, title, sub, onClick, primary, light, disabled }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      className={`access-option${primary ? ' access-option-primary' : ''}`}
      onClick={onClick}
      disabled={disabled}
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
      <div className="global-nav-actions apex-service-nav" style={{ position:'fixed', top:16, right:20, zIndex:200, display:'flex', gap:8, padding:5, background:'rgba(255,255,255,.94)', border:'1px solid #d6dfdf', borderRadius:8, boxShadow:'0 4px 16px rgba(13,26,50,.16)' }}>
        <button className="global-nav-back" onClick={onBack} style={{
          background:'#fff', color:NAVY,
          border:'1px solid #d6dfdf', borderRadius:5,
          padding:'10px 14px', fontSize:12, fontWeight:800,
          cursor:'pointer', boxShadow:'0 3px 10px rgba(13,26,50,.12)', display:'inline-flex', alignItems:'center', gap:6,
        }}><ArrowLeft size={14} /> Back to Home</button>
        {onSignOut && <button className="global-nav-signout" onClick={onSignOut} style={{ background:NAVY, color:'#fff', border:'1px solid rgba(255,255,255,.2)', borderRadius:5, padding:'10px 14px', fontSize:12, fontWeight:800, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:6 }}><LogOut size={14} /> Sign out</button>}
      </div>
      {children}
    </div>
  );
}
