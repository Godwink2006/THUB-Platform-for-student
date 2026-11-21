const SETTINGS_CACHE_PAGE = "settings-school";
const DEFAULT_SETTINGS_SCHOOL_PHOTO = "/icons/school-avatar-default.svg";

async function initSettingsPage() {
  const containerEl = document.getElementById("settingsContainer");
  document
    .getElementById("refreshSettingsSchool")
    ?.addEventListener("click", () => loadSettingsSchoolHeader({ refresh: true }));
  void loadSettingsSchoolHeader();

  try {
    if (containerEl) {
      const allCardsHTML = `
        <a class="settings-link-row" href="my-profile.html">
          <span class="settings-link-icon"><i class="fa-solid fa-user" aria-hidden="true"></i></span>
          <h2>My Profile</h2>
          <i class="fa-solid fa-chevron-right settings-link-arrow" aria-hidden="true"></i>
        </a>
        <button type="button" class="settings-link-row app-theme-toggle" id="appThemeToggle" aria-label="Switch to dark mode" aria-pressed="false" title="Switch to dark mode">
          <span class="settings-link-icon"><i class="fa-solid fa-palette" aria-hidden="true"></i></span>
          <h2>Appearance</h2>
          <span class="settings-theme-mode">Dark mode</span>
          <i class="fa-solid fa-chevron-right settings-link-arrow" aria-hidden="true"></i>
        </button>
        <a class="settings-link-row" href="school-information.html">
          <span class="settings-link-icon"><i class="fa-solid fa-school" aria-hidden="true"></i></span>
          <h2>School Information</h2>
          <i class="fa-solid fa-chevron-right settings-link-arrow" aria-hidden="true"></i>
        </a>
        <button id="enablePushNotificationsBtn" type="button" class="settings-link-row">
          <span class="settings-link-icon"><i class="fa-solid fa-bell" aria-hidden="true"></i></span>
          <h2>Push Notifications</h2>
          <i class="fa-solid fa-chevron-right settings-link-arrow" aria-hidden="true"></i>
        </button>
        <p class="settings-action-status" id="pushNotificationStatus" aria-live="polite">Choose whether T-HUB notifications are enabled on this device.</p>
        <button id="clearBrowserDataBtn" type="button" class="settings-link-row settings-logout-row">
          <span class="settings-link-icon"><i class="fa-solid fa-right-from-bracket" aria-hidden="true"></i></span>
          <h2>Log Out</h2>
          <i class="fa-solid fa-chevron-right settings-link-arrow" aria-hidden="true"></i>
        </button>
      `;

      containerEl.innerHTML = allCardsHTML;
      window.applySavedAppTheme?.();

      document
        .getElementById("clearBrowserDataBtn")
        ?.addEventListener("click", openClearDataDialog);
      initPushNotificationSetup();
      document
        .getElementById("cancelClearDataBtn")
        ?.addEventListener("click", closeClearDataDialog);
      document
        .getElementById("confirmClearDataBtn")
        ?.addEventListener("click", clearCurrentBrowserData);
      document.getElementById("clearDataDialog")?.addEventListener("click", (event) => {
        if (event.target.id === "clearDataDialog") closeClearDataDialog();
      });
      document.addEventListener("keydown", handleClearDataDialogKeydown);

    }
  } catch (err) {
    console.error("Initialization error:", err);
  }
}

document.addEventListener("DOMContentLoaded", initSettingsPage);

function renderSettingsSchoolHeader(school = {}) {
  const name = document.getElementById("settingsSchoolName");
  const motto = document.getElementById("settingsSchoolMotto");
  const photo = document.getElementById("settingsSchoolPhoto");
  if (name) name.textContent = school.schoolName || "My School";
  if (motto) {
    motto.textContent = school.schoolMotto || "";
    motto.hidden = !school.schoolMotto;
  }
  if (photo) {
    photo.src = school.logoUrl || DEFAULT_SETTINGS_SCHOOL_PHOTO;
    photo.alt = `${school.schoolName || "School"} photo`;
    photo.dataset.hydrated = "true";
  }
}

function setSettingsRefreshState(isRefreshing) {
  const button = document.getElementById("refreshSettingsSchool");
  if (!button) return;
  button.disabled = isRefreshing;
  button.innerHTML = isRefreshing
    ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Refreshing...</span>'
    : '<i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Refresh</span>';
}

async function loadSettingsSchoolHeader(options = {}) {
  const refresh = options.refresh === true;
  if (refresh) setSettingsRefreshState(true);

  try {
    const client = window.supabaseClient;
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    if (!user) {
      window.studentPageCache?.clearLast(SETTINGS_CACHE_PAGE);
      renderSettingsSchoolHeader();
      return;
    }

    const cached = window.studentPageCache?.read(SETTINGS_CACHE_PAGE, user.id);
    if (cached?.data && !refresh) {
      renderSettingsSchoolHeader(cached.data);
      return;
    }

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("school_id")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;
    if (!profile?.school_id) {
      renderSettingsSchoolHeader();
      return;
    }

    const { data: school, error: schoolError } = await client
      .from("schools")
      .select("school_name, school_motto, logo_url")
      .eq("id", profile.school_id)
      .maybeSingle();
    if (schoolError) throw schoolError;
    const schoolData = {
      schoolId: profile.school_id,
      schoolName: school?.school_name || "My School",
      schoolMotto: school?.school_motto || "",
      logoUrl: school?.logo_url || "",
    };
    renderSettingsSchoolHeader(schoolData);
    window.studentPageCache?.write(SETTINGS_CACHE_PAGE, user.id, schoolData);
  } catch (error) {
    console.error("Could not load the school details for Settings:", error);
    if (typeof showToast === "function") {
      showToast(
        window.getSupabaseErrorMessage?.(error, "Could not load the school details."),
        "error",
      );
    }
    if (!document.getElementById("settingsSchoolPhoto")?.dataset.hydrated) {
      renderSettingsSchoolHeader();
    }
  } finally {
    if (refresh) setSettingsRefreshState(false);
  }
}

async function initPushNotificationSetup() {
  const button = document.getElementById("enablePushNotificationsBtn");
  const status = document.getElementById("pushNotificationStatus");
  if (!button || !status) return;

  const setStatus = (message, state = "") => {
    status.textContent = message;
    status.classList.remove("is-success", "is-pending", "is-error");
    if (state) status.classList.add(`is-${state}`);
  };

  const supported = "serviceWorker" in navigator && "Notification" in window && "PushManager" in window;
  if (!supported || !window.isSecureContext) {
    button.disabled = true;
    setStatus("Push notifications need a supported browser and a secure HTTPS connection.", "error");
    return;
  }

  let registration;
  let isEnabled = false;
  let statusOverride = null;

  const renderState = () => {
    if (Notification.permission === "denied") {
      button.disabled = false;
      button.setAttribute("aria-label", "Try push notification setup again");
      setStatus("Notifications are blocked by your browser. Allow them in this site’s browser settings, then tap Push Notifications to try again.", "error");
      return;
    }
    button.disabled = false;
    button.setAttribute("aria-label", isEnabled ? "Disable push notifications on this device" : "Enable push notifications on this device");
    if (statusOverride) {
      setStatus(statusOverride.message, statusOverride.state);
    } else {
      setStatus(isEnabled
        ? "Notifications are on for this device. Updates will arrive here."
        : "Notifications are off on this device.", isEnabled ? "success" : "");
    }
  };

  try {
    registration = await navigator.serviceWorker.register("/service-worker.js");
    const currentSubscription = await registration.pushManager.getSubscription();
    if (currentSubscription && Notification.permission === "granted") {
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
      if (userError) throw userError;
      if (user) {
        const { data, error } = await supabaseClient
          .from("push_subscriptions")
          .select("id")
          .eq("user_id", user.id)
          .eq("endpoint", currentSubscription.endpoint)
          .maybeSingle();
        if (error) throw error;
        isEnabled = Boolean(data);
      }
    }
  } catch (error) {
    console.error("Could not check push notification setup:", error);
    statusOverride = {
      message: window.getSupabaseErrorMessage?.(error, "Could not check this device’s notification setup. Try again."),
      state: "error",
    };
  }
  renderState();

  button.addEventListener("click", async () => {
    if (Notification.permission === "denied") {
      statusOverride = {
        message: "Notifications are still blocked by your browser. Allow them in this site’s browser settings, then tap Push Notifications to try again.",
        state: "error",
      };
      renderState();
      return;
    }

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    statusOverride = null;
    setStatus(isEnabled ? "Turning notifications off…" : "Setting up push notifications…", "pending");
    try {
      if (isEnabled) {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
          if (userError) throw userError;
          if (user) {
            const { error } = await supabaseClient
              .from("push_subscriptions")
              .delete()
              .eq("user_id", user.id)
              .eq("endpoint", subscription.endpoint);
            if (error) throw error;
          }
          await subscription.unsubscribe();
        }
        isEnabled = false;
        statusOverride = { message: "Push notifications are off on this device.", state: "success" };
      } else {
        let permission = Notification.permission;
        if (permission === "default") {
          permission = await Notification.requestPermission();
        }
        if (permission === "granted") {
          if (!registration) registration = await navigator.serviceWorker.register("/service-worker.js");
          let subscription = await registration.pushManager.getSubscription();
          if (!subscription) {
            subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: base64UrlToUint8Array(window.T_HUB_VAPID_PUBLIC_KEY),
            });
          }
          const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
          if (userError) throw userError;
          if (!user) throw new Error("Sign in before enabling push notifications.");

          const saveSubscription = async (activeSubscription) => {
            const subscriptionData = activeSubscription.toJSON();
            return supabaseClient.from("push_subscriptions").upsert({
              user_id: user.id,
              endpoint: activeSubscription.endpoint,
              p256dh: subscriptionData.keys?.p256dh,
              auth_key: subscriptionData.keys?.auth,
            }, { onConflict: "endpoint" });
          };

          const { error } = await saveSubscription(subscription);
          if (error) throw error;

          isEnabled = true;
          statusOverride = { message: "Push notifications are on for this device.", state: "success" };
        } else {
          statusOverride = { message: "Permission was not granted. Notifications are still off.", state: "error" };
        }
      }
    } catch (error) {
      console.error("Could not set up push notifications:", error);
      statusOverride = {
        message: window.getSupabaseErrorMessage?.(error, "Could not update notifications on this device. Check your connection and try again."),
        state: "error",
      };
    } finally {
      button.removeAttribute("aria-busy");
      button.disabled = false;
      renderState();
    }
  });
}

function base64UrlToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

let clearDataDialogTrigger = null;

function openClearDataDialog(event) {
  const dialog = document.getElementById("clearDataDialog");
  if (!dialog) return;

  clearDataDialogTrigger = event.currentTarget;
  dialog.hidden = false;
  dialog.setAttribute("aria-hidden", "false");
  document.body.classList.add("settings-modal-open");
  requestAnimationFrame(() => {
    document.getElementById("cancelClearDataBtn")?.focus();
  });
}

function closeClearDataDialog() {
  const dialog = document.getElementById("clearDataDialog");
  if (!dialog || dialog.dataset.busy === "true") return;

  dialog.hidden = true;
  dialog.setAttribute("aria-hidden", "true");
  document.body.classList.remove("settings-modal-open");
  clearDataDialogTrigger?.focus();
}

function handleClearDataDialogKeydown(event) {
  const dialog = document.getElementById("clearDataDialog");
  if (!dialog || dialog.hidden) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeClearDataDialog();
    return;
  }

  if (event.key === "Tab") {
    const buttons = [
      document.getElementById("cancelClearDataBtn"),
      document.getElementById("confirmClearDataBtn"),
    ].filter((button) => button && !button.disabled);
    if (buttons.length === 0) return;

    const firstButton = buttons[0];
    const lastButton = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === firstButton) {
      event.preventDefault();
      lastButton.focus();
    } else if (!event.shiftKey && document.activeElement === lastButton) {
      event.preventDefault();
      firstButton.focus();
    }
  }
}

async function clearCurrentBrowserData() {
  const dialog = document.getElementById("clearDataDialog");
  const confirmButton = document.getElementById("confirmClearDataBtn");
  const cancelButton = document.getElementById("cancelClearDataBtn");
  if (!dialog || !confirmButton || dialog.dataset.busy === "true") return;

  dialog.dataset.busy = "true";
  confirmButton.disabled = true;
  confirmButton.textContent = "Logging out…";
  if (cancelButton) cancelButton.disabled = true;

  try {
    if (window.supabaseClient?.auth) {
      const { error } = await window.supabaseClient.auth.signOut({
        scope: "local",
      });
      if (error) console.warn("Local Supabase sign-out returned an error:", error);
    }
  } catch (error) {
    console.warn("Supabase sign-out failed; clearing this site's local session anyway:", error);
  }

  try {
    window.localStorage.clear();
  } catch (error) {
    console.warn("Could not clear local storage:", error);
  }

  try {
    window.sessionStorage.clear();
  } catch (error) {
    console.warn("Could not clear session storage:", error);
  }

  try {
    const cacheNames = await window.caches?.keys();
    await Promise.all((cacheNames || []).map((name) => window.caches.delete(name)));
  } catch (error) {
    console.warn("Could not clear this site's cached files:", error);
  }

  try {
    const registrations = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((registrations || []).map((registration) => registration.unregister()));
  } catch (error) {
    console.warn("Could not unregister this site's service workers:", error);
  }

  try {
    if (typeof window.indexedDB?.databases === "function") {
      const databases = await window.indexedDB.databases();
      await Promise.all(
        databases
          .filter((database) => database.name)
          .map(
            (database) =>
              new Promise((resolve) => {
                const request = window.indexedDB.deleteDatabase(database.name);
                request.onsuccess = resolve;
                request.onerror = resolve;
                request.onblocked = resolve;
              }),
          ),
      );
    }
  } catch (error) {
    console.warn("Could not clear this site's IndexedDB data:", error);
  }

  try {
    document.cookie.split(";").forEach((cookie) => {
      const cookieName = cookie.split("=")[0].trim();
      if (cookieName) {
        document.cookie = `${cookieName}=; Max-Age=0; path=/; SameSite=Lax`;
      }
    });
  } catch (error) {
    console.warn("Could not clear this site's accessible cookies:", error);
  }

  window.location.replace("/index.html");
}
