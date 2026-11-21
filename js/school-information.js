const SCHOOL_INFORMATION_CACHE_PAGE = "school-information";
const DEFAULT_SCHOOL_INFORMATION_LOGO = "/icons/school-avatar-default.svg";
let schoolInformationUser = null;


async function checkStudentAccess() {
  if (!window.supabaseClient) {
    throw new Error("The database client is unavailable.");
  }

  const { data, error: userError } = await window.supabaseClient.auth.getUser();
  if (userError) throw userError;
  const user = data?.user;

  if (!user) {
    const error = new Error("Your session has expired. Sign in again.");
    error.status = 401;
    throw error;
  }

  const { data: profile, error: profileError } = await window.supabaseClient
    .from("profiles")
    .select("school_id, status")
    .eq("id", user.id)
    .single();
  if (profileError) throw profileError;

  let enrollmentQuery = window.supabaseClient
    .from("student_enrollments")
    .select("enrollment_status")
    .eq("student_id", user.id);

  if (profile.school_id) {
    enrollmentQuery = enrollmentQuery.eq("school_id", profile.school_id);
  }

  const { data: enrollments, error: enrollmentError } = await enrollmentQuery;
  if (enrollmentError) throw enrollmentError;
  const isGraduatedStudent = (enrollments || []).some((enrollment) =>
    ["graduated", "transferred", "transfered"].includes(
      String(enrollment.enrollment_status || "").trim().toLowerCase(),
    ),
  );

  return {
    isGraduatedStudent,
    profile,
    user,
  };
}

function showSchoolInformationMessage(message, type = "info") {
  const notice = document.getElementById("schoolInformationNotice");
  if (notice) {
    notice.textContent = message;
    notice.dataset.type = type;
    notice.hidden = false;
  }
  if (type === "error" && typeof showToast === "function") showToast(message, "error");
}

function schoolInformationErrorMessage(error, action = "load") {
  const code = String(error?.code || "").toLowerCase();
  const status = Number(error?.status || error?.statusCode || 0);
  const diagnostic = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();

  if (status === 401 || /invalid jwt|session.*expired|refresh token/.test(diagnostic)) {
    return "Your session has expired. Sign in again, then reopen School Information.";
  }
  if (/school.{0,30}inactive|inactive.{0,30}school/.test(diagnostic)) {
    return "This school is inactive. You can view its information, but changes are unavailable until the school is active.";
  }
  if (code === "42501" || status === 403 || /row-level security|permission denied|not authorized|access denied/.test(diagnostic)) {
    return action === "save"
      ? "School information could not be saved because your account or school does not have permission to make changes."
      : "You do not have permission to load some school information. Contact your school administrator for help.";
  }
  if (/failed to fetch|network|connection|timeout/.test(diagnostic)) {
    return `Could not connect to ${action === "save" ? "save" : "load"} school information. Check your internet connection and try again.`;
  }
  if (code === "pgrst116") return "The requested school information could not be found.";
  return action === "save"
    ? "School information could not be saved. Please try again."
    : "School information could not be loaded. Refresh the page or contact your school administrator.";
}

function renderSchoolInformation(school) {
  const logoImg = document.getElementById("schoolLogoPreview");
  if (logoImg) {
    logoImg.src = school.logo_url || DEFAULT_SCHOOL_INFORMATION_LOGO;
    logoImg.alt = `${school.school_name || "School"} logo`;
  }

  setText("schoolNameValue", school.school_name);
  setText("schoolMottoValue", school.school_motto);
  setText("schoolEmailValue", school.email);
  setText("alternativePhoneValue", school.alternative_phone);
  setText("schoolWebsiteValue", school.website);
  setText("schoolAddressValue", school.address);
  setText("schoolCityValue", school.city);
  setText("schoolCountryValue", school.country);
  setText("principalNameValue", school.principal_name);
  setText("principalEmailValue", school.principal_email);
  setText("principalPhoneValue", school.principal_phone);
  setText("schoolTypeValue", school.school_type);
  setText("educationLevelValue", school.education_level);
}

function cachedSchoolInformationMatchesSession(cachedUserId) {
  if (!cachedUserId) return false;
  try {
    return Object.keys(localStorage).some((key) => {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) return false;
      try {
        const session = JSON.parse(localStorage.getItem(key) || "null");
        return session?.user?.id === cachedUserId;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function restoreCachedSchoolInformation() {
  const cached = window.studentPageCache?.readLast(SCHOOL_INFORMATION_CACHE_PAGE);
  if (!cached?.data || !cachedSchoolInformationMatchesSession(cached.userId)) return false;

  renderSchoolInformation(cached.data);
  const view = document.getElementById("schoolInformationView");
  if (view) view.hidden = false;
  const loader = document.getElementById("formLoader");
  if (loader) loader.style.display = "none";
  return true;
}

function setSchoolInformationRefreshState(isRefreshing) {
  const button = document.getElementById("refreshSchoolInformation");
  if (!button) return;
  button.disabled = isRefreshing;
  button.setAttribute("aria-busy", String(isRefreshing));
  button.innerHTML = isRefreshing
    ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Refreshing...</span>'
    : '<i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Refresh</span>';
}

async function loadSchoolProfile(options = {}) {
  const refresh = options.refresh === true;
  if (refresh) setSchoolInformationRefreshState(true);

  try {
    const user = schoolInformationUser;
    if (!user) {
      window.studentPageCache?.clearLast(SCHOOL_INFORMATION_CACHE_PAGE);
      return false;
    }

    const schoolId = options.schoolId || "";
    if (!schoolId) {
      showSchoolInformationMessage("Your account is not linked to a school.", "error");
      return false;
    }

    const cached = window.studentPageCache?.read(SCHOOL_INFORMATION_CACHE_PAGE, user.id);
    if (!refresh && cached?.data?.schoolId === schoolId) {
      renderSchoolInformation(cached.data);
      return true;
    }

    const { data, error } = await supabaseClient
      .from("schools")
      .select("school_name, school_motto, logo_url, email, alternative_phone, website, address, city, country, principal_name, principal_email, principal_phone, school_type, education_level")
      .eq("id", schoolId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      showSchoolInformationMessage("School information could not be found.", "error");
      return false;
    }

    const schoolData = { ...data, schoolId };
    renderSchoolInformation(schoolData);
    window.studentPageCache?.write(SCHOOL_INFORMATION_CACHE_PAGE, user.id, schoolData);
    const notice = document.getElementById("schoolInformationNotice");
    if (notice) notice.hidden = true;
    return true;
  } catch (err) {
    console.error("Error loading school profile:", err);
    showSchoolInformationMessage(schoolInformationErrorMessage(err), "error");
    return false;
  } finally {
    if (refresh) setSchoolInformationRefreshState(false);
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  const value = typeof val === "string" ? val.trim() : val;
  el.textContent = value ? String(value) : "Not provided";
}

document.addEventListener("DOMContentLoaded", async () => {
  const loader = document.getElementById("formLoader");
  const view = document.getElementById("schoolInformationView");
  const refreshButton = document.getElementById("refreshSchoolInformation");
  const restoredFromCache = restoreCachedSchoolInformation();
  if (restoredFromCache && refreshButton) refreshButton.disabled = true;

  let access = { isGraduatedStudent: false, user: null };
  let accessVerified = false;
  try {
    access = await checkStudentAccess();
    schoolInformationUser = access.user;
    accessVerified = true;
  } catch (error) {
    console.error("Could not determine School Information access:", error);
    showSchoolInformationMessage(schoolInformationErrorMessage(error), "error");
    window.studentPageCache?.clearLast(SCHOOL_INFORMATION_CACHE_PAGE);
  }

  if (!accessVerified) {
    if (view) view.hidden = true;
    if (loader) loader.style.display = "none";
    return;
  }

  if (access.isGraduatedStudent) {
    const page = document.getElementById("schoolInformationPage");
    page?.classList.add("graduated-school-access");
    if (view) view.hidden = true;
    window.studentPageCache?.clearLast(SCHOOL_INFORMATION_CACHE_PAGE);
    if (loader) loader.style.display = "none";
    showSchoolInformationMessage(
      "School Information is unavailable because your enrollment is marked as graduated or transferred. Contact your school administrator if you think this is a mistake.",
    );
    return;
  }

  refreshButton?.addEventListener("click", () => {
    void loadSchoolProfile({ refresh: true, schoolId: access.profile?.school_id });
  });
  if (refreshButton) refreshButton.disabled = false;

  const loaded = await loadSchoolProfile({ schoolId: access.profile?.school_id });

  if (loader) loader.style.display = "none";
  if (view) view.hidden = !loaded;

});
