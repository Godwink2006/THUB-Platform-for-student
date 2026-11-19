const ACADEMICS_CACHE_PAGE = "academics";
const DEFAULT_ACADEMICS_STUDENT_PHOTO = "/icons/student-avatar-default.svg";
const DEFAULT_ACADEMICS_SCHOOL_PHOTO = "/icons/school-avatar-default.svg";

function renderAcademicsLinks(container) {
  const links = [
    ["My Attendance", "my-attendance.html", "fa-calendar-check"],
    ["My Grades", "my-grades.html", "fa-chart-column"],
    ["My Fees", "my-fees.html", "fa-wallet"],
    ["My Transfer History", "my-history.html", "fa-right-left"],
    ["My Timetable", "my-timetable.html", "fa-calendar-days"],
  ];

  container.innerHTML = links
    .map(([title, href, icon]) => `
      <a class="academic-link-row" href="${href}">
        <i class="fa-solid ${icon} academic-link-icon" aria-hidden="true"></i>
        <h2>${title}</h2>
        <i class="fa-solid fa-chevron-right academic-link-arrow" aria-hidden="true"></i>
      </a>
    `)
    .join("");
}

function renderAcademicsProfile(data) {
  const studentPhoto = document.getElementById("academicsStudentPhoto");
  const schoolPhoto = document.getElementById("academicsSchoolPhoto");
  const userEmail = document.getElementById("academicsUserEmail");
  if (studentPhoto) studentPhoto.src = data.studentPhotoUrl || DEFAULT_ACADEMICS_STUDENT_PHOTO;
  if (schoolPhoto) schoolPhoto.src = data.schoolPhotoUrl || DEFAULT_ACADEMICS_SCHOOL_PHOTO;
  if (userEmail) userEmail.textContent = data.email || "";
}

async function loadAcademicsProfile(options = {}) {
  const refresh = options.refresh === true;
  const refreshButton = document.getElementById("refreshAcademics");
  if (refresh && refreshButton) {
    refreshButton.disabled = true;
    refreshButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Refreshing...</span>';
  }

  try {
    const client = window.supabaseClient;
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError) throw authError;
    if (!user) {
      window.studentPageCache?.clearLast(ACADEMICS_CACHE_PAGE);
      window.location.replace("/index.html");
      return;
    }

    const currentUserCache = window.studentPageCache?.read(ACADEMICS_CACHE_PAGE, user.id);
    if (currentUserCache && !refresh) {
      const data = {
        ...currentUserCache.data,
        email: user.email || currentUserCache.data.email || "",
      };
      renderAcademicsProfile(data);
      window.studentPageCache?.write(ACADEMICS_CACHE_PAGE, user.id, data);
      return;
    }

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("photo_url, email, school_id")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;

    let schoolPhotoUrl = "";
    if (profile.school_id) {
      const { data: school, error: schoolError } = await client
        .from("schools")
        .select("logo_url")
        .eq("id", profile.school_id)
        .maybeSingle();
      if (schoolError) throw schoolError;
      schoolPhotoUrl = school?.logo_url || "";
    }

    const data = {
      email: user.email || profile.email || "",
      studentPhotoUrl: profile.photo_url || "",
      schoolPhotoUrl,
    };
    renderAcademicsProfile(data);
    window.studentPageCache?.write(ACADEMICS_CACHE_PAGE, user.id, data);
  } catch (error) {
    console.error("Could not load the student profile on academics:", error);
  } finally {
    if (refresh && refreshButton) {
      refreshButton.disabled = false;
      refreshButton.innerHTML = '<i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Refresh</span>';
    }
  }
}

async function initAcademicsPage() {
  const containerEl = document.getElementById("academicsContainer");
  if (!containerEl) return;
  renderAcademicsLinks(containerEl);

  const cached = window.studentPageCache?.readLast(ACADEMICS_CACHE_PAGE);
  if (cached?.data) renderAcademicsProfile(cached.data);

  document
    .getElementById("refreshAcademics")
    ?.addEventListener("click", () => loadAcademicsProfile({ refresh: true }));
  await loadAcademicsProfile();
}

document.addEventListener("DOMContentLoaded", initAcademicsPage);
