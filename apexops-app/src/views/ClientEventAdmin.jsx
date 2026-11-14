import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getAvailableEvents, getEventAccessCode } from '../lib/eventScope';
import { DEMO_MODE, getDemoCollection, setDemoCollection } from '../lib/demoStore';
import { getSuppliers, removeSupplier, upsertSuppliers, uploadPublicImage } from '../lib/mock';
import { enqueue, isNetworkError } from '../lib/offline';
import { EVENT_TIERS, EXTRA_STAFF_SEAT_PRICE, getDefaultPricingConfig, INCLUDED_INTERNAL_SEATS, validatePricingConfig, VOLUME_PLANS } from '../lib/pricing';
import { Building2, CalendarDays, Check, LayoutDashboard, MailPlus, Pencil, Plus, RefreshCw, Trash2, Truck, Upload, X } from 'lucide-react';

const emptyClient = { name:'', slug:'', adminEmail:'', eventLimit:1 };
const emptyEvent = { client_id:'', name:'', slug:'', event_start_date:'', event_end_date:'', build_up_start_date:'', build_up_end_date:'', breakdown_start_date:'', breakdown_end_date:'', next_event_name:'', billing_exempt:false, logo_file:null };
const emptyInvite = { client_id:'', event_id:'', email:'', role:'staff' };
const emptySupplier = { name:'', contact:'', email:'', mobile:'', category:'Other' };

function eventStatus(event) {
  const today = new Date().toISOString().slice(0, 10);
  const start = event.build_up_start_date || event.event_start_date;
  const end = event.breakdown_end_date || event.event_end_date;
  if (end && end < today) return ['Completed', 'past'];
  if (start && start <= today) return ['Live', 'live'];
  return ['Upcoming', 'upcoming'];
}

export default function ClientEventAdmin({ onEventCreated }) {
  const [section, setSection] = useState('overview');
  const [clients, setClients] = useState([]);
  const [events, setEvents] = useState([]);
  const [dashboardEventFilter, setDashboardEventFilter] = useState('');
  const [pricingConfig, setPricingConfig] = useState(getDefaultPricingConfig);
  const [memberships, setMemberships] = useState([]);
  const [privateSuppliers, setPrivateSuppliers] = useState([]);
  const [supplierClientId, setSupplierClientId] = useState('');
  const [managedClientId, setManagedClientId] = useState('');
  const [managedClientEventLimit, setManagedClientEventLimit] = useState(1);
  const [managedClientBilling, setManagedClientBilling] = useState({ billing_mode:'unmanaged', billing_status:'active', paid_through:'', prepaid_event_credits:0 });
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [clientForm, setClientForm] = useState(emptyClient);
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [editingEventId, setEditingEventId] = useState('');
  const [showEventForm, setShowEventForm] = useState(false);
  const [inviteForm, setInviteForm] = useState(emptyInvite);
  const [supplierForm, setSupplierForm] = useState(emptySupplier);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    if (!supabase && !DEMO_MODE) {
      setError('Client and event administration requires a connected Supabase project.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const availableEvents = await getAvailableEvents();
      let currentMemberships = [];
      let platformAdmin = false;
      let visibleClients = [];
      let nextPricingConfig = getDefaultPricingConfig();
      let pricingLoadError = '';
      if (DEMO_MODE) {
        platformAdmin = true;
        currentMemberships = getDemoCollection('memberships', [{ client_id:'demo-client-ece', event_id:null, role:'client_admin' }]);
        visibleClients = getDemoCollection('clients', [{ id:'demo-client-ece', name:'Executive Conference Events', slug:'executive-conference-events', event_limit:1, billing_mode:'unmanaged', billing_status:'active', billing_plan:'legacy', prepaid_event_credits:0, trial_started_at:null, trial_ends_at:null }]);
        nextPricingConfig = getDemoCollection('pricing', nextPricingConfig);
      } else {
        const [membershipResult, adminResult] = await Promise.all([
          supabase.from('client_event_memberships').select('client_id, event_id, role'),
          supabase.rpc('is_platform_admin'),
        ]);
        if (membershipResult.error) throw membershipResult.error;
        if (adminResult.error) throw adminResult.error;
        platformAdmin = Boolean(adminResult.data);
        currentMemberships = membershipResult.data || [];
        if (platformAdmin) {
          const { data, error: clientsError } = await supabase.from('clients')
            .select('id, name, slug, event_limit, billing_mode, billing_status, billing_plan, paid_through, term_started_at, term_ends_at, committed_events, prepaid_event_credits, trial_started_at, trial_ends_at')
            .order('name');
          if (clientsError) throw clientsError;
          visibleClients = data || [];
          const { data:pricing, error:pricingError } = await supabase.from('platform_pricing')
            .select('event_tiers, volume_plans').eq('id', true).maybeSingle();
          if (pricingError) pricingLoadError = 'Pricing settings are unavailable. Apply supabase/platform-pricing-migration.sql to enable the editor.';
          else if (pricing?.event_tiers && pricing?.volume_plans) nextPricingConfig = { eventTiers:pricing.event_tiers, volumePlans:pricing.volume_plans };
        }
      }
      const managedClientId = currentMemberships.find(membership => membership.role === 'client_admin' && !membership.event_id)?.client_id || '';
      let managedClientEventLimit = 1;
      let managedClientBilling = { billing_mode:'unmanaged', billing_status:'active', billing_plan:'legacy', paid_through:null, term_ends_at:null, committed_events:0, prepaid_event_credits:0, trial_started_at:null, trial_ends_at:null };
      if (!DEMO_MODE && !platformAdmin && managedClientId) {
        const { data:managedClient, error:managedClientError } = await supabase.from('clients')
          .select('event_limit, billing_mode, billing_status, billing_plan, paid_through, term_ends_at, committed_events, prepaid_event_credits, trial_started_at, trial_ends_at')
          .eq('id', managedClientId).maybeSingle();
        if (managedClientError) throw managedClientError;
        managedClientEventLimit = managedClient?.event_limit || 1;
        managedClientBilling = managedClient || managedClientBilling;
      } else if (DEMO_MODE) {
        managedClientBilling = visibleClients[0] || managedClientBilling;
      }
      let managedEvents = availableEvents;
      if (!DEMO_MODE && availableEvents.length) {
        const { data: codeRows, error: codeError } = await supabase.rpc('get_event_access_codes', {
          requested_event_ids:availableEvents.map(event => event.id),
        });
        let rows = codeRows || [];
        if (codeError?.code === 'PGRST202') {
          const { data:legacyRows, error:legacyError } = await supabase.from('events').select('id, exhibitor_code').in('id', availableEvents.map(event => event.id));
          if (legacyError) throw legacyError;
          rows = legacyRows || [];
        } else if (codeError) throw codeError;
        const codeByEventId = new Map(rows.map(row => [row.event_id || row.id, row.exhibitor_code]));
        managedEvents = availableEvents.map(event => ({ ...event, exhibitor_code:codeByEventId.get(event.id) || '' }));
      }
      setClients(visibleClients);
      setEvents(managedEvents);
      setPricingConfig(nextPricingConfig);
      setMemberships(currentMemberships);
      setIsPlatformAdmin(platformAdmin);
      setManagedClientId(managedClientId);
      setManagedClientEventLimit(managedClientEventLimit);
      setManagedClientBilling(managedClientBilling);
      setEventForm(current => ({ ...current, client_id:platformAdmin ? current.client_id || visibleClients[0]?.id || '' : managedClientId }));
      setInviteForm(current => ({ ...current, client_id:platformAdmin ? current.client_id || visibleClients[0]?.id || '' : managedClientId }));
      const supplierScope = platformAdmin ? supplierClientId || visibleClients[0]?.id || '' : managedClientId;
      setSupplierClientId(supplierScope);
      setPrivateSuppliers(supplierScope ? await getSuppliers(supplierScope) : []);
      if (pricingLoadError) setError(pricingLoadError);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load client and event access.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const billingForClient = clientId => isPlatformAdmin
    ? clients.find(client => client.id === clientId) || {}
    : managedClientBilling;
  const billingIsCurrent = clientId => {
    const account = billingForClient(clientId);
    if (account.billing_status !== 'active') return false;
    if (account.billing_mode === 'monthly') {
      const today = new Date().toISOString().slice(0, 10);
      return Boolean(account.paid_through && account.paid_through >= today && account.term_ends_at && account.term_ends_at >= today);
    }
    if (account.billing_mode === 'trial') {
      const today = new Date().toISOString().slice(0, 10);
      return Boolean(account.trial_started_at && account.trial_started_at <= today && account.trial_ends_at && account.trial_ends_at > today);
    }
    return account.billing_mode === 'unmanaged' || account.billing_mode === 'prepaid';
  };
  const canManageClient = clientId => isPlatformAdmin || (billingIsCurrent(clientId) && memberships.some(membership =>
    membership.client_id === clientId && membership.role === 'client_admin' && !membership.event_id));
  const canManageSuppliers = clientId => canManageClient(clientId);
  const canInviteToScope = (clientId, eventId) => isPlatformAdmin || (billingIsCurrent(clientId) && memberships.some(membership =>
    membership.client_id === clientId && membership.role === 'client_admin'
      && (!membership.event_id || membership.event_id === eventId)
      && (eventId || !membership.event_id)));
  const selectedEvent = events.find(event => event.id === inviteForm.event_id);
  const inviteClientEvents = events.filter(event => event.client_id === inviteForm.client_id);
  const dashboardEvents = events.filter(event => !dashboardEventFilter || event.id === dashboardEventFilter);

  function beginEditEvent(event) {
    setEditingEventId(event.id);
    setEventForm({
      client_id:event.client_id,
      name:event.name || '',
      slug:event.slug || '',
      event_start_date:event.event_start_date || '',
      event_end_date:event.event_end_date || '',
      build_up_start_date:event.build_up_start_date || '',
      build_up_end_date:event.build_up_end_date || '',
      breakdown_start_date:event.breakdown_start_date || '',
      breakdown_end_date:event.breakdown_end_date || '',
      next_event_name:event.next_event_name || '',
      billing_exempt:Boolean(event.billing_exempt),
      logo_file:null,
    });
    setSection('events');
    setShowEventForm(true);
    setError('');
    setNotice('');
  }

  function cancelEditEvent() {
    setEditingEventId('');
    setShowEventForm(false);
    setEventForm(current => ({ ...emptyEvent, client_id:current.client_id }));
  }

  async function addPrivateSupplier(event) {
    event.preventDefault();
    if (!supplierClientId || !canManageSuppliers(supplierClientId)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await upsertSuppliers([{ ...supplierForm, id:`supplier-${crypto.randomUUID()}` }], supplierClientId);
      setSupplierForm(emptySupplier);
      setPrivateSuppliers(await getSuppliers(supplierClientId));
      setNotice('Private organizer supplier added. It is available across this organizer’s events.');
    } catch (saveError) {
      setError(saveError?.message || 'Could not add the organizer supplier.');
    } finally {
      setSaving(false);
    }
  }

  async function deletePrivateSupplier(supplier) {
    if (!window.confirm(`Remove ${supplier.name} from this organizer’s private supplier list?`)) return;
    try {
      await removeSupplier(supplier.id, supplierClientId);
      setPrivateSuppliers(await getSuppliers(supplierClientId));
    } catch (deleteError) {
      setError(deleteError?.message || 'Could not remove the supplier.');
    }
  }

  async function createClient(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const name = clientForm.name.trim();
      const slug = clientForm.slug.trim().toLowerCase();
      const eventLimit = Number(clientForm.eventLimit);
      if (!Number.isInteger(eventLimit) || eventLimit < 1 || eventLimit > 1000) throw new Error('Set an event limit from 1 to 1000.');
      if (DEMO_MODE) {
        const clients = getDemoCollection('clients', []);
        if (clients.some(client => client.slug === slug)) throw new Error('That organization URL slug is already in use.');
        setDemoCollection('clients', [...clients, { id:`demo-client-${crypto.randomUUID()}`, name, slug, event_limit:eventLimit }]);
      } else {
        const input = { id:crypto.randomUUID(), name, slug, adminEmail:clientForm.adminEmail.trim(), eventLimit };
        const { error: createError } = await supabase.functions.invoke('create-client', { body:input });
        if (createError && isNetworkError(createError)) {
          await enqueue('client.create', input);
          setClientForm(emptyClient);
          setNotice('You are offline. The client will be created automatically when the connection returns.');
          return;
        }
        if (createError) {
          let message = createError.message;
          try { message = (await createError.context.json()).message || message; } catch { /* keep generic message */ }
          throw new Error(message);
        }
      }
      setClientForm(emptyClient);
      setNotice('Client organization created. Create an event and invite its first client admin.');
      await refresh();
    } catch (saveError) {
      setError(saveError?.message || 'Could not create the client organization.');
    } finally {
      setSaving(false);
    }
  }

  async function updateClientEventLimit(clientId, value) {
    const eventLimit = Number(value);
    if (!Number.isInteger(eventLimit) || eventLimit < 1 || eventLimit > 1000) {
      setError('Set an event limit from 1 to 1000.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: updateError } = await supabase.from('clients').update({ event_limit:eventLimit }).eq('id', clientId);
      if (updateError) throw updateError;
      setClients(current => current.map(client => client.id === clientId ? { ...client, event_limit:eventLimit } : client));
      if (clientId === managedClientId) setManagedClientEventLimit(eventLimit);
      setNotice('Client event limit updated.');
    } catch (updateError) {
      setError(updateError?.message || 'Could not update the client event limit.');
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function updateClientBilling(clientId, patch) {
    if (!isPlatformAdmin) return;
    if (patch.prepaid_event_credits !== undefined && (!Number.isInteger(Number(patch.prepaid_event_credits)) || Number(patch.prepaid_event_credits) < 0)) {
      setError('Prepaid event credits must be a whole number of zero or more.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      let saved;
      if (DEMO_MODE) {
        const current = getDemoCollection('clients', []);
        const client = current.find(item => item.id === clientId);
        saved = { ...patch };
        if (saved.billing_mode === 'monthly' && saved.term_started_at !== (client?.term_started_at || null)) saved.prepaid_event_credits = 0;
        setDemoCollection('clients', current.map(item => item.id === clientId ? { ...item, ...saved } : item));
      } else {
        const { data, error: updateError } = await supabase.from('clients').update(patch).eq('id', clientId)
          .select('billing_plan, billing_mode, billing_status, prepaid_event_credits, paid_through, term_started_at, term_ends_at, committed_events, trial_started_at, trial_ends_at').single();
        if (updateError) throw updateError;
        saved = data;
      }
      setClients(current => current.map(client => client.id === clientId ? { ...client, ...saved } : client));
      setNotice('Client access settings saved. Payment has not been collected by this app.');
      return saved;
    } catch (updateError) {
      setError(updateError?.message || 'Could not update client access settings.');
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  function updatePricingTier(index, field, value) {
    setPricingConfig(current => ({
      ...current,
      eventTiers:current.eventTiers.map((tier, tierIndex) => tierIndex === index ? { ...tier, [field]:value } : tier),
    }));
  }

  function updateVolumePlan(index, field, value) {
    setPricingConfig(current => ({
      ...current,
      volumePlans:current.volumePlans.map((plan, planIndex) => planIndex === index ? { ...plan, [field]:value } : plan),
    }));
  }

  async function savePricingConfig() {
    const validationError = validatePricingConfig(pricingConfig);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (DEMO_MODE) {
        setDemoCollection('pricing', pricingConfig);
      } else {
        const { data, error:saveError } = await supabase.from('platform_pricing')
          .upsert({ id:true, event_tiers:pricingConfig.eventTiers, volume_plans:pricingConfig.volumePlans }, { onConflict:'id' })
          .select('event_tiers, volume_plans').single();
        if (saveError) throw saveError;
        setPricingConfig({ eventTiers:data.event_tiers, volumePlans:data.volume_plans });
      }
      setNotice('Pricing tiers and annual discounts saved.');
    } catch (saveError) {
      setError(saveError?.message || 'Could not save pricing settings.');
    } finally {
      setSaving(false);
    }
  }

  async function createEvent(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const eventValues = {
        client_id:eventForm.client_id,
        name:eventForm.name.trim(),
        slug:eventForm.slug.trim().toLowerCase(),
        event_start_date:eventForm.event_start_date,
        event_end_date:eventForm.event_end_date,
        build_up_start_date:eventForm.build_up_start_date,
        build_up_end_date:eventForm.build_up_end_date,
        breakdown_start_date:eventForm.breakdown_start_date,
        breakdown_end_date:eventForm.breakdown_end_date,
        next_event_name:eventForm.next_event_name.trim() || null,
        billing_exempt:Boolean(isPlatformAdmin && eventForm.billing_exempt),
        is_public:true,
      };
      const existingEvents = DEMO_MODE ? getDemoCollection('events', []) : await getAvailableEvents();
      if (existingEvents.some(item => item.slug === eventValues.slug)) throw new Error('That event URL slug is already in use.');
      eventValues.logo_url = eventForm.logo_file
        ? await uploadPublicImage('event-logos', 'logo', eventForm.logo_file, eventValues.slug)
        : null;
      let data;
      if (DEMO_MODE) {
        const currentEvents = getDemoCollection('events', []);
        const prefix = eventValues.name.replace(/[^A-Za-z]/g, '').slice(0, 5).toUpperCase() || 'EVENT';
        data = { ...eventValues, id:`demo-event-${crypto.randomUUID()}`, exhibitor_code:`${prefix}-${eventValues.event_start_date.replace(/-/g, '')}` };
        setDemoCollection('events', [...currentEvents, data]);
      } else {
        const { data:createdEvent, error: createError } = await supabase.from('events').insert(eventValues)
          .select('id, client_id, name, event_start_date, event_end_date, build_up_start_date, build_up_end_date, breakdown_start_date, breakdown_end_date, next_event_name, slug, is_public, logo_url, billing_exempt').single();
        if (createError) throw createError;
        data = createdEvent;
      }
      setEventForm(current => ({ ...emptyEvent, client_id:current.client_id }));
      setShowEventForm(false);
      await refresh();
      onEventCreated(data);
      setNotice(`Event created. Public links can use ?event=${data.slug}.`);
    } catch (saveError) {
      setError(saveError?.message || 'Could not create the event.');
    } finally {
      setSaving(false);
    }
  }

  async function updateEvent(event) {
    event.preventDefault();
    const currentEvent = events.find(item => item.id === editingEventId);
    if (!currentEvent) {
      setError('That event is no longer available. Refresh and try again.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const eventValues = {
        name:eventForm.name.trim(),
        slug:eventForm.slug.trim().toLowerCase(),
        event_start_date:eventForm.event_start_date,
        event_end_date:eventForm.event_end_date,
        build_up_start_date:eventForm.build_up_start_date,
        build_up_end_date:eventForm.build_up_end_date,
        breakdown_start_date:eventForm.breakdown_start_date,
        breakdown_end_date:eventForm.breakdown_end_date,
        next_event_name:eventForm.next_event_name.trim() || null,
      };
      if (isPlatformAdmin) eventValues.billing_exempt = Boolean(eventForm.billing_exempt);
      if (events.some(item => item.id !== currentEvent.id && item.slug === eventValues.slug)) {
        throw new Error('That event URL slug is already in use.');
      }
      if (eventForm.logo_file) eventValues.logo_url = await uploadPublicImage('event-logos', 'logo', eventForm.logo_file, eventValues.slug);

      let data;
      if (DEMO_MODE) {
        const currentEvents = getDemoCollection('events', []);
        data = { ...currentEvent, ...eventValues };
        setDemoCollection('events', currentEvents.map(item => item.id === currentEvent.id ? data : item));
      } else {
        const { data:updatedEvent, error:updateError } = await supabase.from('events').update(eventValues).eq('id', currentEvent.id)
          .select('id, client_id, name, event_start_date, event_end_date, build_up_start_date, build_up_end_date, breakdown_start_date, breakdown_end_date, next_event_name, slug, is_public, logo_url, billing_exempt, clients(name)').single();
        if (updateError) throw updateError;
        data = updatedEvent;
      }
      setEditingEventId('');
      setEventForm(current => ({ ...emptyEvent, client_id:currentEvent.client_id }));
      setShowEventForm(false);
      await refresh();
      onEventCreated(data);
      setNotice(`Event details updated for ${data.name}.`);
    } catch (saveError) {
      setError(saveError?.message || 'Could not update the event.');
    } finally {
      setSaving(false);
    }
  }

  async function updateEventLogo(event, file) {
    if (!file) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const logo_url = await uploadPublicImage('event-logos', 'logo', file, event.id);
      if (DEMO_MODE) {
        const currentEvents = getDemoCollection('events', []);
        setDemoCollection('events', currentEvents.map(item => item.id === event.id ? { ...item, logo_url } : item));
      } else {
        const { error: updateError } = await supabase.from('events').update({ logo_url }).eq('id', event.id);
        if (updateError) throw updateError;
      }
      await refresh();
      setNotice(`${event.name} logo updated. It will appear in the Exhibitors event list.`);
    } catch (saveError) {
      setError(saveError?.message || 'Could not update the event logo.');
    } finally {
      setSaving(false);
    }
  }

  async function rotateEventCode(event) {
    if (!window.confirm(`Rotate the exhibitor code for ${event.name}? The current code will stop working immediately.`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      let code;
      if (DEMO_MODE) {
        code = `APX-${crypto.randomUUID().replace(/-/g, '').toUpperCase()}`;
        setDemoCollection('events', getDemoCollection('events', []).map(item => item.id === event.id ? { ...item, exhibitor_code:code } : item));
      } else {
        const { data, error:rotateError } = await supabase.rpc('rotate_event_exhibitor_code', { target_event_id:event.id });
        if (rotateError) throw rotateError;
        code = data;
      }
      if (!code) throw new Error('The new exhibitor code was generated but could not be retrieved. Refresh the page to load it.');
      setEvents(current => current.map(item => item.id === event.id ? { ...item, exhibitor_code:code } : item));
      setNotice(`Code rotated for ${event.name}. The previous code is no longer valid; share the new code with exhibitors.`);
    } catch (rotateError) {
      setError(rotateError?.message || 'Could not regenerate the exhibitor code.');
    } finally {
      setSaving(false);
    }
  }

  async function inviteMember(event) {
    event.preventDefault();
    if (!inviteForm.event_id && inviteForm.role !== 'client_admin') {
      setError('Choose an event for event administrators, operations, or staff invitations.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const invitation = {
        client_id:inviteForm.client_id,
        event_id:inviteForm.event_id || null,
        email:inviteForm.email.trim(),
        role:inviteForm.role,
        created_at:new Date().toISOString(),
      };
      if (DEMO_MODE) {
        const invitations = getDemoCollection('invitations', []);
        setDemoCollection('invitations', [...invitations, invitation]);
        setNotice(`Demo invitation recorded for ${invitation.email}.`);
      } else {
        const { data, error: inviteError } = await supabase.functions.invoke('invite-event-member', { body: {
          clientId:invitation.client_id,
          eventId:invitation.event_id,
          email:invitation.email,
          role:invitation.role,
        } });
        if (inviteError) throw inviteError;
        setNotice(data?.message || `Invitation sent to ${invitation.email}.`);
      }
      setInviteForm(current => ({ ...current, email:'' }));
    } catch (inviteError) {
      const serverMessage = inviteError?.context?.body?.message;
      setError(serverMessage || inviteError?.message || 'Could not invite this user.');
    } finally {
      setSaving(false);
    }
  }

  const navItems = [
    ['overview', 'Overview', LayoutDashboard],
    ...(isPlatformAdmin ? [['events', 'Events', CalendarDays], ['clients', 'Clients & access', Building2], ['pricing', 'Pricing', CalendarDays]] : [
      ['events', 'Events', CalendarDays],
      ['suppliers', 'Suppliers', Truck],
      ['team', 'Team access', MailPlus],
    ]),
  ];
  const sectionTitle = navItems.find(([key]) => key === section)?.[1] || 'Overview';
  const liveEvents = dashboardEvents.filter(event => eventStatus(event)[1] === 'live').length;
  const quotaClientId = isPlatformAdmin ? eventForm.client_id : managedClientId;
  const quotaClient = clients.find(client => client.id === quotaClientId);
  const currentEventLimit = isPlatformAdmin ? Number(quotaClient?.event_limit || 1) : managedClientEventLimit;
  const currentClientEvents = events.filter(event => event.client_id === quotaClientId && !event.billing_exempt).length;
  const eventLimitReached = Boolean(quotaClientId && currentClientEvents >= currentEventLimit && !eventForm.billing_exempt);

  return (
    <div className="adm-shell">
      <aside className="adm-sidebar">
        <div className="adm-brand">APEXOPS<sup>™</sup><small>{isPlatformAdmin ? 'Platform Admin' : 'Client workspace'}</small></div>
        <nav aria-label={isPlatformAdmin ? 'Platform administration' : 'Client workspace'}>
          {navItems.map(([key, label, Icon]) => <button key={key} type="button" className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined} onClick={()=>setSection(key)}><Icon size={16} /> {label}</button>)}
        </nav>
      </aside>
    <main className="tenant-admin-page adm-main">
      <header className="tenant-admin-heading adm-topbar">
        <div>
          <div className="tenant-admin-kicker">{isPlatformAdmin ? 'PLATFORM ADMIN' : 'CLIENT WORKSPACE'}</div>
          <h1>{sectionTitle}</h1>
          <p>{isPlatformAdmin ? 'Manage client accounts and access.' : 'Manage events, suppliers and team access for your organisation.'}</p>
        </div>
        <button className="tenant-refresh" type="button" onClick={refresh} disabled={loading || saving} title="Refresh"><RefreshCw size={15} /> Refresh</button>
      </header>

      {error && <div className="tenant-feedback tenant-error" role="alert">{error}</div>}
      {notice && <div className="tenant-feedback tenant-notice" role="status">{notice}</div>}
      {loading ? <div className="tenant-loading">Loading clients, events and access…</div> : <>
        <section className="adm-overview" hidden={section !== 'overview'}>
          <div className="adm-stats">
            {isPlatformAdmin && <div className="adm-stat"><span>Clients</span><strong>{clients.length}</strong></div>}
            <div className="adm-stat"><span>Events shown</span><strong>{dashboardEvents.length}</strong></div>
            <div className="adm-stat"><span>Live now</span><strong>{liveEvents}</strong></div>
            <div className="adm-stat"><span>Private suppliers</span><strong>{privateSuppliers.length}</strong></div>
          </div>
          <div className="tenant-section">
            <div className="tenant-section-heading"><CalendarDays size={17} /><div><h2>{isPlatformAdmin ? 'Client events' : 'Your events'}</h2><p>{isPlatformAdmin ? 'Event overview across client accounts.' : 'Open the Events section to create or manage them.'}</p></div></div>
            {isPlatformAdmin && <label className="tenant-admin-filter">Event<select aria-label="Filter dashboard events" value={dashboardEventFilter} onChange={event=>setDashboardEventFilter(event.target.value)}><option value="">All events</option>{events.map(event=><option key={event.id} value={event.id}>{event.clients?.name ? `${event.clients.name} · ` : ''}{event.name}</option>)}</select></label>}
            <div className="tenant-list">
              {dashboardEvents.map(event => { const [label, tone] = eventStatus(event); return <div className="tenant-list-row" key={event.id}><div className="tenant-event-details"><strong>{event.name}</strong><span>{event.clients?.name ? `${event.clients.name} · ` : ''}{event.event_start_date} to {event.event_end_date}</span></div><span className={`adm-chip adm-chip-${tone}`}>{label}</span></div>; })}
              {!dashboardEvents.length && <p className="tenant-empty">No events match this filter.</p>}
            </div>
          </div>
        </section>
        {isPlatformAdmin && <section className="tenant-section" hidden={section !== 'clients'}>
          <div className="tenant-section-heading"><Building2 size={17} /><div><h2>Client organizations</h2><p>{clients.length} available to your account</p></div></div>
          <div className="tenant-list">
            {clients.map(client => <div key={client.id}><div className="tenant-list-row"><div className="tenant-event-details"><strong>{client.name}</strong><span>{client.slug} · {events.filter(event => event.client_id === client.id && !event.billing_exempt).length} of {client.event_limit || 1} billable events used</span></div><label className="tenant-quota-control">Event limit<input type="number" min="1" max="1000" value={client.event_limit || 1} disabled={saving} onChange={event=>setClients(current=>current.map(item=>item.id === client.id ? { ...item, event_limit:event.target.value } : item))} onBlur={event=>updateClientEventLimit(client.id, event.target.value)} /></label></div><BillingControls client={client} saving={saving} onSave={updateClientBilling} volumePlans={pricingConfig.volumePlans} /></div>)}
            {!clients.length && <p className="tenant-empty">No organizations are assigned to your account.</p>}
          </div>
          {isPlatformAdmin && <form className="tenant-form tenant-inline-form" onSubmit={createClient}>
            <h3>Create organization after payment confirmation</h3>
            <label>Organization name<input required maxLength="160" value={clientForm.name} onChange={event=>setClientForm({ ...clientForm, name:event.target.value })} /></label>
            <label>URL slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={clientForm.slug} onChange={event=>setClientForm({ ...clientForm, slug:event.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'') })} /></label>
            <label>Event limit<input required type="number" min="1" max="1000" value={clientForm.eventLimit} onChange={event=>setClientForm({ ...clientForm, eventLimit:event.target.value })} /><small>Maximum number of events this client can create.</small></label>
            <label>First admin email (optional)<input type="email" value={clientForm.adminEmail} onChange={event=>setClientForm({ ...clientForm, adminEmail:event.target.value })} /></label>
            <button type="submit" disabled={saving}><Plus size={15} /> Create client</button>
          </form>}
        </section>}

        {isPlatformAdmin && <section className="tenant-section" hidden={section !== 'pricing'}>
          <div className="tenant-section-heading"><CalendarDays size={17} /><div><h2>Proposed launch pricing</h2><p>Edit event size bands and annual discounts. ZAR per event; VAT, if applicable, is additional.</p></div><button className="tenant-add-event" type="button" disabled={saving} onClick={savePricingConfig}><Check size={15} /> Save pricing</button></div>
          <div className="tenant-pricing-table-wrap"><table className="tenant-pricing-table">
            <thead><tr><th>Event category</th><th>Minimum stands / build locations</th><th>Maximum</th><th>Price (ZAR)</th></tr></thead>
            <tbody>{pricingConfig.eventTiers.map((tier,index)=><tr key={tier.id}>
              <td><input aria-label={`Category ${tier.id}`} value={tier.name} onChange={event=>updatePricingTier(index,'name',event.target.value)} /></td>
              <td><input aria-label={`Minimum locations ${tier.id}`} type="number" min="1" step="1" value={tier.minLocations} onChange={event=>updatePricingTier(index,'minLocations',event.target.value === '' ? '' : Number(event.target.value))} /></td>
              <td><input aria-label={`Maximum locations ${tier.id}`} type="number" min="1" step="1" placeholder="No limit" value={tier.maxLocations ?? ''} onChange={event=>updatePricingTier(index,'maxLocations',event.target.value === '' ? null : Number(event.target.value))} /></td>
              <td><input aria-label={`Price ZAR ${tier.id}`} type="number" min="0" step="1" placeholder="Custom quote" value={tier.listPrice ?? ''} onChange={event=>updatePricingTier(index,'listPrice',event.target.value === '' ? null : Number(event.target.value))} /></td>
            </tr>)}</tbody>
          </table></div>
          <p className="tenant-scope-note">Floor area, halls, operational zones and complexity also require assessment; a custom quote may apply.</p>
          <h3>Annual commitment</h3>
          <div className="tenant-pricing-table-wrap"><table className="tenant-pricing-table"><thead><tr><th>Minimum events / year</th><th>Maximum</th><th>Discount (%)</th></tr></thead><tbody><tr><td>1</td><td>11</td><td>0</td></tr>{pricingConfig.volumePlans.map((plan,index)=><tr key={plan.id}>
            <td><input aria-label={`Minimum annual events ${plan.id}`} type="number" min="1" step="1" value={plan.eventsPerYear} onChange={event=>updateVolumePlan(index,'eventsPerYear',event.target.value === '' ? '' : Number(event.target.value))} /></td>
            <td><input aria-label={`Maximum annual events ${plan.id}`} type="number" min="1" step="1" value={plan.maxEvents} onChange={event=>updateVolumePlan(index,'maxEvents',event.target.value === '' ? '' : Number(event.target.value))} /></td>
            <td><input aria-label={`Discount percent ${plan.id}`} type="number" min="0" max="100" step="0.1" value={plan.discountPct} onChange={event=>updateVolumePlan(index,'discountPct',event.target.value === '' ? '' : Number(event.target.value))} /></td>
          </tr>)}</tbody></table></div>
          <p className="tenant-scope-note">Includes {INCLUDED_INTERNAL_SEATS} internal operational accounts; additional internal accounts are R{EXTRA_STAFF_SEAT_PRICE} per user per event. External participant access is free.</p>
        </section>}

        <section className="tenant-section" hidden={section !== 'events'}>
          <div className="tenant-section-heading"><CalendarDays size={17} /><div><h2>Event workspaces</h2><p>Each event has isolated staff, exhibitors, requests and reports.</p></div>{!showEventForm && <button className="tenant-add-event" type="button" onClick={()=>{setEditingEventId('');setShowEventForm(true);}}><Plus size={15} /> New event</button>}</div>
          <div className="tenant-list">
            {events.map(event => <div className="tenant-list-row" key={event.id}><div className="tenant-event-details"><strong>{event.name}{event.next_event_name ? ` · Rebooking ${event.next_event_name}` : ''}</strong><span>Event {event.event_start_date} to {event.event_end_date} · Build-up {event.build_up_start_date} to {event.build_up_end_date} · Breakdown {event.breakdown_start_date} to {event.breakdown_end_date}</span>{event.billing_exempt && <span className="tenant-internal-badge">Internal ECE · non-billable</span>}</div><span className="tenant-event-access"><code>?event={event.slug}</code><code>Exhibitor code: {event.exhibitor_code}</code><button className="tenant-regenerate-code" type="button" disabled={saving || (!isPlatformAdmin && !canInviteToScope(event.client_id, event.id))} onClick={()=>rotateEventCode(event)}><RefreshCw size={12} /> Rotate code</button></span><div className="tenant-event-actions"><button className="tenant-edit-event" type="button" disabled={saving || (event.billing_exempt && !isPlatformAdmin)} onClick={()=>beginEditEvent(event)}><Pencil size={14} /> Edit</button><label className="tenant-event-logo-action" title={`${event.logo_url ? 'Change' : 'Upload'} ${event.name} logo`}>{event.logo_url ? <img src={event.logo_url} alt={`${event.name} logo`} /> : <Upload size={14} />}<span>{event.logo_url ? 'Change logo' : 'Upload logo'}</span><input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${event.logo_url ? 'Change' : 'Upload'} logo for ${event.name}`} disabled={saving} onChange={inputEvent=>{const file=inputEvent.target.files?.[0];if(file)updateEventLogo(event,file);inputEvent.target.value='';}} /></label></div></div>)}
            {!events.length && <p className="tenant-empty">No events are assigned to your account.</p>}
          </div>
          {showEventForm && <form className="tenant-form tenant-inline-form" onSubmit={editingEventId ? updateEvent : createEvent}>
            <h3>{editingEventId ? 'Edit event' : 'Create event'}</h3>
            {isPlatformAdmin ? <label>Client<select required value={eventForm.client_id} disabled={Boolean(editingEventId)} onChange={event=>setEventForm({ ...eventForm, client_id:event.target.value })}><option value="">Select client</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label> : <p className="tenant-scope-note">New events will be created within your assigned organization.</p>}
            <label>Event name<input required maxLength="160" value={eventForm.name} onChange={event=>setEventForm({ ...eventForm, name:event.target.value })} /></label>
            {quotaClientId && <p className="tenant-scope-note">Event allowance: {currentClientEvents} of {currentEventLimit} used.</p>}
            <label>URL slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={eventForm.slug} onChange={event=>setEventForm({ ...eventForm, slug:event.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'') })} />{editingEventId && <small>Changing this slug changes the event link.</small>}</label>
            <label>Event logo (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>setEventForm({ ...eventForm, logo_file:event.target.files?.[0] || null })} /><small>PNG, JPG, or WebP; maximum 2 MB.</small></label>
            <label>Event start date<input type="date" required value={eventForm.event_start_date} onChange={event=>setEventForm({ ...eventForm, event_start_date:event.target.value })} /></label>
            <label>Event end date<input type="date" required min={eventForm.event_start_date || undefined} value={eventForm.event_end_date} onChange={event=>setEventForm({ ...eventForm, event_end_date:event.target.value })} /></label>
            <label>Build-up start<input type="date" required max={eventForm.event_start_date || undefined} value={eventForm.build_up_start_date} onChange={event=>setEventForm({ ...eventForm, build_up_start_date:event.target.value })} /></label>
            <label>Build-up end<input type="date" required min={eventForm.build_up_start_date || undefined} max={eventForm.event_start_date || undefined} value={eventForm.build_up_end_date} onChange={event=>setEventForm({ ...eventForm, build_up_end_date:event.target.value })} /></label>
            <label>Breakdown start<input type="date" required min={eventForm.event_end_date || eventForm.event_start_date || undefined} value={eventForm.breakdown_start_date} onChange={event=>setEventForm({ ...eventForm, breakdown_start_date:event.target.value })} /></label>
            <label>Breakdown end<input type="date" required min={eventForm.breakdown_start_date || undefined} value={eventForm.breakdown_end_date} onChange={event=>setEventForm({ ...eventForm, breakdown_end_date:event.target.value })} /></label>
            <label>Next event name<input maxLength="160" value={eventForm.next_event_name} onChange={event=>setEventForm({ ...eventForm, next_event_name:event.target.value })} placeholder="Optional rebooking destination" /></label>
            {isPlatformAdmin && <label className="tenant-internal-toggle"><input type="checkbox" checked={Boolean(eventForm.billing_exempt)} onChange={event=>setEventForm({ ...eventForm, billing_exempt:event.target.checked })} /><span>Internal ECE event (non-billable)<small>Excluded from client billing and event quota. Platform Admin only.</small></span></label>}
            <button type="submit" disabled={saving || !eventForm.client_id || !canManageClient(eventForm.client_id) || (!editingEventId && eventLimitReached)}>{editingEventId ? <Pencil size={15} /> : <Plus size={15} />} {editingEventId ? 'Save changes' : eventLimitReached ? 'Event limit reached' : 'Create event'}</button>
            {editingEventId && <button className="tenant-cancel-edit" type="button" disabled={saving} onClick={cancelEditEvent}><X size={15} /> Cancel edit</button>}
          </form>}
        </section>

        <section className="tenant-section" hidden={section !== 'suppliers'}>
          <div className="tenant-section-heading"><Building2 size={17} /><div><h2>Private suppliers</h2><p>Visible only to this organizer and reusable across its events.</p></div></div>
          {isPlatformAdmin && <label className="tenant-supplier-owner">Organizer<select value={supplierClientId} onChange={async event=>{setSupplierClientId(event.target.value);setPrivateSuppliers(await getSuppliers(event.target.value));}}><option value="">Select organization</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}
          {canManageSuppliers(supplierClientId) && <form className="tenant-form tenant-inline-form" onSubmit={addPrivateSupplier}>
            <h3>Add a private supplier</h3>
            <label>Supplier name<input required value={supplierForm.name} onChange={event=>setSupplierForm({ ...supplierForm, name:event.target.value })} /></label>
            <label>Contact person<input value={supplierForm.contact} onChange={event=>setSupplierForm({ ...supplierForm, contact:event.target.value })} /></label>
            <label>Email<input type="email" value={supplierForm.email} onChange={event=>setSupplierForm({ ...supplierForm, email:event.target.value })} /></label>
            <label>Mobile<input value={supplierForm.mobile} onChange={event=>setSupplierForm({ ...supplierForm, mobile:event.target.value })} /></label>
            <label>Service category<input value={supplierForm.category} onChange={event=>setSupplierForm({ ...supplierForm, category:event.target.value })} /></label>
            <button type="submit" disabled={saving || !supplierClientId}><Plus size={15} /> Add supplier</button>
          </form>}
          <div className="tenant-list">
            {privateSuppliers.map(supplier=><div className="tenant-list-row" key={supplier.id}><div className="tenant-event-details"><strong>{supplier.name}</strong><span>{[supplier.category, supplier.contact, supplier.email, supplier.mobile].filter(Boolean).join(' · ')}</span></div>{canManageSuppliers(supplierClientId) && <button className="tenant-remove-supplier" type="button" onClick={()=>deletePrivateSupplier(supplier)} title={`Remove ${supplier.name}`}><Trash2 size={14} /><span>Remove</span></button>}</div>)}
            {!privateSuppliers.length && <p className="tenant-empty">No private suppliers have been added for this organizer.</p>}
          </div>
        </section>

        <section className="tenant-section" hidden={section !== 'team'}>
          <div className="tenant-section-heading"><MailPlus size={17} /><div><h2>Invite team members</h2><p>Access is limited to the selected client and event scope.</p></div></div>
          <form className="tenant-form tenant-invite-form" onSubmit={inviteMember}>
            {isPlatformAdmin ? <label>Client<select required value={inviteForm.client_id} onChange={event=>setInviteForm({ ...inviteForm, client_id:event.target.value, event_id:'' })}><option value="">Select client</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label> : <p className="tenant-scope-note">Invitations are limited to your assigned organization.</p>}
            <label>Event<select value={inviteForm.event_id} onChange={event=>setInviteForm({ ...inviteForm, event_id:event.target.value })}><option value="">Organization-wide</option>{inviteClientEvents.map(event=><option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
            <label>Role<select value={inviteForm.role} onChange={event=>setInviteForm({ ...inviteForm, role:event.target.value })}><option value="staff">Staff</option><option value="ops">Operations</option><option value="event_admin">Event admin</option><option value="client_admin">Client admin</option></select></label>
            <label>Email<input required type="email" value={inviteForm.email} onChange={event=>setInviteForm({ ...inviteForm, email:event.target.value })} /></label>
            {selectedEvent && <p className="tenant-scope-note">Invitation scope: {selectedEvent.name}</p>}
            <button type="submit" disabled={saving || !inviteForm.client_id || !canInviteToScope(inviteForm.client_id, inviteForm.event_id)}><MailPlus size={15} /> Send invitation</button>
          </form>
        </section>
      </>}
    </main>
    </div>
  );
}

function BillingControls({ client, saving, onSave, volumePlans = VOLUME_PLANS }) {
  const [form, setForm] = useState({
    billing_plan:client.billing_plan || 'legacy',
    billing_mode:client.billing_mode || 'unmanaged',
    billing_status:client.billing_status || 'pending',
    prepaid_event_credits:client.prepaid_event_credits ?? 0,
    paid_through:client.paid_through || '',
    term_started_at:client.term_started_at || '',
    term_ends_at:client.term_ends_at || '',
    committed_events:client.committed_events ?? 0,
    trial_started_at:client.trial_started_at || '',
    trial_ends_at:client.trial_ends_at || '',
  });
  const [error, setError] = useState('');
  const monthly = form.billing_mode === 'monthly';
  const today = new Date().toISOString().slice(0, 10);
  const trialActive = form.billing_mode === 'trial' && form.billing_status === 'active' && form.trial_started_at <= today && form.trial_ends_at > today;
  const trialExpired = form.billing_mode === 'trial' && form.trial_ends_at && form.trial_ends_at <= today;

  async function startDemoTrial() {
    if (form.trial_started_at) return;
    const trialStartedAt = new Date().toISOString().slice(0, 10);
    const trialEnd = new Date(`${trialStartedAt}T00:00:00.000Z`);
    trialEnd.setUTCDate(trialEnd.getUTCDate() + 30);
    setError('');
    const saved = await onSave(client.id, {
      billing_mode:'trial',
      billing_plan:'legacy',
      billing_status:'active',
      trial_started_at:trialStartedAt,
      trial_ends_at:trialEnd.toISOString().slice(0, 10),
      prepaid_event_credits:0,
      paid_through:null,
      term_started_at:null,
      term_ends_at:null,
      committed_events:0,
    });
    if (saved) setForm(current => ({ ...current, ...saved, paid_through:saved.paid_through || '', term_started_at:saved.term_started_at || '', term_ends_at:saved.term_ends_at || '', trial_started_at:saved.trial_started_at || '', trial_ends_at:saved.trial_ends_at || '' }));
  }

  async function submit(event) {
    event.preventDefault();
    const credits = Number(form.prepaid_event_credits);
    if (!Number.isInteger(credits) || credits < 0) {
      setError('Enter a non-negative whole number of credits.');
      return;
    }
    if (monthly && form.billing_status === 'active' && (!form.term_started_at || !form.term_ends_at || !form.paid_through || form.term_started_at > form.term_ends_at)) {
      setError('Enter valid term dates and a paid-through date before activating a monthly plan.');
      return;
    }
    const plan = volumePlans.find(item => item.id === form.billing_plan);
    const committedEvents = Number(form.committed_events);
    if (monthly && (!Number.isInteger(committedEvents) || committedEvents < 1 || (plan && (committedEvents < plan.eventsPerYear || committedEvents > plan.maxEvents)))) {
      setError(plan ? `Enter a commitment from ${plan.eventsPerYear} to ${plan.maxEvents} events.` : 'Enter a positive number of committed events.');
      return;
    }
    setError('');
    const saved = await onSave(client.id, {
      billing_plan:form.billing_plan,
      billing_mode:form.billing_mode,
      billing_status:form.billing_status,
      prepaid_event_credits:credits,
      paid_through:form.paid_through || null,
      term_started_at:form.term_started_at || null,
      term_ends_at:form.term_ends_at || null,
      committed_events:monthly ? committedEvents : 0,
      trial_started_at:form.trial_started_at || null,
      trial_ends_at:form.trial_ends_at || null,
    });
    if (saved) setForm(current => ({ ...current, ...saved, paid_through:saved.paid_through || '', term_started_at:saved.term_started_at || '', term_ends_at:saved.term_ends_at || '', trial_started_at:saved.trial_started_at || '', trial_ends_at:saved.trial_ends_at || '' }));
  }

  return <details>
    <summary>Billing and access: {trialActive ? '30-day trial' : trialExpired ? 'trial expired' : client.billing_status || 'pending'}</summary>
    <form className="tenant-form" onSubmit={submit}>
      <label>Plan<select value={form.billing_mode === 'trial' ? 'trial' : form.billing_plan} onChange={event=>{ const nextPlan=event.target.value; const plan=volumePlans.find(item=>item.id === nextPlan); const billingMode=nextPlan === 'trial' ? 'trial' : nextPlan === 'legacy' ? 'unmanaged' : nextPlan === 'pay_per_event' ? 'prepaid' : 'monthly'; setForm({ ...form, billing_plan:nextPlan === 'trial' ? 'legacy' : nextPlan, billing_mode:billingMode, committed_events:plan?.eventsPerYear || 0 }); }}>
        {form.trial_started_at && <option value="trial">30-day demo trial</option>}
        <option value="legacy">Legacy / unmanaged</option><option value="pay_per_event">Pay per event</option>
        {volumePlans.map(plan=><option key={plan.id} value={plan.id}>{plan.eventsPerYear}–{plan.maxEvents} events / year ({plan.discountPct}%)</option>)}
        {monthly && form.billing_plan !== 'enterprise' && !volumePlans.some(plan=>plan.id === form.billing_plan) && <option value={form.billing_plan}>Previous plan ({form.billing_plan})</option>}
        <option value="enterprise">Enterprise / negotiated</option>
      </select></label>
      <label>Access status<select value={form.billing_status} onChange={event=>setForm({ ...form, billing_status:event.target.value })}>
        {['pending','active','past_due','suspended','cancelled'].map(status=><option key={status} value={status}>{status.replace('_', ' ')}</option>)}
      </select></label>
      {form.billing_plan === 'pay_per_event' && <label>Prepaid event credits<input type="number" min="0" step="1" required value={form.prepaid_event_credits} onChange={event=>setForm({ ...form, prepaid_event_credits:event.target.value })} /></label>}
      {monthly && <><label>Committed events<input type="number" min="1" step="1" required value={form.committed_events} onChange={event=>setForm({ ...form, committed_events:event.target.value })} /></label><label>Approved additional event credits<input type="number" min="0" step="1" required value={form.prepaid_event_credits} onChange={event=>setForm({ ...form, prepaid_event_credits:event.target.value })} /><small>Credits reset when the term start changes.</small></label><label>Term start<input type="date" value={form.term_started_at} onChange={event=>setForm({ ...form, term_started_at:event.target.value })} /></label><label>Term end<input type="date" value={form.term_ends_at} onChange={event=>setForm({ ...form, term_ends_at:event.target.value })} /></label><label>Paid through<input type="date" value={form.paid_through} onChange={event=>setForm({ ...form, paid_through:event.target.value })} /></label></>}
      {(trialActive || trialExpired) && <p className="tenant-trial-status">{trialActive ? `Demo trial active until ${form.trial_ends_at}.` : `Demo trial expired on ${form.trial_ends_at}; active access is off.`}</p>}
      {!form.trial_started_at && <button className="tenant-start-trial" type="button" disabled={saving} onClick={startDemoTrial}><CalendarDays size={15} /> Start 30-day demo trial</button>}
      {error && <p className="tenant-error" role="alert">{error}</p>}
      <button type="submit" disabled={saving}>Save access settings</button>
    </form>
  </details>;
}