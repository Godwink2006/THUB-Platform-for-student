let allCatalogBooks = [];
const BOOKS_PAGE_SIZE = 10;
const BOOKS_CACHE_PREFIX = "thubStudentBooksCatalog:v2:";
const BOOKS_LAST_ACCESS_KEY = "thubStudentBooksAccess:v1";
let booksOffset = 0;
let booksHasMore = false;
let booksLoading = false;
let booksAccessLoading = false;
let booksAccessVerified = false;
let booksGraduatedAccess = false;
let booksCacheKey = "";
let booksStudentId = "";
let booksSchoolId = "";
let booksCacheRestored = false;

function readBooksCache() {
  if (!booksCacheKey) return null;
  try {
    const cached = JSON.parse(localStorage.getItem(booksCacheKey) || "null");
    if (
      !cached ||
      !Array.isArray(cached.books)
    ) return null;
    return cached;
  } catch (error) {
    console.warn("Could not read the saved books catalog:", error);
    return null;
  }
}

function saveBooksCache() {
  if (!booksCacheKey) return;
  try {
    localStorage.setItem(booksCacheKey, JSON.stringify({
      savedAt: Date.now(),
      studentId: booksStudentId,
      schoolId: booksSchoolId,
      books: allCatalogBooks,
      hasMore: booksHasMore,
    }));
  } catch (error) {
    console.warn("Could not save the books catalog locally:", error);
  }
}

function saveBooksAccess() {
  if (!booksStudentId) return;
  try {
    localStorage.setItem(BOOKS_LAST_ACCESS_KEY, JSON.stringify({
      studentId: booksStudentId,
      schoolId: booksSchoolId,
      cacheKey: booksCacheKey,
    }));
  } catch (error) {
    console.warn("Could not save student enrollment locally:", error);
  }
}

function restoreCachedBooksPage() {
  try {
    const savedAccess = JSON.parse(localStorage.getItem(BOOKS_LAST_ACCESS_KEY) || "null");
    if (!savedAccess?.studentId) return false;

    booksStudentId = savedAccess.studentId;
    booksSchoolId = savedAccess.schoolId || "";
    // Cached catalog data never grants access; initializeBooksPage verifies enrollment with Supabase.
    booksGraduatedAccess = false;
    booksCacheKey = `${BOOKS_CACHE_PREFIX}${booksStudentId}:${booksSchoolId || "no-school"}`;

    const cachedCatalog = readBooksCache();
    if (!cachedCatalog || cachedCatalog.studentId !== booksStudentId) return false;

    allCatalogBooks = cachedCatalog.books;
    booksOffset = allCatalogBooks.length;
    booksHasMore = cachedCatalog.hasMore === true;
    booksCacheRestored = true;
    const query = document.getElementById("catalogSearchInput")?.value.toLowerCase().trim() || "";
    renderBookCards(filterCatalogBooks(query));
    updateBooksNextButton();
    return true;
  } catch (error) {
    console.warn("Could not restore the saved Books page:", error);
    return false;
  }
}

function updateBooksNextButton() {
  const nextButton = document.getElementById("nextBooksPage");
  if (!nextButton) return;
  nextButton.hidden = !booksHasMore;
  nextButton.disabled = false;
  nextButton.textContent = "Next";
}

function booksErrorMessage(error, action = "load") {
  const backendMessage = window.getSupabaseErrorMessage?.(error, "");
  if (backendMessage) return backendMessage;

  const code = String(error?.code || "").toLowerCase();
  const status = Number(error?.status || error?.statusCode || 0);
  const diagnostic = `${code} ${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();

  if (status === 401 || code === "pgrst301" || /invalid jwt|session.*expired|refresh token/.test(diagnostic)) {
    return "Your session has expired. Sign in again, then reopen Books.";
  }
  if (/school.{0,30}inactive|inactive.{0,30}school/.test(diagnostic)) {
    return "This school is inactive. Books are unavailable until the school is reactivated.";
  }
  if (code === "42501" || status === 403 || /row-level security|permission denied|not authorized|access denied|insufficient privilege/.test(diagnostic)) {
    return action === "history"
      ? "You do not have permission to view this borrowing history. Contact your school administrator if you need access."
      : "You do not have permission to view the library catalog. Contact your school administrator for help.";
  }
  if (/failed to fetch|fetch failed|network|connection|timeout|timed out/.test(diagnostic)) {
    return `${action === "history" ? "Borrowing history" : "Books"} could not be loaded because the connection failed. Check your internet connection and try again.`;
  }
  if (code === "pgrst116") return "The account or book information could not be found. Refresh the page and try again.";
  return action === "history"
    ? "Your borrowing history could not be loaded. Please try again."
    : "The library catalog could not be loaded. Please try again.";
}

function showBooksNotice(message, type = "info", onRetry = null) {
  const notice = document.getElementById("booksPageNotice");
  if (!notice) return;
  notice.replaceChildren();
  notice.dataset.type = type;

  const icon = document.createElement("i");
  icon.className = type === "info"
    ? "fa-solid fa-spinner fa-spin"
    : type === "graduated"
      ? "fa-solid fa-graduation-cap"
      : "fa-solid fa-triangle-exclamation";
  icon.setAttribute("aria-hidden", "true");

  const content = document.createElement("div");
  content.className = "books-notice-content";
  const text = document.createElement("span");
  text.textContent = message;
  content.appendChild(text);

  if (onRetry) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Try again";
    retry.addEventListener("click", onRetry, { once: true });
    content.appendChild(retry);
  }

  notice.append(icon, content);
  notice.hidden = false;
}

function hideBooksNotice() {
  const notice = document.getElementById("booksPageNotice");
  if (notice) {
    notice.hidden = true;
    notice.replaceChildren();
    delete notice.dataset.type;
  }
}

function showBooksCatalogLoading() {
  const gridContainer = document.getElementById("bookCardGrid");
  if (!gridContainer) return;
  gridContainer.innerHTML = `
    <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: #64748b;">
      <i class="fa-solid fa-spinner fa-spin" style="margin-right: 0.5rem; font-size: 1.2rem;"></i>
      Loading books...
    </div>
  `;
}

async function initializeBooksPage(options = {}) {
  if (booksAccessLoading) return;
  const forceCatalogRefresh = options.forceCatalogRefresh === true;
  const cachedStudentId = booksStudentId;
  const cachedSchoolId = booksSchoolId;
  let matchingCachedCatalog = false;
  booksAccessLoading = true;
  booksAccessVerified = false;
  booksGraduatedAccess = false;
  hideBooksNotice();
  const refreshButton = document.getElementById("refreshBooksCatalog");
  if (allCatalogBooks.length === 0) showBooksCatalogLoading();
  if (forceCatalogRefresh && refreshButton) {
    refreshButton.disabled = true;
    refreshButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Refreshing...</span>';
  }

  try {
    if (!window.supabaseClient) throw new Error("The database client is unavailable.");
    const { data: authData, error: authError } = await window.supabaseClient.auth.getUser();
    if (authError) throw authError;
    if (!authData?.user?.id) {
      const error = new Error("Your session has expired.");
      error.status = 401;
      throw error;
    }

    matchingCachedCatalog = booksCacheRestored && cachedStudentId === authData.user.id;
    if (booksCacheRestored && !matchingCachedCatalog) {
      allCatalogBooks = [];
      booksOffset = 0;
      booksHasMore = false;
      booksCacheRestored = false;
      showBooksCatalogLoading();
    }

    const { data: profile, error: profileError } = await window.supabaseClient
      .from("profiles")
      .select("role, school_id")
      .eq("id", authData.user.id)
      .single();
    if (profileError) throw profileError;
    booksStudentId = authData.user.id;
    booksSchoolId = profile?.school_id || "";
    matchingCachedCatalog = matchingCachedCatalog && cachedSchoolId === booksSchoolId;
    if (booksCacheRestored && !matchingCachedCatalog) {
      allCatalogBooks = [];
      booksOffset = 0;
      booksHasMore = false;
      booksCacheRestored = false;
      showBooksCatalogLoading();
    }
    booksCacheKey = `${BOOKS_CACHE_PREFIX}${authData.user.id}:${booksSchoolId || "no-school"}`;

    if (String(profile?.role || "").trim().toLowerCase() !== "student") {
      throw new Error("The library catalog is available to student accounts only.");
    }

    let enrollmentQuery = window.supabaseClient
      .from("student_enrollments")
      .select("enrollment_status")
      .eq("student_id", authData.user.id);
    if (booksSchoolId) enrollmentQuery = enrollmentQuery.eq("school_id", booksSchoolId);

    const { data: enrollments, error: enrollmentError } = await enrollmentQuery;
    if (enrollmentError) throw enrollmentError;
    const enrollmentStatuses = [...new Set((enrollments || [])
      .map((enrollment) => String(enrollment.enrollment_status || "").trim().toLowerCase())
      .filter(Boolean))];
    booksGraduatedAccess = enrollmentStatuses.some((status) =>
      ["graduated", "transferred", "transfered"].includes(status),
    );
    booksAccessVerified = true;

    saveBooksAccess();
    if (booksGraduatedAccess) {
      try {
        localStorage.removeItem(booksCacheKey);
      } catch (error) {
        console.warn("Could not clear the saved Books catalog:", error);
      }
      allCatalogBooks = [];
      booksOffset = 0;
      booksHasMore = false;
      booksCacheRestored = false;
      document.getElementById("bookCardGrid")?.replaceChildren();
      showBooksNotice(
        "Books are unavailable because your enrollment at this school is marked as graduated or transferred. Contact your school administrator if you think this is a mistake.",
        "graduated",
      );
      return;
    }

    hideBooksNotice();
    if (matchingCachedCatalog && !forceCatalogRefresh) {
      saveBooksCache();
      updateBooksNextButton();
      return;
    }
    booksCacheRestored = false;
    await loadBookCatalog({
      preserveCurrent: forceCatalogRefresh && allCatalogBooks.length > 0,
    });
  } catch (error) {
    console.error("Could not determine Books page access:", error);
    allCatalogBooks = [];
    booksCacheRestored = false;
    booksAccessVerified = false;
    document.getElementById("bookCardGrid")?.replaceChildren();
    showBooksNotice(booksErrorMessage(error), "error", () => initializeBooksPage({ forceCatalogRefresh: true }));
  } finally {
    booksAccessLoading = false;
    if (forceCatalogRefresh && refreshButton) {
      refreshButton.disabled = false;
      refreshButton.innerHTML = '<i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Refresh</span>';
    }
  }
}

async function loadBookCatalog(options = {}) {
  if (!booksAccessVerified) return;
  const gridContainer = document.getElementById("bookCardGrid");
  if (!gridContainer) return;
  const append = options.append === true;
  const preserveCurrent = options.preserveCurrent === true && !append;
  const nextButton = document.getElementById("nextBooksPage");

  if (booksLoading || (append && !booksHasMore)) return;
  booksLoading = true;

  if (!append && !preserveCurrent) {
    booksOffset = 0;
    booksHasMore = false;
    allCatalogBooks = [];
    if (nextButton) {
      nextButton.hidden = true;
      nextButton.disabled = false;
      nextButton.textContent = "Next";
    }
    showBooksCatalogLoading();
  } else if (nextButton) {
    nextButton.disabled = true;
    nextButton.textContent = "Loading...";
  }
  hideBooksNotice();

  try {
    const queryOffset = append ? booksOffset : 0;
    const { data: page, error } = await window.supabaseClient
      .from("books")
      .select(
        `
        *,
        departments ( name )
      `,
      )
      .eq("status", "active")
      .order("title", { ascending: true })
      .order("id", { ascending: true })
      .range(queryOffset, queryOffset + BOOKS_PAGE_SIZE);

    if (error) throw error;

    const books = page || [];
    const visibleBooks = books.slice(0, BOOKS_PAGE_SIZE);
    booksHasMore = books.length > BOOKS_PAGE_SIZE;

    if (visibleBooks.length === 0) {
      if (!append) {
        allCatalogBooks = [];
        booksOffset = 0;
        renderBookCards([]);
      }
      saveBooksCache();
      return;
    }

    booksOffset = queryOffset + visibleBooks.length;
    const catalogPage = visibleBooks.map((book) => ({
      ...book,
      available_copies: getAvailableBookCopies(book),
    }));
    allCatalogBooks = append
      ? allCatalogBooks.concat(catalogPage)
      : catalogPage;
    saveBooksCache();
    const query = document
      .getElementById("catalogSearchInput")
      ?.value.toLowerCase().trim() || "";
    renderBookCards(filterCatalogBooks(query));
  } catch (err) {
    console.error("Error loading catalog:", err);
    showBooksNotice(booksErrorMessage(err), "error", () => loadBookCatalog({ append }));
    if (!append && !preserveCurrent) {
      gridContainer.replaceChildren();
    }
  } finally {
    booksLoading = false;
    updateBooksNextButton();
  }
}

function filterCatalogBooks(query) {
  return allCatalogBooks.filter((book) => {
    const title = (book.title || "").toLowerCase();
    const author = (book.author || "").toLowerCase();
    const dept = (book.departments?.name || "").toLowerCase();
    const code = (book.book_code || "").toLowerCase();

    return (
      title.includes(query) ||
      author.includes(query) ||
      dept.includes(query) ||
      code.includes(query)
    );
  });
}

function getAvailableBookCopies(book) {
  const availableCopies = Number(book.available_copies);
  if (!Number.isFinite(availableCopies)) return 0;
  return Math.max(0, Math.floor(availableCopies));
}

function renderBookCards(booksToRender) {
  const gridContainer = document.getElementById("bookCardGrid");
  if (!gridContainer) return;

  gridContainer.innerHTML = "";

  if (!booksToRender || booksToRender.length === 0) {
    gridContainer.innerHTML = `
     <div style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 5rem 2rem; min-height: 250px; text-align: center; color: #64748b;">
  <i class="fa-solid fa-book-open" style="font-size: 10rem; margin-bottom: 1rem; color: #cbd5e1; display: block;"></i>
  <span style="font-size: 1.1rem; font-weight: 800; color: #334155;">No books available.</span>
</div>
    `;
    return;
  }

  booksToRender.forEach((book) => {
    const card = document.createElement("div");
    card.className = "book-card";

    const coverSrc =
      book.cover_image_url ||
      "https://cdn-icons-png.flaticon.com/512/29/29302.png";
    const departmentName = book.departments ? book.departments.name : "-";
    const availableCopies = Number(book.available_copies) || 0;

    const isAvailable = availableCopies > 0;
    const badgeClass = isAvailable ? "badge-available" : "badge-unavailable";
    const badgeText = isAvailable
      ? `${availableCopies} Available`
      : "Out of Stock";

    card.innerHTML = `
      <div class="book-card-img-wrapper">
        <span class="book-card-badge ${badgeClass}">${badgeText}</span>
        <img
          src="${escapeHtml(coverSrc)}"
          alt="${escapeHtml(book.title)}"
          onerror="this.onerror=null; this.src='https://cdn-icons-png.flaticon.com/512/149/149071.png';"
        />
      </div>
      <div class="book-card-body">
        <span class="book-card-category">${escapeHtml(departmentName)}</span>
        <h3 class="book-card-title">${escapeHtml(book.title)}</h3>
        <p class="book-card-author">By ${escapeHtml(book.author || "Unknown")}</p>
        <div class="book-card-footer">
          <span class="book-copies-text">Shelf: <strong>${escapeHtml(book.shelf_location || "N/A")}</strong></span>
<button class="book-view-details-btn" onclick="openStudentBookHistoryModal('${book.id}')">
  View
</button>
        </div>
      </div>
    `;

    gridContainer.appendChild(card);
  });
}

const catalogSearchInput = document.getElementById("catalogSearchInput");
if (catalogSearchInput) {
  catalogSearchInput.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase().trim();
    renderBookCards(filterCatalogBooks(query));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("nextBooksPage")
    ?.addEventListener("click", () => loadBookCatalog({ append: true }));
  document
    .getElementById("refreshBooksCatalog")
    ?.addEventListener("click", () => initializeBooksPage({ forceCatalogRefresh: true }));

  restoreCachedBooksPage();
  initializeBooksPage();
});

async function openStudentBookHistoryModal(bookId) {
  if (!booksAccessVerified) {
    showToast("Checking your student access. Please try again in a moment.", "info");
    return;
  }
  if (booksGraduatedAccess) {
    showToast("Borrowing history is unavailable because your enrollment is marked as graduated or transferred.", "error");
    return;
  }
  const studentModal = document.getElementById("studentHistoryModal");
  if (!studentModal) {
    if (typeof showToast === "function") {
      showToast("Modal element not found.", "error");
    }
    return;
  }

  studentModal.style.display = "flex";
  if (typeof lockBodyScroll === "function") lockBodyScroll();

  const historyContainer = document.getElementById("studentHistoryContent");
  if (historyContainer) {
    historyContainer.innerHTML = `
      <div style="text-align: center; padding: 2rem; color: #64748b;">
        <i class="fa-solid fa-spinner fa-spin" style="margin-right: 0.5rem;"></i> Loading your history...
      </div>
    `;
  }

  try {
    const {
      data: { user },
      error: authError,
    } = await window.supabaseClient.auth.getUser();
    if (authError || !user) throw new Error("Not authenticated");

    const { data: profile, error: profileError } = await window.supabaseClient
      .from("profiles")
      .select("id, full_name, email, photo_url, students(student_id)")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;

    const { data: history, error } = await window.supabaseClient
      .from("book_borrowings")
      .select(`*, books ( title, book_code, description )`)
      .eq("book_id", bookId)
      .eq("borrower_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!historyContainer) return;

    const book =
      allCatalogBooks.find((item) => item.id === bookId) ||
      history?.[0]?.books ||
      {};
    const student = Array.isArray(profile.students)
      ? profile.students[0]
      : profile.students;
    const borrowerIdentity = getBorrowerIdentity(profile, student);
    const borrowerName = profile.full_name || profile.email || "User";
    const photoUrl = getSafeProfilePhotoUrl(profile.photo_url);
    const bookDetails = `
      <section class="book-history-book">
        <h4>${escapeHtml(book.title || "Book details")}</h4>
        ${book?.book_code ? `<p><strong>Book ID:</strong> ${escapeHtml(book.book_code)}</p>` : ""}
        <p><strong>Description:</strong> ${escapeHtml(book.description || "No description available.")}</p>
      </section>
      <section class="book-history-borrower" aria-label="Borrower profile">
        <img class="app-person-avatar" src="${escapeHtml(photoUrl)}" alt="" aria-hidden="true" onerror="this.onerror=null;this.src='${escapeHtml(window.DEFAULT_PROFILE_AVATAR || "")}'" />
        <span class="app-person-meta">
          <strong>${escapeHtml(borrowerName)}</strong>
          <small>Student</small>
          ${borrowerIdentity ? `<small>${escapeHtml(borrowerIdentity.label)}: ${escapeHtml(borrowerIdentity.value)}</small>` : ""}
        </span>
      </section>
      <h4 class="book-history-section-title">Borrowing History</h4>
    `;

    if (!history || history.length === 0) {
      historyContainer.innerHTML = `${bookDetails}
        <div class="empty-state-card">
          <i class="fa-solid fa-book-open-reader empty-icon"></i>
          <p>You have no borrowing history for this book yet.</p>
        </div>`;
      return;
    }

    historyContainer.innerHTML = `${bookDetails}${history
      .map((record) => `
     <div class="book-history-entry">
        <p><strong>Borrowed Date:</strong> ${formatDate(record.borrow_date)}</p>
        <p><strong>Due Date:</strong> ${formatDate(record.due_date)}</p>
        <p><strong>Return Date:</strong> ${record.return_date ? formatDate(record.return_date) : "Not returned yet"}</p>
        <p><strong>Status:</strong> <span class="status-${escapeHtml(record.status)}">${escapeHtml(record.status)}</span></p>
      </div>
    `).join("")}`;
  } catch (err) {
    console.error("Error loading student history:", err);
    if (historyContainer) {
      historyContainer.replaceChildren();
      const message = document.createElement("p");
      message.style.cssText = "text-align:center;color:#dc2626;padding:2rem;";
      message.textContent = booksErrorMessage(err, "history");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "book-view-details-btn";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => openStudentBookHistoryModal(bookId), { once: true });
      historyContainer.append(message, retry);
    }
  }
}

function getBorrowerIdentity(profile, student = null) {
  if (student?.student_id) {
    return { label: "Student ID", value: student.student_id };
  }
  return null;
}

function getSafeProfilePhotoUrl(photoUrl) {
  if (!photoUrl) return window.DEFAULT_PROFILE_AVATAR || "";
  try {
    const parsedPhotoUrl = new URL(photoUrl, window.location.href);
    if (
      ["https:", "http:"].includes(parsedPhotoUrl.protocol) ||
      photoUrl === window.DEFAULT_PROFILE_AVATAR
    ) {
      return parsedPhotoUrl.href;
    }
  } catch (error) {
    console.warn("Ignoring invalid profile photo URL:", error);
  }
  return window.DEFAULT_PROFILE_AVATAR || "";
}

function formatDate(dateString) {
  if (!dateString) return "-";
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return escapeHtml(dateString);

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function closeStudentHistoryModal() {
  const studentModal = document.getElementById("studentHistoryModal");
  if (studentModal) {
    studentModal.style.display = "none";
  }
  if (typeof unLockBodyScroll === "function") {
    unLockBodyScroll();
  }
}

window.addEventListener("click", (e) => {
  const studentModal = document.getElementById("studentHistoryModal");
  if (studentModal && e.target === studentModal) {
    closeStudentHistoryModal();
  }
});
