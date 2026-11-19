document.addEventListener("DOMContentLoaded", loadStudentDashboard);

async function loadStudentDashboard() {
  const preview = document.getElementById("announcementPreviewContainer");

  try {
    const client = window.supabaseClient;
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError) throw authError;
    if (!user) return window.forceLogout?.();

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("full_name, role, status, school_id")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;

    if (
      String(profile?.role || "").trim().toLowerCase() !== "student" ||
      String(profile?.status || "").trim().toLowerCase() !== "active"
    ) {
      await client.auth.signOut();
      window.location.replace("/index.html");
      return;
    }

    const welcome = document.getElementById("welcomeUserText");
    if (welcome) welcome.textContent = `Welcome back, ${profile.full_name || "Student"}`;

    await Promise.all([
      loadStudentAnnouncements(client, profile.school_id, preview),
      updateStudentNotificationBadge(client, user.id),
    ]);
  } catch (error) {
    console.error("Could not load the student dashboard:", error);
    if (preview) {
      preview.innerHTML = '<div class="announcement-item"><p>Announcements could not be loaded. Refresh the page and try again.</p></div>';
    }
  } finally {
    document.body.classList.remove("dashboard-auth-checking");
    document.getElementById("dashboardAuthLoading")?.remove();
  }
}

async function loadStudentAnnouncements(client, schoolId, container) {
  if (!container) return;
  if (!schoolId) {
    container.innerHTML = '<div class="announcement-item"><p>Your student profile is not linked to a school.</p></div>';
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await client
    .from("announcements")
    .select("id, title, message, status, target_audience, expiry_date, created_at")
    .eq("school_id", schoolId)
    .or(`expiry_date.is.null,expiry_date.gte.${today}`)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const studentAnnouncements = (data || []).filter((item) => {
    const audiences = String(item.target_audience || "")
      .split(",")
      .map((audience) => audience.trim().toLowerCase());
    return audiences.some((audience) => ["all", "student", "students"].includes(audience));
  });

  if (!studentAnnouncements.length) {
    container.innerHTML = '<div class="announcement-item empty-state"><h4>No announcements</h4><p>There are no current announcements for students.</p></div>';
    return;
  }

  container.innerHTML = studentAnnouncements.map((item) => {
    const status = escapeStudentHtml(item.status || "Normal");
    const title = escapeStudentHtml(item.title || "Announcement");
    const message = escapeStudentHtml(item.message || "");
    const expiry = item.expiry_date ? `Expires ${escapeStudentHtml(item.expiry_date)}` : "No expiry date";
    return `<article class="announcement-item dashboard-announcement">
      <div class="dashboard-card-header"><h4>${title}</h4><span class="announcement-status">${status}</span></div>
      <p style="white-space: pre-wrap">${message}</p>
      <small>${expiry}</small>
    </article>`;
  }).join("");
}

async function updateStudentNotificationBadge(client, userId) {
  const badge = document.getElementById("notificationBadge");
  if (!badge) return;

  const { count, error } = await client
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  if (error) {
    console.warn("Could not load unread notification count:", error);
    return;
  }

  badge.textContent = count > 99 ? "99+" : String(count || 0);
  badge.hidden = !count;
}

function escapeStudentHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
