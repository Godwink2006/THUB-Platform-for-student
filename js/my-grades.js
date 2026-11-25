let cachedStudentGrades = [];
let cachedStudentGradeCreators = new Map();
let studentTerms = [];
const MY_GRADES_CACHE_PAGE = "my-grades";
let gradesStudentId = null;
let gradesLoading = false;

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
  restoreCachedStudentGrades();
  document.getElementById("refreshStudentGrades")?.addEventListener("click", () => {
    void loadStudentGradeData({ refresh: true });
  });
  [
    "studentAcademicYearSelect",
    "studentTermSelect",
    "studentAssessmentSelect",
    "studentClassSelect",
    "studentSubjectSelect",
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", renderSelectedStudentGrades);
  });
  void loadStudentGradeData();
});

function cachedGradesMatchSession(cachedUserId) {
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

function restoreCachedStudentGrades() {
  const cached = window.studentPageCache?.readLast(MY_GRADES_CACHE_PAGE);
  if (
    !cached?.data ||
    !Array.isArray(cached.data.grades) ||
    !Array.isArray(cached.data.terms) ||
    !Array.isArray(cached.data.creators) ||
    !cachedGradesMatchSession(cached.userId)
  ) return false;

  gradesStudentId = cached.userId;
  cachedStudentGrades = cached.data.grades;
  studentTerms = cached.data.terms;
  cachedStudentGradeCreators = new Map(cached.data.creators);
  setupStudentGradeFilters();
  renderSelectedStudentGrades();
  return true;
}

function setGradesRefreshState(isRefreshing) {
  const button = document.getElementById("refreshStudentGrades");
  if (!button) return;
  button.disabled = isRefreshing;
  button.setAttribute("aria-busy", String(isRefreshing));
  button.innerHTML = isRefreshing
    ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Refreshing...</span>'
    : '<i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Refresh</span>';
}

async function loadStudentGradeData(options = {}) {
  if (gradesLoading) return;
  gradesLoading = true;
  const refresh = options.refresh === true;
  if (refresh) setGradesRefreshState(true);
  const client = window.supabaseClient || supabaseClient;
  const reportContainer = document.getElementById("studentGradesReport");

  try {
    if (!client) throw new Error("The database client is unavailable.");
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();

    if (userError || !user) {
      throw new Error("Please sign in to view your grades.");
    }
    gradesStudentId = user.id;
    if (refresh) window.studentTransferHistoryIndex = null;

    const historyIndex = await window.getStudentTransferHistoryIndex(client);
    const historicalGradeIds = historyIndex?.recordIds?.grade || new Set();

    const { data, error } = await client
      .from("grade_records")
      .select(`
        id,
        score,
        remarks,
        created_at,
        student_id,
        grades!inner (
          id,
          status,
          created_by,
          date_recorded,
          term_id,
          academic_year_id,
          assessment_id,
          class_id,
          subject_id,
          subjects ( id, name ),
          terms ( id, name, academic_year_id ),
          academic_years ( id, year_label ),
          assessments ( id, name, maximum_marks ),
          assessment_categories ( id, name, marks ),
          classes ( id, name )
        )
      `)
      .eq("student_id", user.id)
      .eq("grades.status", "submitted")
      .order("created_at", { ascending: false });

    if (error) throw error;

    cachedStudentGrades = (data || [])
      .filter((record) => !historicalGradeIds.has(String(record.id)))
      .map((record) => ({
        ...record,
        grades: getOneRelation(record.grades),
      }))
      .filter((record) => record.grades);

    cachedStudentGradeCreators = new Map();
    const { data: gradeCreators, error: gradeCreatorsError } = await client.rpc(
      "student_grade_creator_names",
    );
    if (gradeCreatorsError) {
      console.warn("Could not load grade author names:", gradeCreatorsError);
      // Keep teacher names available on deployments before the new creator
      // lookup function has been installed.
      const gradeClassIds = [
        ...new Set(
          cachedStudentGrades
            .map((record) => record.grades.class_id)
            .filter(Boolean)
            .map(String),
        ),
      ];
      const teacherNameResults = await Promise.all(
        gradeClassIds.map((classId) =>
          client.rpc("student_timetable_teacher_names", { p_class_id: classId }),
        ),
      );
      for (const result of teacherNameResults) {
        if (result.error) {
          console.warn("Could not load assigned teacher names for grades:", result.error);
          continue;
        }
        for (const teacher of result.data || []) {
          if (teacher?.teacher_id && teacher.full_name) {
            cachedStudentGradeCreators.set(String(teacher.teacher_id), {
              full_name: teacher.full_name,
              role: "teacher",
            });
          }
        }
      }
    } else {
      for (const creator of gradeCreators || []) {
        if (creator?.creator_id && creator.full_name) {
          cachedStudentGradeCreators.set(String(creator.creator_id), {
            full_name: creator.full_name,
            role: creator.author_role || "staff",
          });
        }
      }
    }

    const gradeYearIds = [
      ...new Set(
        cachedStudentGrades
          .map((record) => record.grades.academic_year_id)
          .filter(Boolean)
          .map(String),
      ),
    ];

    studentTerms = [];
    if (gradeYearIds.length) {
      const { data: terms, error: termsError } = await client
        .from("terms")
        .select("id, name, academic_year_id")
        .in("academic_year_id", gradeYearIds);

      if (termsError) {
        console.error("Error loading semester labels:", termsError);
        studentTerms = cachedStudentGrades
          .map((record) => getOneRelation(record.grades.terms))
          .filter(Boolean);
      } else {
        studentTerms = terms || [];
      }
    }

    await window.studentPageCache?.write(MY_GRADES_CACHE_PAGE, user.id, {
      grades: cachedStudentGrades,
      terms: studentTerms,
      creators: [...cachedStudentGradeCreators.entries()],
    });
    setupStudentGradeFilters();
    renderSelectedStudentGrades();
  } catch (error) {
    console.error("Error initializing My Grades:", error);
    showToast(
      window.getSupabaseErrorMessage?.(error, "Could not load your grades. Refresh the page or try again."),
      "error",
    );
    if (reportContainer) {
      if (!cachedStudentGrades.length) {
        reportContainer.innerHTML = `
          <p class="grades-state grades-state-error">
            ${escapeHTML(error.message || "Could not load your grades. Refresh the page or try again.")}
          </p>`;
      }
    }
  } finally {
    gradesLoading = false;
    if (refresh) setGradesRefreshState(false);
  }
}

function setupStudentGradeFilters() {
  const yearSelect = document.getElementById("studentAcademicYearSelect");
  const assessmentSelect = document.getElementById("studentAssessmentSelect");
  const classSelect = document.getElementById("studentClassSelect");
  const subjectSelect = document.getElementById("studentSubjectSelect");
  const years = new Map();
  const assessments = new Map();
  const classes = new Map();
  const subjects = new Map();

  cachedStudentGrades.forEach((record) => {
    const grade = record.grades;
    const year = getOneRelation(grade.academic_years);
    const assessment = getOneRelation(grade.assessments);
    const schoolClass = getOneRelation(grade.classes);
    const subject = getOneRelation(grade.subjects);
    if (year?.id) years.set(String(year.id), year.year_label || "Academic year");
    if (assessment?.id) assessments.set(String(assessment.id), assessment.name || "Assessment");
    if (schoolClass?.id) classes.set(String(schoolClass.id), schoolClass.name || "Class");
    if (subject?.id) subjects.set(String(subject.id), subject.name || "Subject");
  });

  fillFilterSelect(yearSelect, "All Academic Years", years);
  setAssessmentPeriodOptions(assessmentSelect, [...assessments.entries()].map(([id, name]) => ({ id, name })), "All Assessment Periods");
  fillFilterSelect(classSelect, "All Classes", classes);
  fillFilterSelect(subjectSelect, "All Subjects", subjects);
  const termSelect = document.getElementById("studentTermSelect");
  if (termSelect) {
    const selectedTerm = termSelect.value;
    termSelect.innerHTML = '<option value="">All Semesters</option><option value="1">1st Semester</option><option value="2">2nd Semester</option>';
    termSelect.value = selectedTerm;
  }
}

function fillFilterSelect(select, placeholder, values, required = false) {
  if (!select) return;
  const selectedValue = select.value;
  const options = window.buildUniqueFilterOptions?.(values) || [];

  select.replaceChildren();
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  options.sort((a, b) =>
    String(a.label).localeCompare(String(b.label), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );

  options.forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });

  select.required = required;
  if (options.some((option) => option.value === selectedValue)) {
    select.value = selectedValue;
  }
}

async function loadStudentStatusForTerm(studentId, academicYearId, termId) {
  const badge = document.getElementById("studentStatusBadge");
  if (!badge) return;

  if (!termId) {
    badge.textContent = "No term";
    badge.className = "status-badge normal";
    return;
  }

  try {
    const client = window.supabaseClient || supabaseClient;
    const { data, error } = await client
      .from("student_enrollments")
      .select("enrollment_status")
      .eq("student_id", studentId)
      .eq("academic_year_id", academicYearId)
      .eq("term_id", termId)
      .maybeSingle();

    if (error) throw error;

    const status = data?.enrollment_status || "Normal";
    badge.textContent = status;
    badge.className = `status-badge ${String(status).toLowerCase()}`;
  } catch (error) {
    console.error("Error loading term status:", error);
    const message = window.getSupabaseErrorMessage?.(error, "Unavailable");
    badge.textContent = "Error";
    badge.title = message;
    badge.className = "status-badge status-error";
    showToast(message, "error");
  }
}

async function renderSelectedStudentGrades() {
  const reportContainer = document.getElementById("studentGradesReport");
  const yearId = document.getElementById("studentAcademicYearSelect")?.value || "";
  const semesterValue = document.getElementById("studentTermSelect")?.value || "";
  const semesterNumber = Number(semesterValue);
  const assessmentId = document.getElementById("studentAssessmentSelect")?.value || "";
  const assessmentIds = parseAssessmentPeriodIds(assessmentId);
  const classId = document.getElementById("studentClassSelect")?.value || "";
  const subjectId = document.getElementById("studentSubjectSelect")?.value || "";

  if (!reportContainer) return;

  try {
    const records = cachedStudentGrades.filter((record) => {
      const grade = record.grades;
      const term = getOneRelation(grade.terms);
      const matchesYear = window.filterSelectionMatches?.(yearId, grade.academic_year_id) ?? (!yearId || String(grade.academic_year_id) === String(yearId));
      const matchesSemester = ![1, 2].includes(semesterNumber) || getSemesterNumber(term?.name) === semesterNumber;
      const matchesAssessment = !assessmentIds.length || assessmentIds.includes(String(grade.assessment_id));
      const matchesClass = window.filterSelectionMatches?.(classId, grade.class_id) ?? (!classId || String(grade.class_id) === String(classId));
      const matchesSubject = window.filterSelectionMatches?.(subjectId, grade.subject_id) ?? (!subjectId || String(grade.subject_id) === String(subjectId));

      return (
        matchesYear &&
        matchesSemester &&
        matchesAssessment &&
        matchesClass &&
        matchesSubject
      );
    });

    if (!records.length) {
      reportContainer.innerHTML = `
        <p class="grades-state">
          ${cachedStudentGrades.length ? "No published grades match the selected filters." : "No published grades are available yet."}
        </p>`;
    } else {
      const grouped = new Map();
      records.forEach((record) => {
        const grade = record.grades;
        const subject = getOneRelation(grade.subjects);
        const category = getOneRelation(grade.assessment_categories);
        const subjectName = subject?.name || "General Subject";
        const categoryName = category?.name || "Assessment";

        if (!grouped.has(subjectName)) grouped.set(subjectName, []);
        grouped.get(subjectName).push({
          categoryName,
          score: record.score,
          weight: category?.marks ?? "-",
          creatorId: grade.created_by ? String(grade.created_by) : null,
        });
      });

      let html = renderStudentGradesStats(records);
      grouped.forEach((items, subjectName) => {
        html += `
          <div class="card grade-subject-card">
            <h3>${escapeHTML(subjectName)}</h3>
            <div class="table-responsive">
              <table class="table" style="width:100%;border-collapse:collapse;min-width:480px;">
                <thead>
                  <tr><th>Category</th><th>Score</th><th>Max Marks</th><th>Entered by</th></tr>
                </thead>
                <tbody>
                  ${items.map((item) => `
                    <tr>
                      <td>${escapeHTML(item.categoryName)}</td>
                      <td><strong>${item.score ?? "N/A"}</strong></td>
                      <td>${item.weight}</td>
                      <td>${renderStudentGradeAuthor(cachedStudentGradeCreators.get(item.creatorId), item.creatorId)}</td>
                    </tr>`).join("")}
                </tbody>
              </table>
            </div>
          </div>
        `;
      });

      reportContainer.innerHTML = html;
    }

    if (yearId && [1, 2].includes(semesterNumber) && gradesStudentId) {
      const selectedTerm = studentTerms.find(
        (term) =>
          window.filterSelectionMatches?.(yearId, term.academic_year_id) &&
          getSemesterNumber(term.name) === semesterNumber,
      );
      void loadStudentStatusForTerm(
        gradesStudentId,
        selectedTerm?.academic_year_id || yearId,
        selectedTerm?.id,
      );
    } else {
      const badge = document.getElementById("studentStatusBadge");
      if (badge) {
        badge.textContent = "Multiple periods";
        badge.className = "status-badge normal";
      }
    }
  } catch (error) {
    console.error("Error loading student grades:", error);
    showToast(
      window.getSupabaseErrorMessage?.(error, "Could not load grades."),
      "error",
    );
    reportContainer.innerHTML = `
      <p class="grades-state grades-state-error">
        Failed to load grades: ${escapeHTML(error.message || "Unknown error")}
      </p>`;
  }
}

function renderStudentGradeAuthor(profile, profileId) {
  if (!profile) {
    return `<span class="table-muted">${profileId ? "Name unavailable" : "Unknown"}</span>`;
  }

  const name = escapeHTML(profile.full_name || "Unknown");
  const role = profile.role
    ? escapeHTML(String(profile.role).charAt(0).toUpperCase() + String(profile.role).slice(1).toLowerCase())
    : "";
  const staffId = profile.teachers?.staff_id
    ? escapeHTML(profile.teachers.staff_id)
    : "";
  const details = [role, staffId].filter(Boolean).join(" · ");

  return `<span><strong>${name}</strong>${details ? `<small style="display:block;color:#718096;">${details}</small>` : ""}</span>`;
}

function renderStudentGradesStats(records) {
  let totalScore = 0;
  let totalMax = 0;
  let validCount = 0;
  let passedCount = 0;
  let sumPercentages = 0;

  records.forEach((rec) => {
    const grade = rec.grades || {};
    const category = getOneRelation(grade.assessment_categories) || {};
    const score = Number(rec.score);
    const categoryMax = Number(category.marks);

    if (Number.isFinite(score)) {
      totalScore += score;
    }
    if (Number.isFinite(categoryMax) && categoryMax > 0) {
      totalMax += categoryMax;
      if (Number.isFinite(score)) {
        const percentage = (score / categoryMax) * 100;
        sumPercentages += percentage;
        validCount++;
        if (percentage >= 70) passedCount++;
      }
    }
  });

  const avgPct = validCount
    ? totalMax > 0
      ? (totalScore / totalMax) * 100
      : sumPercentages / validCount
    : 0;

  const letterGrade =
    avgPct >= 90
      ? "A"
      : avgPct >= 80
        ? "B"
        : avgPct >= 70
          ? "C"
          : avgPct >= 60
            ? "D"
            : "F";

  const gradeClass =
    avgPct >= 80 ? "text-green" : avgPct >= 70 ? "text-amber" : "text-red";

  return `
    <div class="stats-grid">
      <div class="stat-card">
        <span class="stat-label">Average Category Score</span>
        <span class="stat-value ${gradeClass}">${validCount > 0 ? avgPct.toFixed(1) + "%" : "-"}</span>
        <span class="stat-sub">${validCount > 0 ? `Grade ${letterGrade} performance` : "No scores yet"}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Total Points</span>
        <span class="stat-value" style="color: #2563eb;">${totalScore}${totalMax > 0 ? ` <small style="font-size:1rem;color:#8b99ad;">/ ${totalMax}</small>` : ""}</span>
        <span class="stat-sub">Cumulative marks scored</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Assessment Categories</span>
        <span class="stat-value">${validCount}</span>
        <span class="stat-sub">${validCount > 0 ? `${passedCount} of ${validCount} passed (≥70%)` : "Recorded grades"}</span>
      </div>
    </div>
  `;
}

