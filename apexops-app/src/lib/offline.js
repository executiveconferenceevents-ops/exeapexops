// Offline write queue and read cache. Queued operations replay in order once the network returns.
import { supabase } from './supabase';
import { STATUS_FLOW } from './mock';

const QUEUE_KEY = 'apexops.offline-queue';
const FAILED_KEY = 'apexops.offline-failed';
const CACHE_PREFIX = 'apexops.cache:';

const listeners = new Set();
let flushing = false;

function read(key, fallback) {
  try { return JSON.parse(window.localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function write(key, value) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); }
  catch { /* storage full or unavailable */ }
}

function notify() {
  const state = getOfflineState();
  listeners.forEach(listener => listener(state));
}

export function isNetworkError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const text = `${error?.name || ''} ${error?.message || ''}`;
  return /failed to fetch|networkerror|network request failed|load failed|fetcherror|timeout/i.test(text);
}

export function getOfflineState() {
  return { pending: read(QUEUE_KEY, []).length, failed: read(FAILED_KEY, []).length, online: typeof navigator === 'undefined' || navigator.onLine };
}

export function subscribeOffline(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pendingOps(type) {
  return read(QUEUE_KEY, []).filter(op => op.type === type);
}

export function enqueue(type, payload) {
  const queue = read(QUEUE_KEY, []);
  queue.push({ opId: crypto.randomUUID(), type, payload, queuedAt: new Date().toISOString() });
  write(QUEUE_KEY, queue);
  notify();
}

export function clearFailed() {
  write(FAILED_KEY, []);
  notify();
}

export function getFailedOps() {
  return read(FAILED_KEY, []);
}

export async function cachedRead(key, loader) {
  const storageKey = CACHE_PREFIX + key;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    const cached = read(storageKey, null);
    if (cached) return cached.value;
  }
  try {
    const value = await loader();
    write(storageKey, { value, savedAt: Date.now() });
    return value;
  } catch (error) {
    const cached = read(storageKey, null);
    if (cached && isNetworkError(error)) return cached.value;
    throw error;
  }
}

export function cacheGet(key) {
  return read(CACHE_PREFIX + key, null)?.value ?? null;
}

export function cacheWrite(key, value) {
  write(CACHE_PREFIX + key, { value, savedAt: Date.now() });
}

// Overlays queued staff/exhibitor edits on a cached list so the user sees their own offline changes.
export function applyPendingDb(table, rows, keyField, eventId) {
  let result = [...(rows || [])];
  read(QUEUE_KEY, []).filter(op => op.type.startsWith('db.') && op.payload.table === table && (!op.payload.eventId || op.payload.eventId === eventId)).forEach(({ type, payload }) => {
    const upsertRow = row => {
      const index = result.findIndex(item => item[keyField] === row[keyField]);
      if (index >= 0) result[index] = { ...result[index], ...row };
      else result.push(row);
    };
    const matches = row => Object.entries(payload.match || {}).every(([field, value]) => field === 'event_id' || row[field] === value);
    if (type === 'db.insert') upsertRow(payload.row);
    else if (type === 'db.upsert') payload.rows.forEach(upsertRow);
    else if (type === 'db.update') result = result.map(row => matches(row) ? { ...row, ...payload.patch } : row);
    else if (type === 'db.delete') result = result.filter(row => !matches(row));
  });
  return result;
}

function applyMatch(builder, match) {
  return Object.entries(match).reduce((query, [field, value]) => query.eq(field, value), builder);
}

const isDuplicate = error => error?.code === '23505' || /duplicate key|already been submitted|already exists/i.test(error?.message || '');

const handlers = {
  async 'query.insert'({ row }) {
    return supabase.from('queries').insert(row);
  },
  async 'query.update'({ id, eventId, dbPatch }, op) {
    const { data: current, error } = await supabase.from('queries').select('status, updated_at').eq('id', id).eq('event_id', eventId).maybeSingle();
    if (error) return { error };
    if (!current) return { error: { message: `Query ${id} no longer exists.` } };
    let patch = dbPatch;
    const changedSince = current.updated_at && new Date(current.updated_at) > new Date(op.queuedAt);
    // Status only moves forward: if the server is already further along the flow, the older offline status is ignored.
    const serverRank = STATUS_FLOW.indexOf(current.status);
    if (changedSince && patch.status && serverRank > STATUS_FLOW.indexOf(patch.status)) {
      const { status, completed_at, ...rest } = patch;
      patch = rest;
    }
    return supabase.from('queries').update(patch).eq('id', id).eq('event_id', eventId);
  },
  async 'db.insert'({ table, row }) {
    return supabase.from(table).insert(row);
  },
  async 'db.upsert'({ table, rows, onConflict }) {
    return supabase.from(table).upsert(rows, { onConflict });
  },
  async 'db.update'({ table, match, patch }) {
    return applyMatch(supabase.from(table).update(patch), match);
  },
  async 'db.delete'({ table, match }) {
    return applyMatch(supabase.from(table).delete(), match);
  },
  async 'public.query'({ slug, code, payload }) {
    return supabase.rpc('submit_public_query', { requested_event_slug: slug, requested_code: code, query_payload: payload });
  },
  async 'client.create'(input) {
    const { error } = await supabase.functions.invoke('create-client', { body: input });
    return { error };
  },
  async 'event.create'({ values }) {
    return supabase.from('events').insert(values);
  },
};

export async function flushQueue() {
  if (flushing || !supabase || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  flushing = true;
  try {
    let queue = read(QUEUE_KEY, []);
    while (queue.length) {
      const op = queue[0];
      const handler = handlers[op.type];
      let error = null;
      try {
        error = handler ? (await handler(op.payload, op)).error : new Error(`Unknown operation ${op.type}`);
      } catch (thrown) { error = thrown; }
      if (error && isNetworkError(error)) break;
      if (error && !isDuplicate(error)) {
        write(FAILED_KEY, [...read(FAILED_KEY, []), { ...op, message: error.message || String(error) }]);
      }
      queue = read(QUEUE_KEY, []).filter(item => item.opId !== op.opId);
      write(QUEUE_KEY, queue);
      notify();
    }
  } finally {
    flushing = false;
    notify();
  }
}

export function startOfflineSync() {
  const trigger = () => { notify(); flushQueue(); };
  window.addEventListener('online', trigger);
  window.addEventListener('offline', notify);
  const timer = window.setInterval(flushQueue, 30000);
  flushQueue();
  return () => {
    window.removeEventListener('online', trigger);
    window.removeEventListener('offline', notify);
    window.clearInterval(timer);
  };
}
