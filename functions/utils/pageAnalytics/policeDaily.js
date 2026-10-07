"use strict";

const {
    BACKFILL_START_DATE,
    buildBasePayload,
    ensureStudent,
    getDateWindow,
    hasAnyDocs,
    increment,
    isInWindow,
    pickStudentSnapshot,
    requireDateKey,
    roundAmount,
    stringOrNull,
    toIsoOrNull,
    toNumber,
} = require("./common");

const COLLECTION = "policeAnalyticsDaily";

function getPoliceAmount(row = {}) {
    const signed = Number(row.amountSigned);
    if (Number.isFinite(signed) && signed !== 0) return signed;
    const amount = roundAmount(row.amount || row.totalAmount || 0);
    if (String(row.type || "").toLowerCase() === "fine") return -Math.abs(amount);
    if (String(row.type || "").toLowerCase() === "reward") return Math.abs(amount);
    return amount;
}

function ensureStudentRuleRow(byStudentRule, studentSnapshot, ruleKey, ruleText) {
    const studentUid = String(studentSnapshot.uid || "unknown").trim() || "unknown";
    if (!byStudentRule[studentUid]) {
        byStudentRule[studentUid] = {
            uid: studentUid,
            studentName: studentSnapshot.name || "학생",
            studentNumber: studentSnapshot.number ?? null,
            rules: {},
        };
    } else {
        if (!byStudentRule[studentUid].studentName && studentSnapshot.name) {
            byStudentRule[studentUid].studentName = studentSnapshot.name;
        }
        if (byStudentRule[studentUid].studentNumber === null && studentSnapshot.number !== undefined) {
            byStudentRule[studentUid].studentNumber = studentSnapshot.number;
        }
    }

    if (!byStudentRule[studentUid].rules[ruleKey]) {
        byStudentRule[studentUid].rules[ruleKey] = {
            ruleKey,
            ruleText: ruleText || ruleKey,
            eventCount: 0,
            fineCount: 0,
            fineAmount: 0,
            rewardCount: 0,
            rewardAmount: 0,
            neutralCount: 0,
            cancelledCount: 0,
            netAmount: 0,
            latestAppliedAt: null,
        };
    }

    return byStudentRule[studentUid].rules[ruleKey];
}

function applyHistoryRow({ byStudent, byRule, byStudentRule, totals, row }) {
    const type = String(row.type || "").toLowerCase();
    const amountSigned = getPoliceAmount(row);
    const amountAbs = Math.abs(amountSigned);
    const studentSnapshot = pickStudentSnapshot(row);
    const student = ensureStudent(byStudent, studentSnapshot);
    const ruleKey = stringOrNull(row.ruleId) || stringOrNull(row.ruleText) || "custom";
    const ruleText = stringOrNull(row.ruleText) || ruleKey;
    const studentRule = ensureStudentRuleRow(byStudentRule, studentSnapshot, ruleKey, ruleText);
    const appliedAtIso = toIsoOrNull(row.appliedAt);

    totals.eventCount += 1;
    student.eventCount += 1;
    student.lastAppliedAt = appliedAtIso || student.lastAppliedAt || null;
    studentRule.eventCount += 1;
    studentRule.netAmount = roundAmount(toNumber(studentRule.netAmount) + amountSigned);
    if (appliedAtIso && (!studentRule.latestAppliedAt || appliedAtIso > studentRule.latestAppliedAt)) {
        studentRule.latestAppliedAt = appliedAtIso;
    }

    if (type === "reward" || amountSigned > 0) {
        totals.rewardCount += 1;
        totals.rewardAmount += amountAbs;
        student.rewardCount = roundAmount(toNumber(student.rewardCount) + 1);
        student.rewardAmount = roundAmount(toNumber(student.rewardAmount) + amountAbs);
        studentRule.rewardCount = roundAmount(toNumber(studentRule.rewardCount) + 1);
        studentRule.rewardAmount = roundAmount(toNumber(studentRule.rewardAmount) + amountAbs);
    } else if (type === "fine" || amountSigned < 0) {
        totals.fineCount += 1;
        totals.fineAmount += amountAbs;
        student.fineCount = roundAmount(toNumber(student.fineCount) + 1);
        student.fineAmount = roundAmount(toNumber(student.fineAmount) + amountAbs);
        studentRule.fineCount = roundAmount(toNumber(studentRule.fineCount) + 1);
        studentRule.fineAmount = roundAmount(toNumber(studentRule.fineAmount) + amountAbs);
    } else {
        totals.neutralCount += 1;
        student.neutralCount = roundAmount(toNumber(student.neutralCount) + 1);
        studentRule.neutralCount = roundAmount(toNumber(studentRule.neutralCount) + 1);
    }

    if (String(row.status || "").includes("cancel")) {
        totals.cancelledCount += 1;
        student.cancelledCount = roundAmount(toNumber(student.cancelledCount) + 1);
        studentRule.cancelledCount = roundAmount(toNumber(studentRule.cancelledCount) + 1);
    }

    if (!byRule[ruleKey]) {
        byRule[ruleKey] = {
            ruleKey,
            ruleText,
            eventCount: 0,
            fineCount: 0,
            rewardCount: 0,
            netAmount: 0,
        };
    }
    byRule[ruleKey].eventCount += 1;
    byRule[ruleKey].netAmount = roundAmount(toNumber(byRule[ruleKey].netAmount) + amountSigned);
    if (type === "reward" || amountSigned > 0) byRule[ruleKey].rewardCount += 1;
    if (type === "fine" || amountSigned < 0) byRule[ruleKey].fineCount += 1;
}

async function buildPoliceDaily(db, classId, dateKey, options = {}) {
    requireDateKey(dateKey, "dateKey");
    const window = getDateWindow(dateKey);
    const classRef = db.collection("classes").doc(classId);
    const [historySnap, reportSnap, reflectionSnap] = await Promise.all([
        classRef
            .collection("policeFineHistory")
            .where("appliedAt", ">=", window.startTs)
            .where("appliedAt", "<=", window.endTs)
            .get(),
        classRef
            .collection("policeReports")
            .where("createdAt", ">=", window.startTs)
            .where("createdAt", "<=", window.endTs)
            .get()
            .catch(() => classRef.collection("policeReports").limit(0).get()),
        classRef
            .collection("reflections")
            .where("submittedAt", ">=", window.startTs)
            .where("submittedAt", "<=", window.endTs)
            .get()
            .catch(() => classRef.collection("reflections").limit(0).get()),
    ]);

    const byStudent = {};
    const byRule = {};
    const byStudentRule = {};
    const reportStatus = {};
    const reflectionStatus = {};
    const totals = {
        eventCount: 0,
        fineCount: 0,
        rewardCount: 0,
        neutralCount: 0,
        cancelledCount: 0,
        fineAmount: 0,
        rewardAmount: 0,
        reportCreatedCount: 0,
        reflectionSubmittedCount: 0,
    };

    historySnap.forEach((docSnap) => {
        applyHistoryRow({ byStudent, byRule, byStudentRule, totals, row: docSnap.data() || {} });
    });

    reportSnap.forEach((docSnap) => {
        const row = docSnap.data() || {};
        if (!isInWindow(row.createdAt, window)) return;
        totals.reportCreatedCount += 1;
        totals.eventCount += 1;
        increment(reportStatus, row.status || "unknown", 1);
        const student = ensureStudent(byStudent, pickStudentSnapshot(row));
        student.eventCount += 1;
        student.reportCreatedCount = roundAmount(toNumber(student.reportCreatedCount) + 1);
    });

    reflectionSnap.forEach((docSnap) => {
        const row = docSnap.data() || {};
        if (!isInWindow(row.submittedAt, window)) return;
        totals.reflectionSubmittedCount += 1;
        totals.eventCount += 1;
        increment(reflectionStatus, row.status || "submitted", 1);
        const student = ensureStudent(byStudent, pickStudentSnapshot(row));
        student.eventCount += 1;
        student.reflectionSubmittedCount = roundAmount(
            toNumber(student.reflectionSubmittedCount) + 1,
        );
    });

    totals.netAmount = roundAmount(totals.rewardAmount - totals.fineAmount);
    const sourceCounts = {
        policeFineHistory: historySnap.size,
        policeReports: reportSnap.size,
        reflections: reflectionSnap.size,
    };
    const status = totals.eventCount > 0 ? "ready" : "empty";

    return {
        ...buildBasePayload({
            classId,
            dateKey,
            domain: "police",
            status,
            generatedBy: options.source,
            sourceCollections: ["policeFineHistory", "policeReports", "reflections"],
            sourceCounts,
            sourceRanges: {
                policeFineHistory: { field: "appliedAt", start: window.startDate.toISOString(), end: window.endDate.toISOString() },
                policeReports: { field: "createdAt", start: window.startDate.toISOString(), end: window.endDate.toISOString() },
                reflections: { field: "submittedAt", start: window.startDate.toISOString(), end: window.endDate.toISOString() },
            },
        }),
        eventTotals: totals,
        byStudent,
        byRule,
        byStudentRule,
        snapshot: {
            reportStatus,
            reflectionStatus,
        },
    };
}

async function hasPoliceActivity(db, classId, startDate = BACKFILL_START_DATE) {
    const classRef = db.collection("classes").doc(classId);
    const start = getDateWindow(startDate).startTs;
    const [history, reports, reflections] = await Promise.all([
        hasAnyDocs(classRef.collection("policeFineHistory"), [["appliedAt", ">=", start]]),
        hasAnyDocs(classRef.collection("policeReports"), [["createdAt", ">=", start]]).catch(() => false),
        hasAnyDocs(classRef.collection("reflections")).catch(() => false),
    ]);
    return history || reports || reflections;
}

module.exports = {
    COLLECTION,
    buildDaily: buildPoliceDaily,
    hasActivity: hasPoliceActivity,
};
