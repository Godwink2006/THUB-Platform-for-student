async function initAcademicsPage() {
  const skeletonEl = document.getElementById("academicsSkeleton");
  const containerEl = document.getElementById("academicsContainer");

  try {
    if (!containerEl) return;

    const cards = [
      ["My Attendance", "View your attendance record.", "my-attendance.html", "fa-calendar-check"],
      ["My Grades", "View your grades and results.", "my-grades.html", "fa-chart-column"],
      ["My Fees", "View your fee balance and payments.", "my-fees.html", "fa-wallet"],
      ["My Transfer History", "View your transfer history.", "my-history.html", "fa-right-left"],
      ["My Timetable", "View your class timetable.", "my-timetable.html", "fa-calendar-days"],
    ];

    containerEl.innerHTML = cards
      .map(([title, description, href, icon]) => `
        <div class="academic-card">
          <h4><i class="fa-solid ${icon} app-academic-icon" aria-hidden="true"></i> ${title}</h4>
          <p>${description}</p>
          <button onclick="window.location.href = '${href}'" class="manage-btn">
            View <i class="fa-solid fa-chevron-right"></i>
          </button>
        </div>
      `)
      .join("");
  } catch (error) {
    console.error("Could not load student academics:", error);
  } finally {
    if (skeletonEl) skeletonEl.style.display = "none";
    if (containerEl) containerEl.style.display = "grid";
  }
}

document.addEventListener("DOMContentLoaded", initAcademicsPage);
