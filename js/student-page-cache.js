(function () {
  const CACHE_PREFIX = "thubStudentPageCache:v1:";

  function lastUserKey(page) {
    return `${CACHE_PREFIX}${page}:last-user`;
  }

  function pageDataKey(page, userId) {
    return `${CACHE_PREFIX}${page}:${userId}`;
  }

  function readLast(page) {
    try {
      const userId = localStorage.getItem(lastUserKey(page));
      if (!userId) return null;
      const cached = JSON.parse(localStorage.getItem(pageDataKey(page, userId)) || "null");
      if (!cached || cached.userId !== userId || !cached.data) return null;
      return cached;
    } catch (error) {
      console.warn(`Could not read the saved ${page} page:`, error);
      return null;
    }
  }

  function read(page, userId) {
    if (!userId) return null;
    try {
      const cached = JSON.parse(localStorage.getItem(pageDataKey(page, userId)) || "null");
      if (!cached || cached.userId !== userId || !cached.data) return null;
      return cached;
    } catch (error) {
      console.warn(`Could not read the saved ${page} page:`, error);
      return null;
    }
  }

  function write(page, userId, data) {
    if (!userId) return;
    try {
      localStorage.setItem(pageDataKey(page, userId), JSON.stringify({
        userId,
        savedAt: Date.now(),
        data,
      }));
      localStorage.setItem(lastUserKey(page), userId);
    } catch (error) {
      console.warn(`Could not save the ${page} page locally:`, error);
    }
  }

  function clearLast(page) {
    try {
      localStorage.removeItem(lastUserKey(page));
    } catch (error) {
      console.warn(`Could not clear the saved ${page} page pointer:`, error);
    }
  }

  function clearAll() {
    for (const storage of [localStorage, sessionStorage]) {
      try {
        for (let index = storage.length - 1; index >= 0; index -= 1) {
          const key = storage.key(index);
          if (
            key?.startsWith(CACHE_PREFIX) ||
            key?.startsWith("thubStudentBooksCatalog:v") ||
            key === "thubStudentBooksAccess:v1"
          ) storage.removeItem(key);
        }
      } catch (error) {
        console.warn("Could not clear saved student page data:", error);
      }
    }
  }

  function persistExistingSessionCaches() {
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (
          !key ||
          !(key.startsWith(CACHE_PREFIX) ||
            key.startsWith("thubStudentBooksCatalog:v") ||
            key === "thubStudentBooksAccess:v1")
        ) continue;

        const value = sessionStorage.getItem(key);
        if (value !== null && localStorage.getItem(key) === null) {
          localStorage.setItem(key, value);
        }
        sessionStorage.removeItem(key);
      }
    } catch (error) {
      console.warn("Could not preserve this tab's student cache:", error);
    }
  }

  persistExistingSessionCaches();

  window.studentPageCache = Object.freeze({ read, readLast, write, clearLast, clearAll });

  window.supabaseClient?.auth?.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") clearAll();
  });
})();
