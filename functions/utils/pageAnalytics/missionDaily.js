"use strict";
const { readMissionDocsStudentStates } = require("../missionStudentState");

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

const COLLECTION = "missionAnalyticsDaily";
const COMPLETED_STATUSES = new Set(["approved", "late-approved", "completed"]);

function normalizeTierMeta(rawTier = null) {
    if (!rawTier) return null;

    if (typeof rawTier === "string") {
        const value = rawTier.trim();
        if (!value) return null;
        return { id: value, name: value, color: "#64748b", minScore: 0 };
    }

    const id = String(rawTier?.id || rawTier?.name || "").trim();
    if (!id) return null;

    const parsedMinScore = Number(rawTier?.minScore);
    return {
        id,
        name: String(rawTier?.name || id).trim(),
        color: String(rawTier?.color || "#64748b"),
        minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
    };
}

function getMissionMinTierRequirement(mission = {}) {
    const tierMeta = normalizeTierMeta(mission?.minCreditTier);
    if (tierMeta) return tierMeta;

    const tierId = String(mission?.minCreditTierId || "").trim();
    if (!tierId) return null;

    const parsedMinScore = Number(mission?.minCreditTierMinScore);
    return {
        id: tierId,
        name: String(mission?.minCreditTierName || tierId).trim(),
        color: String(mission?.minCreditTierColor || "#64748b"),
        minScore: Number.isFinite(parsedMinScore) ? parsedMinScore : 0,
    };
}

function meetsMissionTierRequirement(mission = {}, studentData = {}) {
    const minTier = getMissionMinTierRequirement(mission);
    if (!minTier) return true;

    const studentScore = Number(studentData?.creditScore);
    if (Number.isFinite(studentScore)) {
        return studentScore >= Number(minTier.minScore || 0);
    }

    const studentTier = normalizeTierMeta(studentData?.creditTier);
    if (!studentTier) return false;

    if (studentTier.id && minTier.id && studentTier.id === minTier.id) {
        return true;
    }

    return Number(studentTier.minScore || 0) >= Number(minTier.minScore || 0);
}

function isMissionAssignedToStudent(mission = {}, studentUid, studentData = {}) {
    const resolvedUid = String(studentUid || "").trim();
    if (!resolvedUid) return false;

    const targets = Array.isArray(mission?.targetStudentUids)
        ? mission.targetStudentUids
        : [];
    if (targets.length > 0 && !targets.includes(resolvedUid)) {
        return false;
    }

    return meetsMissionTierRequirement(mission, studentData);
}

function isStudentParticipant(student = {}) {
    return student.role === "student" || !student.role;
}

function pickCompletionDate(completion = {}) {
    return completion.submittedAt ||
        completion.createdAt ||
        completion.completedAt ||
        completion.approvedAt ||
        completion.updatedAt ||
        null;
}

function getStatus(value) {
    return String(value || "unknown").trim() || "unknown";
}

function getMissionType(mission = {}, row = {}) {
    return stringOrNull(mission.type || row.missionType) || null;
}

function createStudentMissionEntry({ missionId, mission, row, studentUid }) {
    return {
        studentUid,
        missionId,
        title: stringOrNull(mission.title || row.missionTitle) || "Mission",
        type: getMissionType(mission, row),
        eventCount: 0,
        attemptCount: 0,
        approvedCount: 0,
        pendingCount: 0,
        rejectedCount: 0,
        canceledCount: 0,
        completedDayCount: 0,
        extraApprovedCount: 0,
        rewardAmount: 0,
        byStatus: {},
        latestAt: null,
    };
}

function addStudentMissionEvent({
    byStudentMission,
    mission,
    row,
    studentUid,
    status,
    amount = 0,
    eventDate = null,
}) {
    const missionId = stringOrNull(mission.id) || stringOrNull(row.missionId) || "unknown";
    const uid = stringOrNull(studentUid) || "unknown";

    if (!byStudentMission[uid]) byStudentMission[uid] = {};
    if (!byStudentMission[uid][missionId]) {
        byStudentMission[uid][missionId] = createStudentMissionEntry({
            missionId,
            mission,
            row,
            studentUid: uid,
        });
    }

    const entry = byStudentMission[uid][missionId];
    entry.eventCount += 1;
    entry.attemptCount += 1;
    increment(entry.byStatus, status, 1);

    if (COMPLETED_STATUSES.has(status)) {
        entry.approvedCount = roundAmount(toNumber(entry.approvedCount) + 1);
    }
    if (status === "pending") {
        entry.pendingCount = roundAmount(toNumber(entry.pendingCount) + 1);
    }
    if (status === "rejected") {
        entry.rejectedCount = roundAmount(toNumber(entry.rejectedCount) + 1);
    }
    if (status === "canceled" || status === "cancelled") {
        entry.canceledCount = roundAmount(toNumber(entry.canceledCount) + 1);
    }
    if (amount > 0) {
        entry.rewardAmount = roundAmount(toNumber(entry.rewardAmount) + amount);
    }

    const eventIso = toIsoOrNull(eventDate);
    if (eventIso && (!entry.latestAt || eventIso > entry.latestAt)) {
        entry.latestAt = eventIso;
    }
}

function finalizeStudentMissionEntries(byStudentMission = {}) {
    Object.values(byStudentMission).forEach((missionMap = {}) => {
        Object.values(missionMap).forEach((entry = {}) => {
            const approvedCount = Number(entry.approvedCount || 0);
            if (entry.type === "always" && approvedCount > 0) {
                entry.completedDayCount = 1;
                entry.extraApprovedCount = Math.max(approvedCount - 1, 0);
            }
            if (entry.type !== "always" && Number(entry.eventCount || 0) > 0) {
                entry.assignedCount = 1;
            }
        });
    });
}

async function readStudents(classRef) {
    const snap = await classRef.collection("students").get();
    return snap.docs
        .map((docSnap) => ({ uid: docSnap.id, data: docSnap.data() || {} }))
        .filter(({ data }) => isStudentParticipant(data));
}

function addAssignedGeneralMissions({ byStudentMission, students, missions }) {
    missions.forEach((mission) => {
        if (getMissionType(mission) === "always") return;

        students.forEach(({ uid, data }) => {
            if (!isMissionAssignedToStudent(mission, uid, data)) return;
            const completion = mission?.completions?.[uid];
            if (!completion || typeof completion !== "object") return;
            if (!pickCompletionDate(completion)) return;

            const missionId = stringOrNull(mission.id) || "unknown";
            if (!byStudentMission[uid]) byStudentMission[uid] = {};
            if (!byStudentMission[uid][missionId]) {
                byStudentMission[uid][missionId] = createStudentMissionEntry({
                    missionId,
                    mission,
                    row: completion,
                    studentUid: uid,
                });
            }
            byStudentMission[uid][missionId].assignedCount = 1;
        });
    });
}

function addMissionEvent({
    byStudent,
    byMission,
    byStudentMission,
    totals,
    mission,
    row,
    studentUid,
    status,
    amount = 0,
    eventDate = null,
}) {
    const snapshot = pickStudentSnapshot(row, studentUid);
    const student = ensureStudent(byStudent, snapshot);
    const missionId = stringOrNull(mission.id) || stringOrNull(row.missionId) || "unknown";

    totals.eventCount += 1;
    student.eventCount += 1;
    increment(totals.byStatus, status, 1);
    student[`${status}Count`] = roundAmount(toNumber(student[`${status}Count`]) + 1);

    if (amount > 0) {
        totals.rewardAmount = roundAmount(toNumber(totals.rewardAmount) + amount);
        student.rewardAmount = roundAmount(toNumber(student.rewardAmount) + amount);
    }

    if (!byMission[missionId]) {
        byMission[missionId] = {
            missionId,
            title: stringOrNull(mission.title || row.missionTitle) || "Mission",
            type: getMissionType(mission, row),
            eventCount: 0,
            byStatus: {},
            rewardAmount: 0,
        };
    }
    byMission[missionId].eventCount += 1;
    increment(byMission[missionId].byStatus, status, 1);
    byMission[missionId].rewardAmount = roundAmount(
        toNumber(byMission[missionId].rewardAmount) + amount,
    );

    addStudentMissionEvent({
        byStudentMission,
        mission,
        row,
        studentUid,
        status,
        amount,
        eventDate,
    });
}

function getRewardTotalAmount(row = {}) {
    const rewardTotal = row.rewardTotal && typeof row.rewardTotal === "object"
        ? row.rewardTotal
        : null;
    if (!rewardTotal) {
        return roundAmount(row.reward || row.rewardAmount || 0);
    }

    return roundAmount(
        toNumber(rewardTotal.currency) +
        toNumber(rewardTotal.credit) +
        toNumber(rewardTotal.missionToken),
    );
}

function addCountByStatus(target, status, count) {
    const amount = toNumber(count);
    if (amount <= 0) return;
    increment(target, status, amount);
}

function addAlwaysDaySummary({
    byStudent,
    byMission,
    byStudentMission,
    totals,
    mission,
    row,
}) {
    const missionId = stringOrNull(mission.id) || stringOrNull(row.missionId) || "unknown";
    const studentUid = stringOrNull(row.studentUid) || "unknown";
    const attemptCount = Math.max(0, roundAmount(row.attemptCount || 0));
    const approvedCount = Math.max(0, roundAmount(row.approvedCount || 0));
    const pendingCount = Math.max(0, roundAmount(row.pendingCount || 0));
    const eventDate = row.lastAttemptAt || row.updatedAt || null;
    const rewardAmount = getRewardTotalAmount(row);

    if (attemptCount <= 0 && approvedCount <= 0 && pendingCount <= 0) return;

    const snapshot = pickStudentSnapshot(row, studentUid);
    const student = ensureStudent(byStudent, snapshot);
    const eventCount = Math.max(attemptCount, approvedCount + pendingCount, 1);

    totals.eventCount += eventCount;
    totals.alwaysAttemptEvents += eventCount;
    addCountByStatus(totals.byStatus, "approved", approvedCount);
    addCountByStatus(totals.byStatus, "pending", pendingCount);
    if (rewardAmount > 0) {
        totals.rewardAmount = roundAmount(toNumber(totals.rewardAmount) + rewardAmount);
    }

    student.eventCount += eventCount;
    if (approvedCount > 0) {
        student.approvedCount = roundAmount(toNumber(student.approvedCount) + approvedCount);
    }
    if (pendingCount > 0) {
        student.pendingCount = roundAmount(toNumber(student.pendingCount) + pendingCount);
    }
    if (rewardAmount > 0) {
        student.rewardAmount = roundAmount(toNumber(student.rewardAmount) + rewardAmount);
    }

    if (!byMission[missionId]) {
        byMission[missionId] = {
            missionId,
            title: stringOrNull(mission.title || row.missionTitle) || "Mission",
            type: "always",
            eventCount: 0,
            byStatus: {},
            rewardAmount: 0,
        };
    }
    byMission[missionId].eventCount += eventCount;
    addCountByStatus(byMission[missionId].byStatus, "approved", approvedCount);
    addCountByStatus(byMission[missionId].byStatus, "pending", pendingCount);
    byMission[missionId].rewardAmount = roundAmount(
        toNumber(byMission[missionId].rewardAmount) + rewardAmount,
    );

    if (!byStudentMission[studentUid]) byStudentMission[studentUid] = {};
    if (!byStudentMission[studentUid][missionId]) {
        byStudentMission[studentUid][missionId] = createStudentMissionEntry({
            missionId,
            mission: { ...mission, type: "always" },
            row,
            studentUid,
        });
    }

    const entry = byStudentMission[studentUid][missionId];
    entry.eventCount += eventCount;
    entry.attemptCount += attemptCount;
    entry.approvedCount = roundAmount(toNumber(entry.approvedCount) + approvedCount);
    entry.pendingCount = roundAmount(toNumber(entry.pendingCount) + pendingCount);
    entry.completedDayCount += approvedCount > 0 ? 1 : 0;
    entry.extraApprovedCount += Math.max(approvedCount - 1, 0);
    entry.rewardAmount = roundAmount(toNumber(entry.rewardAmount) + rewardAmount);
    addCountByStatus(entry.byStatus, "approved", approvedCount);
    addCountByStatus(entry.byStatus, "pending", pendingCount);

    const eventIso = toIsoOrNull(eventDate);
    if (eventIso && (!entry.latestAt || eventIso > entry.latestAt)) {
        entry.latestAt = eventIso;
    }
}

async function readAlwaysDaySummaries(db, classRef, students, missions, dateKey) {
    const docs = [];
    const alwaysMissions = missions.filter((mission) => getMissionType(mission) === "always");
    const missionMap = new Map(alwaysMissions.map((mission) => [mission.id, mission]));
    const studentMap = new Map(students.map((student) => [student.uid, student.data || {}]));

    try {
        const daySnap = await db
            .collectionGroup("days")
            .where("classId", "==", classRef.id)
            .where("dayKey", "==", dateKey)
            .get();
        daySnap.docs.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const mission = missionMap.get(String(data.missionId || ""));
            const studentUid = String(data.studentUid || "");
            const studentData = studentMap.get(studentUid);
            if (!mission || !studentData) return;
            if (!isMissionAssignedToStudent(mission, studentUid, studentData)) return;
            docs.push({
                id: docSnap.id,
                mission,
                data: () => data,
            });
        });

        return {
            docs,
            size: docs.length,
            forEach(callback) {
                docs.forEach(callback);
            },
        };
    } catch (error) {
        console.warn(
            `[missionAnalyticsDaily] collection-group day query failed; using direct reads classId=${classRef.id} date=${dateKey}`,
            error?.message || error,
        );
    }

    for (const mission of alwaysMissions) {
        const missionDocs = await Promise.all(
            students
                .filter(({ uid, data }) => isMissionAssignedToStudent(mission, uid, data))
                .map(async ({ uid }) => {
                    const docSnap = await classRef
                        .collection("students")
                        .doc(uid)
                        .collection("missionState")
                        .doc(mission.id)
                        .collection("days")
                        .doc(dateKey)
                        .get();

                    if (!docSnap || !docSnap.exists) return null;
                    return {
                        id: docSnap.id,
                        data: () => docSnap.data() || {},
                        mission,
                    };
                }),
        );

        docs.push(...missionDocs.filter(Boolean));
    }

    return {
        docs,
        size: docs.length,
        forEach(callback) {
            docs.forEach(callback);
        },
    };
}

async function buildMissionDaily(db, classId, dateKey, options = {}) {
    requireDateKey(dateKey, "dateKey");
    const window = getDateWindow(dateKey);
    const classRef = db.collection("classes").doc(classId);
    const [missionsSnap, students] = await Promise.all([
        classRef.collection("missions").get(),
        readStudents(classRef),
    ]);
    // These legacy parent projections are not a source for always-day analytics.
    // Preserve strict validation of all consumed fields and regular v2 states.
    const analyticsDocs = missionsSnap.docs.map((doc) => {
        const raw = doc.data();
        if (raw.type !== "always") return doc;
        const data = Object.fromEntries(Object.entries(raw).filter(([key]) => !/^(stats|lastAttempts)(\.|$)/.test(key)));
        return { id: doc.id, ref: doc.ref, data: () => data };
    });
    const resolvedMissionDocs = await readMissionDocsStudentStates(db, analyticsDocs, { studentUids: students.map(({ uid }) => uid) });
    const missions = resolvedMissionDocs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() || {}),
    }));
    const alwaysDaySummaries = await readAlwaysDaySummaries(
        db,
        classRef,
        students,
        missions,
        dateKey,
    );

    const byStudent = {};
    const byMission = {};
    const byStudentMission = {};
    const totals = {
        eventCount: 0,
        rewardAmount: 0,
        byStatus: {},
        normalCompletionEvents: 0,
        alwaysAttemptEvents: 0,
    };
    missions.forEach((mission) => {
        const completions = mission.completions && typeof mission.completions === "object"
            ? mission.completions
            : {};

        Object.entries(completions).forEach(([studentUid, completion]) => {
            const eventDate = pickCompletionDate(completion || {});
            if (!isInWindow(eventDate, window)) return;

            const status = getStatus(completion.status);
            const reward = COMPLETED_STATUSES.has(status)
                ? roundAmount(completion.reward || completion.rewardAmount || mission.reward || 0)
                : 0;

            addMissionEvent({
                byStudent,
                byMission,
                byStudentMission,
                totals,
                mission,
                row: completion || {},
                studentUid,
                status,
                amount: reward,
                eventDate,
            });
            totals.normalCompletionEvents += 1;
        });
    });

    alwaysDaySummaries.forEach((docSnap) => {
        addAlwaysDaySummary({
            byStudent,
            byMission,
            byStudentMission,
            totals,
            mission: docSnap.mission,
            row: docSnap.data() || {},
        });
    });

    addAssignedGeneralMissions({ byStudentMission, students, missions });
    finalizeStudentMissionEntries(byStudentMission);

    return {
        ...buildBasePayload({
            classId,
            dateKey,
            domain: "mission",
            status: totals.eventCount > 0 ? "ready" : "empty",
            generatedBy: options.source,
            sourceCollections: ["missions", "students/{uid}/missionState/{missionId}/days"],
            sourceCounts: {
                missionsScanned: missionsSnap.size,
                alwaysDaySummaries: alwaysDaySummaries.size || 0,
                studentsScanned: students.length,
            },
            sourceRanges: {
                completions: {
                    fields: ["approvedAt", "submittedAt", "completedAt", "updatedAt"],
                    start: window.startDate.toISOString(),
                    end: window.endDate.toISOString(),
                },
                alwaysDays: { field: "dayKey", value: dateKey },
            },
        }),
        eventTotals: totals,
        byStudent,
        byMission,
        byStudentMission,
        snapshot: {
            latestMissionDocUpdatedAt: missionsSnap.docs
                .map((docSnap) => toIsoOrNull((docSnap.data() || {}).updatedAt))
                .filter(Boolean)
                .sort()
                .pop() || null,
        },
    };
}

async function hasMissionActivity(db, classId, startDate = BACKFILL_START_DATE) {
    const classRef = db.collection("classes").doc(classId);
    if (await hasAnyDocs(classRef.collection("missions")).catch(() => false)) {
        return true;
    }
    const attempts = await db
        .collectionGroup("attempts")
        .where("classId", "==", classId)
        .where("dayKey", ">=", startDate)
        .limit(1)
        .get()
        .catch(() => ({ empty: true }));
    return !attempts.empty;
}

module.exports = {
    COLLECTION,
    buildDaily: buildMissionDaily,
    hasActivity: hasMissionActivity,
};
