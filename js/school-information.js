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

async function loadSchoolProfile() {
  try {
    const user = schoolInformationUser;
    if (!user) return false;

    const { data: userProfile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("school_id")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;

    if (!userProfile?.school_id) {
      showSchoolInformationMessage("Your account is not linked to a school.", "error");
      return false;
    }

    const { data, error } = await supabaseClient
      .from("schools")
      .select("*")
      .eq("id", userProfile.school_id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      showSchoolInformationMessage("School information could not be found.", "error");
      return false;
    }

    const logoImg = document.getElementById("schoolLogoPreview");
    if (logoImg) logoImg.src = data.logo_url || "/icons/school-avatar-default.svg";

    setText("schoolNameValue", data.school_name);
    setText("schoolMottoValue", data.school_motto);
    setText("schoolEmailValue", data.email);
    setText("alternativePhoneValue", data.alternative_phone);
    setText("schoolWebsiteValue", data.website);
    setText("schoolAddressValue", data.address);
    setText("schoolCityValue", data.city);
    setText("schoolCountryValue", data.country);
    setText("principalNameValue", data.principal_name);
    setText("principalEmailValue", data.principal_email);
    setText("principalPhoneValue", data.principal_phone);
    setText("schoolTypeValue", data.school_type);
    setText("educationLevelValue", data.education_level);
    return true;
  } catch (err) {
    console.error("Error loading school profile:", err);
    showSchoolInformationMessage(schoolInformationErrorMessage(err), "error");
    return false;
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

  let access = { isGraduatedStudent: false, user: null };
  try {
    access = await checkStudentAccess();
    schoolInformationUser = access.user;
  } catch (error) {
    console.error("Could not determine School Information access:", error);
    showSchoolInformationMessage(schoolInformationErrorMessage(error), "error");
  }

  if (access.isGraduatedStudent) {
    const page = document.getElementById("schoolInformationPage");
    page?.classList.add("graduated-school-access");
    if (view) view.hidden = true;
    if (loader) loader.style.display = "none";
    showSchoolInformationMessage(
      "School Information is unavailable because your enrollment is marked as graduated or transferred. Contact your school administrator if you think this is a mistake.",
    );
    return;
  }

  const loaded = await loadSchoolProfile();

  if (loader) loader.style.display = "none";
  if (view) view.hidden = !loaded;

});
