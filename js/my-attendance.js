let allAttendanceRecords = [];
const MY_ATTENDANCE_CACHE_PAGE = "my-attendance";
let attendanceLoading = false;

function getOneRelation(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function getSemesterNumber(termName) {
  const name = String(termName || "");
  if (/\b(?:1(?:st)?|first|term\s*1|semester\s*1|one|i)\b/i.test(name)) {
    return 1;
  }
  if (/\b(?:2(?:nd)?|second|term\s*2|semester\s*2|two|ii)\b/i.test(name)) {
    return 2;
  }
  return null;
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.studentPageCache?.ready;
  const hasCachedAttendance = restoreCachedAttendance();
  if (!hasCachedAttendance) {
    const tableBody = document.getElementById("attendanceHistoryTable");
    if (tableBody) {
      tableBody.innerHTML = '<tr><td colspan="5" class="attendance-empty-state">Loading your attendance...</td></tr>';
    }
  }
  document.getElementById("refreshStudentAttendance")?.addEventListener("click", () => {
    void loadStudentAttendanceData({ refresh: true });
  });
  ["academicYearFilter", "termFilter", "classFilter", "subjectFilter", "periodFilter", "statusFilter"]
    .forEach((id) => document.getElementById(id)?.addEventListener("change", applyFiltersAndRender));
  void loadStudentAttendanceData();
});

function cachedAttendanceMatchesSession(cachedUserId) {
  if (!cachedUserId) return false;
  try {
    return Object.keys(localStorage).some((key) => {
      if (!key.startsWith("sb-") || !key.endsWith("-auth-token")) return false;
      try {
        return JSON.parse(localStorage.getItem(key) || "null")?.user?.id === cachedUserId;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function restoreCachedAttendance() {
  const cached = window.studentPageCache?.readLast(MY_ATTENDANCE_CACHE_PAGE);
  if (
    !cached?.data ||
    !Array.isArray(cached.data.records) ||
    !cachedAttendanceMatchesSession(cached.userId)
  ) return false;

  allAttendanceRecords = cached.data.records;
  populateDropdownFilters(allAttendanceRecords);
  applyFiltersAndRender();
  return true;
}

function setAttendanceRefreshState(isRefreshing) {
  const button = document.getElementById("refreshStudentAttendance");
  if (!button) return;
  button.disabled = isRefreshing;
  button.setAttribute("aria-busy", String(isRefreshing));
  button.innerHTML = isRefreshing
    ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Refreshing...</span>'
    : '<i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Refresh</span>';
}

async function loadStudentAttendanceData(options = {}) {
  if (attendanceLoading) return;
  attendanceLoading = true;
  const refresh = options.refresh === true;
  if (refresh) setAttendanceRefreshState(true);
  const client = window.supabaseClient || supabaseClient;
  const tableBody = document.getElementById("attendanceHistoryTable");

  try {
    if (!client) throw new Error("Supabase client is not available.");
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    if (!user) {
      window.studentPageCache?.clearLast(MY_ATTENDANCE_CACHE_PAGE);
      window.location.href = "login.html";
      return;
    }
    if (refresh) window.studentTransferHistoryIndex = null;
    const historyIndex = await window.getStudentTransferHistoryIndex(client);
    await fetchStudentAttendanceRecords(user.id, historyIndex, client);
    window.studentPageCache?.write(MY_ATTENDANCE_CACHE_PAGE, user.id, {
      records: allAttendanceRecords,
    });
    populateDropdownFilters(allAttendanceRecords);
    applyFiltersAndRender();
  } catch (error) {
    console.error("Error loading student attendance:", error);
    if (!allAttendanceRecords.length && tableBody) {
      tableBody.innerHTML = `
        <tr><td colspan="5" class="attendance-state attendance-state-error">
          ${escapeHTML(error.message || "Could not load attendance records. Refresh the page or try again.")}
        </td></tr>`;
      calculateOverviewStats([]);
      renderSubjectCards([]);
    }
    showToast(
      window.getSupabaseErrorMessage?.(error, "Could not load attendance records."),
      "error",
    );
  } finally {
    attendanceLoading = false;
    if (refresh) setAttendanceRefreshState(false);
  }
}

async function fetchStudentAttendanceRecords(userId, historyIndex, client) {
  const { data: attendanceRecords, error: recordsError } = await client
    .from("attendance_records")
    .select("id, status, created_at, student_id, attendance_id")
    .eq("student_id", userId);

  if (recordsError) throw recordsError;

  const historicalAttendanceIds = historyIndex?.recordIds?.attendance || new Set();
  const currentAttendanceRecords = (attendanceRecords || []).filter(
    (record) => !historicalAttendanceIds.has(String(record.id)),
  );

  if (!currentAttendanceRecords.length) {
    allAttendanceRecords = [];
    return;
  }

  const attendanceIds = [
    ...new Set(currentAttendanceRecords.map((record) => record.attendance_id).filter(Boolean)),
  ];

  let attendanceMap = {};
  if (attendanceIds.length) {
    const { data: attendanceSessions, error: attendanceError } = await client
      .from("attendance")
      .select(`
        id,
        date,
        term_id,
        academic_year_id,
        class_id,
        teacher_id,
        subject_id,
        assessment_id,
        periods ( id, name ),
        assessments ( id, name ),
        terms ( id, name ),
        academic_years ( id, year_label ),
        classes ( id, name ),
        subjects ( id, name )
      `)
      .in("id", attendanceIds);

    if (attendanceError) throw attendanceError;
    attendanceMap = Object.fromEntries(
      (attendanceSessions || []).map((attendance) => [attendance.id, attendance]),
    );
  }

  allAttendanceRecords = currentAttendanceRecords
    .map((record) => ({
      ...record,
      attendance: getOneRelation(attendanceMap[record.attendance_id]),
    }))
    .filter((record) => record.attendance)
    .map((record) => ({
      ...record,
      attendance: {
        ...record.attendance,
        periods: getOneRelation(record.attendance.periods),
        assessments: getOneRelation(record.attendance.assessments),
        terms: getOneRelation(record.attendance.terms),
        academic_years: getOneRelation(record.attendance.academic_years),
        classes: getOneRelation(record.attendance.classes),
        subjects: getOneRelation(record.attendance.subjects),
      },
    }));

  const teacherNameMap = new Map();
  const { data: attendanceCreators, error: attendanceCreatorsError } = await client.rpc(
    "student_attendance_creator_names",
  );
  if (attendanceCreatorsError) {
    console.warn("Could not load attendance author names:", attendanceCreatorsError);
    // Keep teacher names available on deployments before the scoped lookup is installed.
    const classIds = [
      ...new Set(
        allAttendanceRecords
          .map((record) => record.attendance.class_id)
          .filter(Boolean)
          .map(String),
      ),
    ];
    const teacherNameResults = await Promise.all(
      classIds.map((classId) =>
        client.rpc("student_timetable_teacher_names", { p_class_id: classId }),
      ),
    );
    for (const result of teacherNameResults) {
      if (result.error) {
        console.warn("Could not load assigned teacher names for attendance:", result.error);
        continue;
      }
      for (const teacher of result.data || []) {
        if (teacher?.teacher_id && teacher.full_name) {
          teacherNameMap.set(String(teacher.teacher_id), teacher.full_name);
        }
      }
    }
  } else {
    for (const creator of attendanceCreators || []) {
      if (creator?.creator_id && creator.full_name) {
        teacherNameMap.set(String(creator.creator_id), creator.full_name);
      }
    }
  }
  allAttendanceRecords = allAttendanceRecords.map((record) => ({
    ...record,
    attendance: {
      ...record.attendance,
      teacher_name: teacherNameMap.get(String(record.attendance.teacher_id)) || null,
    },
  }));

}

function fillAttendanceFilter(select, placeholder, values) {
  if (!select) return;
  const selectedValue = select.value;
  const options = window.buildUniqueFilterOptions?.(values) || [];

  select.replaceChildren();
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "all";
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  options
    .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, {
      numeric: true,
      sensitivity: "base",
    }))
    .forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
  if (options.some((option) => option.value === selectedValue)) select.value = selectedValue;
}

function populateDropdownFilters(records) {
  const subjectFilter = document.getElementById("subjectFilter");
  const yearFilter = document.getElementById("academicYearFilter");
  const termFilter = document.getElementById("termFilter");
  const classFilter = document.getElementById("classFilter");
  const periodFilter = document.getElementById("periodFilter");

  const subjects = new Map();
  const years = new Map();
  const classes = new Map();
  const assessments = [];

  records.forEach((record) => {
    const attendance = record.attendance;
    if (attendance.subject_id) {
      subjects.set(String(attendance.subject_id), attendance.subjects?.name || "Subject");
    }
    if (attendance.academic_year_id) {
      years.set(String(attendance.academic_year_id), attendance.academic_years?.year_label || "Academic year");
    }
    if (attendance.class_id) {
      classes.set(String(attendance.class_id), attendance.classes?.name || "Class");
    }
    const assessmentId = attendance.assessment_id || attendance.assessments?.id;
    if (assessmentId && attendance.assessments?.name) {
      assessments.push({ id: assessmentId, name: attendance.assessments.name });
    }
  });

  fillAttendanceFilter(subjectFilter, "All Subjects", subjects);
  fillAttendanceFilter(yearFilter, "All Academic Years", years);
  fillAttendanceFilter(classFilter, "All Classes", classes);
  setAssessmentPeriodOptions(
    periodFilter,
    assessments,
    "All Assessment Periods",
    "all",
  );

  if (termFilter) {
    const selectedTerm = termFilter.value;
    termFilter.innerHTML = `
      <option value="all">All Semesters</option>
      <option value="1">1st Semester</option>
      <option value="2">2nd Semester</option>`;
    termFilter.value = selectedTerm;
  }
}

function renderAttendanceHistory(records) {
  const tbody = document.getElementById("attendanceHistoryTable");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!records?.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="attendance-empty-state">
          ${allAttendanceRecords.length ? "No matching attendance records found for these filters." : "No attendance records are available yet."}
        </td>
      </tr>`;
    return;
  }

  records.forEach((record) => {
    const attendance = record.attendance;
    const dateStr = attendance?.date
      ? new Date(attendance.date).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : "-";
    const teacherName = attendance?.teacher_name || "-";
    const status = record.status || "-";
    const statusClass = status.toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${escapeHTML(dateStr)}</td>
      <td>${escapeHTML(attendance?.subjects?.name || "-")}</td>
      <td>${escapeHTML(teacherName)}</td>
      <td>${escapeHTML(attendance?.assessments?.name || "-")}</td>
      <td><span class="status-tag ${statusClass}">${escapeHTML(status)}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function calculateOverviewStats(records) {
  const total = records.length;
  let present = 0;
  let absent = 0;

  records.forEach((record) => {
    const status = String(record.status || "").toLowerCase();
    if (status === "present") present++;
    else if (status === "absent") absent++;
  });

  const rate = total ? Math.round((present / total) * 100) : 0;
  const rateElement = document.getElementById("overallRate");
  const presentElement = document.getElementById("totalPresent");
  const absentElement = document.getElementById("totalAbsent");
  if (rateElement) rateElement.textContent = `${rate}%`;
  if (presentElement) presentElement.textContent = present;
  if (absentElement) absentElement.textContent = absent;
}

function renderSubjectCards(records) {
  const container = document.getElementById("subjectCardsContainer");
  if (!container) return;
  container.innerHTML = "";

  const subjectsMap = new Map();
  records.forEach((record) => {
    const subjectName = record.attendance?.subjects?.name || "General";
    if (!subjectsMap.has(subjectName)) subjectsMap.set(subjectName, { total: 0, present: 0 });
    const stat = subjectsMap.get(subjectName);
    stat.total++;
    if (String(record.status || "").toLowerCase() === "present") stat.present++;
  });

  if (!subjectsMap.size) {
    container.innerHTML = `<p class="attendance-empty-state">${allAttendanceRecords.length ? "No subject data for this filter selection." : "No subject attendance is available yet."}</p>`;
    return;
  }

  subjectsMap.forEach((stat, subjectName) => {
    const percentage = stat.total ? Math.round((stat.present / stat.total) * 100) : 0;
    const card = document.createElement("div");
    card.className = "subject-card";
    card.innerHTML = `
      <div class="subject-card-header">
        <span class="subject-name">${escapeHTML(subjectName)}</span>
        <span class="subject-badge">${percentage}%</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width:${percentage}%"></div>
      </div>
      <div class="subject-details">
        <span>Attended: ${stat.present}/${stat.total}</span>
        <span>Classes</span>
      </div>`;
    container.appendChild(card);
  });
}

function applyFiltersAndRender() {
  const selectedYear = document.getElementById("academicYearFilter")?.value || "all";
  const selectedSemester = document.getElementById("termFilter")?.value || "all";
  const selectedClass = document.getElementById("classFilter")?.value || "all";
  const selectedSubject = document.getElementById("subjectFilter")?.value || "all";
  const selectedPeriod = document.getElementById("periodFilter")?.value || "all";
  const selectedStatus = document.getElementById("statusFilter")?.value || "all";
  const selectedAssessmentIds = parseAssessmentPeriodIds(selectedPeriod);

  const filteredRecords = allAttendanceRecords.filter((record) => {
    const attendance = record.attendance;
    const status = String(record.status || "").toLowerCase();
    return (
      (window.filterSelectionMatches?.(selectedYear, attendance.academic_year_id) ?? (selectedYear === "all" || String(attendance.academic_year_id) === selectedYear)) &&
      (selectedSemester === "all" || getSemesterNumber(attendance.terms?.name) === Number(selectedSemester)) &&
      (window.filterSelectionMatches?.(selectedClass, attendance.class_id) ?? (selectedClass === "all" || String(attendance.class_id) === selectedClass)) &&
      (window.filterSelectionMatches?.(selectedSubject, attendance.subject_id) ?? (selectedSubject === "all" || String(attendance.subject_id) === selectedSubject)) &&
      (selectedPeriod === "all" || selectedAssessmentIds.includes(String(attendance.assessment_id || attendance.assessments?.id))) &&
      (selectedStatus === "all" || status === selectedStatus.toLowerCase())
    );
  });

  calculateOverviewStats(filteredRecords);
  renderSubjectCards(filteredRecords);
  renderAttendanceHistory(filteredRecords);
}
