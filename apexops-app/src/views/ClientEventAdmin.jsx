import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getAvailableEvents, setActiveEvent } from '../lib/eventScope';
import { DEMO_MODE, getDemoCollection, setDemoCollection } from '../lib/demoStore';
import { getSuppliers, removeSupplier, upsertSuppliers, uploadPublicImage } from '../lib/mock';
import { Building2, CalendarDays, MailPlus, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';

const emptyClient = { name:'', slug:'' };
const emptyEvent = { client_id:'', name:'', slug:'', event_start_date:'', event_end_date:'', build_up_start_date:'', build_up_end_date:'', breakdown_start_date:'', breakdown_end_date:'', next_event_name:'', logo_file:null };
const emptyInvite = { client_id:'', event_id:'', email:'', role:'staff' };
const emptySupplier = { name:'', contact:'', email:'', mobile:'', category:'Other' };

export default function ClientEventAdmin() {
  const [clients, setClients] = useState([]);
  const [events, setEvents] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [privateSuppliers, setPrivateSuppliers] = useState([]);
  const [supplierClientId, setSupplierClientId] = useState('');
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [clientForm, setClientForm] = useState(emptyClient);
  const [eventForm, setEventForm] = useState(emptyEvent);
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
      if (DEMO_MODE) {
        platformAdmin = true;
        currentMemberships = getDemoCollection('memberships', [{ client_id:'demo-client-ece', event_id:null, role:'client_admin' }]);
        visibleClients = getDemoCollection('clients', [{ id:'demo-client-ece', name:'Executive Conference Events', slug:'executive-conference-events' }]);
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
          const { data, error: clientsError } = await supabase.from('clients').select('id, name, slug').order('name');
          if (clientsError) throw clientsError;
          visibleClients = data || [];
        }
      }
      const managedClientId = currentMemberships.find(membership => membership.role === 'client_admin' && !membership.event_id)?.client_id || '';
      setClients(visibleClients);
      setEvents(availableEvents);
      setMemberships(currentMemberships);
      setIsPlatformAdmin(platformAdmin);
      setEventForm(current => ({ ...current, client_id:platformAdmin ? current.client_id || visibleClients[0]?.id || '' : managedClientId }));
      setInviteForm(current => ({ ...current, client_id:platformAdmin ? current.client_id || visibleClients[0]?.id || '' : managedClientId }));
      const supplierScope = platformAdmin ? supplierClientId || visibleClients[0]?.id || '' : managedClientId;
      setSupplierClientId(supplierScope);
      setPrivateSuppliers(supplierScope ? await getSuppliers(supplierScope) : []);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load client and event access.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const canManageClient = clientId => isPlatformAdmin || memberships.some(membership =>
    membership.client_id === clientId && membership.role === 'client_admin' && !membership.event_id);
  const canManageSuppliers = clientId => canManageClient(clientId);
  const canInviteToScope = (clientId, eventId) => isPlatformAdmin || memberships.some(membership =>
    membership.client_id === clientId && membership.role === 'client_admin'
      && (!membership.event_id || membership.event_id === eventId)
      && (eventId || !membership.event_id));
  const selectedEvent = events.find(event => event.id === inviteForm.event_id);
  const inviteClientEvents = events.filter(event => event.client_id === inviteForm.client_id);

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
      if (DEMO_MODE) {
        const clients = getDemoCollection('clients', []);
        if (clients.some(client => client.slug === slug)) throw new Error('That organization URL slug is already in use.');
        setDemoCollection('clients', [...clients, { id:`demo-client-${crypto.randomUUID()}`, name, slug }]);
      } else {
        const { error: createError } = await supabase.rpc('create_client', {
          requested_name:name,
          requested_slug:slug,
        });
        if (createError) throw createError;
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
          .select('id, client_id, name, event_start_date, event_end_date, build_up_start_date, build_up_end_date, breakdown_start_date, breakdown_end_date, next_event_name, slug, exhibitor_code, is_public, logo_url').single();
        if (createError) throw createError;
        data = createdEvent;
      }
      setEventForm(current => ({ ...emptyEvent, client_id:current.client_id }));
      await refresh();
      setActiveEvent(data);
      setNotice(`Event created. Public links can use ?event=${data.slug}.`);
    } catch (saveError) {
      setError(saveError?.message || 'Could not create the event.');
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

  return (
    <main className="tenant-admin-page">
      <header className="tenant-admin-heading">
        <div className="tenant-admin-kicker">APEXOPS™ · PLATFORM</div>
        <h1>Clients &amp; Events</h1>
        <p>{isPlatformAdmin ? 'Create client organizations after payment is confirmed, then provision their events and teams.' : 'Create events and manage team access within your assigned organization.'}</p>
        <button className="tenant-refresh" type="button" onClick={refresh} disabled={loading || saving} title="Refresh organizations and events"><RefreshCw size={15} /> Refresh</button>
      </header>

      {error && <div className="tenant-feedback tenant-error" role="alert">{error}</div>}
      {notice && <div className="tenant-feedback tenant-notice" role="status">{notice}</div>}
      {loading ? <div className="tenant-loading">Loading clients, events and access…</div> : <>
        {isPlatformAdmin && <section className="tenant-section">
          <div className="tenant-section-heading"><Building2 size={17} /><div><h2>Client organizations</h2><p>{clients.length} available to your account</p></div></div>
          <div className="tenant-list">
            {clients.map(client => <div className="tenant-list-row" key={client.id}><strong>{client.name}</strong><code>{client.slug}</code></div>)}
            {!clients.length && <p className="tenant-empty">No organizations are assigned to your account.</p>}
          </div>
          {isPlatformAdmin && <form className="tenant-form tenant-inline-form" onSubmit={createClient}>
            <h3>Create organization after payment confirmation</h3>
            <label>Organization name<input required maxLength="160" value={clientForm.name} onChange={event=>setClientForm({ ...clientForm, name:event.target.value })} /></label>
            <label>URL slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={clientForm.slug} onChange={event=>setClientForm({ ...clientForm, slug:event.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'') })} /></label>
            <button type="submit" disabled={saving}><Plus size={15} /> Create client</button>
          </form>}
        </section>}

        <section className="tenant-section">
          <div className="tenant-section-heading"><CalendarDays size={17} /><div><h2>Event workspaces</h2><p>Each event has isolated staff, exhibitors, requests and reports.</p></div></div>
          <div className="tenant-list">
            {events.map(event => <div className="tenant-list-row" key={event.id}><div className="tenant-event-details"><strong>{event.name}{event.next_event_name ? ` · Rebooking ${event.next_event_name}` : ''}</strong><span>Event {event.event_start_date} to {event.event_end_date} · Build-up {event.build_up_start_date} to {event.build_up_end_date} · Breakdown {event.breakdown_start_date} to {event.breakdown_end_date}</span></div><span className="tenant-event-access"><code>?event={event.slug}</code><code>Exhibitor code: {event.exhibitor_code}</code></span><label className="tenant-event-logo-action" title={`${event.logo_url ? 'Change' : 'Upload'} ${event.name} logo`}>{event.logo_url ? <img src={event.logo_url} alt={`${event.name} logo`} /> : <Upload size={14} />}<span>{event.logo_url ? 'Change logo' : 'Upload logo'}</span><input type="file" accept="image/png,image/jpeg,image/webp" aria-label={`${event.logo_url ? 'Change' : 'Upload'} logo for ${event.name}`} disabled={saving} onChange={inputEvent=>{const file=inputEvent.target.files?.[0];if(file)updateEventLogo(event,file);inputEvent.target.value='';}} /></label></div>)}
            {!events.length && <p className="tenant-empty">No events are assigned to your account.</p>}
          </div>
          <form className="tenant-form tenant-inline-form" onSubmit={createEvent}>
            <h3>Create event</h3>
            {isPlatformAdmin ? <label>Client<select required value={eventForm.client_id} onChange={event=>setEventForm({ ...eventForm, client_id:event.target.value })}><option value="">Select client</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label> : <p className="tenant-scope-note">New events will be created within your assigned organization.</p>}
            <label>Event name<input required maxLength="160" value={eventForm.name} onChange={event=>setEventForm({ ...eventForm, name:event.target.value })} /></label>
            <label>URL slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={eventForm.slug} onChange={event=>setEventForm({ ...eventForm, slug:event.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'') })} /></label>
            <label>Event logo (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event=>setEventForm({ ...eventForm, logo_file:event.target.files?.[0] || null })} /><small>PNG, JPG, or WebP; maximum 2 MB.</small></label>
            <label>Event start date<input type="date" required value={eventForm.event_start_date} onChange={event=>setEventForm({ ...eventForm, event_start_date:event.target.value })} /></label>
            <label>Event end date<input type="date" required min={eventForm.event_start_date || undefined} value={eventForm.event_end_date} onChange={event=>setEventForm({ ...eventForm, event_end_date:event.target.value })} /></label>
            <label>Build-up start<input type="date" required max={eventForm.event_start_date || undefined} value={eventForm.build_up_start_date} onChange={event=>setEventForm({ ...eventForm, build_up_start_date:event.target.value })} /></label>
            <label>Build-up end<input type="date" required min={eventForm.build_up_start_date || undefined} max={eventForm.event_start_date || undefined} value={eventForm.build_up_end_date} onChange={event=>setEventForm({ ...eventForm, build_up_end_date:event.target.value })} /></label>
            <label>Breakdown start<input type="date" required min={eventForm.event_end_date || eventForm.event_start_date || undefined} value={eventForm.breakdown_start_date} onChange={event=>setEventForm({ ...eventForm, breakdown_start_date:event.target.value })} /></label>
            <label>Breakdown end<input type="date" required min={eventForm.breakdown_start_date || undefined} value={eventForm.breakdown_end_date} onChange={event=>setEventForm({ ...eventForm, breakdown_end_date:event.target.value })} /></label>
            <label>Next event name<input maxLength="160" value={eventForm.next_event_name} onChange={event=>setEventForm({ ...eventForm, next_event_name:event.target.value })} placeholder="Optional rebooking destination" /></label>
            <button type="submit" disabled={saving || !eventForm.client_id || !canManageClient(eventForm.client_id)}><Plus size={15} /> Create event</button>
          </form>
        </section>

        <section className="tenant-section">
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

        <section className="tenant-section">
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
  );
}