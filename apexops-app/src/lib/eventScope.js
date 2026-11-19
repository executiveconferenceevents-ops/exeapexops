import { supabase } from './supabase';
import { DEMO_MODE, getDemoCollection } from './demoStore';
import { getCacheRecord, saveCacheRecord } from './offlineDb';

const LEGACY_DEMO_EVENT_SLUG = 'esg-africa-2026';
const DEFAULT_EVENT_SLUG = DEMO_MODE ? 'apexops-expo-demo-2026' : process.env.REACT_APP_DEFAULT_EVENT_SLUG || LEGACY_DEMO_EVENT_SLUG;
const ACTIVE_EVENT_KEY = 'apexops-active-event-v1';
const DEMO_EVENT_ID = 'demo-event-esg-africa-2026';
const DEMO_EVENT_CODE = 'APEXDM-20260930';
export const PRIVACY_NOTICE_VERSION = '2026-10-04-v1';
let activeEvent = null;

function presentDemoEvent(event) {
  if (!DEMO_MODE || event?.id !== DEMO_EVENT_ID) return event;
  return { ...event, name:'APEX Expo Demo 2026', next_event_name:'APEX Expo Demo 2027', slug:DEFAULT_EVENT_SLUG, exhibitor_code:DEMO_EVENT_CODE };
}

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
  const slug = (querySlug || activeEvent?.slug || DEFAULT_EVENT_SLUG).trim().toLowerCase();
  return DEMO_MODE && slug === LEGACY_DEMO_EVENT_SLUG ? DEFAULT_EVENT_SLUG : slug;
}

export function getActiveEvent() {
  if (activeEvent) return activeEvent;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(ACTIVE_EVENT_KEY) || 'null');
    if (stored?.id && stored?.slug) activeEvent = presentDemoEvent(stored);
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
      id:DEMO_EVENT_ID, client_id:clients[0]?.id || 'demo-client-ece', clients:clients[0], name:'APEX Expo Demo 2026',
      event_start_date:'2026-09-30', event_end_date:'2026-10-01', build_up_start_date:'2026-09-29', build_up_end_date:'2026-09-29',
      event_start_time:'09:00', event_end_time:'17:00', build_up_start_time:'08:00', build_up_end_time:'18:00',
      breakdown_start_time:'17:00', breakdown_end_time:'20:00',
      breakdown_start_date:'2026-10-01', breakdown_end_date:'2026-10-01', next_event_name:'APEX Expo Demo 2027',
      slug:DEFAULT_EVENT_SLUG, exhibitor_code:DEMO_EVENT_CODE, is_public:true, logo_url:'',
    }]).map(event => presentDemoEvent({ ...event, clients:clients.find(client => client.id === event.client_id) || event.clients }));
  }
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return [];
  return loadCachedPublicValue(`available-events:${userId}`, async () => {
    const { data, error } = await supabase
      .from('events')
      .select('id, client_id, name, event_start_date, event_start_time, event_end_date, event_end_time, build_up_start_date, build_up_start_time, build_up_end_date, build_up_end_time, breakdown_start_date, breakdown_start_time, breakdown_end_date, breakdown_end_time, next_event_name, slug, is_public, logo_url, billing_exempt, clients(name)')
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
      supabase.from('client_event_memberships').select('client_id, event_id, role').eq('user_id', userId),
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

export async function resolvePublicEvent(slug = getEventSlug(), accessCode, { requireOnline = false } = {}) {
  const normalizedSlug = String(slug || DEFAULT_EVENT_SLUG).trim().toLowerCase();
  const requestedSlug = DEMO_MODE && normalizedSlug === LEGACY_DEMO_EVENT_SLUG ? DEFAULT_EVENT_SLUG : normalizedSlug;
  if (DEMO_MODE) {
    const event = (await getAvailableEvents()).find(item => item.slug === requestedSlug && item.is_public);
    const enteredCode = String(accessCode || '').trim().toUpperCase();
    const legacyCode = requestedSlug === DEFAULT_EVENT_SLUG && enteredCode === 'ESGAF-20260930';
    if (!event || (enteredCode !== event.exhibitor_code && !legacyCode)) return null;
    return { ...event, accessCode:event.exhibitor_code };
  }
  if (!supabase) return null;
  const normalizedCode = String(accessCode || '').trim().toUpperCase();
  if (!normalizedCode) return null;
  const loadEvent = async () => {
    const { data, error } = await supabase.rpc('get_public_event', { requested_slug:requestedSlug, requested_code:normalizedCode });
    if (error) throw error;
    return Array.isArray(data) ? data[0] || null : data;
  };
  const event = requireOnline ? await loadEvent() : await loadCachedPublicValue(`public-event:${requestedSlug}:${await hashCode(normalizedCode)}`, loadEvent);
  return event ? { ...event, accessCode:normalizedCode } : null;
}

export function getActiveClientId() {
  const clientId = getActiveEvent()?.client_id;
  if (!clientId) throw new Error('Choose an organizer event before opening its supplier directory.');
  return clientId;
}