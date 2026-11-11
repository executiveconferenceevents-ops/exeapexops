import { supabase } from './supabase';
import { DEMO_MODE, getDemoCollection } from './demoStore';
import { getCacheRecord, saveCacheRecord } from './offlineDb';

const DEFAULT_EVENT_SLUG = process.env.REACT_APP_DEFAULT_EVENT_SLUG || 'esg-africa-2026';
const ACTIVE_EVENT_KEY = 'apexops-active-event-v1';
export const PRIVACY_NOTICE_VERSION = '2026-10-04-v1';
let activeEvent = null;

async function loadCachedPublicValue(key, loader) {
  const cached = await getCacheRecord(key);
  if (typeof navigator !== 'undefined' && navigator.onLine === false && cached) return cached.value;
  try {
    const value = await loader();
    await saveCacheRecord({ key, value, savedAt:Date.now() });
    return value;
  } catch (error) {
    if (cached && /failed to fetch|networkerror|network request failed|load failed|fetcherror|timeout/i.test(`${error?.name || ''} ${error?.message || ''}`)) return cached.value;
    throw error;
  }
}

async function hashCode(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '').trim().toUpperCase()));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function getEventSlug() {
  const querySlug = new URLSearchParams(window.location.search).get('event');
  return (querySlug || activeEvent?.slug || DEFAULT_EVENT_SLUG).trim().toLowerCase();
}

export function getActiveEvent() {
  if (activeEvent) return activeEvent;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(ACTIVE_EVENT_KEY) || 'null');
    if (stored?.id && stored?.slug) activeEvent = stored;
  } catch { /* session storage may be unavailable */ }
  return activeEvent;
}

export function getActiveEventId() {
  const eventId = getActiveEvent()?.id;
  if (!eventId) throw new Error('Choose an event before opening this workspace.');
  return eventId;
}

export function getActiveEventCode() {
  const eventCode = getActiveEvent()?.accessCode;
  if (!eventCode) throw new Error('Enter the event code provided by the organiser.');
  return eventCode;
}

export function setActiveEvent(event) {
  activeEvent = event ? { ...event, slug: String(event.slug).trim().toLowerCase() } : null;
  try {
    if (activeEvent) {
      const { accessCode, ...shareableEvent } = activeEvent;
      window.sessionStorage.setItem(ACTIVE_EVENT_KEY, JSON.stringify(shareableEvent));
    }
    else window.sessionStorage.removeItem(ACTIVE_EVENT_KEY);
  } catch { /* the in-memory event remains available for this page */ }
  if (activeEvent?.slug) {
    const url = new URL(window.location.href);
    url.searchParams.set('event', activeEvent.slug);
    window.history.replaceState(window.history.state, '', url);
  }
  return activeEvent;
}

export function clearActiveEvent() {
  activeEvent = null;
  try { window.sessionStorage.removeItem(ACTIVE_EVENT_KEY); }
  catch { /* session storage may be unavailable */ }
}

export async function getAvailableEvents() {
  if (DEMO_MODE) {
    const clients = getDemoCollection('clients', [{ id:'demo-client-ece', name:'Executive Conference Events', slug:'executive-conference-events' }]);
    return getDemoCollection('events', [{
      id:'demo-event-esg-africa-2026', client_id:clients[0]?.id || 'demo-client-ece', clients:clients[0], name:'ESG Africa 2026',
      event_start_date:'2026-09-30', event_end_date:'2026-10-01', build_up_start_date:'2026-09-29', build_up_end_date:'2026-09-29',
      breakdown_start_date:'2026-10-01', breakdown_end_date:'2026-10-01', next_event_name:'ESG Africa 2027',
      slug:DEFAULT_EVENT_SLUG, exhibitor_code:'ESGAF-20260930', is_public:true, logo_url:'',
    }]).map(event => ({ ...event, clients:clients.find(client => client.id === event.client_id) || event.clients }));
  }
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return [];
  return loadCachedPublicValue(`available-events:${userId}`, async () => {
    const { data, error } = await supabase
      .from('events')
      .select('id, client_id, name, event_start_date, event_end_date, build_up_start_date, build_up_end_date, breakdown_start_date, breakdown_end_date, next_event_name, slug, is_public, logo_url, clients(name)')
      .order('name');
    if (error) throw error;
    return data || [];
  });
}

export async function getUserEventAccess(userId) {
  if (!supabase || !userId) return { platformAdmin:false, memberships:[] };
  return loadCachedPublicValue(`event-access:${userId}`, async () => {
    const [adminResult, membershipResult] = await Promise.all([
      supabase.rpc('is_platform_admin'),
      supabase.from('client_event_memberships').select('client_id, event_id, role'),
    ]);
    if (adminResult.error) throw adminResult.error;
    if (membershipResult.error) throw membershipResult.error;
    return { platformAdmin:Boolean(adminResult.data), memberships:membershipResult.data || [] };
  });
}

export async function getEventAccessCode(eventId) {
  if (DEMO_MODE) {
    const event = (await getAvailableEvents()).find(item => item.id === eventId);
    return event?.exhibitor_code || '';
  }
  if (!supabase) return '';
  const { data, error } = await supabase.rpc('get_event_access_code', { requested_event_id:eventId });
  if (error?.code === 'PGRST202') {
    const { data:legacyEvent, error:legacyError } = await supabase.from('events').select('exhibitor_code').eq('id', eventId).maybeSingle();
    if (legacyError) throw legacyError;
    return legacyEvent?.exhibitor_code || '';
  }
  if (error) throw error;
  return data || '';
}

export async function getPublicEvents() {
  if (DEMO_MODE) return (await getAvailableEvents()).filter(event => event.is_public).map(event => ({
    client_name:event.clients?.name || 'Organizer', event_name:event.name, event_start_date:event.event_start_date,
    event_end_date:event.event_end_date, build_up_start_date:event.build_up_start_date, build_up_end_date:event.build_up_end_date,
    breakdown_start_date:event.breakdown_start_date, breakdown_end_date:event.breakdown_end_date,
    slug:event.slug, next_event_name:event.next_event_name, logo_url:event.logo_url || '',
  }));
  if (!supabase) return [];
  return loadCachedPublicValue('public-events', async () => {
    const { data, error } = await supabase.rpc('list_public_events');
    if (error) throw error;
    return data || [];
  });
}

export async function resolvePublicEvent(slug = getEventSlug(), accessCode) {
  const requestedSlug = String(slug || DEFAULT_EVENT_SLUG).trim().toLowerCase();
  if (DEMO_MODE) {
    const event = (await getAvailableEvents()).find(item => item.slug === requestedSlug && item.is_public);
    if (!event || String(accessCode || '').trim().toUpperCase() !== event.exhibitor_code) return null;
    return { ...event, accessCode:event.exhibitor_code };
  }
  if (!supabase) return null;
  const normalizedCode = String(accessCode || '').trim().toUpperCase();
  if (!normalizedCode) return null;
  const cacheKey = `public-event:${requestedSlug}:${await hashCode(normalizedCode)}`;
  const event = await loadCachedPublicValue(cacheKey, async () => {
    const { data, error } = await supabase.rpc('get_public_event', { requested_slug:requestedSlug, requested_code:normalizedCode });
    if (error) throw error;
    return Array.isArray(data) ? data[0] || null : data;
  });
  return event ? { ...event, accessCode:normalizedCode } : null;
}

export function getActiveClientId() {
  const clientId = getActiveEvent()?.client_id;
  if (!clientId) throw new Error('Choose an organizer event before opening its supplier directory.');
  return clientId;
}