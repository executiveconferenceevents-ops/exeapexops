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
import ExhibitorServices from './views/ExhibitorServices';
import Deliveries from './views/Deliveries';
import ExhibitorShop from './views/ExhibitorShop';
import ExhibitorPortal from './views/ExhibitorPortal';
import { supabase } from './lib/supabase';
import { DEMO_MODE } from './lib/demoStore';
import { getDemoAccess, getDemoAccountsForPortal, authenticateDemoAccount } from './lib/demoAccounts';
import { clearActiveEvent, getActiveEvent, getAvailableEvents, getEventAccessCode, getEventSlug, getPublicEvents, getUserEventAccess, PRIVACY_NOTICE_VERSION, resolvePublicEvent, setActiveEvent } from './lib/eventScope';
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, ClipboardPlus, Eye, HardHat, Home, LayoutDashboard, LogIn, LogOut, Mail, Monitor, PackageCheck, ShieldCheck, ShoppingBag, Ticket, Truck, Users } from 'lucide-react';
import { AppShell, PageHeader, ServiceCard, StatusBadge, Wordmark } from './components/AppShell';
import LoginLayout from './components/LoginLayout';
import ClientRegistrationForm from './components/ClientRegistrationForm';
import HomeOverview from './components/HomeOverview';
import { forgetExhibitorPass, loadExhibitorPass, loadExhibitorStand, saveExhibitorPass } from './lib/exhibitorPass';
import './styles/apex-brand.css';

export default function App() {
  const [role, setRole] = useState(null);
  const [openOpsQueryId, setOpenOpsQueryId] = useState('');
  const [session, setSession] = useState(null);
  const [loginDestination, setLoginDestination] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [canManageTenants, setCanManageTenants] = useState(false);
  const [events, setEvents] = useState([]);
  const [eventMemberships, setEventMemberships] = useState([]);
  const [eventContextReadyFor, setEventContextReadyFor] = useState('');
  const [publicEvents, setPublicEvents] = useState([]);
  const [publicEventSlug, setPublicEventSlug] = useState('');
  const [publicAccessView, setPublicAccessView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('admin') ? 'clients' : params.has('event') ? 'events' : 'home';
  });
  const [adminReturnView, setAdminReturnView] = useState('home');
  const [publicEventSearch, setPublicEventSearch] = useState('');
  const [publicEventMonth, setPublicEventMonth] = useState('');
  const [publicAccessCode, setPublicAccessCode] = useState('');
  const [verifyingPublicEvent, setVerifyingPublicEvent] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [privacyNoticeChecked, setPrivacyNoticeChecked] = useState(false);
  const [privacyAcknowledgementId, setPrivacyAcknowledgementId] = useState('');
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
    if (!authReady) return undefined;
    let cancelled = false;
    setEventContextReadyFor('');
    setEventLoading(true);
    setEventError('');
    const loadEventContext = async () => {
      try {
        if (session) {
          let platformAdmin = false;
          let organizationAdmin = false;
          let currentMemberships = [];
          if (DEMO_MODE) {
            const accessContext = getDemoAccess(session.user?.demoRole);
            platformAdmin = accessContext.platformAdmin;
            currentMemberships = accessContext.memberships;
            organizationAdmin = currentMemberships.some(membership => membership.role === 'client_admin' && !membership.event_id);
          } else if (supabase) {
            const accessContext = await getUserEventAccess(session.user?.id);
            if (cancelled) return;
            platformAdmin = accessContext.platformAdmin;
            currentMemberships = accessContext.memberships;
            organizationAdmin = currentMemberships.some(membership => membership.role === 'client_admin' && !membership.event_id);
          }
          if (cancelled) return;
          let availableEvents = [];
          try {
            availableEvents = await getAvailableEvents();
          } catch (eventLoadError) {
            if (!platformAdmin) throw eventLoadError;
            setEventError(eventLoadError?.message || 'Could not load events for this account.');
          }
          if (cancelled) return;
          const workspaceEvents = platformAdmin
            ? availableEvents.filter(event => event.billing_exempt || currentMemberships.some(membership => membership.client_id === event.client_id && (!membership.event_id || membership.event_id === event.id)))
            : availableEvents;
          setIsPlatformAdmin(platformAdmin);
          setCanManageTenants(organizationAdmin);
          setEventMemberships(currentMemberships);
          setEvents(workspaceEvents);
          const currentEvent = getActiveEvent();
          const nextEvent = workspaceEvents.find(event => event.slug === getEventSlug())
            || workspaceEvents.find(event => event.id === currentEvent?.id)
            || (workspaceEvents.length === 1 ? workspaceEvents[0] : null);
          const demoExhibitor = DEMO_MODE && session.user?.demoRole === 'exhibitor';
          const selectedWorkspaceEvent = demoExhibitor && nextEvent
            ? {
              ...nextEvent,
              accessCode:nextEvent.exhibitor_code,
              privacyNoticeVersion:PRIVACY_NOTICE_VERSION,
              privacyAcknowledgementId:'demo-exhibitor-acknowledgement',
            }
            : nextEvent;
          setSelectedEvent(selectedWorkspaceEvent);
          setActiveEvent(selectedWorkspaceEvent);
          setPrivacyAcknowledged(demoExhibitor);
          setPrivacyNoticeChecked(demoExhibitor);
          setPrivacyAcknowledgementId(demoExhibitor ? 'demo-exhibitor-acknowledgement' : '');
        } else {
          setEvents([]);
          setEventMemberships([]);
          setIsPlatformAdmin(false);
          setCanManageTenants(false);
          const availablePublicEvents = await getPublicEvents();
          if (cancelled) return;
          setPublicEvents(availablePublicEvents);
          const linkedSlug = new URLSearchParams(window.location.search).get('event') || '';
          setPublicEventSlug(availablePublicEvents.some(event => event.slug === linkedSlug) ? linkedSlug : '');
          setPublicAccessCode('');
          setSelectedEvent(null);
          setPrivacyAcknowledged(false);
          setPrivacyNoticeChecked(false);
          setPrivacyAcknowledgementId('');
          const pass = loadExhibitorPass();
          const adminRequested = new URLSearchParams(window.location.search).has('admin');
          if (pass && !adminRequested && (!linkedSlug || linkedSlug === pass.slug)) {
            try {
              const rememberedEvent = await resolvePublicEvent(pass.slug, pass.accessCode, { requireOnline:true });
              if (cancelled) return;
              if (!rememberedEvent) forgetExhibitorPass();
              else {
                const acknowledged = pass.privacyNoticeVersion === PRIVACY_NOTICE_VERSION && Boolean(pass.privacyAcknowledgementId);
                const restoredEvent = {
                  ...rememberedEvent,
                  privacyNoticeVersion:PRIVACY_NOTICE_VERSION,
                  privacyAcknowledgementId:acknowledged ? pass.privacyAcknowledgementId : crypto.randomUUID(),
                };
                setPublicEventSlug(restoredEvent.slug);
                setSelectedEvent(restoredEvent);
                setActiveEvent(restoredEvent);
                setPrivacyAcknowledgementId(restoredEvent.privacyAcknowledgementId);
                setPrivacyAcknowledged(acknowledged);
                setPublicAccessView('events');
                if (acknowledged && pass.stand) setRole('exhibitor');
              }
            } catch {
              if (!cancelled) setEventError('Could not verify your saved event access. Connect to the internet and try again.');
            }
          }
        }
      } catch (eventLoadError) {
        if (!cancelled) setEventError(eventLoadError?.message || 'Could not load events for this account.');
      } finally {
          if (!cancelled) {
            setEventContextReadyFor(session?.user?.id || '');
            setEventLoading(false);
          }
      }
    };
    loadEventContext();
    return () => { cancelled = true; };
  }, [session, authReady]);

  async function signOut() {
    if (!DEMO_MODE && supabase) await supabase.auth.signOut();
    const homeUrl = new URL(window.location.href);
    homeUrl.searchParams.delete('admin');
    homeUrl.searchParams.delete('event');
    window.history.replaceState(window.history.state, '', `${homeUrl.pathname}${homeUrl.search}${homeUrl.hash}`);
    setSession(null);
    setRole(null);
    setPublicAccessView('home');
    setAdminReturnView('home');
    setSelectedEvent(null);
    setEventMemberships([]);
    setPrivacyAcknowledged(false);
    setPrivacyNoticeChecked(false);
    setPrivacyAcknowledgementId('');
    clearActiveEvent();
  }

  function selectEvent(eventId) {
    const nextEvent = events.find(event => event.id === eventId) || null;
    setSelectedEvent(nextEvent);
    setActiveEvent(nextEvent);
    setRole(null);
  }

  function handleEventCreated(event) {
    const canOpenEventOperations = role !== 'platform-admin' || Boolean(event.billing_exempt);
    setEvents(current => {
      const updatedEvents = [...current.filter(item => item.id !== event.id), event];
      return role === 'platform-admin' ? updatedEvents.filter(item => item.billing_exempt) : updatedEvents;
    });
    setSelectedEvent(canOpenEventOperations ? event : null);
    setActiveEvent(canOpenEventOperations ? event : null);
  }

  function selectPublicEvent(slug) {
    forgetExhibitorPass();
    setPublicEventSlug(slug);
    setPublicAccessCode('');
    setSelectedEvent(null);
    setPrivacyAcknowledged(false);
    setPrivacyNoticeChecked(false);
    setPrivacyAcknowledgementId('');
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
      const previousEvent = getActiveEvent();
      const previouslyAcknowledged = previousEvent?.slug === publicEvent.slug
        && previousEvent?.privacyNoticeVersion === PRIVACY_NOTICE_VERSION
        && Boolean(previousEvent?.privacyAcknowledgementId);
      const verifiedEvent = {
        ...publicEvent,
        privacyNoticeVersion:PRIVACY_NOTICE_VERSION,
        privacyAcknowledgementId:previouslyAcknowledged ? previousEvent.privacyAcknowledgementId : crypto.randomUUID(),
      };
      setSelectedEvent(verifiedEvent);
      setActiveEvent(verifiedEvent);
      setPublicAccessCode('');
      setPrivacyAcknowledged(previouslyAcknowledged);
      setPrivacyAcknowledgementId(verifiedEvent.privacyAcknowledgementId);
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

  async function openStaffExhibitorView(nextRole) {
    if (!selectedEvent?.id) return;
    try {
      const accessCode = selectedEvent.exhibitor_code || await getEventAccessCode(selectedEvent.id);
      if (!accessCode) throw new Error('You do not have permission to open this exhibitor view.');
      setActiveEvent({ ...selectedEvent, accessCode });
      setRole(nextRole);
    } catch (accessError) {
      setEventError(accessError?.message || 'Could not open the exhibitor view.');
    }
  }

  async function acknowledgePrivacyNotice() {
    if (!selectedEvent?.slug || !privacyNoticeChecked) return;
    if (!DEMO_MODE && supabase) {
      const { data, error } = await supabase.rpc('acknowledge_public_event_privacy', {
        requested_event_slug:selectedEvent.slug,
        requested_code:selectedEvent.accessCode,
        requested_acknowledgement_id:privacyAcknowledgementId,
        requested_notice_version:PRIVACY_NOTICE_VERSION,
      });
      if (error || !data) {
        setEventError(error?.message || 'Could not record your acknowledgement. Check your connection and try again.');
        return;
      }
    }
    const acknowledgedEvent = { ...selectedEvent, privacyAcknowledgementId, privacyNoticeVersion:PRIVACY_NOTICE_VERSION };
    setActiveEvent(acknowledgedEvent);
    saveExhibitorPass(acknowledgedEvent);
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
  const demoRole = DEMO_MODE ? session?.user?.demoRole : null;
  const isDemoClient = DEMO_MODE && demoRole === 'client';
  const isDemoExhibitor = DEMO_MODE && demoRole === 'exhibitor';
  const canOpenOps = Boolean(selectedEvent && ((isPlatformAdmin && selectedEvent.billing_exempt) || activeEventMemberships.some(membership => ['client_admin','event_admin','ops'].includes(membership.role)))) && !isDemoClient && !isDemoExhibitor;
  const canOpenQueue = Boolean(selectedEvent && ((isPlatformAdmin && selectedEvent.billing_exempt) || activeEventMemberships.some(membership => ['client_admin','event_admin','ops','staff'].includes(membership.role)))) && !isDemoClient && !isDemoExhibitor;
  const canOpenDeliveries = Boolean(selectedEvent && (canOpenQueue || activeEventMemberships.some(membership => membership.role === 'delivery')));
  const deliveryOnly = canOpenDeliveries && !canOpenQueue && !canOpenOps && !canManageTenants && !isPlatformAdmin;

  useEffect(() => {
    if (!session || !loginDestination || eventLoading || eventContextReadyFor !== (session.user?.id || '')) return;

    if (loginDestination === 'clients') {
      if (isPlatformAdmin) {
        const workspaceUrl = new URL(window.location.href);
        workspaceUrl.searchParams.delete('admin');
        window.history.replaceState(window.history.state, '', `${workspaceUrl.pathname}${workspaceUrl.search}${workspaceUrl.hash}`);
        setRole('platform-admin');
      }
      else setEventError('This account is not assigned Platform Admin access. Ask the platform owner to grant this account access. Client administrators use Client Workspace; Operations accounts use Event Operations.');
    } else if (loginDestination === 'auto') {
      if (!events.length && !isPlatformAdmin && !canManageTenants) {
        setEventError('No event access is assigned to this account. Ask your organiser to invite this email.');
      } else if (selectedEvent && !canOpenOps && !canManageTenants && !isPlatformAdmin && canOpenQueue) {
        setRole('dept');
      } else if (deliveryOnly) {
        setRole('deliveries');
      }
    } else if (loginDestination === 'client') {
      if (canManageTenants) setRole('tenant-admin');
      else setEventError('This account does not have organisation-wide client administrator access. Use Operations or Staff sign in for your assigned event role.');
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
      } else if (deliveryOnly) {
        setRole('deliveries');
      } else {
        setEventError('This account has no staff access for the selected event. Ask the client to update its invitation.');
      }
    } else if (loginDestination === 'exhibitor-demo') {
      if (isDemoExhibitor && selectedEvent?.accessCode) setRole(null);
      else setEventError('This account does not have access to the exhibitor demo workspace.');
    }

    setLoginDestination(null);
  }, [session, loginDestination, eventLoading, eventContextReadyFor, isPlatformAdmin, canManageTenants, selectedEvent, events.length, canOpenOps, canOpenQueue, deliveryOnly, isDemoExhibitor]);

  useEffect(() => {
    if (!session || eventLoading || !role) return;
    const operationsRole = ['ops','staff','people','exhibitors','exhibitor','client-query','rebooking','services','shop'].includes(role);
    const allowed = isDemoExhibitor && ['exhibitor','client-query','rebooking','shop'].includes(role) ? true
      : role === 'platform-admin' ? isPlatformAdmin
      : role === 'tenant-admin' ? canManageTenants
      : role === 'deliveries' ? canOpenDeliveries
      : operationsRole ? canOpenOps
        : role === 'dept' ? canOpenQueue
          : true;
    if (!allowed) setRole(null);
  }, [session, eventLoading, role, isPlatformAdmin, canManageTenants, canOpenOps, canOpenQueue, canOpenDeliveries, isDemoExhibitor]);

  if (!authReady) return null;
  if (session && recovering) return <SetPasswordScreen onDone={()=>{ setRecovering(false); window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search); }} />;
  const portalToken = new URLSearchParams(window.location.search).get('portal');
  if (portalToken) return <ExhibitorPortal token={portalToken} />;
  const needsEvent = !selectedEvent || eventLoading;
  const mainNav = activeKey => (isDemoExhibitor ? [
    { key:'home', label:'Home', Icon:Home, onClick:()=>setRole(null) },
    { key:'client-query', label:'Log a query', Icon:ClipboardPlus, onClick:()=>openPublicRole('client-query') },
    { key:'exhibitor', label:'Check my status', Icon:Monitor, onClick:()=>openPublicRole('exhibitor') },
    { key:'shop', label:'Order furniture', Icon:ShoppingBag, onClick:()=>openPublicRole('shop') },
    { key:'rebooking', label:'Rebook your stand', Icon:Building2, onClick:()=>openPublicRole('rebooking') },
  ] : [
    !deliveryOnly && { key:'home', label:'Home', Icon:Home, onClick:()=>setRole(null) },
    canOpenOps && { key:'ops', label:'Event operations', Icon:LayoutDashboard, onClick:()=>setRole('ops'), disabled:needsEvent },
    canOpenQueue && { key:'dept', label:'My queue', Icon:HardHat, onClick:()=>setRole('dept'), disabled:needsEvent },
    canOpenOps && { key:'staff', label:'Suppliers & staff', Icon:Truck, onClick:()=>setRole('staff'), disabled:needsEvent },
    canOpenOps && { key:'people', label:'People', Icon:Users, onClick:()=>setRole('people'), disabled:needsEvent },
    canOpenOps && { key:'exhibitors', label:'Exhibitors', Icon:Building2, onClick:()=>setRole('exhibitors'), disabled:needsEvent },
    canOpenOps && { key:'services', label:'Orders & packages', Icon:ShoppingBag, onClick:()=>setRole('services'), disabled:needsEvent },
    canOpenDeliveries && { key:'deliveries', label:'Deliveries', Icon:PackageCheck, onClick:()=>setRole('deliveries'), disabled:needsEvent },
    canOpenOps && { key:'exhibitor', label:'Exhibitor view', Icon:Eye, onClick:()=>openStaffExhibitorView('exhibitor'), disabled:needsEvent },
    canOpenOps && { key:'client-query', label:'Log a query', Icon:ClipboardPlus, onClick:()=>openStaffExhibitorView('client-query'), disabled:needsEvent },
    canOpenOps && { key:'rebooking', label:'Rebooking', Icon:Building2, onClick:()=>openStaffExhibitorView('rebooking'), disabled:needsEvent },
    canManageTenants && { key:'tenant-admin', label:'Events & team', Icon:Users, onClick:()=>setRole('tenant-admin') },
    isPlatformAdmin && role === 'platform-admin' && { key:'platform-admin', label:'Platform admin', Icon:Building2, onClick:()=>setRole('platform-admin') },
  ].filter(Boolean)).map(item=>({ ...item, active:item.key === activeKey }));
  const roleLabel = isDemoExhibitor ? 'Exhibitor' : isPlatformAdmin ? 'Platform owner' : canManageTenants ? 'Organiser' : canOpenOps ? 'Operations' : deliveryOnly ? 'Supplier / Delivery' : 'Staff';
  const framed = (activeKey, content, wide = true) => <AppShell
    eventName={selectedEvent?.name} eventMeta={selectedEvent ? formatEventDateRange(selectedEvent.event_start_date, selectedEvent.event_end_date) : undefined}
    onEventClick={deliveryOnly ? undefined : ()=>setRole(null)} nav={mainNav(activeKey)} onSignOut={signOut} onBack={()=>setRole(null)}
    userLabel={session?.user?.email || 'Signed in'} userRole={roleLabel} wide={wide}>{content}</AppShell>;

  if (role === 'exhibitor' && session && (canOpenOps || isDemoExhibitor)) return framed('exhibitor', <ExhibitorStatus />);
  if (role === 'client-query' && session && (canOpenOps || isDemoExhibitor)) return framed('client-query', <ClientQuery />);
  if (role === 'exhibitor' && !session) return <WithBack onBack={()=>setRole(null)}><ExhibitorStatus onForgetDevice={()=>{ setRole(null); selectPublicEvent(''); setPublicAccessView('events'); }} /></WithBack>;
  if (role === 'shop' && !session) return <ExhibitorShop initialStand={loadExhibitorStand(getEventSlug()) || ''} onBack={()=>setRole(null)} />;
  if (role === 'client-query' && !session) return <WithBack onBack={()=>setRole(null)}><ClientQuery /></WithBack>;
  if (role === 'rebooking' && session && (canOpenOps || isDemoExhibitor)) return framed('rebooking', <RebookingForm />);
  if (role === 'rebooking' && !session) {
    const rebookingNav = [
      { key:'overview', label:session ? 'Workspace' : 'Overview', Icon:LayoutDashboard, onClick:()=>setRole(null) },
      { key:'query', label:'Log a Query', Icon:ClipboardPlus, onClick:()=>setRole('client-query') },
      { key:'status', label:'Check My Status', Icon:Monitor, onClick:()=>setRole('exhibitor') },
      { key:'rebook', label:'Rebook Your Stand', Icon:Building2, active:true },
    ];
    return <AppShell eventName={selectedEvent?.name} nav={rebookingNav} onBack={()=>setRole(null)} onSignOut={session ? signOut : undefined}><RebookingForm /></AppShell>;
  }
  if (session && role === 'platform-admin' && isPlatformAdmin) return framed('platform-admin', <ClientEventAdmin onEventCreated={handleEventCreated} />);
  if (session && role === 'tenant-admin' && canManageTenants) return framed('tenant-admin', <ClientEventAdmin onEventCreated={handleEventCreated} clientWorkspaceOnly currentUserId={session.user?.id} />);
  if (session && role === 'ops' && canOpenOps) return framed('ops', <OpsPortal onOpenStaff={()=>setRole('staff')} onOpenExhibitors={()=>setRole('exhibitors')} initialQueryId={openOpsQueryId} onInitialQueryOpened={()=>setOpenOpsQueryId('')} />);
  if (session && role === 'staff' && canOpenOps) return framed('staff', <StaffSetup />);
  if (session && role === 'people' && canOpenOps) return framed('people', <PeopleSetup onBack={()=>setRole('ops')} />);
  if (session && role === 'exhibitors' && canOpenOps) return framed('exhibitors', <ExhibitorSetup onBack={()=>setRole('ops')} />);
  if (session && role === 'services' && canOpenOps) return framed('services', <ExhibitorServices onOpenShop={()=>openStaffExhibitorView('shop')} />);
  if (session && role === 'deliveries' && canOpenDeliveries) return framed('deliveries', <Deliveries />);
  if (session && role === 'shop' && (canOpenOps || isDemoExhibitor)) return framed('shop', <ExhibitorShop onBack={()=>setRole(null)} />);
  if (session && role === 'dept' && canOpenQueue) return framed('dept', <DeptQueue allowStaffPicker={canOpenOps} />);

  if (session && isDemoExhibitor && !role) {
    const exhibitorItems = [
      { key:'client-query', label:'Log a Query', Icon:ClipboardPlus, description:'Report an issue for your stand', action:()=>openPublicRole('client-query') },
      { key:'exhibitor', label:'Check My Status', Icon:Monitor, description:'Follow your service requests', action:()=>openPublicRole('exhibitor') },
      { key:'shop', label:'Order Furniture', Icon:ShoppingBag, description:'Choose furniture for your stand', action:()=>openPublicRole('shop') },
      { key:'rebooking', label:'Rebook Your Stand', Icon:Building2, description:'Register interest in a future event', action:()=>openPublicRole('rebooking') },
    ];
    return (
      <AppShell eventName={selectedEvent?.name} eventMeta={selectedEvent ? formatEventDateRange(selectedEvent.event_start_date, selectedEvent.event_end_date) : undefined} onEventClick={()=>setRole(null)} nav={mainNav('home')} onSignOut={signOut} userLabel={session.user?.email} userRole="Exhibitor">
        <PageHeader eyebrow={selectedEvent?.name || 'APEXOPS'} title="Exhibitor" accent="workspace." subtitle="Access services for your stand at this event." />
        <div className="event-card">
          <div><span className="event-label">Active event</span><h2>{selectedEvent?.name || 'No event selected'}</h2></div>
          <StatusBadge icon={CheckCircle2}>Exhibitor access</StatusBadge>
        </div>
        <div className="svc-grid">
          {exhibitorItems.map(item=><ServiceCard key={item.key} icon={item.Icon} title={item.label} description={item.description} onClick={item.action} disabled={!selectedEvent || eventLoading} />)}
        </div>
      </AppShell>
    );
  }

  if (session && !role) {
    const hubItems = [
      canOpenOps && { key:'ops', label:'Event Operations', Icon:Monitor, description:'Manage requests and work for the selected event', action:()=>setRole('ops'), needsEvent:true },
      canOpenQueue && { key:'dept', label:'My Queue', Icon:HardHat, description:'Staff: see your assignments and update status', action:()=>setRole('dept'), needsEvent:true },
      canOpenDeliveries && { key:'deliveries', label:'Deliveries', Icon:PackageCheck, description:'View and update event deliveries', action:()=>setRole('deliveries'), needsEvent:true },
      canManageTenants && { key:'events', label:'Client Workspace', Icon:Building2, description:'Manage your events, team and suppliers', action:()=>setRole('tenant-admin') },
      selectedEvent && canOpenOps && { key:'exhibitor', label:'Exhibitor Status', Icon:Monitor, description:'See what exhibitors see for this event', action:()=>openStaffExhibitorView('exhibitor') },
      selectedEvent && canOpenOps && { key:'query', label:'Log a Query', Icon:ClipboardPlus, description:'Log a query on behalf of an exhibitor', action:()=>openStaffExhibitorView('client-query') },
    ].filter(Boolean);
    const hubNav = mainNav('home');
    return (
      <AppShell eventName={selectedEvent?.name} eventMeta={selectedEvent ? formatEventDateRange(selectedEvent.event_start_date, selectedEvent.event_end_date) : undefined} onEventClick={()=>setRole(null)} nav={hubNav} onSignOut={signOut} userLabel={session.user?.email || 'Signed in'} userRole={roleLabel}>
        <PageHeader eyebrow={selectedEvent?.name || 'APEXOPS'} title={`${greeting()},`} accent={`${firstNameFrom(session.user?.email)}.`} subtitle="Everything you can do for this event, in one place." />
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
        {selectedEvent && !canOpenOps && !canOpenQueue && !canOpenDeliveries && !canManageTenants && <p className="shell-note">No staff access is assigned to this event. Contact your client administrator.</p>}
        {selectedEvent && canOpenOps && <HomeOverview key={selectedEvent.id} eventId={selectedEvent.id} onOpenOps={queryId=>{setOpenOpsQueryId(queryId || '');setRole('ops');}} />}
        <h2 className="ho-section-title">Your <em>tools.</em></h2>
        <div className="svc-grid">
          {hubItems.map(item => <ServiceCard key={item.key} icon={item.Icon} title={item.label} description={item.description} onClick={item.action} disabled={item.needsEvent && (!selectedEvent || eventLoading)} />)}
        </div>
      </AppShell>
    );
  }

  if (!session && publicAccessView === 'home') return (
    <LoginLayout
      title="Event operations"
      accent="under control."
      subtitle="Choose the portal for your role. Your account permissions determine which events and tools you can access."
    >
      <div className="lg-journey">
        <div className="lg-journey-intro">
          <span className="lg-eyebrow">APEXOPS EVENT PLATFORM</span>
          <h2>Select your <em>portal.</em></h2>
          <p>Sign in through the workspace that matches your responsibilities.</p>
        </div>
        <div className="lg-journey-grid" aria-label="Choose a portal">
          <button className="lg-journey-option" type="button" onClick={()=>{ setAdminReturnView('home'); setPublicAccessView('clients'); }}>
            <ShieldCheck size={19} /><span><strong>Platform Admin</strong><small>Manage client accounts, billing, and activation.</small></span>
          </button>
          <button className="lg-journey-option" type="button" onClick={()=>setPublicAccessView('client')}>
            <Building2 size={19} /><span><strong>Client / Organiser</strong><small>Set up events, teams, and organisation details.</small></span>
          </button>
          <button className="lg-journey-option" type="button" onClick={()=>setPublicAccessView('organiser')}>
            <LayoutDashboard size={19} /><span><strong>Event Operations</strong><small>Manage requests and coordinate event delivery.</small></span>
          </button>
          <button className="lg-journey-option" type="button" onClick={()=>setPublicAccessView('team')}>
            <HardHat size={19} /><span><strong>Staff & Delivery</strong><small>Open assigned jobs and update delivery progress.</small></span>
          </button>
          <button className="lg-journey-option" type="button" onClick={()=>setPublicAccessView('events')}>
            <Ticket size={19} /><span><strong>Exhibitor access</strong><small>Find your event and enter its organiser-issued code.</small></span>
          </button>
        </div>
        {eventError && <div className="lg-alert" role="alert">{eventError}</div>}
        <div className="lg-journey-contact">
          <span><Building2 size={16} /><span><strong>New to APEXOPS?</strong><small>Request a guided demo for your organisation.</small></span></span>
          <a href="mailto:didi@executiveconferenceevents.com?subject=APEXOPS%20guided%20demo%20request"><Mail size={15} /> Request a demo</a>
        </div>
        <button type="button" className="lg-link lg-registration-link" onClick={()=>setPublicAccessView('registration')}>Request a client account</button>
      </div>
    </LoginLayout>
  );

  if (!session && publicAccessView === 'registration') return (
    <LoginLayout title="Client account" accent="request." subtitle="Submit your organization details for review.">
      <ClientRegistrationForm onBack={()=>setPublicAccessView('home')} />
    </LoginLayout>
  );

  if (!session && publicAccessView === 'events' && selectedEvent?.accessCode) {
    const servicesReady = privacyAcknowledged;
    const exhibitorNav = [
      { key:'overview', label:'Overview', Icon:LayoutDashboard, active:true },
      { key:'query', label:'Log a Query', Icon:ClipboardPlus, onClick:()=>openPublicRole('client-query'), disabled:!servicesReady },
      { key:'status', label:'Check My Status', Icon:Monitor, onClick:()=>openPublicRole('exhibitor'), disabled:!servicesReady },
      { key:'shop', label:'Order Furniture', Icon:ShoppingBag, onClick:()=>openPublicRole('shop'), disabled:!servicesReady },
      { key:'rebook', label:'Rebook Your Stand', Icon:Building2, onClick:()=>openPublicRole('rebooking'), disabled:!servicesReady },
    ];
    return (
      <AppShell eventName={selectedEvent.name} nav={exhibitorNav}>
        <PageHeader eyebrow={selectedEvent.name} title="Exhibitor" accent="services." subtitle="Report issues, follow your requests and plan your next event." />
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
          <ServiceCard icon={ShoppingBag} eyebrow="Stand furniture" title="Order Furniture" description="Choose furniture for your stand and get your order form." onClick={()=>openPublicRole('shop')} />
          <ServiceCard icon={Building2} eyebrow="Future events" title="Rebook Your Stand" description={`Register interest in ${selectedEvent.next_event_name || 'the next event'}.`} onClick={()=>openPublicRole('rebooking')} />
        </div>}
      </AppShell>
    );
  }

  if (!session && publicAccessView === 'clients') return (
    <LoginLayout title="Platform" accent="admin." subtitle="Sign in to manage client accounts and access.">
      <TeamLogin onSignedIn={nextSession=>{ setLoginDestination('clients'); setSession(nextSession); }} initiallyOpen title="Admin sign in" demoPortal="admin" />
      {eventError && <div className="lg-alert" role="alert">{eventError}</div>}
      <button type="button" className="lg-link" onClick={()=>setPublicAccessView(adminReturnView)}>Back to portal selection</button>
    </LoginLayout>
  );

  if (!session && publicAccessView === 'exhibitor-demo') return (
    <LoginLayout title="Exhibitor" accent="demo access." subtitle="Sign in to preview the tools available to an exhibitor.">
      <TeamLogin onSignedIn={nextSession=>{ setLoginDestination('exhibitor-demo'); setSession(nextSession); }} initiallyOpen title="Exhibitor demo sign in" demoPortal="exhibitor" />
      <button type="button" className="lg-link" onClick={()=>setPublicAccessView('home')}>Back to portal selection</button>
      {eventError && <div className="lg-alert" role="alert">{eventError}</div>}
    </LoginLayout>
  );

  const loginCopy = {
    client: ['Client / Organiser', 'sign in.', 'Manage your organisation, event setup, and team access.'],
    organiser: ['Event operations', 'sign in.', 'Sign in to run requests and operations for your assigned event.'],
    team: ['Staff', 'sign in.', 'Sign in to see and update the jobs assigned to you.'],
  };
  const [headTitle, headAccent, headSubtitle] = publicAccessView === 'events'
    ? (publicEventSlug
      ? ['Enter your', 'event code.', 'Enter the code provided by your organiser to continue.']
      : ['Find your', 'event.', 'Select an event, then enter your organiser-issued code to access services.'])
    : loginCopy[publicAccessView];

  return (
    <LoginLayout
      title={headTitle}
      accent={headAccent}
      subtitle={headSubtitle}
      bullets={publicAccessView === 'events' && !publicEventSlug ? ['Report and track issues at your stand', 'See which requests are resolved', 'Plan your next event'] : null}
    >
      {publicAccessView === 'events' ? (publicEventSlug ? (
        <div className="lg-code">
          <div className="lg-selected">
            <div><strong>{selectedPublicEvent?.event_name || publicEventSlug}</strong><span>{formatEventDateRange(selectedPublicEvent?.event_start_date, selectedPublicEvent?.event_end_date)}</span></div>
            <button type="button" className="lg-secondary lg-back-event" onClick={()=>selectPublicEvent('')} disabled={verifyingPublicEvent}><ArrowLeft size={15} aria-hidden="true" /> Back to event list</button>
          </div>
          <label className="lg-label" htmlFor="public-event-code">Event code</label>
          <input id="public-event-code" autoComplete="off" value={publicAccessCode} onChange={event=>setPublicAccessCode(event.target.value.toUpperCase())} onKeyDown={event=>{ if (event.key === 'Enter') verifyPublicEvent(); }} placeholder="Enter the code from your organiser" disabled={eventLoading || verifyingPublicEvent} />
          <button type="button" className="lg-primary" onClick={verifyPublicEvent} disabled={eventLoading || verifyingPublicEvent || !publicEventSlug || !publicAccessCode.trim()}>{verifyingPublicEvent ? 'Checking...' : 'Continue'}</button>
        </div>
      ) : (
        <>
          <button type="button" className="lg-link" onClick={()=>setPublicAccessView('home')}>Back to portal selection</button>
          {DEMO_MODE && <button type="button" className="lg-secondary" onClick={()=>setPublicAccessView('exhibitor-demo')}>Sign in to exhibitor demo</button>}
          <h2 className="lg-title">Choose your event</h2>
          <p className="lg-sub">Find your event, then enter the code your organiser gave you.</p>
          <div className="lg-filters">
            <input type="search" aria-label="Search events" placeholder="Search events or organisers" value={publicEventSearch} onChange={event=>setPublicEventSearch(event.target.value)} disabled={eventLoading} />
            <select aria-label="Filter events by month" value={publicEventMonth} onChange={event=>setPublicEventMonth(event.target.value)} disabled={eventLoading}>
              <option value="">All months</option>
              {publicEventMonths.map(month=><option key={month} value={month}>{new Date(`${month}-01T12:00:00`).toLocaleDateString('en-GB',{month:'long',year:'numeric'})}</option>)}
            </select>
          </div>
          {eventLoading ? <p className="lg-sub">Loading events...</p> : <div className="lg-events">
            {filteredPublicEvents.map(event => (
              <button className="lg-event" key={event.slug} type="button" onClick={()=>selectPublicEvent(event.slug)}>
                <span className="lg-event-logo" aria-hidden="true">{event.logo_url ? <img src={event.logo_url} alt="" /> : getEventInitials(event.event_name)}</span>
                <span className="lg-event-main">
                  <strong>{event.event_name}</strong>
                  <span>{formatEventDateRange(event.event_start_date, event.event_end_date)}</span>
                  <small>Build-up {formatEventDateRange(event.build_up_start_date, event.build_up_end_date)} · Breakdown {formatEventDateRange(event.breakdown_start_date, event.breakdown_end_date)}</small>
                </span>
                <span className="lg-chevron" aria-hidden="true">›</span>
              </button>
            ))}
            {!filteredPublicEvents.length && <p className="lg-empty">{publicEvents.length ? 'No events match this search or month.' : 'No public events are available yet.'}</p>}
          </div>}
        </>
      )) : (
        <TeamLogin onSignedIn={nextSession=>{ setLoginDestination(publicAccessView); setSession(nextSession); }} initiallyOpen title={{ client:'Client / Organiser sign in', organiser:'Operations sign in', team:'Staff sign in' }[publicAccessView]} demoPortal={{ client:'client', organiser:'operations', team:'team' }[publicAccessView]} />
      )}
      {publicAccessView !== 'events' && <button type="button" className="lg-link lg-back-home" onClick={()=>setPublicAccessView('home')}>Back to portal selection</button>}
      {eventError && <div className="lg-alert" role="alert">{eventError}</div>}
    </LoginLayout>
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

function TeamLogin({ onSignedIn, initiallyOpen = false, title = 'Team sign in', compact = false, demoPortal }) {
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
      setError('');
      const account = authenticateDemoAccount(email, password);
      if (!account) {
        setError('Use one of the listed demo accounts and its preview password.');
        return;
      }
      if (account.portal !== demoPortal) {
        setError(`This is the ${account.portalLabel} demo account. Choose that portal to sign in.`);
        return;
      }
      onSignedIn({ demo:true, user:{ id:account.id, email:account.email, demoRole:account.demoRole } });
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

  if (!open) return <button type="button" className="lg-secondary" onClick={()=>setOpen(true)}><LogIn size={14} /> Team sign in</button>;
  return <form className={`lg-form${compact ? ' is-compact' : ''}`} onSubmit={resetMode ? sendReset : signIn}>
    {(!compact || resetMode) && <div>
      <h2 className="lg-title">{resetMode ? 'Reset your password' : title}</h2>
      <p className="lg-sub">{resetMode ? 'We will email you a link to choose a new password.' : 'Use the email and password for your account.'}</p>
    </div>}
    {DEMO_MODE && demoPortal && <div className="lg-demo-accounts">
      <strong>Preview demo login</strong>
      {getDemoAccountsForPortal(demoPortal).map(account=><span key={account.email}><b>{account.label}:</b> {account.email} · {account.password}</span>)}
      <small>Demo-only public credentials; they are not secure accounts and do not access Production.</small>
    </div>}
    <input required type="email" aria-label="Work email" autoComplete="email" placeholder="Work email" value={email} onChange={e=>setEmail(e.target.value)} />
    {!resetMode && <input required type="password" aria-label="Password" autoComplete="current-password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />}
    {error && <span className="lg-error" role="alert">{error}</span>}
    {notice && <span className="lg-ok" role="status">{notice}</span>}
    <button type="submit" className="lg-primary">{resetMode ? 'Send reset link' : <><LogIn size={16} /> Sign in</>}</button>
    <button type="button" className="lg-link" onClick={()=>{ setResetMode(mode => !mode); setError(''); setNotice(''); }}>{resetMode ? 'Back to sign in' : 'Forgot password?'}</button>
    {compact && !resetMode && <p className="lg-form-hint"><ShieldCheck size={16} strokeWidth={1.6} aria-hidden="true" /> Organisers, operations and supplier staff all sign in here. APEXOPS opens the tools your role allows.</p>}
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

  return <LoginLayout title="Set your" accent="password." subtitle="Choose a password to finish setting up your account.">
    <form className="lg-form" onSubmit={save}>
      <div><h2 className="lg-title">Set your password</h2><p className="lg-sub">Use at least 8 characters.</p></div>
      <input required type="password" aria-label="New password" autoComplete="new-password" placeholder="New password" value={password} onChange={e=>setPassword(e.target.value)} />
      <input required type="password" aria-label="Confirm new password" autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={e=>setConfirm(e.target.value)} />
      {error && <span className="lg-error" role="alert">{error}</span>}
      <button type="submit" className="lg-primary" disabled={saving}>{saving ? 'Saving...' : 'Save password'}</button>
    </form>
  </LoginLayout>;
}

function WithBack({ onBack, onSignOut, showBack = true, backLabel = 'Back to workspace', children }) {
  return (
    <div>
      <div className="ax-topbar">
        <Wordmark byline />
        {showBack && <button type="button" className="ax-topbar-btn" onClick={onBack}><ArrowLeft size={16} aria-hidden="true" /> <span>{backLabel}</span></button>}
        {onSignOut && <button type="button" className="ax-topbar-btn is-primary" onClick={onSignOut}><LogOut size={16} aria-hidden="true" /> <span>Sign out</span></button>}
      </div>
      {children}
    </div>
  );
}

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

function firstNameFrom(email) {
  const name = String(email || '').split('@')[0].split(/[._-]/)[0];
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'there';
}
