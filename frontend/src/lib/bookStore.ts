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

/** Stores the open book, or forgets it when the book is cleared. */
export async function saveBook(book: Book | null): Promise<void> {
  try {
    if (book) await withStore('readwrite', (store) => store.put(book, KEY));
    else await withStore('readwrite', (store) => store.delete(KEY));
  } catch {
    // Private browsing, a full disk, or no IndexedDB at all. Not fatal.
  }
}

/** The book from a previous page load, or null if there isn't a usable one. */
export async function loadBook(): Promise<Book | null> {
  try {
    const saved = await withStore<Book | undefined>('readonly', (store) => store.get(KEY));
    if (!saved || typeof saved.text !== 'string' || !saved.text.trim()) return null;
    return saved;
  } catch {
    return null;
  }
}

/**
 * The full book, kept aside while one of its summaries is the open book. Stored
 * under its own key so "Back to the full book" still works after a reload —
 * otherwise narrating a summary would quietly throw the book away.
 */
export interface FullBookStash {
  book: Book;
  originalText: string | null;
}

const FULL_BOOK_KEY = 'fullBook';

export async function saveFullBook(stash: FullBookStash | null): Promise<void> {
  try {
    if (stash) await withStore('readwrite', (store) => store.put(stash, FULL_BOOK_KEY));
    else await withStore('readwrite', (store) => store.delete(FULL_BOOK_KEY));
  } catch {
    // Same as saveBook: not fatal.
  }
}

export async function loadFullBook(): Promise<FullBookStash | null> {
  try {
    const saved = await withStore<FullBookStash | undefined>('readonly', (store) =>
      store.get(FULL_BOOK_KEY),
    );
    if (!saved?.book || typeof saved.book.text !== 'string' || !saved.book.text.trim()) return null;
    return saved;
  } catch {
    return null;
  }
}
