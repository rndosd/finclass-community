const BANK_SUMMARY_VERSION = 1;
const PAYROLL_SUMMARY_VERSION = 1;
const STUDENT_PAYROLL_SUMMARY_VERSION = 1;

const EMPTY_PENDING_COUNTS = Object.freeze({
  savings: 0,
  loans: 0,
  total: 0,
});

function toWholeNumber(value, fallback = 0) {
  const numericValue = Math.floor(Number(value));
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function sortByCreatedAtDesc(a, b) {
  return toMillis(b?.createdAt) - toMillis(a?.createdAt);
}

function normalizeRows(rows = []) {
  const normalizedRows = Array.isArray(rows) ? [...rows] : [];
  normalizedRows.sort(sortByCreatedAtDesc);
  return normalizedRows;
}

function isFiniteNumberLike(value) {
  return Number.isFinite(Number(value));
}

function hasRequiredOverviewStats(data, kind) {
  if (
    !isFiniteNumberLike(data?.rowCount) ||
    !isFiniteNumberLike(data?.pendingCount) ||
    !isFiniteNumberLike(data?.activeCount)
  ) {
    return false;
  }

  if (kind === "savings") {
    return (
      isFiniteNumberLike(data?.claimableCount) &&
      isFiniteNumberLike(data?.totalAmount)
    );
  }

  return (
    isFiniteNumberLike(data?.overdueCount) &&
    isFiniteNumberLike(data?.totalOutstandingPrincipal)
  );
}

export function isValidPendingSummaryData(data) {
  return (
    Number(data?.summaryVersion || 0) === BANK_SUMMARY_VERSION &&
    Array.isArray(data?.pendingSavings) &&
    Array.isArray(data?.pendingLoans) &&
    isFiniteNumberLike(data?.pendingSavingsCount) &&
    isFiniteNumberLike(data?.pendingLoansCount)
  );
}

export function normalizePendingSummaryData(data) {
  const pendingSavings = normalizeRows(data?.pendingSavings);
  const pendingLoans = normalizeRows(data?.pendingLoans);
  const counts = {
    savings: toWholeNumber(data?.pendingSavingsCount, pendingSavings.length),
    loans: toWholeNumber(data?.pendingLoansCount, pendingLoans.length),
  };

  return {
    pendingSavings,
    pendingLoans,
    counts: {
      ...counts,
      total: counts.savings + counts.loans,
    },
    updatedAt: data?.updatedAt || null,
  };
}

export function getEmptyPendingSummary() {
  return {
    pendingSavings: [],
    pendingLoans: [],
    counts: EMPTY_PENDING_COUNTS,
    updatedAt: null,
  };
}

export function isValidBankOverviewSummaryData(data, kind) {
  return (
    Number(data?.summaryVersion || 0) === BANK_SUMMARY_VERSION &&
    data?.kind === kind &&
    hasRequiredOverviewStats(data, kind)
  );
}

export function normalizeBankOverviewSummaryData(data, kind) {
  const rows = normalizeRows(data?.rows);
  const commonStats = {
    rowCount: toWholeNumber(data?.rowCount, rows.length),
    pendingCount: toWholeNumber(data?.pendingCount),
    activeCount: toWholeNumber(data?.activeCount),
  };

  const stats =
    kind === "savings"
      ? {
          ...commonStats,
          claimableCount: toWholeNumber(data?.claimableCount),
          totalAmount: toWholeNumber(data?.totalAmount),
        }
      : {
          ...commonStats,
          overdueCount: toWholeNumber(data?.overdueCount),
          totalOutstandingPrincipal: toWholeNumber(
            data?.totalOutstandingPrincipal,
          ),
        };

  return {
    kind,
    rows,
    stats,
    alertDateBuckets: data?.alertDateBucketsVersion === 1 && data?.alertDateBuckets &&
      typeof data.alertDateBuckets === "object" && !Array.isArray(data.alertDateBuckets)
      ? data.alertDateBuckets : null,
    updatedAt: data?.updatedAt || null,
  };
}

export function getEmptyBankOverviewSummary(kind) {
  return {
    kind,
    rows: [],
    stats:
      kind === "savings"
        ? {
            rowCount: 0,
            pendingCount: 0,
            activeCount: 0,
            claimableCount: 0,
            totalAmount: 0,
          }
        : {
            rowCount: 0,
            pendingCount: 0,
            activeCount: 0,
            overdueCount: 0,
            totalOutstandingPrincipal: 0,
          },
    updatedAt: null,
  };
}

export function isValidPayrollOverviewSummaryData(data) {
  return (
    Number(data?.summaryVersion || 0) === PAYROLL_SUMMARY_VERSION &&
    Array.isArray(data?.recentPayslips) &&
    isFiniteNumberLike(data?.recentSalaryCount) &&
    isFiniteNumberLike(data?.recentBonusCount) &&
    isFiniteNumberLike(data?.totalRecentNetSalary)
  );
}

export function normalizePayrollOverviewSummaryData(data, limitCount = 200) {
  const recentPayslips = normalizeRows(data?.recentPayslips).slice(0, limitCount);

  return {
    recentPayslips,
    stats: {
      recentPayslipCount: recentPayslips.length,
      recentSalaryCount: toWholeNumber(data?.recentSalaryCount),
      recentBonusCount: toWholeNumber(data?.recentBonusCount),
      totalRecentNetSalary: toWholeNumber(data?.totalRecentNetSalary),
    },
    latestCreatedAt: data?.latestCreatedAt || recentPayslips[0]?.createdAt || null,
    updatedAt: data?.updatedAt || null,
  };
}

export function getEmptyPayrollOverviewSummary() {
  return {
    recentPayslips: [],
    stats: {
      recentPayslipCount: 0,
      recentSalaryCount: 0,
      recentBonusCount: 0,
      totalRecentNetSalary: 0,
    },
    latestCreatedAt: null,
    updatedAt: null,
  };
}

export function isValidStudentPayrollSummaryData(data) {
  return (
    Number(data?.summaryVersion || 0) === STUDENT_PAYROLL_SUMMARY_VERSION &&
    Array.isArray(data?.recentSalaryPayslips) &&
    isFiniteNumberLike(data?.recentSalaryCount) &&
    isFiniteNumberLike(data?.totalRecentNetSalary)
  );
}

export function normalizeStudentPayrollSummaryData(data, limitCount = 30) {
  const recentSalaryPayslips = normalizeRows(data?.recentSalaryPayslips).slice(
    0,
    limitCount,
  );

  return {
    studentUid: String(data?.studentUid || "").trim() || null,
    recentSalaryPayslips,
    stats: {
      recentSalaryCount: toWholeNumber(
        data?.recentSalaryCount,
        recentSalaryPayslips.length,
      ),
      totalRecentNetSalary: toWholeNumber(data?.totalRecentNetSalary),
    },
    latestSalaryCreatedAt:
      data?.latestSalaryCreatedAt || recentSalaryPayslips[0]?.createdAt || null,
    latestSalaryPayslipId:
      String(data?.latestSalaryPayslipId || "").trim() ||
      recentSalaryPayslips[0]?.id ||
      null,
    hasSalaryPayslips:
      data?.hasSalaryPayslips === true || recentSalaryPayslips.length > 0,
    updatedAt: data?.updatedAt || null,
  };
}

export function getEmptyStudentPayrollSummary() {
  return {
    studentUid: null,
    recentSalaryPayslips: [],
    stats: {
      recentSalaryCount: 0,
      totalRecentNetSalary: 0,
    },
    latestSalaryCreatedAt: null,
    latestSalaryPayslipId: null,
    hasSalaryPayslips: false,
    updatedAt: null,
  };
}
