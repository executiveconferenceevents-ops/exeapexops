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
import { ArrowLeft, Building2, CheckCircle2, ClipboardPlus, HardHat, LayoutDashboard, LogIn, LogOut, Monitor } from 'lucide-react';
import { AppShell, PageHeader, ServiceCard, StatusBadge } from './components/AppShell';
import { NAVY, NAVY_DEEP, GOLD, GOLD_PALE, FONT, DISPLAY_FONT } from './theme';

const PRIVACY_NOTICE_VERSION = '2026-10-04-v1';

// ── Role selector / login screen ──────────────────────────────────────────────
// In production this becomes a real Supabase auth login.
// For now: pick your role to enter the right view.

export default function App() {
  const [role, setRole] = useState(null);
  const [session, setSession] = useState(null);
  const [loginDestination, setLoginDestination] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [canManageTenants, setCanManageTenants] = useState(false);
  const [events, setEvents] = useState([]);
  const [eventMemberships, setEventMemberships] = useState([]);
  const [publicEvents, setPublicEvents] = useState([]);
  const [publicEventSlug, setPublicEventSlug] = useState('');
  const [publicAccessView, setPublicAccessView] = useState(() => new URLSearchParams(window.location.search).has('admin') ? 'clients' : 'events');
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
    if (/type=(invite|recovery)/.test(window.location.hash)) setRecovering(true);
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((authEvent, nextSession) => {
      if (authEvent === 'PASSWORD_RECOVERY') setRecovering(true);
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
    setPublicAccessView('events');
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

  function openStaffExhibitorView(nextRole) {
    if (!selectedEvent?.exhibitor_code) return;
    setActiveEvent({ ...selectedEvent, accessCode: selectedEvent.exhibitor_code });
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

  useEffect(() => {
    if (!session || !loginDestination || eventLoading) return;

    if (loginDestination === 'clients') {
      if (isPlatformAdmin) setRole('tenant-admin');
      else setEventError('This account does not have Admin access. Clients can manage their events from the Event Manager card after signing in on the Operations tab.');
    } else if (loginDestination === 'organiser') {
      if (!selectedEvent) {
        setEventError(events.length
          ? 'Choose an event from Event workspace to continue.'
          : 'No event access is assigned to this account. Ask the platform owner to invite this email.');
      } else if (canOpenOps) {
        setRole('ops');
      } else {
        setEventError('This account does not have Operations access for the selected event.');
      }
    } else if (loginDestination === 'team') {
      if (!selectedEvent) {
        setEventError(events.length
          ? 'Choose an event from Event workspace to continue.'
          : 'No event access is assigned to this account. Ask the client to invite this email.');
      } else if (canOpenQueue) {
        setRole('dept');
      } else {
        setEventError('This account has no staff access for the selected event. Ask the client to update its invitation.');
      }
    }

    setLoginDestination(null);
  }, [session, loginDestination, eventLoading, isPlatformAdmin, canManageTenants, selectedEvent, events.length, canOpenOps, canOpenQueue]);

  if (!authReady) return null;
  if (session && recovering) return <SetPasswordScreen onDone={()=>{ setRecovering(false); window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search); }} />;
  if (role === 'exhibitor') return <WithBack onBack={()=>setRole(null)} onSignOut={session ? signOut : undefined}><ExhibitorStatus /></WithBack>;
  if (role === 'client-query') return <WithBack onBack={()=>setRole(null)} onSignOut={session ? signOut : undefined}><ClientQuery /></WithBack>;
  if (role === 'rebooking') {
    const rebookingNav = [
      { key:'overview', label:session ? 'Workspace' : 'Overview', Icon:LayoutDashboard, onClick:()=>setRole(null) },
      { key:'query', label:'Log a Query', Icon:ClipboardPlus, onClick:()=>setRole('client-query') },
      { key:'status', label:'Check My Status', Icon:Monitor, onClick:()=>setRole('exhibitor') },
      { key:'rebook', label:'Rebook Your Stand', Icon:Building2, active:true },
    ];
    return <AppShell eventName={selectedEvent?.name} nav={rebookingNav} onSignOut={session ? signOut : undefined}><RebookingForm /></AppShell>;
  }
  if (session && role === 'tenant-admin' && canManageTenants) return <WithBack onBack={()=>setRole(canOpenOps ? 'ops' : null)} onSignOut={signOut}><ClientEventAdmin /></WithBack>;
  if (session && role === 'ops') return <WithBack onBack={()=>setRole(null)} onSignOut={signOut}><OpsPortal onOpenStaff={()=>setRole('staff')} onOpenExhibitors={()=>setRole('exhibitors')} /></WithBack>;
  if (session && role === 'staff') return <WithBack onBack={()=>setRole('ops')} onSignOut={signOut}><StaffSetup /></WithBack>;
    if (session && role === 'people') return <WithBack onBack={()=>setRole('ops')} onSignOut={signOut}><PeopleSetup onBack={()=>setRole('ops')} /></WithBack>;
  if (session && role === 'exhibitors') return <WithBack onBack={()=>setRole('ops')} onSignOut={signOut}><ExhibitorSetup onBack={()=>setRole('ops')} /></WithBack>;
  if (session && role === 'dept') return <WithBack onBack={()=>setRole(null)} onSignOut={signOut}><DeptQueue /></WithBack>;

  if (session && !role) {
    const hubItems = [
      canOpenOps && { key:'ops', label:'Ops Portal', Icon:Monitor, description:'Operations: manage requests and event operations', action:()=>setRole('ops'), needsEvent:true },
      canOpenQueue && { key:'dept', label:'My Queue', Icon:HardHat, description:'Staff: see your assignments and update status', action:()=>setRole('dept'), needsEvent:true },
      isPlatformAdmin && { key:'admin', label:'Admin Portal', Icon:Building2, description:'Platform back end: manage clients, events, invitations and suppliers', action:()=>setRole('tenant-admin') },
      canManageTenants && !isPlatformAdmin && { key:'events', label:'Event Manager', Icon:Building2, description:'Create your events and manage your team and suppliers', action:()=>setRole('tenant-admin') },
      selectedEvent && canOpenOps && { key:'exhibitor', label:'Exhibitor Status', Icon:Monitor, description:'See what exhibitors see for this event', action:()=>openStaffExhibitorView('exhibitor') },
      selectedEvent && canOpenOps && { key:'query', label:'Log a Query', Icon:ClipboardPlus, description:'Log a query on behalf of an exhibitor', action:()=>openStaffExhibitorView('client-query') },
    ].filter(Boolean);
    const hubNav = [
      { key:'overview', label:'Overview', Icon:LayoutDashboard, active:true },
      ...hubItems.map(item => ({ key:item.key, label:item.label, Icon:item.Icon, onClick:item.action, disabled:item.needsEvent && (!selectedEvent || eventLoading) })),
    ];
    return (
      <AppShell eventName={selectedEvent?.name} nav={hubNav} onSignOut={signOut}>
        <PageHeader title="Choose your workspace" subtitle="Open the area you work in for the selected event." />
        <div className="event-card">
          <div>
            <label className="event-label" htmlFor="active-event">Active event</label>
            <h2>{selectedEvent?.name || (eventLoading ? 'Loading your events...' : 'No event selected')}</h2>
          </div>
          <div className="event-actions">
            <select id="active-event" value={selectedEvent?.id || ''} onChange={event=>selectEvent(event.target.value)} disabled={eventLoading}>
              <option value="">{eventLoading ? 'Loading your events...' : 'Select an event'}</option>
              {events.map(event => <option key={event.id} value={event.id}>{event.clients?.name ? `${event.clients.name} · ` : ''}{event.name}</option>)}
            </select>
          </div>
        </div>
        {eventError && <div className="shell-alert" role="alert">{eventError}</div>}
        {!eventLoading && !events.length && !canManageTenants && <p className="shell-note">No event access is assigned to this account.</p>}
        {selectedEvent && !canOpenOps && !canOpenQueue && <p className="shell-note">No staff access is assigned to this event. Contact your client administrator.</p>}
        <div className="svc-grid">
          {hubItems.map(item => <ServiceCard key={item.key} icon={item.Icon} title={item.label} description={item.description} onClick={item.action} disabled={item.needsEvent && (!selectedEvent || eventLoading)} />)}
        </div>
      </AppShell>
    );
  }

  if (!session && publicAccessView === 'events' && selectedEvent?.accessCode) {
    const servicesReady = privacyAcknowledged;
    const exhibitorNav = [
      { key:'overview', label:'Overview', Icon:LayoutDashboard, active:true },
      { key:'query', label:'Log a Query', Icon:ClipboardPlus, onClick:()=>openPublicRole('client-query'), disabled:!servicesReady },
      { key:'status', label:'Check My Status', Icon:Monitor, onClick:()=>openPublicRole('exhibitor'), disabled:!servicesReady },
      { key:'rebook', label:'Rebook Your Stand', Icon:Building2, onClick:()=>openPublicRole('rebooking'), disabled:!servicesReady },
    ];
    return (
      <AppShell eventName={selectedEvent.name} nav={exhibitorNav}>
        <PageHeader title="Exhibitor services" subtitle="Report issues, follow your requests and plan your next event." />
        <div className="event-card">
          <div>
            <span className="event-label">Active event</span>
            <h2>{selectedEvent.name}</h2>
          </div>
          <div className="event-actions">
            <StatusBadge icon={CheckCircle2}>Event access verified</StatusBadge>
            <button type="button" className="shell-secondary" onClick={()=>selectPublicEvent('')}>Change event</button>
          </div>
        </div>
        {eventError && <div className="shell-alert" role="alert">{eventError}</div>}
        {!servicesReady ? <section className="shell-panel" aria-labelledby="privacy-notice-title">
          <h2 id="privacy-notice-title">Privacy notice</h2>
          <p>The event organiser and Executive Conference Events use the company, stand, contact details, issue details, and rebooking preferences you provide to administer this event, route requests, and contact you about them.</p>
          <p>Your request may be shared with authorised event operations staff and service providers assigned to respond. Information is retained for event delivery and applicable legal record-keeping, then deleted when no longer needed. Do not enter identity numbers, payment details, medical information, or other sensitive personal information in these forms.</p>
          <p>For access, correction, deletion, or privacy questions, contact your event organiser using the contact details on your event invitation.</p>
          <label className="shell-check"><input type="checkbox" checked={privacyNoticeChecked} onChange={event=>setPrivacyNoticeChecked(event.target.checked)} /> <span>I have read and acknowledge this privacy notice.</span></label>
          <button type="button" className="shell-primary" onClick={acknowledgePrivacyNotice} disabled={!privacyNoticeChecked}>Continue to event services</button>
        </section> : <div className="svc-grid">
          <ServiceCard icon={ClipboardPlus} eyebrow="Report an issue" title="Log a Query" description="Report an event issue for your stand, with photos if helpful." onClick={()=>openPublicRole('client-query')} />
          <ServiceCard icon={Monitor} eyebrow="Exhibitor status" title="Check My Status" description="Find your stand’s live service requests." onClick={()=>openPublicRole('exhibitor')} />
          <ServiceCard icon={Building2} eyebrow="Future events" title="Rebook Your Stand" description={`Register interest in ${selectedEvent.next_event_name || 'the next event'}.`} onClick={()=>openPublicRole('rebooking')} />
        </div>}
      </AppShell>
    );
  }

  if (!session && publicAccessView === 'clients') return (
    <div style={{ fontFamily:FONT, minHeight:'100vh', display:'grid', placeItems:'center', padding:24, background:`linear-gradient(135deg, ${NAVY_DEEP} 0%, ${NAVY} 100%)` }}>
      <div style={{ width:'100%', maxWidth:400 }}>
        <div style={{ textAlign:'center', marginBottom:24, color:'#fff' }}>
          <div style={{ fontFamily:DISPLAY_FONT, fontSize:30, fontWeight:700, letterSpacing:1 }}>APEXOPS™</div>
          <div style={{ marginTop:6, color:GOLD_PALE, fontSize:11, letterSpacing:2.4, textTransform:'uppercase' }}>Platform admin</div>
        </div>
        <TeamLogin onSignedIn={nextSession=>{ setLoginDestination('clients'); setSession(nextSession); }} initiallyOpen title="Admin sign in" />
        {eventError && <div className="event-context-error" role="alert" style={{ marginTop:12 }}>{eventError}</div>}
        <button type="button" onClick={()=>setPublicAccessView('events')} style={{ display:'block', margin:'18px auto 0', background:'transparent', color:'rgba(255,255,255,.7)', border:0, cursor:'pointer', fontSize:12 }}><ArrowLeft size={14} /> Back to events</button>
      </div>
    </div>
  );

  return (
    <div className="access-page access-login" style={{
      fontFamily:FONT, minHeight:'100vh', color:'#fff', position:'relative', overflow:'hidden',
      background:`radial-gradient(circle at 90% 12%, rgba(180,154,106,.14), transparent 28%), linear-gradient(120deg, ${NAVY_DEEP} 0%, ${NAVY} 58%, #273958 100%)`,
      display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'56px 24px 32px',
    }}>
      <div className="access-hub-content" style={{ width:'100%', maxWidth:980, position:'relative', zIndex:1 }}>
        <div className="access-hub-eyebrow" style={{ color:GOLD_PALE, fontSize:11, letterSpacing:3.2, textTransform:'uppercase', marginBottom:24 }}>
          Executive Conference Events · APEXOPS™
        </div>
        <div className="access-hub-intro" style={{ maxWidth:620, marginBottom:42 }}>
          <div className="access-hub-headline" style={{ fontFamily:DISPLAY_FONT, fontWeight:600, fontSize:'clamp(48px, 8vw, 88px)', lineHeight:.84, letterSpacing:-1.5 }}>
            {publicAccessView === 'clients' ? <>Admin<br /><em style={{ color:GOLD_PALE, fontWeight:500 }}>portal.</em></> : publicAccessView === 'organiser' ? <>Event<br /><em style={{ color:GOLD_PALE, fontWeight:500 }}>operations.</em></> : publicAccessView === 'team' ? <>Staff<br /><em style={{ color:GOLD_PALE, fontWeight:500 }}>queue.</em></> : publicEventSlug ? <>Enter your<br /><em style={{ color:GOLD_PALE, fontWeight:500 }}>event code.</em></> : <>Find your<br /><em style={{ color:GOLD_PALE, fontWeight:500 }}>event.</em></>}
          </div>
          <div style={{ width:54, height:3, background:GOLD, marginTop:30, marginBottom:18 }} />
          <div className="access-hub-subtitle" style={{ fontFamily:DISPLAY_FONT, fontStyle:'italic', color:'rgba(255,255,255,.72)', fontSize:19 }}>
            {publicAccessView === 'clients' ? 'Sign in to manage clients, events, teams and suppliers.' : publicAccessView === 'organiser' ? 'Sign in to run requests and operations for your event.' : publicAccessView === 'team' ? 'Sign in to see and update the jobs assigned to you.' : publicEventSlug ? 'Enter the code provided by your organiser to continue.' : 'Select an event, then enter your organiser-issued code to access services.'}
          </div>
        </div>

        {!session && <>
          <div className="public-access-panel">
          <nav className="public-access-tabs" aria-label="Access options" style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:24 }}>
            {[['events','Exhibitors'],['team','Staff'],['organiser','Operations']].map(([view,label])=><button key={view} type="button" aria-current={publicAccessView === view ? 'page' : undefined} onClick={()=>setPublicAccessView(view)} style={{ background:publicAccessView === view ? GOLD_PALE : 'rgba(255,255,255,.07)', color:publicAccessView === view ? NAVY : '#fff', border:'1px solid rgba(255,255,255,.28)', borderRadius:4, padding:'10px 14px', fontWeight:700, cursor:'pointer' }}>{label}</button>)}
          </nav>
          {publicAccessView === 'events' ? <div className="public-event-gate">
          {publicEventSlug ? <div className="public-event-code-step">
            <div className="public-event-selected-card">
              <div><strong>{selectedPublicEvent?.event_name || publicEventSlug}</strong><small>{formatEventDateRange(selectedPublicEvent?.event_start_date, selectedPublicEvent?.event_end_date)}</small></div>
              <button type="button" onClick={()=>selectPublicEvent('')} disabled={verifyingPublicEvent}>Change</button>
            </div>
            <label htmlFor="public-event-code">Event code</label>
            <div className="public-event-code-row">
              <input id="public-event-code" autoComplete="off" value={publicAccessCode} onChange={event=>setPublicAccessCode(event.target.value.toUpperCase())} placeholder="Enter the code from your organiser" disabled={eventLoading || verifyingPublicEvent} />
              <button type="button" onClick={verifyPublicEvent} disabled={eventLoading || verifyingPublicEvent || !publicEventSlug || !publicAccessCode.trim()}>{verifyingPublicEvent ? 'Checking...' : 'Continue'}</button>
            </div>
          </div> : <>
            <div className="public-event-list-heading">All events</div>
            <div className="public-event-filters">
              <input type="search" aria-label="Search events" placeholder="Search events or organisers" value={publicEventSearch} onChange={event=>setPublicEventSearch(event.target.value)} disabled={eventLoading} />
              <select aria-label="Filter events by month" value={publicEventMonth} onChange={event=>setPublicEventMonth(event.target.value)} disabled={eventLoading}>
                <option value="">All months</option>
                {publicEventMonths.map(month=><option key={month} value={month}>{new Date(`${month}-01T12:00:00`).toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</option>)}
              </select>
            </div>
            {eventLoading ? <p>Loading events...</p> : <div className="public-event-cards">
              {filteredPublicEvents.map(event => <button className="public-event-card" key={event.slug} type="button" onClick={()=>selectPublicEvent(event.slug)}>
                <div className="public-event-card-heading">
                  <span className="public-event-logo" aria-hidden="true">{event.logo_url ? <img src={event.logo_url} alt="" /> : <b>{getEventInitials(event.event_name)}</b>}</span>
                </div>
                <strong>{event.event_name}</strong>
                <div className="public-event-schedule" aria-label="Event schedule">
                  <span><b>Build-up</b><time>{formatEventDateRange(event.build_up_start_date, event.build_up_end_date)}</time></span>
                  <span><b>Event</b><time>{formatEventDateRange(event.event_start_date, event.event_end_date)}</time></span>
                  <span><b>Breakdown</b><time>{formatEventDateRange(event.breakdown_start_date, event.breakdown_end_date)}</time></span>
                </div>
                <b>Choose event <span aria-hidden="true">›</span></b>
              </button>)}
              {!filteredPublicEvents.length && <p className="public-events-empty">No events match this search or month.</p>}
            </div>}
          </>}
          {!eventLoading && !publicEvents.length && <p>No public events are available yet.</p>}
          </div> : <div className="team-access-panel">
            <TeamLogin onSignedIn={nextSession=>{ setLoginDestination(publicAccessView); setSession(nextSession); }} initiallyOpen title={{ clients:'Admin sign in', organiser:'Operations sign in', team:'Staff sign in' }[publicAccessView]} />
            <button type="button" onClick={()=>setPublicAccessView('events')} style={{ marginTop:12, background:'transparent', color:'rgba(255,255,255,.75)', border:0, cursor:'pointer' }}><ArrowLeft size={14} /> Back to events</button>
          </div>}
          {eventError && <div className="event-context-error" role="alert">{eventError}</div>}
          </div>
        </>}
      </div>

      {!session && publicAccessView !== 'clients' && <button type="button" onClick={()=>setPublicAccessView('clients')} style={{ position:'absolute', right:16, bottom:12, zIndex:2, background:'transparent', border:0, color:'rgba(27,42,74,.45)', fontSize:10, letterSpacing:1, cursor:'pointer' }}>Admin</button>}
      <div className="access-hub-footer" style={{ color:'rgba(255,255,255,.32)', fontSize:10, letterSpacing:.4, marginTop:48, position:'relative', zIndex:1 }}>
        APEXOPS™ © 2026 Executive Conference Events (Pty) Ltd · All rights reserved
      </div>
    </div>
  );
}
function formatEventDateRange(startDate, endDate) {
  const formatDate = value => value
    ? new Date(`${value}T12:00:00`).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
    : '';
  const start = formatDate(startDate);
  const end = formatDate(endDate);
  if (start && end && start !== end) return `${start} - ${end}`;
  return start || end || 'To be confirmed';
}

function getEventInitials(name) {
  const words = String(name || '').split(/\s+/).filter(Boolean);
  if (/^[A-Z0-9]{3,}$/.test(words[0] || '')) return words[0].slice(0, 3);
  return words.slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'EV';
}

function TeamLogin({ onSignedIn, initiallyOpen = false, title = 'Team sign in' }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetMode, setResetMode] = useState(false);

  async function sendReset(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (DEMO_MODE || !supabase) {
      setNotice('Password reset is not available in demo mode.');
      return;
    }
    const appUrl = process.env.REACT_APP_APP_URL || (window.location.protocol.startsWith('http') ? window.location.origin : '');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), appUrl ? { redirectTo: appUrl } : undefined);
    if (resetError) setError(resetError.message);
    else setNotice('If that email has an account, a reset link is on its way. Check your inbox.');
  }

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
  return <form className="team-login-form" onSubmit={resetMode ? sendReset : signIn} style={{ background:'#fff', borderRadius:8, padding:16, display:'grid', gap:8 }}>
    <strong style={{ color:NAVY, fontSize:13 }}>{resetMode ? 'Reset your password' : title}</strong>
    <input required type="email" placeholder="Work email" value={email} onChange={e=>setEmail(e.target.value)} />
    {!resetMode && <input required type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />}
    {error && <span style={{ color:'#C0392B', fontSize:11 }}>{error}</span>}
    {notice && <span style={{ color:'#1E8449', fontSize:12 }}>{notice}</span>}
    <button type="submit" style={{ background:NAVY, color:'#fff', border:'none', borderRadius:6, padding:9, fontWeight:700, cursor:'pointer' }}>{resetMode ? 'Send reset link' : <><LogIn size={14} /> Sign in</>}</button>
    <button type="button" onClick={()=>{ setResetMode(mode => !mode); setError(''); setNotice(''); }} style={{ background:'transparent', border:0, color:'#64778a', fontSize:12, cursor:'pointer', textDecoration:'underline' }}>{resetMode ? 'Back to sign in' : 'Forgot password?'}</button>
  </form>;
}

function SetPasswordScreen({ onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(event) {
    event.preventDefault();
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setSaving(true);
    setError('');
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) setError(updateError.message);
    else onDone();
  }

  return <div style={{ fontFamily:FONT, minHeight:'100vh', display:'grid', placeItems:'center', padding:24, background:`linear-gradient(135deg, ${NAVY_DEEP} 0%, ${NAVY} 100%)` }}>
    <form className="team-login-form" onSubmit={save} style={{ width:'100%', maxWidth:400, background:'#fff', borderRadius:8, padding:24, display:'grid', gap:10 }}>
      <strong style={{ color:NAVY, fontSize:16 }}>Set your password</strong>
      <span style={{ color:'#64778a', fontSize:12 }}>Choose a password to finish setting up your account.</span>
      <input required type="password" autoComplete="new-password" placeholder="New password" value={password} onChange={e=>setPassword(e.target.value)} />
      <input required type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={e=>setConfirm(e.target.value)} />
      {error && <span style={{ color:'#C0392B', fontSize:12 }}>{error}</span>}
      <button type="submit" disabled={saving} style={{ background:NAVY, color:'#fff', border:'none', borderRadius:6, padding:10, fontWeight:700, cursor:'pointer' }}>{saving ? 'Saving...' : 'Save password'}</button>
    </form>
  </div>;
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
