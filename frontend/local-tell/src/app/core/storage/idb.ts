/**
 * Versioned IndexedDB access shared by the main thread and workers.
 *
 * Migrations are additive: an upgrade only creates missing stores/indexes and never clears or
 * deletes existing records. Add a new `case` for every future version.
 */

export const DATABASE_NAME = 'localtell-web';
export const DATABASE_VERSION = 1;

export type StoreName =
  | 'savedPlaces'
  | 'journeys'
  | 'observations'
  | 'recentLookups'
  | 'installedPacks'
  | 'packFiles'
  | 'settings';

export const STORE_NAMES: readonly StoreName[] = [
  'savedPlaces',
  'journeys',
  'observations',
  'recentLookups',
  'installedPacks',
  'packFiles',
  'settings',
];

export class StorageUnavailableError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22);
}

export function describeStorageError(error: unknown): string {
  if (isQuotaError(error)) return 'Browser storage is full. Remove downloaded packs or other data, then try again.';
  if (error instanceof StorageUnavailableError) return error.message;
  return 'Browser storage is unavailable. Private browsing modes or browser settings may block it.';
}

function migrate(db: IDBDatabase, oldVersion: number): void {
  // Falls through intentionally so a fresh install runs every step in order.
  switch (oldVersion) {
    case 0: {
      const saved = db.createObjectStore('savedPlaces', { keyPath: 'id' });
      saved.createIndex('savedAt', 'savedAt');
      const journeys = db.createObjectStore('journeys', { keyPath: 'id', autoIncrement: true });
      journeys.createIndex('timestamp', 'timestamp');
      const observations = db.createObjectStore('observations', { keyPath: 'id' });
      observations.createIndex('createdAt', 'createdAt');
      const recent = db.createObjectStore('recentLookups', { keyPath: 'id' });
      recent.createIndex('createdAt', 'createdAt');
      db.createObjectStore('installedPacks', { keyPath: 'id' });
      db.createObjectStore('packFiles', { keyPath: 'id' });
      db.createObjectStore('settings', { keyPath: 'key' });
    }
  }
}

let openPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (openPromise) return openPromise;
  openPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageUnavailableError('IndexedDB is not available in this browser.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = (event) => migrate(request.result, event.oldVersion);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        openPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(new StorageUnavailableError('Browser storage could not be opened.', request.error));
    request.onblocked = () => reject(new StorageUnavailableError('Browser storage is blocked by another open LocalTell tab.'));
  }).catch((error: unknown) => {
    openPromise = null;
    throw error;
  });
  return openPromise;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Runs [work] in one transaction and resolves only after the transaction commits. */
export async function transaction<T>(
  stores: StoreName | readonly StoreName[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(stores as StoreName | StoreName[], mode);
  const completion = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
  });
  let result: T;
  try {
    result = await work(tx);
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // Already finished or aborted.
    }
    await completion.catch(() => undefined);
    throw error;
  }
  await completion;
  return result;
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return transaction(store, 'readonly', (tx) => requestToPromise(tx.objectStore(store).getAll() as IDBRequest<T[]>));
}

export async function getOne<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return transaction(store, 'readonly', (tx) => requestToPromise(tx.objectStore(store).get(key) as IDBRequest<T | undefined>));
}

export async function putOne<T>(store: StoreName, value: T): Promise<void> {
  await transaction(store, 'readwrite', (tx) => requestToPromise(tx.objectStore(store).put(value)));
}

export async function deleteOne(store: StoreName, key: IDBValidKey): Promise<void> {
  await transaction(store, 'readwrite', (tx) => requestToPromise(tx.objectStore(store).delete(key)));
}

export async function clearStore(store: StoreName): Promise<void> {
  await transaction(store, 'readwrite', (tx) => requestToPromise(tx.objectStore(store).clear()));
}

export async function countStore(store: StoreName): Promise<number> {
  return transaction(store, 'readonly', (tx) => requestToPromise(tx.objectStore(store).count()));
}

export interface SettingRecord<T> {
  readonly key: string;
  readonly value: T;
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await getOne<SettingRecord<T>>('settings', key))?.value;
}

export async function putSetting<T>(key: string, value: T): Promise<void> {
  await putOne<SettingRecord<T>>('settings', { key, value });
}

export async function deleteSetting(key: string): Promise<void> {
  await deleteOne('settings', key);
}
