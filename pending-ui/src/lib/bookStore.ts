import type { Book } from '../types';

const DB_NAME = 'localaudiobook';
const DB_VERSION = 1;
const STORE = 'session';
const KEY = 'book';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('indexeddb blocked'));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveBook(book: Book | null): Promise<void> {
  try {
    if (book) await withStore('readwrite', (store) => store.put(book, KEY));
    else await withStore('readwrite', (store) => store.delete(KEY));
  } catch {
    // Private browsing, a full disk, or no IndexedDB at all. Not fatal.
  }
}
export async function loadBook(): Promise<Book | null> {
  try {
    const saved = await withStore<Book | undefined>('readonly', (store) => store.get(KEY));
    if (!saved || typeof saved.text !== 'string' || !saved.text.trim()) return null;
    return saved;
  } catch {
    return null;
  }
}
