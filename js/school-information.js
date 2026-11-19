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

function disableFormInputs(form) {
  if (!form) return;

  const inputs = form.querySelectorAll("input, select, textarea, button");
  inputs.forEach((input) => {
    input.disabled = true;
  });

  const buttonsToHide = form.querySelectorAll(
    '.save-btn, .reset-btn, button[type="submit"], button[type="reset"]',
  );
  buttonsToHide.forEach((btn) => {
    btn.style.display = "none";
  });

  const logoWrapper = document.getElementById("changeSchoolLogo");
  if (logoWrapper) {
    logoWrapper.style.display = "none";
  }

  const changeLogoBtn = document.querySelector(
    '.upload-btn, label[for="schoolLogo"]',
  );
  if (changeLogoBtn) {
    changeLogoBtn.style.display = "none";
  }
}

async function loadSchoolProfile() {
  try {
    const user = schoolInformationUser;
    if (!user) return;

    const { data: userProfile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("school_id")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;

    if (!userProfile?.school_id) {
      showSchoolInformationMessage("Your account is not linked to a school.", "error");
      return;
    }

    const { data, error } = await supabaseClient
      .from("schools")
      .select("*")
      .eq("id", userProfile.school_id)
      .maybeSingle();

    if (error) throw error;

    if (data) {

      const logoImg = document.getElementById("schoolLogoPreview");
      if (logoImg && data.logo_url) {
        logoImg.src = data.logo_url;
      }

      setValue("schoolName", data.school_name);
      setValue("schoolMotto", data.school_motto);
      setValue("schoolEmail", data.email);
      setValue("alternativePhone", data.alternative_phone);
      setValue("schoolWebsite", data.website);
      setValue("schoolAddress", data.address);
      setValue("schoolCity", data.city);
      setValue("schoolCountry", data.country);

      setValue("principalName", data.principal_name);
      setValue("principalEmail", data.principal_email);
      setValue("principalPhone", data.principal_phone);

      setValue("schoolType", data.school_type);
      setValue("educationLevel", data.education_level);
    }
  } catch (err) {
    console.error("Error loading school profile:", err);
    showSchoolInformationMessage(schoolInformationErrorMessage(err), "error");
  }
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el && val !== null && val !== undefined) {
    el.value = val;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const form =
    document.getElementById("schoolInformationForm") ||
    document.getElementById("schoolProfileForm") ||
    document.querySelector("form");
  const loader = document.getElementById("formLoader");

  let access = { isGraduatedStudent: false, user: null };
  try {
    access = await checkStudentAccess();
    schoolInformationUser = access.user;
  } catch (error) {
    console.error("Could not determine School Information access:", error);
    showSchoolInformationMessage(schoolInformationErrorMessage(error), "error");
  }

  disableFormInputs(form);

  if (access.isGraduatedStudent) {
    const page = document.getElementById("schoolInformationPage");
    page?.classList.add("graduated-school-access");
    if (form) {
      form.style.display = "none";
      form.classList.add("auth-ready");
    }
    if (loader) loader.style.display = "none";
    showSchoolInformationMessage(
      "School Information is unavailable because your enrollment is marked as graduated or transferred. Contact your school administrator if you think this is a mistake.",
    );
    return;
  }

  await loadSchoolProfile();

  if (loader) loader.style.display = "none";
  if (form) form.classList.add("auth-ready");

});
