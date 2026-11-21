const MY_TIMETABLE_CACHE_PAGE = "my-timetable";
let allCurrentLessons = [];
let timetableAccessLoading = false;
let timetableCacheRestored = false;
let cachedTimetableData = null;

function cachedTimetableMatchesSession(cachedUserId) {
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

function renderTimetableData(data) {
  allCurrentLessons = Array.isArray(data.lessons) ? data.lessons : [];
  const className = document.getElementById("classNameDisplay");
  const teacher = document.getElementById("classTeacherDisplay");
  const breaks = document.getElementById("classBreaksDisplay");
  if (className) className.textContent = data.className || "--";
  if (teacher) teacher.textContent = data.classTeacher || "Not Assigned";
  if (breaks) breaks.textContent = data.breaks || "None";
  document.getElementById("classMetaBanner")?.classList.remove("hidden");
  document.getElementById("timetableContent")?.removeAttribute("hidden");
  const notice = document.getElementById("timetablePageNotice");
  if (notice) notice.hidden = true;
  setupTimetableFilters();
  applyTimetableFilters();
}

function restoreCachedTimetable() {
  const cached = window.studentPageCache?.readLast(MY_TIMETABLE_CACHE_PAGE);
  if (!cached?.data || !Array.isArray(cached.data.lessons) || !cachedTimetableMatchesSession(cached.userId)) {
    return false;
  }

  cachedTimetableData = { ...cached.data, studentId: cached.userId };
  timetableCacheRestored = true;
  renderTimetableData(cachedTimetableData);
  document.body.classList.remove("timetable-access-checking");
  const loading = document.getElementById("timetableAccessLoading");
  if (loading) loading.hidden = true;
  return true;
}

function setTimetableRefreshState(isRefreshing) {
  const button = document.getElementById("refreshMyTimetable");
  if (!button) return;
  button.disabled = isRefreshing;
  button.setAttribute("aria-busy", String(isRefreshing));
  button.innerHTML = isRefreshing
    ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Refreshing...</span>'
    : '<i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Refresh</span>';
}

function showTimetableLoading() {
  document.body.classList.add("timetable-access-checking");
  const loading = document.getElementById("timetableAccessLoading");
  if (loading) loading.hidden = false;
}

document.addEventListener("DOMContentLoaded", () => {
  restoreCachedTimetable();
  document.getElementById("refreshMyTimetable")?.addEventListener("click", () => {
    void initMyTimetable({ forceRefresh: true });
  });
  void initMyTimetable();
});

async function initMyTimetable(options = {}) {
  if (timetableAccessLoading) return;
  const forceRefresh = options.forceRefresh === true;
  timetableAccessLoading = true;
  if (forceRefresh) setTimetableRefreshState(true);

  try {
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      window.studentPageCache?.clearLast(MY_TIMETABLE_CACHE_PAGE);
      timetableCacheRestored = false;
      renderEmptyState("User session not found. Please log in.");
      return;
    }

    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("role, school_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      console.error("Profile Fetch Error:", profileError);
      throw new Error("Could not retrieve user profile.");
    }

    const role = profile.role?.toLowerCase();
    const schoolId = profile.school_id;

    if (role === "student") {
      let enrollmentQuery = supabaseClient
        .from("student_enrollments")
        .select("enrollment_status")
        .eq("student_id", user.id);
      if (schoolId) enrollmentQuery = enrollmentQuery.eq("school_id", schoolId);

      const { data: enrollments, error: enrollmentError } = await enrollmentQuery;
      if (enrollmentError) throw enrollmentError;

      const hasGraduatedEnrollment = (enrollments || []).some((enrollment) =>
        ["graduated", "transferred", "transfered"].includes(
          String(enrollment.enrollment_status || "").trim().toLowerCase(),
        ),
      );

      if (hasGraduatedEnrollment) {
        window.studentPageCache?.clearLast(MY_TIMETABLE_CACHE_PAGE);
        timetableCacheRestored = false;
        showGraduatedTimetableNotice();
        return;
      }

      const { data: studentData, error: studentErr } = await supabaseClient
        .from("students")
        .select("class_id, school_id")
        .eq("id", user.id)
        .single();

      if (studentErr || !studentData?.class_id) {
        console.error("Student fetch error:", studentErr);
        window.studentPageCache?.clearLast(MY_TIMETABLE_CACHE_PAGE);
        timetableCacheRestored = false;
        renderEmptyState("You are not currently assigned to a class.");
        return;
      }

      const studentSchoolId = studentData.school_id || schoolId;
      const hasMatchingCache = Boolean(
        timetableCacheRestored &&
        cachedTimetableData?.studentId === user.id &&
        cachedTimetableData?.schoolId === studentSchoolId &&
        cachedTimetableData?.classId === studentData.class_id,
      );

      if (hasMatchingCache && !forceRefresh) {
        setupTimetableFilters();
        applyTimetableFilters();
        return;
      }

      if (timetableCacheRestored && !hasMatchingCache) {
        timetableCacheRestored = false;
        cachedTimetableData = null;
        allCurrentLessons = [];
        document.getElementById("timetableCardsGrid")?.replaceChildren();
        showTimetableLoading();
      }

      const scheduleLoaded = await loadStudentClassSchedule(
        studentData.class_id,
        studentSchoolId,
      );
      if (!scheduleLoaded) {
        window.studentPageCache?.clearLast(MY_TIMETABLE_CACHE_PAGE);
        timetableCacheRestored = false;
        cachedTimetableData = null;
        return;
      }

      setupTimetableFilters();
      applyTimetableFilters();
      saveTimetableCache(user.id, studentSchoolId, studentData.class_id);
    } else {
      window.studentPageCache?.clearLast(MY_TIMETABLE_CACHE_PAGE);
      timetableCacheRestored = false;
      renderEmptyState("Your account is not set up as a student.");
    }
  } catch (err) {
    console.error("Timetable Load Error:", err);
    window.studentPageCache?.clearLast(MY_TIMETABLE_CACHE_PAGE);
    timetableCacheRestored = false;
    renderEmptyState(window.getSupabaseErrorMessage?.(err, "Failed to load timetable schedule."));
  } finally {
    timetableAccessLoading = false;
    document.body.classList.remove("timetable-access-checking");
    const loading = document.getElementById("timetableAccessLoading");
    if (loading) loading.hidden = true;
    if (forceRefresh) setTimetableRefreshState(false);
  }
}

function saveTimetableCache(studentId, schoolId, classId) {
  if (!studentId || !schoolId || !classId || !allCurrentLessons.length) return;
  const className = document.getElementById("classNameDisplay")?.textContent || "--";
  const classTeacher = document.getElementById("classTeacherDisplay")?.textContent || "Not Assigned";
  const breaks = document.getElementById("classBreaksDisplay")?.textContent || "None";
  cachedTimetableData = {
    studentId,
    schoolId,
    classId,
    className,
    classTeacher,
    breaks,
    lessons: allCurrentLessons,
  };
  window.studentPageCache?.write(MY_TIMETABLE_CACHE_PAGE, studentId, cachedTimetableData);
  timetableCacheRestored = true;
}

function showGraduatedTimetableNotice() {
  const content = document.getElementById("timetableContent");
  const notice = document.getElementById("timetablePageNotice");
  if (content) content.hidden = true;
  if (!notice) return;

  notice.replaceChildren();
  notice.dataset.type = "graduated";

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-graduation-cap";
  icon.setAttribute("aria-hidden", "true");

  const message = document.createElement("span");
  message.textContent =
    "Your timetable is unavailable because your enrollment at this school is marked as graduated or transferred. Contact your school administrator if you think this is a mistake.";

  notice.append(icon, message);
  notice.hidden = false;
}

async function loadStudentClassSchedule(classId, schoolId) {
  if (!classId) {
    renderEmptyState("You are not assigned to any class yet.");
    return false;
  }
  allCurrentLessons = [];

  let classQuery = supabaseClient
    .from("classes")
    .select("name")
    .eq("id", classId);

  if (schoolId) {
    classQuery = classQuery.eq("school_id", schoolId);
  }

  const { data: classData, error: classError } = await classQuery.maybeSingle();
  if (classError) throw classError;

  if (classData) {
    const classNameEl = document.getElementById("classNameDisplay");
    if (classNameEl) classNameEl.textContent = classData.name;
  }

  const { data: timetableTeachers, error: teachersError } =
    await supabaseClient.rpc("student_timetable_teacher_names", {
      p_class_id: classId,
    });

  if (teachersError) {
    throw teachersError;
  }

  const teacherProfilesMap = new Map(
    (timetableTeachers || []).map((teacher) => [teacher.teacher_id, teacher]),
  );

  let teacherName = "Not Assigned";
  const classTeacher = (timetableTeachers || []).find(
    (teacher) => teacher.is_class_teacher,
  );
  if (classTeacher?.full_name) {
    teacherName = classTeacher.full_name;
  }

  const classTeacherEl = document.getElementById("classTeacherDisplay");
  if (classTeacherEl) {
    classTeacherEl.textContent = teacherName;
  }

  document.getElementById("classMetaBanner")?.classList.remove("hidden");

  let ttQuery = supabaseClient
    .from("timetables")
    .select("id, status, academic_year_id")
    .eq("class_id", classId)
    .eq("status", "Active");

  if (schoolId) {
    ttQuery = ttQuery.eq("school_id", schoolId);
  }

  const { data: timetables, error: ttErr } = await ttQuery.order("created_at", {
    ascending: false,
  });

  if (ttErr) {
    console.error("Timetable Fetch Error:", ttErr);
    throw ttErr;
  }

  const activeTimetable =
    timetables?.find((t) => t.status?.toLowerCase() === "active") ||
    timetables?.[0];

  if (!activeTimetable) {
    renderEmptyState("No timetable found.");
    return false;
  }

  const { data: rawLessons, error: lessonsErr } = await supabaseClient
    .from("timetable_lessons")
    .select("id, day_of_week, is_break, subject_id, teacher_id, period_id")
    .eq("timetable_id", activeTimetable.id);

  if (lessonsErr) {
    console.error("Lessons Fetch Error:", lessonsErr);
    throw lessonsErr;
  }
  if (!rawLessons || rawLessons.length === 0) {
    renderEmptyState("No timetable found.");
    return false;
  }

  const [subjectsRes, periodsRes] = await Promise.all([
    supabaseClient.from("subjects").select("id, name"),
    supabaseClient.from("periods").select("id, name, start_time, end_time"),
  ]);
  if (subjectsRes.error) throw subjectsRes.error;
  if (periodsRes.error) throw periodsRes.error;

  const subjectsMap = new Map((subjectsRes.data || []).map((s) => [s.id, s]));
  const periodsMap = new Map((periodsRes.data || []).map((p) => [p.id, p]));

  const formattedLessons = rawLessons.map((lesson) => {
    const subjectObj = subjectsMap.get(lesson.subject_id);
    const periodObj = periodsMap.get(lesson.period_id);
    const teacherProfile = teacherProfilesMap.get(lesson.teacher_id);

    const isBreak = Boolean(
      lesson.is_break === true ||
      lesson.is_break === "true" ||
      (!lesson.subject_id && !subjectObj),
    );

    const breakDisplayName = periodObj?.name || "BREAK";

    return {
      ...lesson,
      is_break: isBreak,
      subject: subjectObj
        ? { name: subjectObj.name }
        : { name: breakDisplayName },
      teacher: { full_name: teacherProfile?.full_name || "-" },
      period: periodObj || { start_time: null, end_time: null },
    };
  });

  const breakSlots = formattedLessons
    .filter((l) => l.is_break)
    .map((l) => {
      const start = l.period?.start_time?.slice(0, 5);
      const end = l.period?.end_time?.slice(0, 5);
      const name = l.period?.name || l.subject?.name || "Break";
      if (start && end) return `${name} (${start}–${end})`;
      return name;
    });
  const uniqueBreaks = [...new Set(breakSlots)];
  const breaksEl = document.getElementById("classBreaksDisplay");
  if (breaksEl) {
    breaksEl.textContent = uniqueBreaks.length
      ? uniqueBreaks.join(" · ")
      : "None";
  }

  allCurrentLessons = formattedLessons;
  return true;
}

function renderScheduleCards(lessons) {
  const container = document.getElementById("timetableCardsGrid");
  if (!container) return;

  const selectedDay = document.getElementById("filterTimetableDays")?.value;
  const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

  const activeDays = selectedDay
    ? daysOfWeek.filter(
        (day) => day.toLowerCase() === selectedDay.toLowerCase(),
      )
    : daysOfWeek;

  const groupedLessons = activeDays.reduce((acc, day) => {
    acc[day] = lessons.filter(
      (l) => l.day_of_week === day || l.day_of_week === "All",
    );

    acc[day].sort((a, b) => {
      const timeA = a.period?.start_time || "00:00";
      const timeB = b.period?.start_time || "00:00";
      return timeA.localeCompare(timeB);
    });

    return acc;
  }, {});

  container.innerHTML = activeDays
    .map((day) => {
      const dayLessons = groupedLessons[day] || [];

      return `
        <div class="day-card">
          <div class="day-card-header">
            <span>${day}</span>
            <span class="lesson-count">${dayLessons.length} Periods</span>
          </div>
          <div class="day-card-body">
            ${
              dayLessons.length === 0
                ? `<div class="empty-state timetable-empty-state">
                    <i class="fa-solid fa-calendar-days" aria-hidden="true"></i>
                    <span>No classes scheduled</span>
                  </div>`
                : dayLessons
                    .map(renderLessonCardItem)
                    .join("")
            }
          </div>
        </div>
      `;
    })
    .join("");
}

function renderLessonCardItem(item) {
  const timeStr =
    item.period?.start_time && item.period?.end_time
      ? `${item.period.start_time.slice(0, 5)} - ${item.period.end_time.slice(0, 5)}`
      : "--:--";

  const isBreak = Boolean(
    item.is_break === true ||
    item.is_break === "true" ||
    (!item.subject_id && !item.subject?.name),
  );

  const subjectName = isBreak
    ? item.period?.name || item.subject?.name || "Break"
    : item.subject?.name || "";

  let secondaryLabel = "";
  if (!isBreak) {
    const teacherName = item.teacher?.full_name || "—";
    secondaryLabel = `<div class="lesson-teacher"><i class="fa-solid fa-user-tie"></i> ${escapeHTML(teacherName)}</div>`;
  }

  return `
    <div class="lesson-card-item">
      <div class="lesson-time"><i class="fa-regular fa-clock"></i> ${timeStr}</div>
      <div class="lesson-subject">${escapeHTML(subjectName)}</div>
      ${secondaryLabel}
    </div>
  `;
}

function renderEmptyState(message) {
  const container = document.getElementById("timetableCardsGrid");
  if (!container) return;
  const notice = document.getElementById("timetablePageNotice");
  if (notice) notice.hidden = true;
  document.getElementById("classMetaBanner")?.classList.add("hidden");
  document.getElementById("timetableContent")?.removeAttribute("hidden");

  container.innerHTML = `
    <div class="empty-state timetable-empty-state timetable-page-empty">
      <i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i>
      <p>${escapeHTML(message)}</p>
    </div>
  `;
}

function setupTimetableFilters() {
  const daySelect = document.getElementById("filterTimetableDays");

  if (daySelect && daySelect.options.length <= 1) {
    daySelect.innerHTML = '<option value="">All Days</option>';
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    days.forEach((day) => {
      const opt = document.createElement("option");
      opt.value = day;
      opt.textContent = day;
      daySelect.appendChild(opt);
    });
  }
  if (daySelect) daySelect.onchange = applyTimetableFilters;
}

function applyTimetableFilters() {
  const selectedDay = document.getElementById("filterTimetableDays")?.value;

  let filtered = allCurrentLessons.filter(
    (lesson) => !lesson.is_break,
  );

  if (selectedDay) {
    filtered = filtered.filter(
      (lesson) =>
        lesson.day_of_week?.toLowerCase() === selectedDay.toLowerCase() ||
        lesson.day_of_week?.toLowerCase() === "all",
    );
  }

  renderScheduleCards(filtered);
}
