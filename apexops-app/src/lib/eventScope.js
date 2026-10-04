import { supabase } from './supabase';
import { DEMO_MODE } from './demoStore';

const DEFAULT_EVENT_SLUG = process.env.REACT_APP_DEFAULT_EVENT_SLUG || 'esg-africa-2026';
const ACTIVE_EVENT_KEY = 'apexops-active-event-v1';
let activeEvent = null;

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
    return [{ id:'demo-event-esg-africa-2026', client_id:'demo-client-ece', name:'ESG Africa 2026', event_start_date:'2026-09-30', event_end_date:'2026-10-01', build_up_start_date:'2026-09-29', build_up_end_date:'2026-09-29', breakdown_start_date:'2026-10-01', breakdown_end_date:'2026-10-01', next_event_name:'ESG Africa 2027', slug:DEFAULT_EVENT_SLUG, exhibitor_code:'ESGAF-20260930', is_public:true }];
  }
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('events')
    .select('id, client_id, name, event_start_date, event_end_date, build_up_start_date, build_up_end_date, breakdown_start_date, breakdown_end_date, next_event_name, slug, exhibitor_code, is_public, clients(name)')
    .order('name');
  if (error) throw error;
  return data || [];
}

export async function getPublicEvents() {
  if (DEMO_MODE) return [{ client_name:'Executive Conference Events', event_name:'ESG Africa 2026', event_start_date:'2026-09-30', event_end_date:'2026-10-01', slug:DEFAULT_EVENT_SLUG, next_event_name:'ESG Africa 2027' }];
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('list_public_events');
  if (error) throw error;
  return data || [];
}

export async function resolvePublicEvent(slug = getEventSlug(), accessCode) {
  const requestedSlug = String(slug || DEFAULT_EVENT_SLUG).trim().toLowerCase();
  if (DEMO_MODE) {
    if (String(accessCode || '').trim().toUpperCase() !== 'ESGAF-20260930') return null;
    return { id:'demo-event-esg-africa-2026', client_id:'demo-client-ece', name:'ESG Africa 2026', event_start_date:'2026-09-30', event_end_date:'2026-10-01', build_up_start_date:'2026-09-29', build_up_end_date:'2026-09-29', breakdown_start_date:'2026-10-01', breakdown_end_date:'2026-10-01', next_event_name:'ESG Africa 2027', slug:requestedSlug, accessCode:'ESGAF-20260930', is_public:true };
  }
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_public_event', { requested_slug:requestedSlug, requested_code:String(accessCode || '').trim().toUpperCase() });
  if (error) throw error;
  const event = Array.isArray(data) ? data[0] || null : data;
  return event ? { ...event, accessCode:String(accessCode).trim().toUpperCase() } : null;
}