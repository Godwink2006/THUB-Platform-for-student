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
      const userId = sessionStorage.getItem(lastUserKey(page));
      if (!userId) return null;
      const cached = JSON.parse(sessionStorage.getItem(pageDataKey(page, userId)) || "null");
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
      const cached = JSON.parse(sessionStorage.getItem(pageDataKey(page, userId)) || "null");
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
      sessionStorage.setItem(pageDataKey(page, userId), JSON.stringify({
        userId,
        savedAt: Date.now(),
        data,
      }));
      sessionStorage.setItem(lastUserKey(page), userId);
    } catch (error) {
      console.warn(`Could not save the ${page} page locally:`, error);
    }
  }

  function clearLast(page) {
    try {
      sessionStorage.removeItem(lastUserKey(page));
    } catch (error) {
      console.warn(`Could not clear the saved ${page} page pointer:`, error);
    }
  }

  function clearAll() {
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(key);
      }

      localStorage.removeItem("thubStudentBooksAccess:v1");
      for (let index = localStorage.length - 1; index >= 0; index -= 1) {
        const key = localStorage.key(index);
        if (
          key?.startsWith(CACHE_PREFIX) ||
          key?.startsWith("thubStudentBooksCatalog:v")
        ) localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn("Could not clear saved student page data:", error);
    }
  }

  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
    }
  } catch (error) {
    console.warn("Could not remove older persistent student page data:", error);
  }

  window.studentPageCache = Object.freeze({ read, readLast, write, clearLast, clearAll });

  window.supabaseClient?.auth?.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") clearAll();
  });
})();
