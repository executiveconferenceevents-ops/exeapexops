const CACHE = 'apexops-shell-v1';
const OFFLINE_DB = 'apexops-offline-v2';

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readStore(database, storeName, key) {
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readAll(database, storeName) {
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function removeRecord(database, storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function saveRecord(database, storeName, value) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function syncPublicQueue() {
  const database = await openOfflineDb();
  const configRecord = await readStore(database, 'meta', 'supabase');
  const config = configRecord?.value;
  if (!config?.url || !config?.anonKey) return;
  const pending = (await readAll(database, 'queue'))
    .filter(operation => operation.type === 'public.query')
    .sort((first, second) => first.queuedAt.localeCompare(second.queuedAt));

  for (const operation of pending) {
    try {
      const { slug, code, payload, photos = [] } = operation.payload;
      let photoUrls = payload.photo_urls || [];
      if (photos.length) {
        const eventResponse = await fetch(`${config.url}/rest/v1/rpc/get_public_event`, {
          method: 'POST',
          headers: { apikey:config.anonKey, Authorization:`Bearer ${config.anonKey}`, 'Content-Type':'application/json' },
          body: JSON.stringify({ requested_slug:slug, requested_code:code }),
        });
        if (!eventResponse.ok) throw Object.assign(new Error('Could not verify the queued event.'), { permanent:true });
        const eventRows = await eventResponse.json();
        const event = Array.isArray(eventRows) ? eventRows[0] : eventRows;
        if (!event?.id) throw Object.assign(new Error('The event code is no longer valid.'), { permanent:true });
        const codeHash = await sha256(String(code).trim().toUpperCase());
        const uploaded = [];
        for (const photo of photos) {
          const blob = photo instanceof Blob ? photo : new Blob([photo]);
          if (blob.size > 5 * 1024 * 1024 || !['image/jpeg','image/png','image/webp'].includes(blob.type)) {
            throw Object.assign(new Error('A queued photo exceeds the supported format or 5 MB limit.'), { permanent:true });
          }
          const photoHash = await sha256(await blob.arrayBuffer());
          const extension = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }[blob.type];
          const path = `${event.id}/${codeHash}/${payload.submission_id}/${photoHash}.${extension}`;
          const uploadResponse = await fetch(`${config.url}/storage/v1/object/query-photos-private/${path.split('/').map(encodeURIComponent).join('/')}`, {
            method: 'POST',
            headers: { apikey:config.anonKey, Authorization:`Bearer ${config.anonKey}`, 'Content-Type':blob.type, 'x-upsert':'true' },
            body:blob,
          });
          if (!uploadResponse.ok) {
            const details = await uploadResponse.text();
            const retryable = uploadResponse.status === 408 || uploadResponse.status === 429 || uploadResponse.status >= 500;
            throw Object.assign(new Error(details || 'Could not upload a queued photo.'), { permanent:!retryable });
          }
          uploaded.push(`private://${path}`);
        }
        photoUrls = [...photoUrls, ...uploaded];
      }

      const response = await fetch(`${config.url}/rest/v1/rpc/submit_public_query`, {
        method: 'POST',
        headers: { apikey:config.anonKey, Authorization:`Bearer ${config.anonKey}`, 'Content-Type':'application/json' },
        body: JSON.stringify({
          requested_event_slug:slug,
          requested_code:code,
          query_payload:{ ...payload, photo_urls:photoUrls },
        }),
      });
      if (!response.ok) {
        const details = await response.text();
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw Object.assign(new Error(details || 'Could not sync the queued query.'), { permanent:!retryable });
      }
      const result = await response.json();
      if (!result || (Array.isArray(result) && !result.length)) throw Object.assign(new Error('The server did not confirm the queued query.'), { permanent:true });
      await removeRecord(database, 'queue', operation.opId);
    } catch (error) {
      if (error.permanent) {
        await saveRecord(database, 'failed', { ...operation, message:error.message || 'Could not sync this query.' });
        await removeRecord(database, 'queue', operation.opId);
        continue;
      }
      break;
    }
  }
  const clients = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
  clients.forEach(client => client.postMessage({ type:'APEXOPS_SYNC_UPDATED' }));
}

self.addEventListener('sync', event => {
  if (event.tag === 'apexops-public-queue') event.waitUntil(syncPublicQueue());
});

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/', '/manifest.json', '/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Page loads: network first, fall back to the cached app shell.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put('/', copy));
      return response;
    }).catch(() => caches.match('/')));
    return;
  }

  // Hashed build assets and static files: cache first, refresh in the background.
  event.respondWith(caches.match(request).then(cached => {
    const network = fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => cached);
    return cached || network;
  }));
});
