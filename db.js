const DB_NAME = "shiire_pwa_db";
const DB_VERSION = 1;
const STORE = "books";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const st = db.createObjectStore(STORE, { keyPath: "key" });
        st.createIndex("by_updated", "updatedAt");
        st.createIndex("by_title", "titleLower");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function makeKey({ isbn, title }) {
  const i = (isbn || "").trim();
  if (i) return `isbn:${i}`;
  const t = (title || "").trim().toLowerCase();
  return `title:${t}`;
}

export async function upsertBook(book) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(book);
  await txDone(tx);
  db.close();
}

export async function getBook(key) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const req = tx.objectStore(STORE).get(key);
  const result = await new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export async function listBooks({ q = "" } = {}) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);

  const items = [];
  const req = store.openCursor();
  await new Promise((resolve, reject) => {
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve();
      items.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  db.close();

  const qq = (q || "").trim().toLowerCase();
  let filtered = items;
  if (qq) filtered = items.filter(x => (x.titleLower || "").includes(qq));

  filtered.sort((a,b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return filtered;
}

export async function deleteBook(key) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(key);
  await txDone(tx);
  db.close();
}

export async function wipeAll() {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).clear();
  await txDone(tx);
  db.close();
}
