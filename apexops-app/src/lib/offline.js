// Offline write queue and read cache. Queued operations replay in order once the network returns.
import { supabase } from './supabase';
import { STATUS_FLOW, uploadQueryPhotos } from './mock';
import { clearFailedRecords, deleteQueueOp, getCacheRecord, listFailed, listQueue, saveCacheRecord, saveFailed, saveMetaRecord, saveQueueOp } from './offlineDb';

const listeners = new Set();
let flushing = false;
let stateSnapshot = { pending:0, failed:0, online:typeof navigator === 'undefined' || navigator.onLine };
let failedSnapshot = [];
let migrationPromise;

async function migrateLegacyBrowserData() {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const marker = 'apexops.offline-indexeddb-migrated';
    try { if (window.localStorage.getItem(marker) === 'true') return; }
    catch { throw new Error('Browser storage is unavailable. Keep this page open until you are online.'); }

    try {
      const oldQueue = JSON.parse(window.localStorage.getItem('apexops.offline-queue') || '[]');
      const oldFailed = JSON.parse(window.localStorage.getItem('apexops.offline-failed') || '[]');
      for (const op of oldQueue) await saveQueueOp(op);
      for (const op of oldFailed) await saveFailed(op);
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key?.startsWith('apexops.cache:')) continue;
        const record = JSON.parse(window.localStorage.getItem(key) || 'null');
        if (record) await saveCacheRecord({ key:key.slice('apexops.cache:'.length), ...record });
      }
      window.localStorage.setItem(marker, 'true');
      window.localStorage.removeItem('apexops.offline-queue');
      window.localStorage.removeItem('apexops.offline-failed');
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith('apexops.cache:')) window.localStorage.removeItem(key);
      }
    } catch (error) {
      migrationPromise = null;
      throw new Error(error?.message || 'Could not move pending changes into durable offline storage.');
    }
  })();
  return migrationPromise;
}

function notify() {
  stateSnapshot = { ...stateSnapshot, online:typeof navigator === 'undefined' || navigator.onLine };
  listeners.forEach(listener => listener(stateSnapshot));
}

async function refreshSnapshot() {
  try {
    const [queue, failed] = await Promise.all([listQueue(), listFailed()]);
    stateSnapshot = { pending:queue.length, failed:failed.length, online:typeof navigator === 'undefined' || navigator.onLine };
    failedSnapshot = failed;
    notify();
  } catch {
    stateSnapshot = { ...stateSnapshot, storageError:true };
    notify();
  }
}

export function isNetworkError(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const text = `${error?.name || ''} ${error?.message || ''}`;
  return /failed to fetch|networkerror|network request failed|load failed|fetcherror|timeout/i.test(text);
}

function isRetryableError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  return isNetworkError(error) || status === 408 || status === 429 || status === 401 || status >= 500;
}

export function getOfflineState() {
  return stateSnapshot;
}

export function subscribeOffline(listener) {
  listeners.add(listener);
  refreshSnapshot();
  return () => listeners.delete(listener);
}

export async function pendingOps(type) {
  await migrateLegacyBrowserData();
  return (await listQueue()).filter(op => op.type === type);
}

export async function enqueue(type, payload) {
  await migrateLegacyBrowserData();
  const op = { opId:crypto.randomUUID(), type, payload, queuedAt:new Date().toISOString() };
  await saveQueueOp(op);
  await refreshSnapshot();
  registerBackgroundSync();
}

export async function clearFailed() {
  await migrateLegacyBrowserData();
  await clearFailedRecords();
  await refreshSnapshot();
}

export function getFailedOps() {
  return failedSnapshot;
}

export async function cachedRead(key, loader) {
  await migrateLegacyBrowserData();
  const cached = await getCacheRecord(key);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (cached) return cached.value;
  }
  try {
    const value = await loader();
    await saveCacheRecord({ key, value, savedAt:Date.now() });
    return value;
  } catch (error) {
    if (cached && isNetworkError(error)) return cached.value;
    throw error;
  }
}

export async function cacheGet(key) {
  await migrateLegacyBrowserData();
  return (await getCacheRecord(key))?.value ?? null;
}

export async function cacheWrite(key, value) {
  await migrateLegacyBrowserData();
  await saveCacheRecord({ key, value, savedAt:Date.now() });
}

// Overlays queued staff/exhibitor edits on a cached list so the user sees their own offline changes.
export async function applyPendingDb(table, rows, keyField, eventId) {
  await migrateLegacyBrowserData();
  let result = [...(rows || [])];
  (await listQueue()).filter(op => op.type.startsWith('db.') && op.payload.table === table && (!op.payload.eventId || op.payload.eventId === eventId)).forEach(({ type, payload }) => {
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
  async 'query.insert'({ row, photos = [] }) {
    const photo_urls = photos.length ? await uploadQueryPhotos(photos, row.id, { eventId:row.event_id }) : row.photo_urls;
    const { error } = await supabase.from('queries').insert({ ...row, ...(photo_urls?.length && { photo_urls }) });
    if (error?.code === '23505') {
      const { data:existing, error:lookupError } = await supabase.from('queries').select('id').eq('id', row.id).eq('event_id', row.event_id).maybeSingle();
      if (existing && !lookupError) return { error:null };
      return { error:lookupError || error };
    }
    return { error };
  },
  async 'query.evidence'({ id, eventId, photos }) {
    const { data: current, error: loadError } = await supabase.from('queries').select('photo_urls').eq('id', id).eq('event_id', eventId).single();
    if (loadError) return { error:loadError };
    const uploaded = await uploadQueryPhotos(photos, id, { eventId });
    return supabase.from('queries').update({ photo_urls:[...new Set([...(current.photo_urls || []), ...uploaded])] }).eq('id', id).eq('event_id', eventId);
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
  async 'public.query'({ slug, code, payload, photos = [] }) {
    let queryPayload = payload;
    if (photos.length) {
      const photo_urls = await uploadQueryPhotos(photos, payload.submission_id, { eventId:payload.event_id, code });
      queryPayload = { ...payload, photo_urls };
    }
    const result = await supabase.rpc('submit_public_query', { requested_event_slug: slug, requested_code: code, query_payload: queryPayload });
    if (!result.error && !(Array.isArray(result.data) ? result.data.length : result.data)) {
      return { error:new Error('The saved query could not be confirmed. Verify the event code and privacy acknowledgement.') };
    }
    return result;
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
    await migrateLegacyBrowserData();
    const queue = (await listQueue()).sort((first, second) => first.queuedAt.localeCompare(second.queuedAt));
    while (queue.length) {
      const op = queue[0];
      const handler = handlers[op.type];
      let error = null;
      try {
        error = handler ? (await handler(op.payload, op)).error : new Error(`Unknown operation ${op.type}`);
      } catch (thrown) { error = thrown; }
      if (error && isRetryableError(error)) break;
      if (error) {
        const message = isDuplicate(error)
          ? 'A matching active query already exists. This retry was not created as a duplicate.'
          : error.message || String(error);
        await saveFailed({ ...op, message });
      }
      await deleteQueueOp(op.opId);
      notify();
      queue.shift();
    }
  } finally {
    flushing = false;
    await refreshSnapshot();
  }
}

async function registerBackgroundSync() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    await saveMetaRecord({ key:'supabase', url:process.env.REACT_APP_SUPABASE_URL, anonKey:process.env.REACT_APP_SUPABASE_PUBLISHABLE_KEY });
    if (registration.sync) await registration.sync.register('apexops-public-queue');
  } catch { /* foreground sync remains available */ }
}

export function startOfflineSync() {
  const trigger = () => { notify(); flushQueue(); };
  const onWorkerMessage = event => {
    if (event.data?.type === 'APEXOPS_SYNC_UPDATED') refreshSnapshot();
  };
  window.addEventListener('online', trigger);
  window.addEventListener('offline', notify);
  navigator.serviceWorker?.addEventListener('message', onWorkerMessage);
  const timer = window.setInterval(flushQueue, 30000);
  migrateLegacyBrowserData().then(refreshSnapshot).catch(error => {
    stateSnapshot = { ...stateSnapshot, storageError:true, storageMessage:error.message };
    notify();
  });
  refreshSnapshot();
  registerBackgroundSync();
  flushQueue();
  return () => {
    window.removeEventListener('online', trigger);
    window.removeEventListener('offline', notify);
    navigator.serviceWorker?.removeEventListener('message', onWorkerMessage);
    window.clearInterval(timer);
  };
}
