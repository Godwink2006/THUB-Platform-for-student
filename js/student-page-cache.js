(function () {
  const CACHE_PREFIX = "thubStudentPageCache:v1:";
  const BOOKS_PREFIX = "thubStudentBooksCatalog:v";
  const BOOKS_ACCESS_KEY = "thubStudentBooksAccess:v1";
  const DB_NAME = "thub-student-app-cache";
  const DB_VERSION = 1;
  const STORE_NAME = "entries";
  const memory = new Map();
  let database = null;

  function isAppCacheKey(key) {
    return key?.startsWith(CACHE_PREFIX) ||
      key?.startsWith(BOOKS_PREFIX) ||
      key === BOOKS_ACCESS_KEY;
  }

  function storageAreas() {
    return [window.localStorage, window.sessionStorage].filter(Boolean);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("IndexedDB is unavailable."));
        return;
      }
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open the app cache."));
      request.onblocked = () => reject(new Error("Opening the app cache was blocked."));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  function readAllEntries(db) {
    const transaction = db.transaction(STORE_NAME, "readonly");
    return requestResult(transaction.objectStore(STORE_NAME).getAll());
  }

  async function migrateLegacyEntries(db) {
    const legacyEntries = new Map();
    const removals = [];
    for (const storage of storageAreas()) {
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (!isAppCacheKey(key)) continue;
          const value = storage.getItem(key);
          if (value !== null && !legacyEntries.has(key)) legacyEntries.set(key, value);
          removals.push([storage, key]);
        }
      } catch (error) {
        console.warn("Could not inspect legacy app cache storage:", error);
      }
    }

    if (legacyEntries.size) {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        legacyEntries.forEach((value, key) => store.put({ key, value }));
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error || new Error("Could not migrate the saved app cache."));
        transaction.onabort = () => reject(transaction.error || new Error("App cache migration was aborted."));
      });
      removals.forEach(([storage, key]) => {
        try { storage.removeItem(key); } catch { /* Keep running if storage is restricted. */ }
      });
    }
  }

  async function initialize() {
    try {
      database = await openDatabase();
      await migrateLegacyEntries(database);
      const entries = await readAllEntries(database);
      entries.forEach(({ key, value }) => memory.set(key, value));
    } catch (error) {
      database = null;
      console.warn("IndexedDB cache is unavailable; using browser storage fallback:", error);
      for (const storage of storageAreas()) {
        try {
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (!isAppCacheKey(key)) continue;
            const value = storage.getItem(key);
            if (value !== null) memory.set(key, value);
          }
        } catch { /* The in-memory cache remains available for this page. */ }
      }
    }
  }

  // Cache startup must never keep a page behind its loading screen. IndexedDB
  // can remain pending when another tab holds an upgrade transaction open.
  const ready = new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      if (!database) {
        console.warn("IndexedDB startup is taking too long; loading the page without waiting for cache.");
        for (const storage of storageAreas()) {
          try {
            for (let index = 0; index < storage.length; index += 1) {
              const key = storage.key(index);
              if (!isAppCacheKey(key)) continue;
              const value = storage.getItem(key);
              if (value !== null) memory.set(key, value);
            }
          } catch { /* The page can still fetch fresh data without cache. */ }
        }
      }
      resolve();
    }, 1800);
    initialize().then(() => {
      window.clearTimeout(timeout);
      resolve();
    });
  });

  function persist(key, value) {
    if (database) {
      try {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).put({ key, value });
        transaction.onerror = () => {
          console.warn("Could not persist app cache entry:", transaction.error);
          try { window.localStorage.setItem(key, value); } catch { /* Memory remains available for this page. */ }
        };
        transaction.onabort = () => {
          try { window.localStorage.setItem(key, value); } catch { /* Memory remains available for this page. */ }
        };
        // The in-memory copy is already updated. Do not make page rendering
        // wait for IndexedDB's transaction completion.
        return Promise.resolve();
      } catch (error) {
        console.warn("Could not persist app cache entry:", error);
      }
    }
    try { window.localStorage.setItem(key, value); } catch (error) {
      console.warn("Could not save app cache entry to browser storage:", error);
    }
    return Promise.resolve();
  }

  function removePersisted(key) {
    if (database) {
      try {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        transaction.objectStore(STORE_NAME).delete(key);
        transaction.onerror = () => console.warn("Could not remove app cache entry:", transaction.error);
      } catch (error) {
        console.warn("Could not remove app cache entry:", error);
      }
    }
    storageAreas().forEach((storage) => {
      try { storage.removeItem(key); } catch { /* Storage may be unavailable. */ }
    });
  }

  function lastUserKey(page) {
    return `${CACHE_PREFIX}${page}:last-user`;
  }

  function pageDataKey(page, userId) {
    return `${CACHE_PREFIX}${page}:${userId}`;
  }

  function readLast(page) {
    const userId = getItem(lastUserKey(page));
    return read(page, userId);
  }

  function read(page, userId) {
    if (!userId) return null;
    try {
      const cached = JSON.parse(getItem(pageDataKey(page, userId)) || "null");
      if (!cached || cached.userId !== userId || !cached.data) return null;
      return cached;
    } catch (error) {
      console.warn(`Could not read the saved ${page} page:`, error);
      return null;
    }
  }

  async function write(page, userId, data) {
    if (!userId) return;
    await Promise.all([
      setItem(pageDataKey(page, userId), JSON.stringify({ userId, savedAt: Date.now(), data })),
      setItem(lastUserKey(page), userId),
    ]);
  }

  function clearLast(page) {
    removeItem(lastUserKey(page));
  }

  function getItem(key) {
    return memory.get(key) ?? null;
  }

  function setItem(key, value) {
    const stringValue = String(value);
    memory.set(key, stringValue);
    return isAppCacheKey(key) ? persist(key, stringValue) : Promise.resolve();
  }

  function removeItem(key) {
    memory.delete(key);
    if (isAppCacheKey(key)) removePersisted(key);
  }

  async function clearAll() {
    await ready;
    for (const key of memory.keys()) {
      if (isAppCacheKey(key)) memory.delete(key);
    }
    if (database) {
      try {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction(STORE_NAME, "readwrite");
          transaction.objectStore(STORE_NAME).clear();
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error || new Error("Could not clear app cache."));
          transaction.onabort = () => reject(transaction.error || new Error("Clearing app cache was aborted."));
        });
      } catch (error) {
        console.warn("Could not clear IndexedDB app cache:", error);
      }
    }
    for (const storage of storageAreas()) {
      try {
        for (let index = storage.length - 1; index >= 0; index -= 1) {
          const key = storage.key(index);
          if (isAppCacheKey(key)) storage.removeItem(key);
        }
      } catch (error) {
        console.warn("Could not clear legacy app cache storage:", error);
      }
    }
  }

  window.studentPageCache = Object.freeze({
    ready, read, readLast, write, clearLast, clearAll, getItem, setItem, removeItem,
  });

  window.supabaseClient?.auth?.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") void clearAll();
  });
})();
