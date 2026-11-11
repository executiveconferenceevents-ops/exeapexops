const DB_NAME = 'apexops-offline-v2';
const DB_VERSION = 1;
let databasePromise;

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('queue')) database.createObjectStore('queue', { keyPath: 'opId' });
      if (!database.objectStoreNames.contains('failed')) database.createObjectStore('failed', { keyPath: 'opId' });
      if (!database.objectStoreNames.contains('cache')) database.createObjectStore('cache', { keyPath: 'key' });
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Offline storage is unavailable in this browser.'));
  });
  return databasePromise;
}

async function run(storeName, mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = action(store);
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error('Could not access offline storage.'));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error('Could not write offline storage.'));
    transaction.onabort = () => reject(transaction.error || new Error('Offline storage transaction was cancelled.'));
  });
}

export const listQueue = () => run('queue', 'readonly', store => store.getAll());
export const saveQueueOp = op => run('queue', 'readwrite', store => store.put(op));
export const deleteQueueOp = opId => run('queue', 'readwrite', store => store.delete(opId));
export const listFailed = () => run('failed', 'readonly', store => store.getAll());
export const saveFailed = op => run('failed', 'readwrite', store => store.put(op));
export const clearFailedRecords = () => run('failed', 'readwrite', store => store.clear());
export const getCacheRecord = key => run('cache', 'readonly', store => store.get(key));
export const saveCacheRecord = record => run('cache', 'readwrite', store => store.put(record));
export const getMetaRecord = key => run('meta', 'readonly', store => store.get(key));
export const saveMetaRecord = record => run('meta', 'readwrite', store => store.put(record));
