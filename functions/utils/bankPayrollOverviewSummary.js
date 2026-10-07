"use strict";

const admin = require("../firebaseAdminCompat");
const { buildDateBuckets, updateDateBuckets, countDateBuckets } = require("./bankDateBuckets");
const {
    calculateMaturityDate,
    hasLoanOverduePenalty,
    startOfDayInKST,
} = require("./dateUtils");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const BANK_SUMMARY_VERSION = 1;
const PAYROLL_SUMMARY_VERSION = 1;
const STUDENT_PAYROLL_SUMMARY_VERSION = 1;
const PAYROLL_RECENT_LIMIT = 200;
const STUDENT_PAYROLL_RECENT_LIMIT = 30;
const STUDENT_PAYROLL_LOOKUP_LIMIT = 40;
const STUDENT_PAYROLL_REBUILD_CHUNK_SIZE = 15;

const DASHBOARD_SUMMARY_PATH = (classId, docId) =>
    `classes/${classId}/dashboardSummary/${docId}`;
const STUDENT_DASHBOARD_SUMMARY_PATH = (classId, studentUid, docId) =>
    `classes/${classId}/students/${studentUid}/dashboardSummary/${docId}`;

const BANK_SUMMARY_DOCS = Object.freeze({
    savings: "bankOverviewSavings",
    loans: "bankOverviewLoans",
    pending: "bankAdminPending",
});

const PAYROLL_SUMMARY_DOC = "payrollOverview";
const STUDENT_PAYROLL_SUMMARY_DOC = "payroll";
const OPEN_SAVING_STATUSES = new Set(["active", "pending"]);
const OPEN_LOAN_STATUSES = new Set(["active", "approved", "ongoing", "pending"]);
const OVERDUE_LOAN_STATUSES = new Set(["active", "approved", "ongoing"]);
const REBUILD_REQUIRED_CODES = Object.freeze({
    bank: "BANK_OVERVIEW_SUMMARY_REBUILD_REQUIRED",
    payroll: "PAYROLL_OVERVIEW_SUMMARY_REBUILD_REQUIRED",
    studentPayroll: "STUDENT_PAYROLL_SUMMARY_REBUILD_REQUIRED",
});

function normalizeText(value, fallback = "") {
    const text = String(value || "").trim();
    return text || fallback;
}

function toWholeNumber(value) {
    const numericValue = Math.floor(Number(value));
    return Number.isFinite(numericValue) ? numericValue : 0;
}

function isFiniteNumberLike(value) {
    return Number.isFinite(Number(value));
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.toDate === "function") return value.toDate().getTime();
    if (typeof value.seconds === "number") {
        return value.seconds * 1000;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function sortByCreatedAtDesc(a, b) {
    return toMillis(b?.createdAt) - toMillis(a?.createdAt);
}

function normalizeSortedRows(rows = [], limit = null) {
    const normalized = Array.isArray(rows)
        ? rows.filter((row) => row && row.id)
        : [];

    normalized.sort(sortByCreatedAtDesc);

    if (Number.isFinite(limit) && limit > -1) {
        return normalized.slice(0, limit);
    }

    return normalized;
}

function applyRowDelta(rows = [], beforeRow, afterRow, limit = null) {
    const excludedIds = new Set(
        [beforeRow?.id, afterRow?.id].filter(Boolean),
    );
    const nextRows = Array.isArray(rows)
        ? rows.filter((row) => row && row.id && !excludedIds.has(row.id))
        : [];

    if (afterRow?.id) {
        nextRows.push(afterRow);
    }

    return normalizeSortedRows(nextRows, limit);
}

function createRebuildRequiredError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function getStudentUidFromGroupedDoc(ref) {
    return ref?.parent?.parent?.id || null;
}

function buildSavingOverviewRowFromData(data = {}, { docId, studentUid } = {}) {
    return {
        id: docId || normalizeText(data.id),
        requestedBy: normalizeText(data.requestedBy || studentUid),
        studentUid: studentUid || normalizeText(data.studentUid) || null,
        studentName: normalizeText(data.studentName),
        productId: normalizeText(data.productId),
        productLabel: normalizeText(data.productLabel),
        amount: toWholeNumber(data.amount),
        days: toWholeNumber(data.days),
        status: normalizeText(data.status),
        expectedProfit: toWholeNumber(
            data.expectedProfit ?? data.interestCalculatedOnRequest,
        ),
        interestCalculatedOnRequest: toWholeNumber(
            data.interestCalculatedOnRequest ?? data.expectedProfit,
        ),
        createdAt: data.createdAt || null,
        appliedAt: data.appliedAt || null,
        processedAt: data.processedAt || null,
        startedAt: data.startedAt || null,
        expectedMaturityDate: data.expectedMaturityDate || null,
        actualMaturityDate: data.actualMaturityDate || null,
        maturityDate: data.maturityDate || null,
    };
}

function getSavingOverviewRow(docSnap) {
    return buildSavingOverviewRowFromData(docSnap.data() || {}, {
        docId: docSnap.id,
        studentUid: getStudentUidFromGroupedDoc(docSnap.ref),
    });
}

function getLoanPrincipal(loan = {}) {
    return toWholeNumber(loan.principal ?? loan.amount);
}

function getLoanOutstandingPrincipal(loan = {}) {
    const principal = getLoanPrincipal(loan);
    if (normalizeText(loan.status) === "pending") {
        return principal;
    }
    return toWholeNumber(loan.amountLeft ?? principal);
}

function getLoanTotalInterest(loan = {}) {
    return toWholeNumber(
        loan.normalInterestAmount ??
            loan.interestCalculatedOnRequest ??
            loan.expectedProfit ??
            loan.interestLeft,
    );
}

function getLoanRemainingInterest(loan = {}) {
    const status = normalizeText(loan.status);
    if (["repaid", "cancelled_request", "rejected"].includes(status)) {
        return 0;
    }

    const totalInterest = getLoanTotalInterest(loan);
    const interestPaid = toWholeNumber(loan.interestPaid);

    if (totalInterest > 0 || interestPaid > 0) {
        return Math.max(0, totalInterest - interestPaid);
    }

    return toWholeNumber(loan.interestLeft);
}

function buildLoanOverviewRowFromData(data = {}, { docId, studentUid } = {}) {
    return {
        id: docId || normalizeText(data.id),
        requestedBy: normalizeText(data.requestedBy || studentUid),
        studentUid: studentUid || normalizeText(data.studentUid) || null,
        studentName: normalizeText(data.studentName),
        productId: normalizeText(data.productId),
        productLabel: normalizeText(data.productLabel),
        amount: getLoanPrincipal(data),
        principal: getLoanPrincipal(data),
        amountLeft: getLoanOutstandingPrincipal(data),
        interestLeft: getLoanRemainingInterest(data),
        interestPaid: toWholeNumber(data.interestPaid),
        days: toWholeNumber(data.days),
        status: normalizeText(data.status),
        normalInterestAmount: getLoanTotalInterest(data),
        interestCalculatedOnRequest: toWholeNumber(
            data.interestCalculatedOnRequest ?? data.expectedProfit,
        ),
        expectedProfit: toWholeNumber(
            data.expectedProfit ?? data.interestCalculatedOnRequest,
        ),
        createdAt: data.createdAt || null,
        appliedAt: data.appliedAt || null,
        processedAt: data.processedAt || null,
        startedAt: data.startedAt || null,
        expectedRepaymentDate: data.expectedRepaymentDate || null,
        penaltyBaseDate: data.penaltyBaseDate || null,
        actualRepaymentDate: data.actualRepaymentDate || null,
        repaymentDate: data.repaymentDate || null,
    };
}

function getLoanOverviewRow(docSnap) {
    return buildLoanOverviewRowFromData(docSnap.data() || {}, {
        docId: docSnap.id,
        studentUid: getStudentUidFromGroupedDoc(docSnap.ref),
    });
}

function buildPendingRow(kind, row) {
    return {
        id: row.id,
        kind,
        requestedBy: row.requestedBy || row.studentUid || null,
        studentUid: row.studentUid || row.requestedBy || null,
        studentName: row.studentName || "",
        productId: row.productId || "",
        productLabel: row.productLabel || "",
        amount: toWholeNumber(row.amount ?? row.principal),
        createdAt: row.createdAt || null,
        status: row.status || "pending",
    };
}

function buildPendingSummaryData(pendingSavings = [], pendingLoans = []) {
    const normalizedPendingSavings = normalizeSortedRows(pendingSavings);
    const normalizedPendingLoans = normalizeSortedRows(pendingLoans);

    return {
        summaryVersion: BANK_SUMMARY_VERSION,
        pendingSavingsCount: normalizedPendingSavings.length,
        pendingLoansCount: normalizedPendingLoans.length,
        pendingSavings: normalizedPendingSavings,
        pendingLoans: normalizedPendingLoans,
        updatedAt: FieldValue.serverTimestamp(),
    };
}

function buildSavingsOverviewSummary(rows = []) {
    const normalizedRows = normalizeSortedRows(rows);
    const alertDateBuckets = buildDateBuckets("savings", normalizedRows);
    const today = startOfDayInKST(new Date());
    const claimableCount = normalizedRows.filter((row) => {
        if (row.status !== "active") return false;
        const maturityDate = calculateMaturityDate(row);
        return (
            maturityDate &&
            startOfDayInKST(maturityDate).getTime() <= today.getTime()
        );
    }).length;

    const totalAmount = normalizedRows.reduce((sum, row) => {
        if (!OPEN_SAVING_STATUSES.has(row.status)) return sum;
        return sum + toWholeNumber(row.amount);
    }, 0);

    return {
        summaryVersion: BANK_SUMMARY_VERSION,
        kind: "savings",
        alertDateBucketsVersion: 1,
        alertDateBuckets,
        rowCount: normalizedRows.length,
        pendingCount: normalizedRows.filter((row) => row.status === "pending").length,
        activeCount: normalizedRows.filter((row) => row.status === "active").length,
        claimableCount,
        totalAmount,
        updatedAt: FieldValue.serverTimestamp(),
    };
}

function buildLoansOverviewSummary(rows = []) {
    const normalizedRows = normalizeSortedRows(rows);
    const alertDateBuckets = buildDateBuckets("loans", normalizedRows);
    const today = startOfDayInKST(new Date());
    const overdueCount = normalizedRows.filter((row) => {
        if (!OVERDUE_LOAN_STATUSES.has(row.status)) return false;
        return hasLoanOverduePenalty(row, today);
    }).length;

    const totalOutstandingPrincipal = normalizedRows.reduce((sum, row) => {
        if (!OPEN_LOAN_STATUSES.has(row.status)) return sum;
        return sum + getLoanOutstandingPrincipal(row);
    }, 0);

    return {
        summaryVersion: BANK_SUMMARY_VERSION,
        kind: "loans",
        alertDateBucketsVersion: 1,
        alertDateBuckets,
        rowCount: normalizedRows.length,
        pendingCount: normalizedRows.filter((row) => row.status === "pending").length,
        activeCount: normalizedRows.filter((row) =>
            OVERDUE_LOAN_STATUSES.has(row.status),
        ).length,
        overdueCount,
        totalOutstandingPrincipal,
        updatedAt: FieldValue.serverTimestamp(),
    };
}

function buildPayrollSummaryRowFromData(data = {}, { docId, studentUid } = {}) {
    const totals = data.totals || {};
    const slipType =
        normalizeText(data.slipType || "salary", "salary").toLowerCase() === "bonus"
            ? "bonus"
            : "salary";

    return {
        id: docId || normalizeText(data.id),
        studentUid: studentUid || normalizeText(data.studentUid),
        studentName: normalizeText(data.studentName),
        slipType,
        payrollPeriodKey: normalizeText(data.payrollPeriodKey || docId),
        basePayslipId: normalizeText(data.basePayslipId),
        paymentStartDate: data.paymentStartDate || null,
        paymentEndDate: data.paymentEndDate || null,
        numberOfWeeksPaid: toWholeNumber(data.numberOfWeeksPaid),
        paymentPeriodDescription: normalizeText(data.paymentPeriodDescription),
        totalBaseSalary: toWholeNumber(totals.totalBaseSalary),
        totalDeductions: toWholeNumber(totals.totalDeductions),
        totalBonusAmount: toWholeNumber(totals.totalBonusAmount),
        netSalary: toWholeNumber(totals.netSalary),
        createdAt: data.createdAt || null,
    };
}

function buildPayrollSummaryRow(docSnap) {
    return buildPayrollSummaryRowFromData(docSnap.data() || {}, {
        docId: docSnap.id,
        studentUid: normalizeText(docSnap.data()?.studentUid) ||
            getStudentUidFromGroupedDoc(docSnap.ref),
    });
}

function buildPayrollOverviewSummary(rows = []) {
    const recentPayslips = normalizeSortedRows(rows, PAYROLL_RECENT_LIMIT);
    const recentSalaryCount = recentPayslips.filter(
        (row) => row.slipType === "salary",
    ).length;
    const recentBonusCount = recentPayslips.filter(
        (row) => row.slipType === "bonus",
    ).length;
    const totalRecentNetSalary = recentPayslips.reduce(
        (sum, row) => sum + toWholeNumber(row.netSalary),
        0,
    );

    return {
        summaryVersion: PAYROLL_SUMMARY_VERSION,
        recentPayslips,
        recentSalaryCount,
        recentBonusCount,
        totalRecentNetSalary,
        latestCreatedAt: recentPayslips[0]?.createdAt || null,
        updatedAt: FieldValue.serverTimestamp(),
    };
}

function isSalaryPayrollRow(row) {
    return normalizeText(row?.slipType || "salary", "salary").toLowerCase() === "salary";
}

function buildStudentPayrollSummary(rows = [], { studentUid } = {}) {
    const recentSalaryPayslips = normalizeSortedRows(
        rows.filter(isSalaryPayrollRow),
        STUDENT_PAYROLL_RECENT_LIMIT,
    );
    const totalRecentNetSalary = recentSalaryPayslips.reduce(
        (sum, row) => sum + toWholeNumber(row.netSalary),
        0,
    );

    return {
        summaryVersion: STUDENT_PAYROLL_SUMMARY_VERSION,
        studentUid:
            normalizeText(studentUid) ||
            normalizeText(recentSalaryPayslips[0]?.studentUid) ||
            null,
        recentSalaryPayslips,
        recentSalaryCount: recentSalaryPayslips.length,
        totalRecentNetSalary,
        latestSalaryCreatedAt: recentSalaryPayslips[0]?.createdAt || null,
        latestSalaryPayslipId: recentSalaryPayslips[0]?.id || null,
        hasSalaryPayslips: recentSalaryPayslips.length > 0,
        updatedAt: FieldValue.serverTimestamp(),
    };
}

function isValidBankOverviewSummary(data, kind) {
    return (
        data?.alertDateBucketsVersion === 1 &&
        data?.alertDateBuckets && typeof data.alertDateBuckets === "object" &&
        !Array.isArray(data.alertDateBuckets) &&
        Number(data?.summaryVersion || 0) === BANK_SUMMARY_VERSION &&
        data?.kind === kind &&
        isFiniteNumberLike(data?.rowCount) &&
        isFiniteNumberLike(data?.pendingCount) &&
        isFiniteNumberLike(data?.activeCount) &&
        (
            kind === "savings" ?
                (
                    isFiniteNumberLike(data?.claimableCount) &&
                    isFiniteNumberLike(data?.totalAmount)
                ) :
                (
                    isFiniteNumberLike(data?.overdueCount) &&
                    isFiniteNumberLike(data?.totalOutstandingPrincipal)
                )
        )
    );
}

function isValidPendingSummary(data) {
    return (
        Number(data?.summaryVersion || 0) === BANK_SUMMARY_VERSION &&
        Array.isArray(data?.pendingSavings) &&
        Array.isArray(data?.pendingLoans)
    );
}

function isValidPayrollOverviewSummary(data) {
    return (
        Number(data?.summaryVersion || 0) === PAYROLL_SUMMARY_VERSION &&
        Array.isArray(data?.recentPayslips)
    );
}

function isValidStudentPayrollSummary(data) {
    return (
        Number(data?.summaryVersion || 0) === STUDENT_PAYROLL_SUMMARY_VERSION &&
        Array.isArray(data?.recentSalaryPayslips)
    );
}

async function queryStudentRecentSalaryRows(classId, studentUid) {
    const payslipsRef = db.collection(
        `classes/${classId}/students/${studentUid}/paySlips`,
    );

    const initialSnap = await payslipsRef
        .orderBy("createdAt", "desc")
        .limit(STUDENT_PAYROLL_LOOKUP_LIMIT)
        .get();
    const initialRows = initialSnap.docs
        .map((docSnap) =>
            buildPayrollSummaryRowFromData(docSnap.data() || {}, {
                docId: docSnap.id,
                studentUid,
            }),
        )
        .filter(isSalaryPayrollRow);

    if (
        initialRows.length >= STUDENT_PAYROLL_RECENT_LIMIT ||
        initialSnap.size < STUDENT_PAYROLL_LOOKUP_LIMIT
    ) {
        return normalizeSortedRows(initialRows, STUDENT_PAYROLL_RECENT_LIMIT);
    }

    const fullSnap = await payslipsRef.orderBy("createdAt", "desc").get();
    const fullRows = fullSnap.docs
        .map((docSnap) =>
            buildPayrollSummaryRowFromData(docSnap.data() || {}, {
                docId: docSnap.id,
                studentUid,
            }),
        )
        .filter(isSalaryPayrollRow);

    return normalizeSortedRows(fullRows, STUDENT_PAYROLL_RECENT_LIMIT);
}

function getPendingSummaryRow(kind, row) {
    if (!row || normalizeText(row.status) !== "pending") {
        return null;
    }

    return buildPendingRow(kind, row);
}

function getSavingsSummaryContribution(row, today = startOfDayInKST(new Date())) {
    if (!row) {
        return {
            rowCount: 0,
            pendingCount: 0,
            activeCount: 0,
            claimableCount: 0,
            totalAmount: 0,
        };
    }

    const normalizedToday = today || startOfDayInKST(new Date());
    const maturityDate = calculateMaturityDate(row);
    const isClaimable = row.status === "active" &&
        maturityDate &&
        startOfDayInKST(maturityDate).getTime() <= normalizedToday.getTime();

    return {
        rowCount: 1,
        pendingCount: row.status === "pending" ? 1 : 0,
        activeCount: row.status === "active" ? 1 : 0,
        claimableCount: isClaimable ? 1 : 0,
        totalAmount: OPEN_SAVING_STATUSES.has(row.status) ?
            toWholeNumber(row.amount) :
            0,
    };
}

function getLoansSummaryContribution(row, today = startOfDayInKST(new Date())) {
    if (!row) {
        return {
            rowCount: 0,
            pendingCount: 0,
            activeCount: 0,
            overdueCount: 0,
            totalOutstandingPrincipal: 0,
        };
    }

    const normalizedToday = today || startOfDayInKST(new Date());
    return {
        rowCount: 1,
        pendingCount: row.status === "pending" ? 1 : 0,
        activeCount: OVERDUE_LOAN_STATUSES.has(row.status) ? 1 : 0,
        overdueCount: OVERDUE_LOAN_STATUSES.has(row.status) &&
            hasLoanOverduePenalty(row, normalizedToday) ?
            1 :
            0,
        totalOutstandingPrincipal: OPEN_LOAN_STATUSES.has(row.status) ?
            getLoanOutstandingPrincipal(row) :
            0,
    };
}

function normalizeBankOverviewSummaryStats(data, kind) {
    if (kind === "savings") {
        return {
            rowCount: toWholeNumber(data?.rowCount),
            pendingCount: toWholeNumber(data?.pendingCount),
            activeCount: toWholeNumber(data?.activeCount),
            claimableCount: toWholeNumber(data?.claimableCount),
            totalAmount: toWholeNumber(data?.totalAmount),
        };
    }

    return {
        rowCount: toWholeNumber(data?.rowCount),
        pendingCount: toWholeNumber(data?.pendingCount),
        activeCount: toWholeNumber(data?.activeCount),
        overdueCount: toWholeNumber(data?.overdueCount),
        totalOutstandingPrincipal: toWholeNumber(data?.totalOutstandingPrincipal),
    };
}

function applyBankOverviewSummaryDelta(kind, currentSummary, beforeRow, afterRow) {
    const today = startOfDayInKST(new Date());
    const currentStats = normalizeBankOverviewSummaryStats(currentSummary, kind);
    const getContribution =
        kind === "savings" ? getSavingsSummaryContribution : getLoansSummaryContribution;
    const beforeContribution = getContribution(beforeRow, today);
    const afterContribution = getContribution(afterRow, today);
    const nextStats = {};

    for (const key of Object.keys(currentStats)) {
        nextStats[key] = Math.max(
            0,
            toWholeNumber(currentStats[key]) -
                toWholeNumber(beforeContribution[key]) +
                toWholeNumber(afterContribution[key]),
        );
    }

    const alertDateBuckets = updateDateBuckets(kind, currentSummary.alertDateBuckets, beforeRow, afterRow);
    nextStats[kind === "savings" ? "claimableCount" : "overdueCount"] = countDateBuckets(alertDateBuckets, today);

    return {
        summaryVersion: BANK_SUMMARY_VERSION,
        kind,
        alertDateBucketsVersion: 1,
        alertDateBuckets,
        ...nextStats,
        updatedAt: FieldValue.serverTimestamp(),
    };
}

async function rebuildBankOverviewSummaries(classId) {
    if (!classId) {
        throw new Error("classId is required to rebuild bank overview summaries.");
    }

    const [savingsSnap, loansSnap] = await Promise.all([
        db.collectionGroup("savings").where("classId", "==", classId).get(),
        db.collectionGroup("loans").where("classId", "==", classId).get(),
    ]);

    const savingsRows = savingsSnap.docs
        .map(getSavingOverviewRow)
        .sort(sortByCreatedAtDesc);
    const loansRows = loansSnap.docs
        .map(getLoanOverviewRow)
        .sort(sortByCreatedAtDesc);

    const pendingSavings = savingsRows
        .filter((row) => row.status === "pending")
        .map((row) => buildPendingRow("savings", row));
    const pendingLoans = loansRows
        .filter((row) => row.status === "pending")
        .map((row) => buildPendingRow("loans", row));

    const batch = db.batch();
    batch.set(
        db.doc(DASHBOARD_SUMMARY_PATH(classId, BANK_SUMMARY_DOCS.savings)),
        buildSavingsOverviewSummary(savingsRows),
    );
    batch.set(
        db.doc(DASHBOARD_SUMMARY_PATH(classId, BANK_SUMMARY_DOCS.loans)),
        buildLoansOverviewSummary(loansRows),
    );
    batch.set(
        db.doc(DASHBOARD_SUMMARY_PATH(classId, BANK_SUMMARY_DOCS.pending)),
        buildPendingSummaryData(pendingSavings, pendingLoans),
    );

    await batch.commit();

    return {
        savingsRowCount: savingsRows.length,
        loanRowCount: loansRows.length,
        pendingSavingsCount: pendingSavings.length,
        pendingLoansCount: pendingLoans.length,
    };
}

async function rebuildPayrollOverviewSummary(classId) {
    if (!classId) {
        throw new Error("classId is required to rebuild payroll overview summary.");
    }

    const payslipSnap = await db
        .collectionGroup("paySlips")
        .where("classId", "==", classId)
        .orderBy("createdAt", "desc")
        .limit(PAYROLL_RECENT_LIMIT)
        .get();

    const recentPayslips = payslipSnap.docs.map(buildPayrollSummaryRow);
    const summaryData = buildPayrollOverviewSummary(recentPayslips);

    await db.doc(DASHBOARD_SUMMARY_PATH(classId, PAYROLL_SUMMARY_DOC)).set(
        summaryData,
    );

    return {
        recentPayslipCount: summaryData.recentPayslips.length,
        recentSalaryCount: summaryData.recentSalaryCount,
        recentBonusCount: summaryData.recentBonusCount,
    };
}

async function rebuildStudentPayrollSummary(classId, studentUid) {
    if (!classId || !studentUid) {
        throw new Error("classId and studentUid are required to rebuild student payroll summary.");
    }

    const recentSalaryRows = await queryStudentRecentSalaryRows(classId, studentUid);
    const summaryData = buildStudentPayrollSummary(recentSalaryRows, {
        studentUid,
    });

    await db.doc(
        STUDENT_DASHBOARD_SUMMARY_PATH(
            classId,
            studentUid,
            STUDENT_PAYROLL_SUMMARY_DOC,
        ),
    ).set(summaryData);

    return {
        studentUid,
        recentSalaryCount: summaryData.recentSalaryCount,
        latestSalaryPayslipId: summaryData.latestSalaryPayslipId,
    };
}

async function rebuildAllStudentPayrollSummaries(classId) {
    if (!classId) {
        throw new Error("classId is required to rebuild student payroll summaries.");
    }

    const studentsSnap = await db.collection(`classes/${classId}/students`).get();
    const studentUids = studentsSnap.docs
        .map((docSnap) => normalizeText(docSnap.id))
        .filter(Boolean);

    const results = [];
    for (
        let index = 0;
        index < studentUids.length;
        index += STUDENT_PAYROLL_REBUILD_CHUNK_SIZE
    ) {
        const studentChunk = studentUids.slice(
            index,
            index + STUDENT_PAYROLL_REBUILD_CHUNK_SIZE,
        );
        const chunkResults = await Promise.all(
            studentChunk.map((studentUid) =>
                rebuildStudentPayrollSummary(classId, studentUid),
            ),
        );
        results.push(...chunkResults);
    }

    return {
        studentCount: studentUids.length,
        studentsWithRecentSalary: results.filter(
            (result) => Number(result?.recentSalaryCount || 0) > 0,
        ).length,
        rebuildChunkSize: STUDENT_PAYROLL_REBUILD_CHUNK_SIZE,
        rebuildChunkCount: Math.ceil(
            studentUids.length / STUDENT_PAYROLL_REBUILD_CHUNK_SIZE,
        ),
    };
}

async function rebuildOverviewSummaries(classId) {
    const [bank, payroll] = await Promise.all([
        rebuildBankOverviewSummaries(classId),
        rebuildPayrollOverviewSummary(classId),
    ]);

    let studentPayroll = {
        skipped: false,
        success: true,
    };

    try {
        studentPayroll = {
            ...studentPayroll,
            ...await rebuildAllStudentPayrollSummaries(classId),
        };
    } catch (error) {
        console.error("[rebuildOverviewSummaries] student payroll summary rebuild failed:", {
            classId,
            message: error?.message || String(error),
            stack: error?.stack || null,
        });
        studentPayroll = {
            skipped: true,
            success: false,
            error: error?.message || String(error),
        };
    }

    return { bank, payroll, studentPayroll };
}

async function updateBankOverviewSummariesForWrite({
    classId,
    kind,
    docId,
    studentUid,
    beforeData,
    afterData,
}) {
    if (!classId || !kind || !docId) return null;
    if (kind !== "savings" && kind !== "loans") return null;

    const buildRow =
        kind === "savings" ? buildSavingOverviewRowFromData : buildLoanOverviewRowFromData;
    const beforeRow = beforeData
        ? buildRow(beforeData, { docId, studentUid })
        : null;
    const afterRow = afterData
        ? buildRow(afterData, { docId, studentUid })
        : null;

    const overviewRef = db.doc(
        DASHBOARD_SUMMARY_PATH(classId, BANK_SUMMARY_DOCS[kind]),
    );
    const pendingRef = db.doc(
        DASHBOARD_SUMMARY_PATH(classId, BANK_SUMMARY_DOCS.pending),
    );
    try {
        await db.runTransaction(async (tx) => {
            const [overviewSnap, pendingSnap] = await Promise.all([
                tx.get(overviewRef),
                tx.get(pendingRef),
            ]);

            const overviewSummary = overviewSnap.exists ? overviewSnap.data() || {} : null;
            const pendingSummary = pendingSnap.exists ? pendingSnap.data() || {} : null;

            if (
                !isValidBankOverviewSummary(overviewSummary, kind) ||
                !isValidPendingSummary(pendingSummary)
            ) {
                throw createRebuildRequiredError(REBUILD_REQUIRED_CODES.bank);
            }

            const currentPendingSavings = normalizeSortedRows(
                pendingSummary.pendingSavings,
            );
            const currentPendingLoans = normalizeSortedRows(
                pendingSummary.pendingLoans,
            );
            const nextPendingRows = applyRowDelta(
                kind === "savings" ? currentPendingSavings : currentPendingLoans,
                getPendingSummaryRow(kind, beforeRow),
                getPendingSummaryRow(kind, afterRow),
            );

            tx.set(
                overviewRef,
                applyBankOverviewSummaryDelta(
                    kind,
                    overviewSummary,
                    beforeRow,
                    afterRow,
                ),
            );
            tx.set(
                pendingRef,
                buildPendingSummaryData(
                    kind === "savings" ? nextPendingRows : currentPendingSavings,
                    kind === "loans" ? nextPendingRows : currentPendingLoans,
                ),
            );
        });

        return { mode: "incremental" };
    } catch (error) {
        if (error?.code !== REBUILD_REQUIRED_CODES.bank) {
            throw error;
        }

        await rebuildBankOverviewSummaries(classId);
        return { mode: "rebuild" };
    }
}

async function updatePayrollOverviewSummaryForWrite({
    classId,
    docId,
    studentUid,
    beforeData,
    afterData,
}) {
    if (!classId || !docId) return null;

    const beforeRow = beforeData
        ? buildPayrollSummaryRowFromData(beforeData, { docId, studentUid })
        : null;
    const afterRow = afterData
        ? buildPayrollSummaryRowFromData(afterData, { docId, studentUid })
        : null;
    const summaryRef = db.doc(
        DASHBOARD_SUMMARY_PATH(classId, PAYROLL_SUMMARY_DOC),
    );

    try {
        await db.runTransaction(async (tx) => {
            const summarySnap = await tx.get(summaryRef);
            const summary = summarySnap.exists ? summarySnap.data() || {} : null;

            if (!isValidPayrollOverviewSummary(summary)) {
                throw createRebuildRequiredError(REBUILD_REQUIRED_CODES.payroll);
            }

            const currentRows = normalizeSortedRows(
                summary.recentPayslips,
                PAYROLL_RECENT_LIMIT,
            );
            const beforeWasIncluded = !!beforeRow &&
                currentRows.some((row) => row.id === beforeRow.id);
            const createdAtChanged =
                !!beforeRow &&
                !!afterRow &&
                toMillis(beforeRow.createdAt) !== toMillis(afterRow.createdAt);

            if (beforeWasIncluded && (!afterRow || createdAtChanged)) {
                throw createRebuildRequiredError(REBUILD_REQUIRED_CODES.payroll);
            }

            const nextRows = applyRowDelta(
                currentRows,
                beforeRow,
                afterRow,
                PAYROLL_RECENT_LIMIT,
            );

            tx.set(summaryRef, buildPayrollOverviewSummary(nextRows));
        });

        return { mode: "incremental" };
    } catch (error) {
        if (error?.code !== REBUILD_REQUIRED_CODES.payroll) {
            throw error;
        }

        await rebuildPayrollOverviewSummary(classId);
        return { mode: "rebuild" };
    }
}

async function updateStudentPayrollSummaryForWrite({
    classId,
    studentUid,
    docId,
    beforeData,
    afterData,
}) {
    if (!classId || !studentUid) return null;

    const beforeRow = beforeData
        ? buildPayrollSummaryRowFromData(beforeData, { docId, studentUid })
        : null;
    const afterRow = afterData
        ? buildPayrollSummaryRowFromData(afterData, { docId, studentUid })
        : null;
    const beforeIsSalary = isSalaryPayrollRow(beforeRow);
    const afterIsSalary = isSalaryPayrollRow(afterRow);

    // Bonus payslips do not affect the student-level salary picker summary.
    if (!beforeIsSalary && !afterIsSalary) {
        return { mode: "skipped", skipped: true };
    }

    const isSalaryCreate = !beforeData && !!afterData && afterIsSalary;
    if (!isSalaryCreate) {
        await rebuildStudentPayrollSummary(classId, studentUid);
        return { mode: "rebuild" };
    }

    const summaryRef = db.doc(
        STUDENT_DASHBOARD_SUMMARY_PATH(classId, studentUid, STUDENT_PAYROLL_SUMMARY_DOC),
    );

    try {
        await db.runTransaction(async (tx) => {
            const summarySnap = await tx.get(summaryRef);
            const summary = summarySnap.exists ? summarySnap.data() || {} : null;

            if (!isValidStudentPayrollSummary(summary)) {
                throw createRebuildRequiredError(REBUILD_REQUIRED_CODES.studentPayroll);
            }

            const currentRows = normalizeSortedRows(
                summary.recentSalaryPayslips,
                STUDENT_PAYROLL_RECENT_LIMIT,
            );
            const nextRows = applyRowDelta(
                currentRows,
                null,
                afterRow,
                STUDENT_PAYROLL_RECENT_LIMIT,
            );

            tx.set(summaryRef, buildStudentPayrollSummary(nextRows, { studentUid }));
        });

        return { mode: "incremental" };
    } catch (error) {
        if (error?.code !== REBUILD_REQUIRED_CODES.studentPayroll) {
            throw error;
        }

        await rebuildStudentPayrollSummary(classId, studentUid);
        return { mode: "rebuild" };
    }
}

module.exports = {
    BANK_SUMMARY_VERSION,
    PAYROLL_SUMMARY_VERSION,
    STUDENT_PAYROLL_SUMMARY_VERSION,
    BANK_SUMMARY_DOCS,
    PAYROLL_SUMMARY_DOC,
    STUDENT_PAYROLL_SUMMARY_DOC,
    PAYROLL_RECENT_LIMIT,
    STUDENT_PAYROLL_RECENT_LIMIT,
    buildSavingOverviewRowFromData,
    buildLoanOverviewRowFromData,
    buildPayrollSummaryRowFromData,
    buildPendingSummaryData,
    buildSavingsOverviewSummary,
    buildLoansOverviewSummary,
    buildPayrollOverviewSummary,
    buildStudentPayrollSummary,
    isValidBankOverviewSummary,
    isValidPendingSummary,
    isValidPayrollOverviewSummary,
    rebuildBankOverviewSummaries,
    rebuildPayrollOverviewSummary,
    rebuildStudentPayrollSummary,
    rebuildOverviewSummaries,
    updateBankOverviewSummariesForWrite,
    updatePayrollOverviewSummaryForWrite,
    updateStudentPayrollSummaryForWrite,
};
