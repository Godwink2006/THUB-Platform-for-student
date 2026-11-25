const DEFAULT_STUDENT_AVATAR = "/icons/student-avatar-default.svg";
const DASHBOARD_CACHE_PAGE = "dashboard";
let dashboardLoading = false;

document.addEventListener("DOMContentLoaded", initializeStudentDashboard);

function renderDashboardProfile(profile = {}) {
  const studentName = profile.fullName || "Student";
  const nameElement = document.getElementById("dashboardStudentName");
  const photoElement = document.getElementById("dashboardStudentPhoto");
  if (nameElement) nameElement.textContent = studentName;
  if (photoElement) {
    photoElement.src = profile.photoUrl || DEFAULT_STUDENT_AVATAR;
    photoElement.alt = `${studentName}'s profile photo`;
  }
}

function renderDashboardData(data = {}) {
  renderDashboardProfile(data.profile);
  if (data.attendance) {
    setStudentAttendanceSummary(data.attendance.rate, data.attendance.detail);
  }
  if (data.announcements) {
    renderStudentAnnouncements(
      document.getElementById("announcementPreviewContainer"),
      data.announcements.items || [],
      data.announcements.schoolLinked !== false,
    );
  }
}

function setDashboardRefreshState(isRefreshing) {
  const button = document.getElementById("refreshDashboard");
  if (!button) return;
  button.disabled = isRefreshing;
  button.innerHTML = isRefreshing
    ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Refreshing...</span>'
    : '<i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Refresh</span>';
}

async function initializeStudentDashboard() {
  await window.studentPageCache?.ready;
  document
    .getElementById("refreshDashboard")
    ?.addEventListener("click", () => loadStudentDashboard({ refresh: true }));
  await loadStudentDashboard();
}

async function loadStudentDashboard(options = {}) {
  await window.studentPageCache?.ready;
  if (dashboardLoading) return;
  dashboardLoading = true;
  const refresh = options.refresh === true;
  if (refresh) setDashboardRefreshState(true);
  const preview = document.getElementById("announcementPreviewContainer");

  try {
    const client = window.supabaseClient;
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError) throw authError;
    if (!user) return window.forceLogout?.();

    let cached = window.studentPageCache?.read(DASHBOARD_CACHE_PAGE, user.id);
    if (cached && cached.data.attendance && cached.data.announcements && !refresh) {
      const { data: accessProfile, error: accessProfileError } = await client
        .from("profiles")
        .select("role, status, school_id")
        .eq("id", user.id)
        .single();
      if (accessProfileError) throw accessProfileError;

      if (
        String(accessProfile?.role || "").trim().toLowerCase() !== "student" ||
        String(accessProfile?.status || "").trim().toLowerCase() !== "active"
      ) {
        await client.auth.signOut();
        window.location.replace("/index.html");
        return;
      }

      if (String(cached.data.schoolId || "") === String(accessProfile.school_id || "")) {
        renderDashboardData(cached.data);
        return;
      }
      cached = null;
    }

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("full_name, photo_url, role, status, school_id")
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

    if (cached && String(cached.data.schoolId || "") !== String(profile.school_id || "")) {
      cached = null;
    }

    const dashboardData = {
      profile: {
        fullName: profile.full_name || "Student",
        photoUrl: profile.photo_url || "",
      },
      schoolId: profile.school_id || "",
      attendance: cached?.data?.attendance || null,
      announcements: cached?.data?.announcements || null,
    };
    renderDashboardProfile(dashboardData.profile);

    const results = await Promise.allSettled([
      loadStudentAnnouncements(client, profile.school_id),
      loadStudentAttendanceSummary(client, user.id),
    ]);
    if (results[0].status === "fulfilled") {
      dashboardData.announcements = results[0].value;
    } else {
      console.error("Could not load student announcements:", results[0].reason);
      showToast(
        window.getSupabaseErrorMessage?.(results[0].reason, "Announcements could not be loaded."),
        "error",
      );
      if (!dashboardData.announcements) {
        renderAnnouncementsError(preview, results[0].reason);
      }
    }
    if (results[1].status === "fulfilled") {
      dashboardData.attendance = results[1].value;
    } else {
      console.error("Could not load student attendance summary:", results[1].reason);
      showToast(
        window.getSupabaseErrorMessage?.(results[1].reason, "Attendance could not be loaded."),
        "error",
      );
      if (!dashboardData.attendance) {
        setStudentAttendanceSummary(
          null,
          window.getSupabaseErrorMessage?.(results[1].reason, "Attendance could not be loaded."),
        );
      }
    }
    renderDashboardData(dashboardData);
    window.studentPageCache?.write(DASHBOARD_CACHE_PAGE, user.id, dashboardData);
  } catch (error) {
    console.error("Could not load the student dashboard:", error);
    if (preview) {
      renderAnnouncementsError(preview, error);
    }
  } finally {
    dashboardLoading = false;
    if (refresh) setDashboardRefreshState(false);
  }
}

async function loadStudentAttendanceSummary(client, studentId) {
  const { data: records, error: recordsError } = await client
    .from("attendance_records")
    .select("id, status, attendance_id")
    .eq("student_id", studentId);
  if (recordsError) throw recordsError;

  const historyIndex = await window.getStudentTransferHistoryIndex?.(client);
  const historicalIds = historyIndex?.recordIds?.attendance || new Set();
  const currentRecords = (records || []).filter(
    (record) => !historicalIds.has(String(record.id)),
  );
  const attendanceIds = [...new Set(currentRecords.map((record) => record.attendance_id).filter(Boolean))];

  let validAttendanceIds = new Set();
  if (attendanceIds.length) {
    const { data: sessions, error: sessionsError } = await client
      .from("attendance")
      .select("id")
      .in("id", attendanceIds);
    if (sessionsError) throw sessionsError;
    validAttendanceIds = new Set((sessions || []).map((session) => String(session.id)));
  }

  const validRecords = currentRecords.filter((record) => validAttendanceIds.has(String(record.attendance_id)));
  const present = validRecords.filter((record) => String(record.status || "").toLowerCase() === "present").length;
  const rate = validRecords.length ? Math.round((present / validRecords.length) * 100) : 0;
  const detail = validRecords.length
    ? `${present} present out of ${validRecords.length} recorded ${validRecords.length === 1 ? "class" : "classes"}`
    : "No attendance records yet";

  const attendance = { rate, detail };
  setStudentAttendanceSummary(rate, detail);
  return attendance;
}

function setStudentAttendanceSummary(rate, detail) {
  const rateElement = document.getElementById("studentAttendanceRate");
  const detailElement = document.getElementById("studentAttendanceDetail");
  if (rateElement) rateElement.textContent = rate === null ? "—" : `${rate}%`;
  if (detailElement) detailElement.textContent = detail;
}

async function loadStudentAnnouncements(client, schoolId) {
  if (!schoolId) {
    return { items: [], schoolLinked: false };
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

  return { items: studentAnnouncements, schoolLinked: true };
}

function renderStudentAnnouncements(container, studentAnnouncements, schoolLinked = true) {
  if (!container) return;
  if (!schoolLinked) {
    container.innerHTML = '<div class="announcement-item"><p>Your student profile is not linked to a school.</p></div>';
    return;
  }

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

function renderAnnouncementsError(container, error) {
  if (container) {
    const message = escapeStudentHtml(
      window.getSupabaseErrorMessage?.(error, "Announcements could not be loaded. Refresh the page and try again."),
    );
    container.innerHTML = `<div class="announcement-item"><p>${message}</p></div>`;
  }
}

function escapeStudentHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
