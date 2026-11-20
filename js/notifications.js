const NOTIFICATIONS_CACHE_PAGE = "notifications";
const NOTIFICATIONS_PAGE_SIZE = 20;

document.addEventListener("DOMContentLoaded", async () => {
  const notificationList = document.getElementById("fullNotificationList");
  const markAllReadBtn = document.getElementById("markAllReadBtn");
  const refreshBtn = document.getElementById("refreshNotifications");
  const nextBtn = document.getElementById("nextNotifications");
  const tabs = document.querySelectorAll(".notif-tab");

  let currentFilter = "all";
  let notificationsData = [];
  let loading = false;
  let nextOffset = 0;
  let hasMoreNotifications = false;

  const {
    data: { session },
    error: sessionError,
  } = await window.supabaseClient.auth.getSession();
  if (sessionError || !session) {
    window.location.href = "/index.html";
    return;
  }
  const userId = session.user.id;

  function saveNotificationsCache() {
    window.studentPageCache?.write(NOTIFICATIONS_CACHE_PAGE, userId, {
      items: notificationsData,
      nextOffset,
      hasMore: hasMoreNotifications,
    });
  }

  function setRefreshState(isRefreshing) {
    refreshBtn.disabled = isRefreshing;
    refreshBtn.innerHTML = isRefreshing
      ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Refreshing</span>'
      : '<i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Refresh</span>';
  }

  async function fetchNotifications(options = {}) {
    if (loading) return;
    loading = true;
    const showRefreshState = options.refresh === true;
    if (showRefreshState) setRefreshState(true);
    else if (!notificationsData.length) {
      notificationList.innerHTML = '<div class="notifications-loading-state"><i class="fa-solid fa-spinner fa-spin notification-loading-icon" aria-hidden="true"></i>Loading notifications...</div>';
    }

    try {
      const { data, error } = await window.supabaseClient
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(0, NOTIFICATIONS_PAGE_SIZE);

      if (error) throw error;
      const firstPage = data || [];
      notificationsData = firstPage.slice(0, NOTIFICATIONS_PAGE_SIZE);
      nextOffset = notificationsData.length;
      hasMoreNotifications = firstPage.length > NOTIFICATIONS_PAGE_SIZE;
      saveNotificationsCache();
      renderNotifications();
    } catch (err) {
      console.error("Error fetching notifications:", err);
      if (!notificationsData.length) {
        notificationList.innerHTML = '<div class="notifications-empty-state notifications-error-state">Failed to load notifications.</div>';
      }
      if (typeof showToast === "function") {
        showToast(err.message || "Failed to refresh notifications.", "error");
      }
    } finally {
      loading = false;
      if (showRefreshState) setRefreshState(false);
    }
  }

  async function loadNextNotifications() {
    if (loading || !hasMoreNotifications) return;
    loading = true;
    nextBtn.disabled = true;
    nextBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Loading...';

    try {
      const { data, error } = await window.supabaseClient
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(nextOffset, nextOffset + NOTIFICATIONS_PAGE_SIZE);

      if (error) throw error;
      const page = data || [];
      const pageItems = page.slice(0, NOTIFICATIONS_PAGE_SIZE);
      const loadedIds = new Set(notificationsData.map((item) => String(item.id)));
      notificationsData = notificationsData.concat(
        pageItems.filter((item) => !loadedIds.has(String(item.id))),
      );
      nextOffset += pageItems.length;
      hasMoreNotifications = page.length > NOTIFICATIONS_PAGE_SIZE;
      saveNotificationsCache();
      renderNotifications();
    } catch (err) {
      console.error("Error loading the next notifications:", err);
      if (typeof showToast === "function") {
        showToast(err.message || "Could not load the next notifications.", "error");
      }
    } finally {
      loading = false;
      nextBtn.disabled = false;
      nextBtn.innerHTML = 'Next <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>';
      nextBtn.hidden = !hasMoreNotifications;
    }
  }

  function renderNotifications() {
    markAllReadBtn.disabled = !notificationsData.some((item) => !item.is_read);
    nextBtn.hidden = !hasMoreNotifications;
    let filtered = notificationsData;

    if (currentFilter === "unread") {
      filtered = notificationsData.filter((item) => !item.is_read);
    } else if (currentFilter === "read") {
      filtered = notificationsData.filter((item) => item.is_read);
    }

    if (filtered.length === 0) {
      notificationList.innerHTML = '<div class="notifications-empty-state">No notifications found.</div>';
      return;
    }

    notificationList.innerHTML = filtered
      .map((item) => `
        <div data-id="${escapeHTML(item.id)}" class="notif-item ${item.is_read ? "is-read" : "is-unread"}">
          <div class="notif-item-content">
            <span class="notif-unread-dot" aria-hidden="true"></span>
            <div class="notif-item-copy">
              <h4>${escapeHTML(item.title || "")}</h4>
              <p>${escapeHTML(item.message || "")}</p>
              <span class="notif-item-time">${new Date(item.created_at).toLocaleString()}</span>
            </div>
          </div>
          <div class="notification-item-actions">
            ${!item.is_read ? `<button class="mark-read-single notification-action-btn" data-id="${escapeHTML(item.id)}">Mark as read</button>` : ""}
            <button class="delete-notification notification-action-btn" data-id="${escapeHTML(item.id)}" aria-label="Delete notification" title="Delete notification">
              <i class="fa-solid fa-trash" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      `)
      .join("");

    notificationList.querySelectorAll(".mark-read-single").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        await markAsRead(button.dataset.id);
      });
    });

    notificationList.querySelectorAll(".delete-notification").forEach((button) => {
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        await deleteNotification(button.dataset.id, button);
      });
    });
  }

  async function deleteNotification(id, button) {
    if (!id || !userId) return;
    button.disabled = true;

    try {
      const { data, error } = await window.supabaseClient
        .from("notifications")
        .delete()
        .eq("id", id)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("This notification could not be deleted.");

      notificationsData = notificationsData.filter((item) => item.id !== id);
      nextOffset = Math.max(0, nextOffset - 1);
      saveNotificationsCache();
      renderNotifications();
      void window.refreshStudentNotificationBadge?.();
      if (typeof showToast === "function") showToast("Notification deleted.", "success");
    } catch (err) {
      console.error("Error deleting notification:", err);
      button.disabled = false;
      if (typeof showToast === "function") {
        showToast(err.message || "Could not delete notification.", "error");
      }
    }
  }

  async function markAsRead(id) {
    try {
      const { error } = await window.supabaseClient
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id)
        .eq("user_id", userId);

      if (error) throw error;

      notificationsData = notificationsData.map((item) =>
        item.id === id ? { ...item, is_read: true } : item,
      );
      saveNotificationsCache();
      renderNotifications();
      void window.refreshStudentNotificationBadge?.();
    } catch (err) {
      console.error("Error updating notification:", err);
      if (typeof showToast === "function") showToast("Could not update notification.", "error");
    }
  }

  markAllReadBtn.addEventListener("click", async () => {
    const unreadIds = notificationsData
      .filter((item) => !item.is_read)
      .map((item) => item.id);
    if (!unreadIds.length) return;
    markAllReadBtn.disabled = true;

    try {
      const { error } = await window.supabaseClient
        .from("notifications")
        .update({ is_read: true })
        .in("id", unreadIds)
        .eq("user_id", userId);

      if (error) throw error;

      notificationsData = notificationsData.map((item) => ({ ...item, is_read: true }));
      saveNotificationsCache();
      renderNotifications();
      void window.refreshStudentNotificationBadge?.();
    } catch (err) {
      console.error("Error marking all as read:", err);
      markAllReadBtn.disabled = false;
      if (typeof showToast === "function") showToast("Could not mark notifications as read.", "error");
    }
  });

  refreshBtn.addEventListener("click", () => fetchNotifications({ refresh: true }));
  nextBtn.addEventListener("click", loadNextNotifications);

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((otherTab) => otherTab.classList.remove("active"));
      tab.classList.add("active");
      currentFilter = tab.getAttribute("data-filter");
      renderNotifications();
    });
  });

  const cached = window.studentPageCache?.read(NOTIFICATIONS_CACHE_PAGE, userId);
  if (Array.isArray(cached?.data?.items)) {
    notificationsData = cached.data.items;
    nextOffset = Number.isInteger(cached.data.nextOffset)
      ? cached.data.nextOffset
      : notificationsData.length;
    hasMoreNotifications = cached.data.hasMore === true;
    renderNotifications();
    if (typeof cached.data.hasMore !== "boolean") void fetchNotifications();
  } else {
    await fetchNotifications();
  }
});
