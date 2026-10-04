import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getAvailableEvents, setActiveEvent } from '../lib/eventScope';
import { Building2, CalendarDays, MailPlus, Plus, RefreshCw } from 'lucide-react';

const emptyClient = { name:'', slug:'' };
const emptyEvent = { client_id:'', name:'', slug:'', event_start_date:'', event_end_date:'', build_up_start_date:'', build_up_end_date:'', breakdown_start_date:'', breakdown_end_date:'', next_event_name:'' };
const emptyInvite = { client_id:'', event_id:'', email:'', role:'staff' };

export default function ClientEventAdmin() {
  const [clients, setClients] = useState([]);
  const [events, setEvents] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [clientForm, setClientForm] = useState(emptyClient);
  const [eventForm, setEventForm] = useState(emptyEvent);
  const [inviteForm, setInviteForm] = useState(emptyInvite);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    if (!supabase) {
      setError('Client and event administration requires a connected Supabase project.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [availableEvents, membershipResult, adminResult] = await Promise.all([
        getAvailableEvents(),
        supabase.from('client_event_memberships').select('client_id, event_id, role'),
        supabase.rpc('is_platform_admin'),
      ]);
      if (membershipResult.error) throw membershipResult.error;
      if (adminResult.error) throw adminResult.error;
      const platformAdmin = Boolean(adminResult.data);
      const currentMemberships = membershipResult.data || [];
      const managedClientId = currentMemberships.find(membership => membership.role === 'client_admin' && !membership.event_id)?.client_id || '';
      let visibleClients = [];
      if (platformAdmin) {
        const { data, error: clientsError } = await supabase.from('clients').select('id, name, slug').order('name');
        if (clientsError) throw clientsError;
        visibleClients = data || [];
      }
      setClients(visibleClients);
      setEvents(availableEvents);
      setMemberships(currentMemberships);
      setIsPlatformAdmin(platformAdmin);
      setEventForm(current => ({ ...current, client_id:platformAdmin ? current.client_id || visibleClients[0]?.id || '' : managedClientId }));
      setInviteForm(current => ({ ...current, client_id:platformAdmin ? current.client_id || visibleClients[0]?.id || '' : managedClientId }));
    } catch (loadError) {
      setError(loadError?.message || 'Could not load client and event access.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  const canManageClient = clientId => isPlatformAdmin || memberships.some(membership =>
    membership.client_id === clientId && membership.role === 'client_admin' && !membership.event_id);
  const canInviteToScope = (clientId, eventId) => isPlatformAdmin || memberships.some(membership =>
    membership.client_id === clientId && membership.role === 'client_admin'
      && (!membership.event_id || membership.event_id === eventId)
      && (eventId || !membership.event_id));
  const selectedEvent = events.find(event => event.id === inviteForm.event_id);
  const inviteClientEvents = events.filter(event => event.client_id === inviteForm.client_id);

  async function createClient(event) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { error: createError } = await supabase.rpc('create_client', {
        requested_name:clientForm.name.trim(),
        requested_slug:clientForm.slug.trim().toLowerCase(),
      });
      if (createError) throw createError;
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
    if (!supabase) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data, error: createError } = await supabase.from('events').insert({
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
      }).select('id, client_id, name, event_start_date, event_end_date, build_up_start_date, build_up_end_date, breakdown_start_date, breakdown_end_date, next_event_name, slug, exhibitor_code, is_public').single();
      if (createError) throw createError;
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

  async function inviteMember(event) {
    event.preventDefault();
    if (!supabase) return;
    if (!inviteForm.event_id && inviteForm.role !== 'client_admin') {
      setError('Choose an event for event administrators, operations, or staff invitations.');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { data, error: inviteError } = await supabase.functions.invoke('invite-event-member', {
        body: {
          clientId:inviteForm.client_id,
          eventId:inviteForm.event_id || null,
          email:inviteForm.email.trim(),
          role:inviteForm.role,
        },
      });
      if (inviteError) throw inviteError;
      setNotice(data?.message || `Invitation sent to ${inviteForm.email.trim()}.`);
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
            {events.map(event => <div className="tenant-list-row" key={event.id}><div className="tenant-event-details"><strong>{event.name}{event.next_event_name ? ` · Rebooking ${event.next_event_name}` : ''}</strong><span>Event {event.event_start_date} to {event.event_end_date} · Build-up {event.build_up_start_date} to {event.build_up_end_date} · Breakdown {event.breakdown_start_date} to {event.breakdown_end_date}</span></div><span className="tenant-event-access"><code>?event={event.slug}</code><code>Exhibitor code: {event.exhibitor_code}</code></span></div>)}
            {!events.length && <p className="tenant-empty">No events are assigned to your account.</p>}
          </div>
          <form className="tenant-form tenant-inline-form" onSubmit={createEvent}>
            <h3>Create event</h3>
            {isPlatformAdmin ? <label>Client<select required value={eventForm.client_id} onChange={event=>setEventForm({ ...eventForm, client_id:event.target.value })}><option value="">Select client</option>{clients.map(client=><option key={client.id} value={client.id}>{client.name}</option>)}</select></label> : <p className="tenant-scope-note">New events will be created within your assigned organization.</p>}
            <label>Event name<input required maxLength="160" value={eventForm.name} onChange={event=>setEventForm({ ...eventForm, name:event.target.value })} /></label>
            <label>URL slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={eventForm.slug} onChange={event=>setEventForm({ ...eventForm, slug:event.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'') })} /></label>
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