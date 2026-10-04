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

const PRIVACY_NOTICE_VERSION = '2026-10-04-v1';

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
  const [eventMemberships, setEventMemberships] = useState([]);
  const [publicEvents, setPublicEvents] = useState([]);
  const [publicEventSlug, setPublicEventSlug] = useState('');
  const [publicAccessView, setPublicAccessView] = useState('events');
  const [publicEventSearch, setPublicEventSearch] = useState('');
  const [publicEventMonth, setPublicEventMonth] = useState('');
  const [publicAccessCode, setPublicAccessCode] = useState('');
  const [verifyingPublicEvent, setVerifyingPublicEvent] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [privacyNoticeChecked, setPrivacyNoticeChecked] = useState(false);
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
          let currentMemberships = [];
          if (supabase) {
            const [adminResult, membershipResult] = await Promise.all([
              supabase.rpc('is_platform_admin'),
              supabase.from('client_event_memberships').select('client_id, event_id, role'),
            ]);
            if (cancelled) return;
            if (adminResult.error) throw adminResult.error;
            if (membershipResult.error) throw membershipResult.error;
            platformAdmin = Boolean(adminResult.data);
            currentMemberships = membershipResult.data || [];
            organizationAdmin = currentMemberships.some(membership => membership.role === 'client_admin' && !membership.event_id);
          } else if (DEMO_MODE) {
            platformAdmin = true;
            organizationAdmin = true;
            currentMemberships = [{ client_id:availableEvents[0]?.client_id || 'demo-client-ece', event_id:null, role:'client_admin' }];
          }
          setIsPlatformAdmin(platformAdmin);
          setCanManageTenants(platformAdmin || organizationAdmin);
          setEventMemberships(currentMemberships);
          setEvents(availableEvents);
          const currentEvent = getActiveEvent();
          const nextEvent = availableEvents.find(event => event.slug === getEventSlug())
            || availableEvents.find(event => event.id === currentEvent?.id)
            || (availableEvents.length === 1 ? availableEvents[0] : null);
          setSelectedEvent(nextEvent);
          setActiveEvent(nextEvent);
        } else {
          setEvents([]);
          setEventMemberships([]);
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
          setPrivacyAcknowledged(false);
          setPrivacyNoticeChecked(false);
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
    setEventMemberships([]);
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
    setPrivacyAcknowledged(false);
    setPrivacyNoticeChecked(false);
    setEventError('');
    clearActiveEvent();
    const url = new URL(window.location.href);
    if (slug) url.searchParams.set('event', slug);
    else url.searchParams.delete('event');
    window.history.replaceState(window.history.state, '', url);
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
      let alreadyAcknowledged = false;
      try {
        alreadyAcknowledged = window.localStorage.getItem(`apexops-privacy-ack:${publicEvent.slug}`) === PRIVACY_NOTICE_VERSION;
      } catch { /* acknowledge for this page when local storage is unavailable */ }
      setPrivacyAcknowledged(alreadyAcknowledged);
      setPrivacyNoticeChecked(false);
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
    if (!privacyAcknowledged) {
      setEventError('Read and acknowledge the privacy notice before continuing.');
      return;
    }
    setRole(nextRole);
  }

  function acknowledgePrivacyNotice() {
    if (!selectedEvent?.slug || !privacyNoticeChecked) return;
    try { window.localStorage.setItem(`apexops-privacy-ack:${selectedEvent.slug}`, PRIVACY_NOTICE_VERSION); }
    catch { /* keep the acknowledgement active for this page if storage is unavailable */ }
    setPrivacyAcknowledged(true);
    setEventError('');
  }

  const selectedPublicEvent = publicEvents.find(event => event.slug === publicEventSlug);
  const publicEventMonths = [...new Set(publicEvents.map(event => event.event_start_date?.slice(0, 7)).filter(Boolean))].sort();
  const filteredPublicEvents = publicEvents.filter(event => {
    const searchableText = `${event.client_name} ${event.event_name}`.toLowerCase();
    return (!publicEventSearch.trim() || searchableText.includes(publicEventSearch.trim().toLowerCase()))
      && (!publicEventMonth || event.event_start_date?.slice(0, 7) === publicEventMonth);
  });
  const activeEventMemberships = eventMemberships.filter(membership => selectedEvent
    && membership.client_id === selectedEvent.client_id
    && (!membership.event_id || membership.event_id === selectedEvent.id));
  const canOpenOps = Boolean(selectedEvent && (isPlatformAdmin || activeEventMemberships.some(membership => ['client_admin','event_admin','ops'].includes(membership.role))));
  const canOpenQueue = Boolean(selectedEvent && (isPlatformAdmin || activeEventMemberships.some(membership => ['client_admin','event_admin','ops','staff'].includes(membership.role))));

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
            {session ? <>Choose your<br /><em style={{ color:GOLD_PALE, fontWeight:500 }}>workspace.</em></> : publicAccessView !== 'events' ? <>Team<br /><em style={{ color:GOLD_PALE, fontWeight:500 }}>access.</em></> : selectedEvent?.accessCode ? <>Your event<br /><em style={{ color:GOLD_PALE, fontWeight:500 }}>services.</em></> : publicEventSlug ? <>Enter your<br /><em style={{ color:GOLD_PALE, fontWeight:500 }}>event code.</em></> : <>Welcome to<br /><em style={{ color:GOLD_PALE, fontWeight:500 }}>APEXOPS<sup className="access-brand-trademark">™</sup>.</em></>}
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
        {!session && <>
          <nav className="public-access-tabs" aria-label="Access options" style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:24 }}>
            {[['events','Events'],['team','Team sign in'],['clients','Organisers']].map(([view,label])=><button key={view} type="button" aria-current={publicAccessView === view ? 'page' : undefined} onClick={()=>setPublicAccessView(view)} style={{ background:publicAccessView === view ? GOLD_PALE : 'rgba(255,255,255,.07)', color:publicAccessView === view ? NAVY : '#fff', border:'1px solid rgba(255,255,255,.28)', borderRadius:4, padding:'10px 14px', fontWeight:700, cursor:'pointer' }}>{label}</button>)}
          </nav>
          {publicAccessView === 'events' ? <div className="public-event-gate">
          {selectedEvent?.accessCode ? <div className="public-event-verified">
            <div className="public-event-unlocked">
              <div><span>Event access verified</span><strong>{selectedEvent.clients?.name ? `${selectedEvent.clients.name} · ` : ''}{selectedEvent.name}</strong></div>
              {privacyAcknowledged && <button type="button" onClick={()=>selectPublicEvent('')}>Change event</button>}
            </div>
            {!privacyAcknowledged && <section className="privacy-notice-panel" aria-labelledby="privacy-notice-title">
              <h2 id="privacy-notice-title">Privacy notice</h2>
              <p>The event organiser and Executive Conference Events use the company, stand, contact details, issue details, and rebooking preferences you provide to administer this event, route requests, and contact you about them.</p>
              <p>Your request may be shared with authorised event operations staff and service providers assigned to respond. Information is retained for event delivery and applicable legal record-keeping, then deleted when no longer needed. Do not enter identity numbers, payment details, medical information, or other sensitive personal information in these forms.</p>
              <p>For access, correction, deletion, or privacy questions, contact your event organiser using the contact details on your event invitation.</p>
              <label><input type="checkbox" checked={privacyNoticeChecked} onChange={event=>setPrivacyNoticeChecked(event.target.checked)} /> <span>I have read and acknowledge this privacy notice.</span></label>
              <button type="button" onClick={acknowledgePrivacyNotice} disabled={!privacyNoticeChecked}>Continue to event services</button>
            </section>}
            {privacyAcknowledged && <div className="public-event-services">
              <section className="public-event-service-group">
                <h2>Suppliers &amp; exhibitors</h2>
                <RoleCard icon={<ClipboardPlus size={24} strokeWidth={1.8} />} title="Log a Query" sub="Suppliers and exhibitors can report an event issue" onClick={()=>openPublicRole('client-query')} light />
              </section>
              <section className="public-event-service-group public-event-exhibitor-group">
                <h2>Exhibitors</h2>
                <div className="public-event-exhibitor-options">
                  <RoleCard icon={<Monitor size={24} strokeWidth={1.8} />} title="Check My Status" sub="Find your stand’s live service requests" onClick={()=>openPublicRole('exhibitor')} light />
                  <RoleCard icon={<Building2 size={24} strokeWidth={1.8} />} title="Rebook Your Stand" sub={`Register interest in ${selectedEvent?.next_event_name || 'the next event'}`} onClick={()=>openPublicRole('rebooking')} light />
                </div>
              </section>
            </div>}
          </div> : publicEventSlug ? <div className="public-event-code-step">
            <div className="public-event-selected-card">
              <div><span>{selectedPublicEvent?.client_name || 'Selected client'}</span><strong>{selectedPublicEvent?.event_name || publicEventSlug}</strong><small>{selectedPublicEvent?.event_start_date} to {selectedPublicEvent?.event_end_date}</small></div>
              <button type="button" onClick={()=>selectPublicEvent('')} disabled={verifyingPublicEvent}>Change</button>
            </div>
            <label htmlFor="public-event-code">Event code</label>
            <div className="public-event-code-row">
              <input id="public-event-code" autoComplete="off" value={publicAccessCode} onChange={event=>setPublicAccessCode(event.target.value.toUpperCase())} placeholder="Enter the code from your organiser" disabled={eventLoading || verifyingPublicEvent} />
              <button type="button" onClick={verifyPublicEvent} disabled={eventLoading || verifyingPublicEvent || !publicEventSlug || !publicAccessCode.trim()}>{verifyingPublicEvent ? 'Checking...' : 'Continue'}</button>
            </div>
          </div> : <>
            <div className="public-event-list-heading">Upcoming events</div>
            <div className="public-event-filters">
              <input type="search" aria-label="Search events" placeholder="Search events or organizers" value={publicEventSearch} onChange={event=>setPublicEventSearch(event.target.value)} disabled={eventLoading} />
              <select aria-label="Filter events by month" value={publicEventMonth} onChange={event=>setPublicEventMonth(event.target.value)} disabled={eventLoading}>
                <option value="">All months</option>
                {publicEventMonths.map(month=><option key={month} value={month}>{new Date(`${month}-01T12:00:00`).toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</option>)}
              </select>
            </div>
            {eventLoading ? <p>Loading events...</p> : <div className="public-event-cards">
              {filteredPublicEvents.map(event => <button className="public-event-card" key={event.slug} type="button" onClick={()=>selectPublicEvent(event.slug)}>
                <span>{event.client_name}</span>
                <strong>{event.event_name}</strong>
                <small>{event.event_start_date} to {event.event_end_date}</small>
                <b>Choose event <span aria-hidden="true">›</span></b>
              </button>)}
              {!filteredPublicEvents.length && <p className="public-events-empty">No events match this search or month.</p>}
            </div>}
          </>}
          {!eventLoading && !publicEvents.length && <p>No public events are available yet.</p>}
          </div> : <div className="team-access-panel">
            <TeamLogin onSignedIn={setSession} initiallyOpen title={publicAccessView === 'clients' ? 'Organiser sign in' : 'Team sign in'} />
            <button type="button" onClick={()=>setPublicAccessView('events')} style={{ marginTop:12, background:'transparent', color:'rgba(255,255,255,.75)', border:0, cursor:'pointer' }}><ArrowLeft size={14} /> Back to events</button>
          </div>}
        </>}
        {eventError && <div className="event-context-error" role="alert">{eventError}</div>}

        {session && <div className="access-hub-choice-heading" style={{ textAlign:'left', marginBottom:20 }}>
          <div style={{ color:'rgba(255,255,255,.48)', fontSize:10, letterSpacing:2.2, textTransform:'uppercase' }}>Operations access</div>
        </div>}
      </div>

      {session && <div className="access-card-stack access-card-grid" style={{ display:'flex', flexDirection:'column', gap:10, width:420, maxWidth:'100%', position:'relative', zIndex:1 }}>
        {session && canOpenOps && <RoleCard icon={<Monitor size={24} strokeWidth={1.8} />} title="Ops Portal" sub="Manage requests and event operations" onClick={()=>setRole('ops')} primary disabled={!selectedEvent || eventLoading} />}
        {session && canOpenQueue && <RoleCard icon={<HardHat size={24} strokeWidth={1.8} />} title="My Queue" sub="See your event assignments and update status" onClick={()=>setRole('dept')} light disabled={!selectedEvent || eventLoading} />}
        {session && canManageTenants && <RoleCard icon={<Building2 size={24} strokeWidth={1.8} />} title={isPlatformAdmin ? 'Organisers' : 'Organiser tools'} sub={isPlatformAdmin ? 'Manage paid client organisations, events and invitations' : 'Create events and manage your organisation’s team'} onClick={()=>setRole('tenant-admin')} light />}
        {session && selectedEvent && !canOpenOps && !canOpenQueue && <p className="event-access-help">No staff access is assigned to this event. Contact your organizer.</p>}
      </div>}

      <div className="access-hub-footer" style={{ color:'rgba(255,255,255,.32)', fontSize:10, letterSpacing:.4, marginTop:48, position:'relative', zIndex:1 }}>
        APEXOPS™ © 2026 Executive Conference Events (Pty) Ltd · All rights reserved
      </div>
    </div>
  );
}
function TeamLogin({ onSignedIn, initiallyOpen = false, title = 'Team sign in' }) {
  const [open, setOpen] = useState(initiallyOpen);
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
    <strong style={{ color:NAVY, fontSize:13 }}>{title}</strong>
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
