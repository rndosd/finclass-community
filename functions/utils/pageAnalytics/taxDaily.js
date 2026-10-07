"use strict";

const {
    BACKFILL_START_DATE,
    buildBasePayload,
    ensureStudent,
    getDateWindow,
    hasAnyDocs,
    increment,
    isInWindow,
    listStudents,
    pickStudentSnapshot,
    requireDateKey,
    roundAmount,
    stringOrNull,
    timestampToMillis,
    toIsoOrNull,
    toNumber,
} = require("./common");

const COLLECTION = "taxAnalyticsDaily";
const TAX_BILL_ANALYTICS_FIELDS = [
    "isPaid",
    "status",
    "paidAt",
    "issuedAt",
    "createdAt",
    "timestamp",
    "dueDate",
    "dueAt",
    "billKind",
    "taxType",
    "amount",
    "totalAmount",
    "studentUid",
    "studentName",
    "name",
    "studentNumber",
];

function isBillPaidByDate(bill = {}, endDate) {
    if (!(bill.isPaid === true || bill.status === "paid")) return false;
    const paidMs = timestampToMillis(bill.paidAt);
    return Number.isFinite(paidMs) && paidMs <= endDate.getTime();
}

function isBillIssuedByDate(bill = {}, endDate) {
    const issuedMs = timestampToMillis(bill.issuedAt || bill.createdAt || bill.timestamp);
    return Number.isFinite(issuedMs) && issuedMs <= endDate.getTime();
}

function isBillOverdueByDate(bill = {}, endDate) {
    if (isBillPaidByDate(bill, endDate)) return false;
    const dueMs = timestampToMillis(bill.dueDate || bill.dueAt);
    return Number.isFinite(dueMs) && dueMs < endDate.getTime();
}

function getBillKind(bill = {}) {
    return stringOrNull(bill.billKind) || stringOrNull(bill.taxType) || "general";
}

function buildAmountRows(amountMap = {}, totalAmount = 0) {
    const total = Math.abs(roundAmount(totalAmount));
    return Object.entries(amountMap || {})
        .map(([key, amount]) => {
            const roundedAmount = roundAmount(amount);
            return {
                key,
                label: key,
                amount: roundedAmount,
                shareRate: total > 0 ? Number(((Math.abs(roundedAmount) / total) * 100).toFixed(1)) : null,
            };
        })
        .filter((row) => row.amount !== 0)
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.key.localeCompare(b.key));
}

function buildLedgerAnalytics(incomeExpense = {}) {
    const incomeAmount = roundAmount(incomeExpense.incomeTotal || incomeExpense.totalIncome || 0);
    const expenseAmount = roundAmount(incomeExpense.expenseTotal || incomeExpense.totalExpense || 0);
    const netAmount = roundAmount(incomeAmount - expenseAmount);
    const incomeByTaxType = incomeExpense.byTaxType || {};
    const expenseByCategory = incomeExpense.byCategory || {};

    return {
        summary: {
            incomeAmount,
            expenseAmount,
            netAmount,
            hasLedgerActivity: incomeAmount !== 0 || expenseAmount !== 0,
            incomeTaxTypeCount: Object.keys(incomeByTaxType).filter((key) => toNumber(incomeByTaxType[key]) !== 0).length,
            expenseCategoryCount: Object.keys(expenseByCategory).filter((key) => toNumber(expenseByCategory[key]) !== 0).length,
            expenseToIncomeRate: incomeAmount > 0 ? Number(((expenseAmount / incomeAmount) * 100).toFixed(1)) : null,
        },
        breakdown: {
            incomeByTaxType: buildAmountRows(incomeByTaxType, incomeAmount),
            expenseByCategory: buildAmountRows(expenseByCategory, expenseAmount),
        },
    };
}

function applyBillEvent({ byStudent, byKind, totals, bill, student, mode }) {
    const snapshot = pickStudentSnapshot(bill, student.uid);
    if (!snapshot.name) snapshot.name = student.name;
    if (snapshot.number === null) snapshot.number = student.number;
    const row = ensureStudent(byStudent, snapshot);
    const amount = roundAmount(bill.amount || bill.totalAmount || 0);
    const kind = getBillKind(bill);

    row.eventCount += 1;
    if (mode === "issued") {
        totals.billIssuedCount += 1;
        totals.billIssuedAmount += amount;
        row.billIssuedCount = roundAmount(toNumber(row.billIssuedCount) + 1);
        row.billIssuedAmount = roundAmount(toNumber(row.billIssuedAmount) + amount);
    } else if (mode === "paid") {
        totals.billPaidCount += 1;
        totals.billPaidAmount += amount;
        row.billPaidCount = roundAmount(toNumber(row.billPaidCount) + 1);
        row.billPaidAmount = roundAmount(toNumber(row.billPaidAmount) + amount);
    }

    if (!byKind[kind]) {
        byKind[kind] = {
            kind,
            issuedCount: 0,
            issuedAmount: 0,
            paidCount: 0,
            paidAmount: 0,
        };
    }
    if (mode === "issued") {
        byKind[kind].issuedCount += 1;
        byKind[kind].issuedAmount = roundAmount(toNumber(byKind[kind].issuedAmount) + amount);
    } else {
        byKind[kind].paidCount += 1;
        byKind[kind].paidAmount = roundAmount(toNumber(byKind[kind].paidAmount) + amount);
    }
}

async function readStudentBillsForDate(studentRef, window) {
    const [paidSnap, snapshotSnap] = await Promise.all([
        studentRef
            .collection("taxBills")
            .where("paidAt", ">=", window.startTs)
            .where("paidAt", "<=", window.endTs)
            .select(...TAX_BILL_ANALYTICS_FIELDS)
            .get()
            .catch(() => studentRef.collection("taxBills").limit(0).get()),
        studentRef
            .collection("taxBills")
            .where("issuedAt", "<=", window.endTs)
            .select(...TAX_BILL_ANALYTICS_FIELDS)
            .get()
            .catch(() => studentRef.collection("taxBills").limit(0).get()),
    ]);
    return { paidSnap, snapshotSnap };
}

function buildTaxPayloadFromRows({ classId, dateKey, window, students, dailyData, billsByStudent, sourceCounts, options }) {
    const byStudent = {};
    const byKind = {};
    const incomeExpense = dailyData || {};
    const ledgerAnalytics = buildLedgerAnalytics(incomeExpense);
    const totals = {
        eventCount: 0,
        billIssuedCount: 0,
        billIssuedAmount: 0,
        billPaidCount: 0,
        billPaidAmount: 0,
        taxIncomeTotal: ledgerAnalytics.summary.incomeAmount,
        taxExpenseTotal: ledgerAnalytics.summary.expenseAmount,
    };
    const snapshot = {
        unpaidCount: 0,
        unpaidAmount: 0,
        overdueCount: 0,
        overdueAmount: 0,
        byKindUnpaid: {},
        byKindOverdue: {},
    };

    for (const student of students) {
        const bills = billsByStudent.get(student.uid) || [];
        bills.forEach((bill) => {
            if (!isInWindow(bill.issuedAt || bill.createdAt, window)) return;
            totals.eventCount += 1;
            applyBillEvent({ byStudent, byKind, totals, bill, student, mode: "issued" });
        });

        bills.forEach((bill) => {
            if (!isInWindow(bill.paidAt, window)) return;
            totals.eventCount += 1;
            applyBillEvent({ byStudent, byKind, totals, bill, student, mode: "paid" });
        });

        bills.forEach((bill) => {
            if (!isBillIssuedByDate(bill, window.endDate)) return;
            if (isBillPaidByDate(bill, window.endDate)) return;
            const amount = roundAmount(bill.amount || bill.totalAmount || 0);
            const kind = getBillKind(bill);
            snapshot.unpaidCount += 1;
            snapshot.unpaidAmount += amount;
            increment(snapshot.byKindUnpaid, kind, 1);

            if (isBillOverdueByDate(bill, window.endDate)) {
                snapshot.overdueCount += 1;
                snapshot.overdueAmount += amount;
                increment(snapshot.byKindOverdue, kind, 1);
            }
        });
    }

    totals.eventCount += dailyData ? 1 : 0;
    totals.netTaxFlow = roundAmount(totals.taxIncomeTotal - totals.taxExpenseTotal);
    snapshot.unpaidAmount = roundAmount(snapshot.unpaidAmount);
    snapshot.overdueAmount = roundAmount(snapshot.overdueAmount);

    return {
        ...buildBasePayload({
            classId,
            dateKey,
            domain: "tax",
            status: totals.eventCount > 0 || snapshot.unpaidCount > 0 ? "ready" : "empty",
            generatedBy: options.source,
            sourceCollections: ["taxDaily", "students/{uid}/taxBills"],
            sourceCounts,
            sourceRanges: {
                taxDaily: { doc: dateKey },
                taxBillsIssued: { field: "issuedAt", start: window.startDate.toISOString(), end: window.endDate.toISOString() },
                taxBillsPaid: { field: "paidAt", start: window.startDate.toISOString(), end: window.endDate.toISOString() },
            },
        }),
        taxAnalyticsSchemaVersion: 2,
        eventTotals: totals,
        byStudent,
        byKind,
        snapshot,
        ledgerSummary: ledgerAnalytics.summary,
        ledgerBreakdown: ledgerAnalytics.breakdown,
        dailyLedger: {
            byTaxType: incomeExpense.byTaxType || {},
            byCategory: incomeExpense.byCategory || {},
            incomeByTaxType: ledgerAnalytics.breakdown.incomeByTaxType,
            expenseByCategory: ledgerAnalytics.breakdown.expenseByCategory,
            updatedAt: toIsoOrNull(incomeExpense.updatedAt),
        },
    };
}

async function buildTaxDaily(db, classId, dateKey, options = {}) {
    requireDateKey(dateKey, "dateKey");
    const window = getDateWindow(dateKey);
    const classRef = db.collection("classes").doc(classId);
    const [students, dailySnap] = await Promise.all([
        listStudents(classRef),
        classRef.collection("taxDaily").doc(dateKey).get(),
    ]);
    const billsByStudent = new Map();
    const sourceCounts = {
        taxDaily: dailySnap.exists ? 1 : 0,
        taxBillsIssued: 0,
        taxBillsPaid: 0,
        taxBillsSnapshot: 0,
    };

    for (const student of students) {
        const studentRef = classRef.collection("students").doc(student.uid);
        const { paidSnap, snapshotSnap } = await readStudentBillsForDate(studentRef, window);
        const billMap = new Map();
        [snapshotSnap, paidSnap].forEach((snap) => {
            snap.forEach((docSnap) => {
                billMap.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() || {}) });
            });
        });
        sourceCounts.taxBillsIssued += Array.from(billMap.values()).filter(
            (bill) => isInWindow(bill.issuedAt || bill.createdAt, window),
        ).length;
        sourceCounts.taxBillsPaid += paidSnap.size;
        sourceCounts.taxBillsSnapshot += snapshotSnap.size;
        billsByStudent.set(student.uid, Array.from(billMap.values()));
    }

    return buildTaxPayloadFromRows({
        classId,
        dateKey,
        window,
        students,
        dailyData: dailySnap.exists ? dailySnap.data() || {} : null,
        billsByStudent,
        sourceCounts,
        options,
    });
}

async function readTaxDailyMap(classRef, startDate, endDate) {
    const snap = await classRef
        .collection("taxDaily")
        .where(adminFieldPathDocumentId(), ">=", startDate)
        .where(adminFieldPathDocumentId(), "<=", endDate)
        .get()
        .catch(() => ({ docs: [] }));
    const map = new Map();
    snap.docs.forEach((docSnap) => {
        map.set(docSnap.id, docSnap.data() || {});
    });
    return map;
}

async function readAllTaxBillsByStudent(classRef, students) {
    const billsByStudent = new Map();
    let billCount = 0;
    for (const student of students) {
        const snap = await classRef
            .collection("students")
            .doc(student.uid)
            .collection("taxBills")
            .select(...TAX_BILL_ANALYTICS_FIELDS)
            .get()
            .catch(() => ({ docs: [] }));
        const bills = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
        billCount += bills.length;
        billsByStudent.set(student.uid, bills);
    }
    return { billsByStudent, billCount };
}

async function buildTaxRange(db, classId, dateKeys, options = {}) {
    const classRef = db.collection("classes").doc(classId);
    const students = await listStudents(classRef);
    const dailyMap = await readTaxDailyMap(
        classRef,
        dateKeys[0],
        dateKeys[dateKeys.length - 1],
    );
    const { billsByStudent, billCount } = await readAllTaxBillsByStudent(classRef, students);

    return dateKeys.map((dateKey) => {
        const window = getDateWindow(dateKey);
        const dailyData = dailyMap.get(dateKey) || null;
        let issuedCount = 0;
        let paidCount = 0;
        billsByStudent.forEach((bills) => {
            bills.forEach((bill) => {
                if (isInWindow(bill.issuedAt || bill.createdAt, window)) issuedCount += 1;
                if (isInWindow(bill.paidAt, window)) paidCount += 1;
            });
        });
        return buildTaxPayloadFromRows({
            classId,
            dateKey,
            window,
            students,
            dailyData,
            billsByStudent,
            sourceCounts: {
                taxDaily: dailyData ? 1 : 0,
                taxBillsIssued: issuedCount,
                taxBillsPaid: paidCount,
                taxBillsSnapshot: billCount,
            },
            options,
        });
    });
}

async function hasTaxActivity(db, classId, startDate = BACKFILL_START_DATE) {
    const classRef = db.collection("classes").doc(classId);
    const start = getDateWindow(startDate).startTs;
    const [daily, incomes, expenses] = await Promise.all([
        hasAnyDocs(classRef.collection("taxDaily"), [[adminFieldPathDocumentId(), ">=", startDate]]).catch(() => false),
        hasAnyDocs(classRef.collection("taxIncomes"), [["timestamp", ">=", start]]).catch(() => false),
        hasAnyDocs(classRef.collection("taxExpenses"), [["timestamp", ">=", start]]).catch(() => false),
    ]);
    if (daily || incomes || expenses) return true;

    const students = await listStudents(classRef);
    for (const student of students) {
        const hasBill = await hasAnyDocs(
            classRef.collection("students").doc(student.uid).collection("taxBills"),
            [["issuedAt", ">=", start]],
        ).catch(() => false);
        if (hasBill) return true;
    }
    return false;
}

function adminFieldPathDocumentId() {
    const admin = require("../../firebaseAdminCompat");
    return admin.firestore.FieldPath.documentId();
}

module.exports = {
    COLLECTION,
    buildDaily: buildTaxDaily,
    buildRange: buildTaxRange,
    hasActivity: hasTaxActivity,
};
