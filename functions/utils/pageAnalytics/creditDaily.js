"use strict";

const {
    BACKFILL_START_DATE,
    adminFieldPathDocumentId,
    buildBasePayload,
    ensureStudent,
    getDateWindow,
    getKstYesterdayKey,
    hasAnyDocs,
    increment,
    isInWindow,
    listStudents,
    requireDateKey,
    roundAmount,
    stringOrNull,
    toNumber,
} = require("./common");

const COLLECTION = "creditAnalyticsDaily";

async function readPreviousCreditScore(studentRef, dateKey) {
    const snap = await studentRef
        .collection("creditHistory")
        .where("date", "<", dateKey)
        .orderBy("date", "desc")
        .limit(1)
        .get()
        .catch(() => ({ empty: true, docs: [] }));
    if (snap.empty) return null;
    return Number(snap.docs[0].data()?.score);
}

function getScoreBand(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return "unknown";
    if (value >= 900) return "900+";
    if (value >= 800) return "800-899";
    if (value >= 700) return "700-799";
    if (value >= 600) return "600-699";
    if (value >= 500) return "500-599";
    return "under-500";
}

function buildCreditPayloadFromRows({ classId, dateKey, window, students, historyByStudent, logsByStudent, options }) {
    const byStudent = {};
    const byReason = {};
    const scoreBands = {};
    const scores = [];
    const totals = {
        eventCount: 0,
        historyDocCount: 0,
        logCount: 0,
        positiveDelta: 0,
        negativeDelta: 0,
        changedStudentCount: 0,
        lowScoreStudentCount: 0,
    };

    for (const student of students) {
        const histories = historyByStudent.get(student.uid) || [];
        const logs = logsByStudent.get(student.uid) || [];
        const history = histories.find((entry) => entry.date === dateKey) || null;
        let row = null;
        if (history) {
            const score = Number(history.score);
            const previous = [...histories]
                .filter((entry) => entry.date < dateKey)
                .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
            const previousScore = previous ? Number(previous.score) : null;
            const delta = Number.isFinite(previousScore) && Number.isFinite(score)
                ? roundAmount(score - previousScore)
                : 0;
            row = ensureStudent(byStudent, {
                uid: student.uid,
                name: student.name,
                number: student.number,
            });
            row.eventCount += 1;
            row.score = Number.isFinite(score) ? score : null;
            row.previousScore = Number.isFinite(previousScore) ? previousScore : null;
            row.delta = delta;
            totals.historyDocCount += 1;
            totals.eventCount += 1;
            if (delta !== 0) totals.changedStudentCount += 1;
            if (delta > 0) totals.positiveDelta += delta;
            if (delta < 0) totals.negativeDelta += Math.abs(delta);
            if (Number.isFinite(score)) {
                scores.push(score);
                increment(scoreBands, getScoreBand(score), 1);
                if (score < 600) totals.lowScoreStudentCount += 1;
            }
        }

        logs.forEach((log) => {
            if (!isInWindow(log.timestamp, window)) return;
            if (!row) {
                row = ensureStudent(byStudent, {
                    uid: student.uid,
                    name: student.name,
                    number: student.number,
                });
            }
            const delta = roundAmount(log.delta ?? log.amount ?? 0);
            const reason = stringOrNull(log.reason) || "사유 없음";
            row.eventCount += 1;
            row.logCount = roundAmount(toNumber(row.logCount) + 1);
            row.logDelta = roundAmount(toNumber(row.logDelta) + delta);
            totals.logCount += 1;
            totals.eventCount += 1;
            if (!byReason[reason]) {
                byReason[reason] = {
                    reason,
                    count: 0,
                    positiveDelta: 0,
                    negativeDelta: 0,
                    netDelta: 0,
                };
            }
            byReason[reason].count += 1;
            byReason[reason].netDelta = roundAmount(toNumber(byReason[reason].netDelta) + delta);
            if (delta > 0) {
                byReason[reason].positiveDelta = roundAmount(toNumber(byReason[reason].positiveDelta) + delta);
            } else if (delta < 0) {
                byReason[reason].negativeDelta = roundAmount(toNumber(byReason[reason].negativeDelta) + Math.abs(delta));
            }
        });
    }

    const sortedScores = scores.sort((a, b) => a - b);
    const snapshot = {
        scoreStudentCount: sortedScores.length,
        minScore: sortedScores.length ? sortedScores[0] : null,
        medianScore: sortedScores.length ? sortedScores[Math.floor(sortedScores.length / 2)] : null,
        maxScore: sortedScores.length ? sortedScores[sortedScores.length - 1] : null,
        averageScore: sortedScores.length
            ? Math.round(sortedScores.reduce((sum, score) => sum + score, 0) / sortedScores.length)
            : null,
        scoreBands,
    };

    return {
        ...buildBasePayload({
            classId,
            dateKey,
            domain: "credit",
            status: totals.eventCount > 0 ? "ready" : "empty",
            generatedBy: options.source,
            sourceCollections: ["students/{uid}/creditHistory", "students/{uid}/creditLogs"],
            sourceCounts: {
                studentsScanned: students.length,
                creditHistory: totals.historyDocCount,
                creditLogs: totals.logCount,
            },
            sourceRanges: {
                creditHistory: { doc: dateKey },
                creditLogs: { field: "timestamp", start: window.startDate.toISOString(), end: window.endDate.toISOString() },
            },
        }),
        eventTotals: totals,
        byStudent,
        byReason,
        snapshot,
    };
}

async function buildCreditDailyLegacy(db, classId, dateKey, options = {}) {
    const window = getDateWindow(dateKey);
    const classRef = db.collection("classes").doc(classId);
    const students = await listStudents(classRef);
    const historyByStudent = new Map();
    const logsByStudent = new Map();

    for (const student of students) {
        const studentRef = classRef.collection("students").doc(student.uid);
        const [historySnap, logSnap] = await Promise.all([
            studentRef.collection("creditHistory").doc(dateKey).get(),
            studentRef
                .collection("creditLogs")
                .where("timestamp", ">=", window.startTs)
                .where("timestamp", "<=", window.endTs)
                .get()
                .catch(() => studentRef.collection("creditLogs").limit(0).get()),
        ]);
        const previousScore = await readPreviousCreditScore(studentRef, dateKey);
        const histories = [];
        if (Number.isFinite(previousScore)) {
            histories.push({ date: "0000-00-00", score: previousScore });
        }
        if (historySnap.exists) {
            histories.push({ id: historySnap.id, ...(historySnap.data() || {}) });
        }
        historyByStudent.set(student.uid, histories);
        logsByStudent.set(
            student.uid,
            logSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) })),
        );
    }

    return buildCreditPayloadFromRows({
        classId,
        dateKey,
        window,
        students,
        historyByStudent,
        logsByStudent,
        options,
    });
}

async function readPreviousCreditAnalytics(classRef, dateKey) {
    const snap = await classRef
        .collection(COLLECTION)
        .where(adminFieldPathDocumentId(), "<", dateKey)
        .orderBy(adminFieldPathDocumentId(), "desc")
        .limit(1)
        .get()
        .catch(() => ({ empty: true, docs: [] }));
    return snap.empty ? null : { ...(snap.docs[0].data() || {}), date: snap.docs[0].id };
}

async function buildCreditDaily(db, classId, dateKey, options = {}) {
    requireDateKey(dateKey, "dateKey");
    const window = getDateWindow(dateKey);
    const classRef = db.collection("classes").doc(classId);
    const students = await listStudents(classRef);

    try {
        const [historySnap, logSnap, previousAnalytics] = await Promise.all([
            db.collectionGroup("creditHistory")
                .where("classId", "==", classId)
                .where("date", "==", dateKey)
                .get(),
            db.collectionGroup("creditLogs")
                .where("classId", "==", classId)
                .where("timestamp", ">=", window.startTs)
                .where("timestamp", "<=", window.endTs)
                .get(),
            readPreviousCreditAnalytics(classRef, dateKey),
        ]);
        const currentHistoryByUid = new Map();
        historySnap.docs.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const studentUid = String(data.studentUid || "").trim();
            if (studentUid) {
                currentHistoryByUid.set(studentUid, {
                    id: docSnap.id,
                    ...data,
                });
            }
        });

        const missingHistoryStudents = students.filter(
            (student) => !currentHistoryByUid.has(student.uid),
        );
        if (missingHistoryStudents.length) {
            throw new Error(
                `creditHistory projection coverage missing for ${missingHistoryStudents.length} students`,
            );
        }

        const historyByStudent = new Map();
        const logsByStudent = new Map(students.map((student) => [student.uid, []]));
        logSnap.docs.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const studentUid = String(data.studentUid || "").trim();
            if (!logsByStudent.has(studentUid)) return;
            logsByStudent.get(studentUid).push({ id: docSnap.id, ...data });
        });

        // A gap in daily summaries can hide a newer raw history record. Only
        // reuse the immediately preceding date; otherwise read prior histories.
        const previousDateKey = getKstYesterdayKey(window.startDate);
        const previousByStudent = previousAnalytics?.date === previousDateKey
            ? previousAnalytics.byStudent || {}
            : {};
        const missingPreviousStudents = [];
        students.forEach((student) => {
            const histories = [];
            const rawPreviousScore = previousByStudent?.[student.uid]?.score;
            const previousScore = rawPreviousScore === null || rawPreviousScore === undefined
                ? NaN
                : Number(rawPreviousScore);
            if (Number.isFinite(previousScore)) {
                histories.push({ date: "0000-00-00", score: previousScore });
            } else {
                missingPreviousStudents.push(student);
            }
            histories.push(currentHistoryByUid.get(student.uid));
            historyByStudent.set(student.uid, histories);
        });

        await Promise.all(missingPreviousStudents.map(async (student) => {
            const previousScore = await readPreviousCreditScore(
                classRef.collection("students").doc(student.uid),
                dateKey,
            );
            if (Number.isFinite(previousScore)) {
                historyByStudent.get(student.uid).unshift({
                    date: "0000-00-00",
                    score: previousScore,
                });
            }
        }));

        return buildCreditPayloadFromRows({
            classId,
            dateKey,
            window,
            students,
            historyByStudent,
            logsByStudent,
            options,
        });
    } catch (error) {
        console.warn(
            `[creditAnalyticsDaily] grouped read unavailable; using per-student reads classId=${classId} date=${dateKey}`,
            error?.message || error,
        );
        return buildCreditDailyLegacy(db, classId, dateKey, options);
    }
}

async function buildCreditRange(db, classId, dateKeys, options = {}) {
    const classRef = db.collection("classes").doc(classId);
    const students = await listStudents(classRef);
    const startWindow = getDateWindow(dateKeys[0]);
    const endWindow = getDateWindow(dateKeys[dateKeys.length - 1]);
    const historyByStudent = new Map();
    const logsByStudent = new Map();

    for (const student of students) {
        const studentRef = classRef.collection("students").doc(student.uid);
        const [historySnap, logSnap] = await Promise.all([
            studentRef
                .collection("creditHistory")
                .get()
                .catch(() => ({ docs: [] })),
            studentRef
                .collection("creditLogs")
                .where("timestamp", ">=", startWindow.startTs)
                .where("timestamp", "<=", endWindow.endTs)
                .get()
                .catch(() => ({ docs: [] })),
        ]);
        historyByStudent.set(
            student.uid,
            historySnap.docs
                .map((docSnap) => ({ id: docSnap.id, date: docSnap.id, ...(docSnap.data() || {}) }))
                .sort((a, b) => String(a.date).localeCompare(String(b.date))),
        );
        logsByStudent.set(
            student.uid,
            logSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) })),
        );
    }

    return dateKeys.map((dateKey) => buildCreditPayloadFromRows({
        classId,
        dateKey,
        window: getDateWindow(dateKey),
        students,
        historyByStudent,
        logsByStudent,
        options,
    }));
}

async function hasCreditActivity(db, classId, startDate = BACKFILL_START_DATE) {
    const groupedHistory = await db
        .collectionGroup("creditHistory")
        .where("classId", "==", classId)
        .where("date", ">=", startDate)
        .limit(1)
        .get()
        .catch(() => null);
    if (groupedHistory && !groupedHistory.empty) return true;

    const classRef = db.collection("classes").doc(classId);
    const students = await listStudents(classRef);
    for (const student of students) {
        const hasHistory = await hasAnyDocs(
            classRef.collection("students").doc(student.uid).collection("creditHistory"),
            [["date", ">=", startDate]],
        ).catch(() => false);
        if (hasHistory) return true;
    }
    return false;
}

module.exports = {
    COLLECTION,
    buildDaily: buildCreditDaily,
    buildRange: buildCreditRange,
    hasActivity: hasCreditActivity,
};
