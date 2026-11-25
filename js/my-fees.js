let cachedStudentFees = [];
let cachedStudentTransactions = [];
const MY_FEES_CACHE_PAGE = "my-fees";
let feeAccessLoading = false;
let feesRestoredFromCache = false;

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
function getOneRelation(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function cachedFeesMatchSession(cachedUserId) {
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

function restoreCachedStudentFees() {
  const cached = window.studentPageCache?.readLast(MY_FEES_CACHE_PAGE);
  if (
    !cached?.data ||
    !Array.isArray(cached.data.fees) ||
    !Array.isArray(cached.data.transactions) ||
    !cachedFeesMatchSession(cached.userId)
  ) return false;

  cachedStudentFees = cached.data.fees;
  cachedStudentTransactions = cached.data.transactions;
  feesRestoredFromCache = true;
  setupFeeFilters();
  renderSelectedStudentFees();
  return true;
}

function setFeeRefreshState(isRefreshing) {
  const button = document.getElementById("refreshStudentFees");
  if (!button) return;
  button.disabled = isRefreshing;
  button.setAttribute("aria-busy", String(isRefreshing));
  button.innerHTML = isRefreshing
    ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i><span>Refreshing...</span>'
    : '<i class="fa-solid fa-rotate" aria-hidden="true"></i><span>Refresh</span>';
}

document.addEventListener("DOMContentLoaded", async () => {
  await window.studentPageCache?.ready;
  restoreCachedStudentFees();
  document.getElementById("refreshStudentFees")?.addEventListener("click", () => {
    void loadStudentFees({ refresh: true });
  });
  ["filterAcademicYear", "filterClass", "filterTerm"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", renderSelectedStudentFees);
  });
  void loadStudentFees();
});

async function loadStudentFees(options = {}) {
  if (feeAccessLoading) return;
  feeAccessLoading = true;
  const refresh = options.refresh === true;
  if (refresh) setFeeRefreshState(true);
  const client = window.supabaseClient;

  try {
    if (!client) throw new Error("The database client is unavailable.");
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError) throw authError;
    if (!user) {
      window.studentPageCache?.clearLast(MY_FEES_CACHE_PAGE);
      window.location.href = "login.html";
      return;
    }

    if (refresh) window.studentTransferHistoryIndex = null;
    const historyIndex = await window.getStudentTransferHistoryIndex(client);
    const { data: fees, error: feesError } = await client
      .from("student_fees")
      .select(`
        id, currency_code, total_fees, total_paid, balance, status,
        fee_breakdown, created_at, class_id, academic_year_id, term_id,
        academic_years ( id, year_label ), classes ( id, name ), terms ( id, name )
      `)
      .eq("student_id", user.id)
      .order("created_at", { ascending: false });
    if (feesError) throw feesError;

    const historicalFeeIds = historyIndex?.recordIds?.fee || new Set();
    cachedStudentFees = (fees || [])
      .filter((fee) => !historicalFeeIds.has(String(fee.id)))
      .map((fee) => ({
        ...fee,
        academic_years: getOneRelation(fee.academic_years),
        classes: getOneRelation(fee.classes),
        terms: getOneRelation(fee.terms),
      }));

    const feeIds = cachedStudentFees.map((fee) => fee.id);
    if (feeIds.length) {
      const { data: transactions, error: txError } = await client
        .from("payment_transactions")
        .select(`
          id, amount, payment_method, reference_number, notes, created_at,
          student_fee_id,
          payment_allocations ( id, item_name, amount, fee_item_id )
        `)
        .eq("student_id", user.id)
        .in("student_fee_id", feeIds)
        .order("created_at", { ascending: false });
      if (txError) throw txError;
      cachedStudentTransactions = transactions || [];
    } else {
      cachedStudentTransactions = [];
    }

    setupFeeFilters();
    await window.studentPageCache?.write(MY_FEES_CACHE_PAGE, user.id, {
      fees: cachedStudentFees,
      transactions: cachedStudentTransactions,
    });
    feesRestoredFromCache = true;
    renderSelectedStudentFees();
  } catch (error) {
    console.error("Could not load student fees:", error);
    if (!feesRestoredFromCache) window.studentPageCache?.clearLast(MY_FEES_CACHE_PAGE);
    const feesContainer = document.getElementById("studentFeesContainer");
    const txContainer = document.getElementById("paymentTransactionsContainer");
    const message = escapeHTML(window.getSupabaseErrorMessage?.(error, "Fees could not be loaded. Refresh the page or contact your school administrator."));
    if (!feesRestoredFromCache) {
      if (feesContainer) feesContainer.innerHTML = `<div class="empty-state">${message}</div>`;
      if (txContainer) txContainer.innerHTML = `<div class="empty-state">${message}</div>`;
    }
  } finally {
    feeAccessLoading = false;
    if (refresh) setFeeRefreshState(false);
  }
}

function setupFeeFilters() {
  const selectedYear = document.getElementById("filterAcademicYear")?.value || "";
  const selectedClass = document.getElementById("filterClass")?.value || "";
  const years = new Map();
  const classes = new Map();
  cachedStudentFees.forEach((fee) => {
    if (fee.academic_years?.id) years.set(String(fee.academic_years.id), fee.academic_years.year_label || "Academic year");
    if (fee.classes?.id) classes.set(String(fee.classes.id), fee.classes.name || "Class");
  });
  fillFeeFilter(document.getElementById("filterAcademicYear"), "All Academic Years", years, selectedYear);
  fillFeeFilter(document.getElementById("filterClass"), "All Classes", classes, selectedClass);
  const termSelect = document.getElementById("filterTerm");
  if (termSelect) {
    const selectedTerm = termSelect.value;
    termSelect.innerHTML = '<option value="">All Semesters</option><option value="1">1st Semester</option><option value="2">2nd Semester</option>';
    termSelect.value = selectedTerm;
  }
}

function fillFeeFilter(select, placeholder, values, selectedValue = "") {
  if (!select) return;

  select.replaceChildren();
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  const options = window.buildUniqueFilterOptions?.(values) || [];
  options
    .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true, sensitivity: "base" }))
    .forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
  if (options.some((option) => option.value === selectedValue)) select.value = selectedValue;
}
function renderFeesTable(fees, container) {
  let html = `
    <div class="table-responsive">
      <table>
        <thead>
          <tr>
            <th>Academic Period</th>
            <th>Class</th>
            <th>Fee Items Breakdown</th>
            <th>Total</th>
            <th>Paid</th>
            <th>Balance</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
  `;

  fees.forEach((fee) => {
    const yearLabel = fee.academic_years?.year_label || "-";
    const termName = fee.terms?.name || "-";
    const className = fee.classes?.name || "-";

    let breakdownHtml = `<span style="color: var(--text-muted); font-style: italic;">No items specified</span>`;
    if (fee.fee_breakdown) {
      try {
        const items =
          typeof fee.fee_breakdown === "string"
            ? JSON.parse(fee.fee_breakdown)
            : fee.fee_breakdown;
        if (Array.isArray(items) && items.length > 0) {
          breakdownHtml = `<ul class="breakdown-list" style="margin:0; padding-left:15px;">`;
          items.forEach((item) => {
            const itemName = item.fee_name || "Fee Item";
            const itemAmount = item.amount || 0;
            breakdownHtml += `<li>${escapeHTML(itemName)}: <strong>${window.formatSchoolMoney(itemAmount, fee.currency_code)}</strong></li>`;
          });
          breakdownHtml += `</ul>`;
        }
      } catch (e) {
        console.error("Error parsing fee breakdown JSON:", e);
      }
    }

    const statusDisplay = String(fee.status || "Unpaid");
    const normalizedStatus = statusDisplay.toLowerCase();
    const statusClass = ["paid", "unpaid", "partial"].includes(
      normalizedStatus,
    )
      ? normalizedStatus
      : "unknown";

    html += `
      <tr>
        <td><strong>${escapeHTML(yearLabel)}</strong><br><span style="color: var(--text-muted); font-size: 13px;">${escapeHTML(termName)}</span></td>
        <td>${escapeHTML(className)}</td>
        <td>${breakdownHtml}</td>
        <td class="amount-bold">${window.formatSchoolMoney(fee.total_fees, fee.currency_code)}</td>
        <td class="amount-paid">${window.formatSchoolMoney(fee.total_paid, fee.currency_code)}</td>
        <td class="amount-balance">${window.formatSchoolMoney(fee.balance, fee.currency_code)}</td>
        <td><span class="badge ${statusClass}">${escapeHTML(statusDisplay)}</span></td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}

function renderSelectedStudentFees() {
  const feesContainer = document.getElementById("studentFeesContainer");
  const txContainer = document.getElementById("paymentTransactionsContainer");
  if (!feesContainer || !txContainer) return;

  const filters = {
    academic_year_id: document.getElementById("filterAcademicYear")?.value || "",
    class_id: document.getElementById("filterClass")?.value || "",
    semester_number: document.getElementById("filterTerm")?.value || "",
  };
  const semesterNumber = Number(filters.semester_number || 0);
  const fees = cachedStudentFees.filter((fee) =>
    (window.filterSelectionMatches?.(filters.academic_year_id, fee.academic_year_id) ?? (!filters.academic_year_id || String(fee.academic_year_id) === String(filters.academic_year_id))) &&
    (window.filterSelectionMatches?.(filters.class_id, fee.class_id) ?? (!filters.class_id || String(fee.class_id) === String(filters.class_id))) &&
    (!semesterNumber || getSemesterNumber(fee.terms?.name) === semesterNumber)
  );

  if (!cachedStudentFees.length) {
    feesContainer.innerHTML = '<div class="empty-state">No fee records found.</div>';
    txContainer.innerHTML = '<div class="empty-state">No payment transaction records found.</div>';
    return;
  }

  if (!fees.length) {
    feesContainer.innerHTML = '<div class="empty-state">No fee records match the selected filters.</div>';
    txContainer.innerHTML = '<div class="empty-state">No payment transaction records match the selected fees.</div>';
    return;
  }

  renderFeesTable(fees, feesContainer);
  renderStudentTransactions(fees, txContainer);
}

function renderStudentTransactions(fees, txContainer) {
  const feeIds = new Set(fees.map((fee) => String(fee.id)));
  const currencyByFeeId = new Map(fees.map((fee) => [String(fee.id), fee.currency_code]));
  const transactions = cachedStudentTransactions.filter((tx) => feeIds.has(String(tx.student_fee_id)));

  if (!transactions.length) {
    txContainer.innerHTML = '<div class="empty-state">No payment transaction records found for this period.</div>';
    return;
  }

  const rows = transactions.map((tx) => {
    const dateStr = new Date(tx.created_at).toLocaleDateString("en-US", {
      year: "numeric", month: "short", day: "numeric",
    });
    const allocations = Array.isArray(tx.payment_allocations) ? tx.payment_allocations : [];
    const allocationsHtml = allocations.length
      ? `<ul class="breakdown-list">${allocations.map((allocation) =>
          `<li>${escapeHTML(allocation.item_name || "Fee Item")}: <strong>${window.formatSchoolMoney(allocation.amount || 0, currencyByFeeId.get(String(tx.student_fee_id)))}</strong></li>`,
        ).join("")}</ul>`
      : '<span class="general-payment">General payment</span>';
    return `<tr>
      <td>${escapeHTML(dateStr)}</td>
      <td>${escapeHTML(tx.payment_method || "Cash / Other")}</td>
      <td><code>${escapeHTML(tx.reference_number || "-")}</code></td>
      <td>${allocationsHtml}</td>
      <td class="amount-paid">${window.formatSchoolMoney(tx.amount, currencyByFeeId.get(String(tx.student_fee_id)))}</td>
    </tr>`;
  }).join("");

  txContainer.innerHTML = `<div class="table-responsive"><table>
    <thead><tr><th>Date</th><th>Payment Method</th><th>Reference No.</th><th>Allocated Items</th><th>Total Paid</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}
