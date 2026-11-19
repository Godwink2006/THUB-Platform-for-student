async function initAcademicsPage() {
  const containerEl = document.getElementById("academicsContainer");
  if (!containerEl) return;

  const links = [
    ["My Attendance", "my-attendance.html", "fa-calendar-check"],
    ["My Grades", "my-grades.html", "fa-chart-column"],
    ["My Fees", "my-fees.html", "fa-wallet"],
    ["My Transfer History", "my-history.html", "fa-right-left"],
    ["My Timetable", "my-timetable.html", "fa-calendar-days"],
  ];

  containerEl.innerHTML = links
    .map(([title, href, icon]) => `
      <a class="academic-link-row" href="${href}">
        <i class="fa-solid ${icon} academic-link-icon" aria-hidden="true"></i>
        <h2>${title}</h2>
        <i class="fa-solid fa-chevron-right academic-link-arrow" aria-hidden="true"></i>
      </a>
    `)
    .join("");

  try {
    const client = window.supabaseClient;
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (authError) throw authError;
    if (!user) {
      window.location.replace("/index.html");
      return;
    }

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("photo_url, email, school_id")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;

    const studentPhoto = document.getElementById("academicsStudentPhoto");
    const userEmail = document.getElementById("academicsUserEmail");
    if (studentPhoto && profile.photo_url) studentPhoto.src = profile.photo_url;
    if (userEmail) userEmail.textContent = user.email || profile.email || "";

    if (profile.school_id) {
      const { data: school, error: schoolError } = await client
        .from("schools")
        .select("logo_url")
        .eq("id", profile.school_id)
        .maybeSingle();
      if (schoolError) throw schoolError;
      const schoolPhoto = document.getElementById("academicsSchoolPhoto");
      if (schoolPhoto && school?.logo_url) schoolPhoto.src = school.logo_url;
    }
  } catch (error) {
    console.error("Could not load the student profile on academics:", error);
  }
}

document.addEventListener("DOMContentLoaded", initAcademicsPage);
