const { usesDirectMissionList, compactHomeMissionSummary } = require("../utils/missionListProjection");
const { same: sameRealEstateSource } = require("../utils/realEstateStorageSchema");
const { rentPropertyFields } = require("../utils/realEstateProjectionChanges");
"use strict";

const admin = require("../firebaseAdminCompat");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
    formatDateKeyInKST,
    startOfDayInKST,
    addCalendarDaysInKST,
    calculateMaturityDate,
    calculateRepaymentDate,
} = require("../utils/dateUtils");
const { getAuthContext, hasPermission } = require("../utils/permissions");
const {
    getNotificationStateMainDocPath,
    createNotificationStateMainActionPatch,
} = require("../utils/notificationState");
const {
    writeNoticeUnreadCount: writeNoticeUnreadCountProjection,
} = require("../utils/studentServerProjectionWriters");
const {
    hasMissionStudentEligibilityChanged,
} = require("../utils/missionSummaryProjection");
const {
    normalizeMissionStateFields,
    getMissionStructuralFields,
    readMissionStudentStates,
    readMissionDocsStudentStates,
    guardCanonicalMissionProjection,
    serializeStateValue,
} = require("../utils/missionStudentState");
const { prepareMissionStudentStates } = require("../utils/prepareMissionStudentStates");
const {
    hasTaxNotificationContributionChanged,
} = require("../utils/summaryProjectionGuards");

const db = admin.firestore();
const { readRealEstateLayout } = require("../utils/realEstateStorage");
const FieldValue = admin.firestore.FieldValue;

const SUMMARY_DOC_PATH = (classId, summaryKey) =>
    `classes/${classId}/notificationSummary/${summaryKey}`;
const ASSEMBLY_USER_SUMMARY_COLLECTION_PATH = (classId) =>
    `${SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.assembly)}/users`;
const ASSEMBLY_USER_SUMMARY_DOC_PATH = (classId, uid) =>
    `${ASSEMBLY_USER_SUMMARY_COLLECTION_PATH(classId)}/${uid}`;
const CASE_LIBRARY_SUMMARY_DOC_PATH = "sharedSummaries/caseLibrary";
const STUDENT_DASHBOARD_MISSION_SUMMARY_DOC_PATH = (classId, studentUid) =>
    `classes/${classId}/students/${studentUid}/dashboardSummary/missions`;
const TEACHER_DASHBOARD_MISSION_MAIN_DOC_PATH = (classId) =>
    `classes/${classId}/dashboardSummary/missionsMain`;
const TEACHER_DASHBOARD_MISSION_MAIN_WEEK_COLLECTION_PATH = (classId) =>
    `${TEACHER_DASHBOARD_MISSION_MAIN_DOC_PATH(classId)}/weeks`;
const TEACHER_DASHBOARD_MISSION_MAIN_WEEK_DOC_PATH = (classId, weekKey) =>
    `${TEACHER_DASHBOARD_MISSION_MAIN_WEEK_COLLECTION_PATH(classId)}/${weekKey}`;
const TEACHER_DASHBOARD_MISSION_STATUS_COLLECTION_PATH = (classId) =>
    `${TEACHER_DASHBOARD_MISSION_MAIN_DOC_PATH(classId)}/status`;
const TEACHER_DASHBOARD_MISSION_STATUS_DOC_PATH = (classId, missionId) =>
    `${TEACHER_DASHBOARD_MISSION_STATUS_COLLECTION_PATH(classId)}/${missionId}`;
const TEACHER_DASHBOARD_MISSION_STATS_DOC_PATH = (classId) =>
    `classes/${classId}/dashboardSummary/missionStats`;
const TEACHER_DASHBOARD_MISSION_STATS_WEEK_COLLECTION_PATH = (classId) =>
    `${TEACHER_DASHBOARD_MISSION_STATS_DOC_PATH(classId)}/weeks`;
const TEACHER_DASHBOARD_MISSION_STATS_WEEK_DOC_PATH = (classId, weekKey) =>
    `${TEACHER_DASHBOARD_MISSION_STATS_WEEK_COLLECTION_PATH(classId)}/${weekKey}`;
const ASSEMBLY_SUMMARY_VERSION = 3;
const ASSEMBLY_VIEW_PERMISSION = "page_assembly_view";

const SUMMARY_KEYS = Object.freeze({
    notices: "notices",
    tax: "tax",
    missions: "missions",
    bank: "bank",
    credentials: "credentials",
    police: "police",
    marketplace: "marketplace",
    realestate: "realestate",
    assembly: "assembly",
});

const MISSION_PENDING_STATUSES = new Set(["pending", "late"]);
const MISSION_RESUBMIT_ALLOWED_STATUSES = new Set(["rejected", "cancelled"]);
const MISSION_COMPLETED_STATUSES = new Set(["approved", "late-approved"]);
const DASHBOARD_REGULAR_MISSION_WINDOW_DAYS = 60;
const MISSION_DASHBOARD_SUMMARY_VERSION = 2;
const MISSION_TEACHER_SUMMARY_ITEM_VERSION = 1;
const MISSION_TEACHER_MAIN_SUMMARY_VERSION = 2;
const MISSION_TEACHER_STATUS_SUMMARY_VERSION = 1;
const MISSION_TEACHER_STATS_SUMMARY_VERSION = 1;
const MISSION_TEACHER_STATUS_MODE_EMBEDDED = "embedded";
const MISSION_TEACHER_STATUS_MODE_DETACHED = "detached";
const BANK_LOAN_ALERT_LEAD_DAYS = 3;
const NOTICE_INBOX_EXCLUDED_TYPES = new Set([
    "police_report_new",
]);

function toDateSafe(v) {
    try {
        if (!v) return null;
        if (typeof v.toDate === "function") return v.toDate();
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
    } catch {
        return null;
    }
}

function toMillis(v) {
    const resolved = toDateSafe(v);
    return resolved ? resolved.getTime() : 0;
}

function getBankSummaryFingerprint(collectionId, docData) {
    if (collectionId === "savings") {
        const status = String(docData?.status || "");
        return {
            status,
            relevantDateMs: status === "active" ?
                toMillis(calculateMaturityDate(docData)) :
                0,
        };
    }

    if (collectionId === "loans") {
        const status = String(docData?.status || "");
        return {
            status,
            relevantDateMs: status === "ongoing" ?
                toMillis(calculateRepaymentDate(docData)) :
                0,
        };
    }

    return {
        status: "",
        relevantDateMs: 0,
    };
}

function hasBankSummaryRelevantChange(collectionId, beforeData, afterData) {
    const beforeFingerprint = getBankSummaryFingerprint(collectionId, beforeData);
    const afterFingerprint = getBankSummaryFingerprint(collectionId, afterData);

    return (
        beforeFingerprint.status !== afterFingerprint.status ||
        beforeFingerprint.relevantDateMs !== afterFingerprint.relevantDateMs
    );
}

function getTeacherPendingCountForMission(mission) {
    if (!mission || mission.type === "always") return 0;
    const completions = mission.completions;
    if (!completions || typeof completions !== "object") return 0;

    let count = 0;
    for (const completion of Object.values(completions)) {
        const status = completion?.status;
        if (MISSION_PENDING_STATUSES.has(status)) count += 1;
    }
    return count;
}

function isAlwaysMission(mission) {
    return mission?.type === "always" || (!!mission?.availability && mission?.isActive);
}

function isMissionVisibleToStudent(mission) {
    const availability = mission?.availability || {};
    if (typeof availability.studentVisible === "boolean") {
        return availability.studentVisible;
    }
    if (typeof availability.availabilityStudentVisible === "boolean") {
        return availability.availabilityStudentVisible;
    }
    return true;
}

function isTargetedToStudent(mission, studentUid) {
    if (!studentUid) return false;
    const targets = mission?.targetStudentUids;
    return !Array.isArray(targets) || targets.length === 0 || targets.includes(studentUid);
}

function normalizeTierMeta(rawTier = null) {
    if (!rawTier) return null;

    if (typeof rawTier === "string") {
        const value = rawTier.trim();
        if (!value) return null;
        return {
            id: value,
            name: value,
            color: "#64748b",
            minScore: 0,
        };
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

    if (studentTier.id && studentTier.id === minTier.id) {
        return true;
    }

    return Number(studentTier.minScore || 0) >= Number(minTier.minScore || 0);
}

function isMissionEligibleForStudent(mission = {}, studentUid, studentData = {}) {
    return isTargetedToStudent(mission, studentUid) &&
        meetsMissionTierRequirement(mission, studentData);
}

function getDashboardMissionTitle(mission) {
    const title = typeof mission?.title === "string" ? mission.title.trim() : "";
    return title || "미션";
}

function getDashboardMissionDescription(mission) {
    if (typeof mission?.description !== "string") return "";
    return mission.description.trim();
}

function sanitizeMissionRewardAmount(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeDashboardMissionRewards(rewards) {
    if (Array.isArray(rewards)) {
        return rewards
            .filter((reward) => reward && typeof reward === "object" && reward.type)
            .map((reward) => {
                const normalizedReward = {
                    type: String(reward.type),
                    amount: sanitizeMissionRewardAmount(reward.amount),
                };

                if (reward.minAmount !== undefined) {
                    normalizedReward.minAmount =
                        sanitizeMissionRewardAmount(reward.minAmount);
                }
                if (reward.maxAmount !== undefined) {
                    normalizedReward.maxAmount =
                        sanitizeMissionRewardAmount(reward.maxAmount);
                }
                if (reward.isRange === true) {
                    normalizedReward.isRange = true;
                }
                if (typeof reward.mode === "string" && reward.mode.trim()) {
                    normalizedReward.mode = reward.mode.trim();
                }

                return normalizedReward;
            });
    }

    if (!rewards || typeof rewards !== "object") {
        return [];
    }

    return [
        {
            type: "currency",
            amount: sanitizeMissionRewardAmount(rewards.currency),
        },
        {
            type: "credit",
            amount: sanitizeMissionRewardAmount(rewards.credit),
        },
        {
            type: "missionToken",
            amount: sanitizeMissionRewardAmount(
                rewards.missionToken ?? rewards.token,
            ),
        },
    ].filter((reward) => reward.amount > 0);
}

function createDashboardMissionCompletionSummary(completion) {
    if (!completion || typeof completion !== "object") {
        return null;
    }

    const status =
        typeof completion?.status === "string" && completion.status.trim() ?
            completion.status.trim() :
            null;
    if (!status) return null;

    return {
        status,
        late: completion?.late === true,
        feedback: typeof completion?.feedback === "string" ? completion.feedback : "",
        feedbackEditedAt: completion?.feedbackEditedAt || null,
        submittedAt: completion?.submittedAt || null,
        approvedAt: completion?.approvedAt || null,
        updatedAt: completion?.updatedAt || null,
        submissionId: completion?.submissionId || null,
    };
}

function sanitizeAlwaysMissionAvailability(availability) {
    if (!availability || typeof availability !== "object") return {};

    const sanitized = {
        startTime: availability.startTime || null,
        endTime: availability.endTime || null,
    };

    if (Array.isArray(availability.daysOfWeek)) {
        sanitized.daysOfWeek = availability.daysOfWeek
            .map((day) => Number(day))
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    }

    if (typeof availability.studentVisible === "boolean") {
        sanitized.studentVisible = availability.studentVisible;
    }

    if (typeof availability.availabilityStudentVisible === "boolean") {
        sanitized.availabilityStudentVisible =
            availability.availabilityStudentVisible;
    }

    const maxPerDay = Number(availability?.maxPerDay);
    if (Number.isFinite(maxPerDay) && maxPerDay > 0) {
        sanitized.maxPerDay = maxPerDay;
    }

    return sanitized;
}

function buildTeacherMissionStatusSummary(mission = {}) {
    if (isAlwaysMission(mission)) {
        return {
            approvedStudentUids: [],
            pendingStudentUids: [],
            trackedStudentUids: [],
        };
    }

    const completions =
        mission?.completions && typeof mission.completions === "object" ?
            mission.completions :
            {};
    const submissionsIndex =
        mission?.submissionsIndex && typeof mission.submissionsIndex === "object" ?
            mission.submissionsIndex :
            {};
    const explicitTargets = Array.isArray(mission?.targetStudentUids) ?
        mission.targetStudentUids.filter(Boolean) :
        [];
    const explicitTargetSet =
        explicitTargets.length > 0 ? new Set(explicitTargets) : null;
    const candidateUids = new Set([
        ...Object.keys(completions),
        ...Object.keys(submissionsIndex),
    ]);
    const approvedStudentUids = [];
    const pendingStudentUids = [];
    const trackedStudentUids = [];

    candidateUids.forEach((studentUid) => {
        if (!studentUid) return;
        if (explicitTargetSet && !explicitTargetSet.has(studentUid)) return;

        trackedStudentUids.push(studentUid);

        const status = getMissionCompletionStatus(completions[studentUid]);
        if (MISSION_COMPLETED_STATUSES.has(status)) {
            approvedStudentUids.push(studentUid);
            return;
        }

        if (
            MISSION_PENDING_STATUSES.has(status) ||
            (!!mission?.requireSubmissionForm && !!submissionsIndex?.[studentUid])
        ) {
            pendingStudentUids.push(studentUid);
        }
    });

    approvedStudentUids.sort();
    pendingStudentUids.sort();
    trackedStudentUids.sort();

    return {
        approvedStudentUids,
        pendingStudentUids,
        trackedStudentUids,
    };
}

function getAlwaysMissionTodayCount(mission = {}) {
    const todayKey = formatDateKeyInKST(new Date());
    const lastAttempts =
        mission?.lastAttempts && typeof mission.lastAttempts === "object" ?
            mission.lastAttempts :
            {};

    let todayCount = 0;
    Object.values(lastAttempts).forEach((attempt) => {
        if (!attempt || attempt.dayKey !== todayKey) return;
        const status = typeof attempt?.status === "string" ? attempt.status : "approved";
        if (status === "approved" || status === "pending") {
            todayCount += 1;
        }
    });

    return todayCount;
}

function buildTeacherMissionStatusPayload(mission = {}) {
    if (isAlwaysMission(mission)) {
        return {
            type: "always",
            stats: {
                totalCount: Number(
                    mission?.stats?.totalCount || mission?.["stats.totalCount"] || 0,
                ),
                approvedCount: Number(
                    mission?.stats?.approvedCount ||
                    mission?.["stats.approvedCount"] ||
                    0,
                ),
                pendingCount: Number(
                    mission?.stats?.pendingCount ||
                    mission?.["stats.pendingCount"] ||
                    0,
                ),
                todayCount: getAlwaysMissionTodayCount(mission),
            },
        };
    }

    const statusSummary = buildTeacherMissionStatusSummary(mission);
    return {
        type: typeof mission?.type === "string" ? mission.type : "single",
        stateStorageVersion: Number(mission.stateStorageVersion || 1),
        statusSummary,
        stats: {
            approvedCount: statusSummary.approvedStudentUids.length,
            pendingCount: statusSummary.pendingStudentUids.length,
            trackedCount: statusSummary.trackedStudentUids.length,
        },
    };
}

function buildTeacherMissionSummaryItem(
    classId,
    missionId,
    mission = {},
    options = {},
) {
    const includeEmbeddedStatus = options.includeEmbeddedStatus !== false;
    const startAt = toDateSafe(mission?.timeWindow?.start ?? mission?.startDate);
    const endAt = toDateSafe(mission?.timeWindow?.end ?? mission?.endDate);
    const baseSummary = {
        summaryVersion: MISSION_TEACHER_SUMMARY_ITEM_VERSION,
        id: missionId,
        classId,
        type: typeof mission?.type === "string" ? mission.type : "single",
        title: getDashboardMissionTitle(mission),
        description: getDashboardMissionDescription(mission),
        createdAt: mission?.createdAt || null,
        updatedAt: mission?.updatedAt || null,
        rewards: sanitizeDashboardMissionRewards(mission?.rewards),
        autoApprove: mission?.autoApprove === true,
        requireSubmissionForm: mission?.requireSubmissionForm === true,
        allowLateSubmission: mission?.allowLateSubmission !== false,
        targetStudentUids: Array.isArray(mission?.targetStudentUids) ?
            mission.targetStudentUids.filter(Boolean) :
            [],
        minCreditTierId: mission?.minCreditTierId || null,
        minCreditTierName: mission?.minCreditTierName || null,
        minCreditTierColor: mission?.minCreditTierColor || null,
        minCreditTierMinScore: Number.isFinite(Number(mission?.minCreditTierMinScore)) ?
            Number(mission.minCreditTierMinScore) :
            0,
        minCreditTier: getMissionMinTierRequirement(mission),
    };

    if (isAlwaysMission(mission)) {
        const alwaysSummary = {
            ...baseSummary,
            type: "always",
            isActive: typeof mission?.isActive === "boolean" ? mission.isActive : true,
            displayOrder: Number.isFinite(Number(mission?.displayOrder)) ?
                Number(mission.displayOrder) :
                null,
            availability: sanitizeAlwaysMissionAvailability(mission?.availability),
            maxPerDay: Number.isFinite(Number(mission?.availability?.maxPerDay)) ?
                Number(mission.availability.maxPerDay) :
                (Number.isFinite(Number(mission?.maxPerDay)) ?
                    Number(mission.maxPerDay) :
                    null),
        };

        if (!includeEmbeddedStatus) return alwaysSummary;

        return {
            ...alwaysSummary,
            stats: buildTeacherMissionStatusPayload(mission).stats,
        };
    }

    const regularSummary = {
        ...baseSummary,
        timeWindow: {
            start: startAt,
            end: endAt,
        },
    };

    if (!includeEmbeddedStatus) return regularSummary;

    return {
        ...regularSummary,
        ...buildTeacherMissionStatusPayload(mission),
    };
}

function createTeacherMissionStatusDocData(classId, missionId, mission = {}) {
    return {
        summaryVersion: MISSION_TEACHER_STATUS_SUMMARY_VERSION,
        classId,
        missionId,
        ...buildTeacherMissionStatusPayload(mission),
        updatedAt: FieldValue.serverTimestamp(),
    };
}

function createTeacherMissionStatusWrite(classId, missionId, mission = {}) {
    return {
        ref: db.doc(
            TEACHER_DASHBOARD_MISSION_STATUS_DOC_PATH(classId, missionId),
        ),
        data: createTeacherMissionStatusDocData(classId, missionId, mission),
    };
}

function getTeacherMissionMainWeekWindow(mission = {}) {
    if (isAlwaysMission(mission)) return null;

    const basisDate = toDateSafe(
        mission?.timeWindow?.start ??
        mission?.startDate ??
        mission?.updatedAt ??
        mission?.createdAt,
    );
    if (!basisDate) return null;

    const basisDayStart = startOfDayInKST(basisDate);
    const kstWeekDay = new Date(basisDayStart.getTime() + (9 * 60 * 60 * 1000)).getUTCDay();
    const weekOffset = (kstWeekDay + 6) % 7;
    const weekStart = addCalendarDaysInKST(basisDayStart, -weekOffset);
    const weekEnd = addCalendarDaysInKST(weekStart, 6);

    return {
        weekKey: formatDateKeyInKST(weekStart),
        weekStart,
        weekEnd,
    };
}

function sortTeacherSummaryMissions(left, right) {
    return (
        Math.max(
            toMillis(right?.updatedAt),
            toMillis(right?.timeWindow?.start),
            toMillis(right?.createdAt),
        ) -
        Math.max(
            toMillis(left?.updatedAt),
            toMillis(left?.timeWindow?.start),
            toMillis(left?.createdAt),
        )
    );
}

function sortTeacherAlwaysSummaryMissions(left, right) {
    const leftOrder = Number(left?.displayOrder);
    const rightOrder = Number(right?.displayOrder);
    const leftHasOrder = Number.isFinite(leftOrder);
    const rightHasOrder = Number.isFinite(rightOrder);

    if (leftHasOrder && rightHasOrder && leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
    }
    if (leftHasOrder !== rightHasOrder) {
        return leftHasOrder ? -1 : 1;
    }

    return sortTeacherSummaryMissions(left, right);
}

function createTeacherMissionMainWeekDocData(
    classId,
    weekKey,
    weekStart,
    weekEnd,
    items = [],
) {
    return {
        summaryVersion: MISSION_TEACHER_MAIN_SUMMARY_VERSION,
        classId,
        weekKey,
        weekStartAt: weekStart || null,
        weekEndAt: weekEnd || null,
        items: [...items].sort(sortTeacherSummaryMissions),
        updatedAt: FieldValue.serverTimestamp(),
    };
}

function buildTeacherMissionMainSummaryState(
    classId,
    missionDocs = [],
    options = {},
) {
    const weekMap = new Map();
    const alwaysMissions = [];

    missionDocs.forEach((missionDoc) => {
        const missionId = missionDoc.id;
        const mission = typeof missionDoc.data === "function" ?
            (missionDoc.data() || {}) :
            (missionDoc || {});
        const summaryItem = buildTeacherMissionSummaryItem(
            classId,
            missionId,
            mission,
            options,
        );

        if (summaryItem.type === "always") {
            alwaysMissions.push(summaryItem);
            return;
        }

        const weekWindow = getTeacherMissionMainWeekWindow(mission);
        if (!weekWindow) return;

        const existingWeek = weekMap.get(weekWindow.weekKey) || {
            weekKey: weekWindow.weekKey,
            weekStart: weekWindow.weekStart,
            weekEnd: weekWindow.weekEnd,
            items: [],
        };
        existingWeek.items.push(summaryItem);
        weekMap.set(weekWindow.weekKey, existingWeek);
    });

    const weeks = [...weekMap.values()]
        .map((week) => ({
            ...week,
            items: [...week.items].sort(sortTeacherSummaryMissions),
        }))
        .sort((left, right) => toMillis(right.weekStart) - toMillis(left.weekStart));

    return {
        alwaysMissions: [...alwaysMissions].sort(sortTeacherAlwaysSummaryMissions),
        weeks,
    };
}

function createTeacherMissionMainSummaryMetaWrite(classId, summaryState = {}) {
    return {
        ref: db.doc(TEACHER_DASHBOARD_MISSION_MAIN_DOC_PATH(classId)),
        data: {
            summaryVersion: MISSION_TEACHER_MAIN_SUMMARY_VERSION,
            weekStartsOn: "monday",
            alwaysMissions: Array.isArray(summaryState?.alwaysMissions) ?
                summaryState.alwaysMissions :
                [],
            updatedAt: FieldValue.serverTimestamp(),
        },
        options: { merge: true },
    };
}

function createTeacherMissionMainWeekWrite(classId, weekState = {}) {
    return {
        ref: db.doc(TEACHER_DASHBOARD_MISSION_MAIN_WEEK_DOC_PATH(classId, weekState.weekKey)),
        data: createTeacherMissionMainWeekDocData(
            classId,
            weekState.weekKey,
            weekState.weekStart,
            weekState.weekEnd,
            weekState.items,
        ),
        options: { merge: true },
    };
}

function getTeacherMissionStatsWeekWindow(value) {
    const basisDate = toDateSafe(value);
    if (!basisDate) return null;

    const basisDayStart = startOfDayInKST(basisDate);
    const kstWeekDay = new Date(basisDayStart.getTime() + (9 * 60 * 60 * 1000)).getUTCDay();
    const weekOffset = (kstWeekDay + 6) % 7;
    const weekStart = addCalendarDaysInKST(basisDayStart, -weekOffset);
    const weekEnd = addCalendarDaysInKST(weekStart, 6);

    return {
        weekKey: formatDateKeyInKST(weekStart),
        weekStart,
        weekEnd,
    };
}

function sortTeacherMissionStatsFocusItems(left, right) {
    const approvedDiff = Number(right?.approvedCount || 0) - Number(left?.approvedCount || 0);
    if (approvedDiff) return approvedDiff;

    const assignedDiff = Number(right?.assignedCount || 0) - Number(left?.assignedCount || 0);
    if (assignedDiff) return assignedDiff;

    const latestDiff = toMillis(right?.latestAt) - toMillis(left?.latestAt);
    if (latestDiff) return latestDiff;

    return String(left?.title || "").localeCompare(String(right?.title || ""), "ko");
}

function createEmptyTeacherMissionStatsStudentEntry() {
    return {
        general: {
            focusItems: [],
        },
    };
}

function sanitizeTeacherMissionStatsFocusItem(item = {}) {
    const latestAt = toDateSafe(item?.latestAt);
    return {
        missionId: String(item?.missionId || "").trim(),
        title: String(item?.title || "").trim() || "미션",
        approvedCount: Number(item?.approvedCount || 0),
        assignedCount: Number(item?.assignedCount || 0),
        latestAt: latestAt || null,
    };
}

function sanitizeTeacherMissionStatsStudentEntry(entry = {}) {
    const focusItems = Array.isArray(entry?.general?.focusItems) ?
        entry.general.focusItems
            .map((item) => sanitizeTeacherMissionStatsFocusItem(item))
            .filter((item) => item.missionId && item.latestAt) :
        [];

    if (!focusItems.length) return null;

    return {
        general: {
            focusItems: focusItems.sort(sortTeacherMissionStatsFocusItems),
        },
    };
}

function createTeacherMissionStatsWeekDocData(
    classId,
    weekKey,
    weekStart,
    weekEnd,
    students = {},
) {
    return {
        summaryVersion: MISSION_TEACHER_STATS_SUMMARY_VERSION,
        classId,
        weekKey,
        weekStartAt: weekStart || null,
        weekEndAt: weekEnd || null,
        students,
        updatedAt: FieldValue.serverTimestamp(),
    };
}

function getTeacherGeneralMissionStatus(mission = {}, studentUid) {
    const completion = mission?.completions?.[studentUid];
    const status = completion?.status;
    if (!status) return "not_submitted";
    if (status === "approved" && completion?.late === true) {
        return "late-approved";
    }
    return status;
}

function pickLatestMissionStatTimestamp(...values) {
    return values.reduce(
        (latest, value) => getLatestTimestamp(latest, value),
        null,
    );
}

function getTeacherGeneralMissionLatestAt(mission = {}, studentUid) {
    const completion = mission?.completions?.[studentUid];
    const lastAttempt = mission?.lastAttempts?.[studentUid];

    return pickLatestMissionStatTimestamp(
        completion?.approvedAtMs,
        completion?.approvedAt,
        completion?.updatedAtMs,
        completion?.updatedAt,
        completion?.completedAtMs,
        completion?.completedAt,
        completion?.submittedAtMs,
        completion?.submittedAt,
        completion?.createdAtMs,
        completion?.createdAt,
        lastAttempt?.approvedAtMs,
        lastAttempt?.approvedAt,
    );
}

function buildTeacherMissionStatsFocusItem(
    missionId,
    mission = {},
    studentUid,
    studentData = {},
) {
    if (
        isAlwaysMission(mission) ||
        !isMissionEligibleForStudent(mission, studentUid, studentData)
    ) {
        return null;
    }

    const latestAt = getTeacherGeneralMissionLatestAt(mission, studentUid);
    if (!latestAt) return null;

    const weekWindow = getTeacherMissionStatsWeekWindow(latestAt);
    if (!weekWindow) return null;

    const status = getTeacherGeneralMissionStatus(mission, studentUid);
    const approvedCount = MISSION_COMPLETED_STATUSES.has(status) ? 1 : 0;

    return {
        weekKey: weekWindow.weekKey,
        weekStart: weekWindow.weekStart,
        weekEnd: weekWindow.weekEnd,
        studentUid,
        focusItem: {
            missionId,
            title: getDashboardMissionTitle(mission),
            approvedCount,
            assignedCount: 1,
            latestAt,
        },
    };
}

function buildTeacherMissionStatsSummaryState(students = [], missionDocs = []) {
    const weekMap = new Map();

    missionDocs.forEach((missionDoc) => {
        const missionId = missionDoc.id;
        const mission = typeof missionDoc.data === "function" ?
            (missionDoc.data() || {}) :
            (missionDoc || {});

        students.forEach(({ uid, data }) => {
            const contribution = buildTeacherMissionStatsFocusItem(
                missionId,
                mission,
                uid,
                data || {},
            );
            if (!contribution) return;

            const weekState = weekMap.get(contribution.weekKey) || {
                weekKey: contribution.weekKey,
                weekStart: contribution.weekStart,
                weekEnd: contribution.weekEnd,
                students: {},
            };
            const nextStudentEntry =
                weekState.students[uid] || createEmptyTeacherMissionStatsStudentEntry();

            nextStudentEntry.general.focusItems = [
                ...(nextStudentEntry.general.focusItems || []),
                contribution.focusItem,
            ].sort(sortTeacherMissionStatsFocusItems);

            weekState.students[uid] = nextStudentEntry;
            weekMap.set(contribution.weekKey, weekState);
        });
    });

    return [...weekMap.values()]
        .map((weekState) => ({
            ...weekState,
            students: Object.entries(weekState.students || {})
                .reduce((acc, [studentUid, studentEntry]) => {
                    const sanitizedEntry = sanitizeTeacherMissionStatsStudentEntry(studentEntry);
                    if (sanitizedEntry) {
                        acc[studentUid] = sanitizedEntry;
                    }
                    return acc;
                }, {}),
        }))
        .filter((weekState) => Object.keys(weekState.students || {}).length > 0)
        .sort((left, right) => toMillis(right.weekStart) - toMillis(left.weekStart));
}

function createTeacherMissionStatsWeekWrite(classId, weekState = {}) {
    return {
        ref: db.doc(TEACHER_DASHBOARD_MISSION_STATS_WEEK_DOC_PATH(classId, weekState.weekKey)),
        data: createTeacherMissionStatsWeekDocData(
            classId,
            weekState.weekKey,
            weekState.weekStart,
            weekState.weekEnd,
            weekState.students || {},
        ),
        options: { merge: true },
    };
}

async function cleanupTeacherMissionStatsWeeks(classId, weekKeys = [], guard = null) {
    const activeWeekKeys = new Set((weekKeys || []).filter(Boolean));
    const weekSnap = await db
        .collection(TEACHER_DASHBOARD_MISSION_STATS_WEEK_COLLECTION_PATH(classId))
        .get();

    const staleRefs = weekSnap.docs
        .filter((docSnap) => !activeWeekKeys.has(docSnap.id))
        .map((docSnap) => docSnap.ref);

    if (!staleRefs.length) return;

    for (let index = 0; index < staleRefs.length; index += 400) {
        if (guard) {
            await db.runTransaction(async (tx) => {
                await guard(tx);
                staleRefs.slice(index, index + 400).forEach((ref) => tx.delete(ref));
            });
            continue;
        }
        const batch = db.batch();
        staleRefs.slice(index, index + 400).forEach((ref) => batch.delete(ref));
        await batch.commit();
    }
}

function upsertTeacherMissionStatsFocusItems(items = [], focusItem = null) {
    const nextItems = (items || [])
        .map((item) => sanitizeTeacherMissionStatsFocusItem(item))
        .filter((item) => item.missionId && item.latestAt);

    if (focusItem?.missionId) {
        nextItems.push(sanitizeTeacherMissionStatsFocusItem(focusItem));
    }

    return nextItems
        .filter((item) => item.missionId && item.latestAt)
        .sort(sortTeacherMissionStatsFocusItems);
}

async function syncTeacherMissionStatsSummaryItem(
    classId,
    missionId,
    beforeMission = null,
    afterMission = null,
    affectedStudents = [],
) {
    if (!classId || !missionId || !affectedStudents.length) return;

    const contributionStates = affectedStudents.map(({ uid, data }) => ({
        uid,
        beforeContribution: beforeMission ?
            buildTeacherMissionStatsFocusItem(missionId, beforeMission, uid, data || {}) :
            null,
        afterContribution: afterMission ?
            buildTeacherMissionStatsFocusItem(missionId, afterMission, uid, data || {}) :
            null,
    }));

    const weekRefs = new Map();
    contributionStates.forEach(({ beforeContribution, afterContribution }) => {
        if (beforeContribution?.weekKey) {
            weekRefs.set(
                beforeContribution.weekKey,
                db.doc(
                    TEACHER_DASHBOARD_MISSION_STATS_WEEK_DOC_PATH(
                        classId,
                        beforeContribution.weekKey,
                    ),
                ),
            );
        }
        if (afterContribution?.weekKey) {
            weekRefs.set(
                afterContribution.weekKey,
                db.doc(
                    TEACHER_DASHBOARD_MISSION_STATS_WEEK_DOC_PATH(
                        classId,
                        afterContribution.weekKey,
                    ),
                ),
            );
        }
    });

    if (!weekRefs.size) return;

    await db.runTransaction(async (tx) => {
        await guardCanonicalMissionProjection(tx, db, classId, missionId, afterMission);
        const weekEntries = [...weekRefs.entries()];
        const weekSnaps = await Promise.all(
            weekEntries.map(([, weekRef]) => tx.get(weekRef)),
        );
        const weekSnapByKey = new Map(
            weekEntries.map(([weekKey], index) => [weekKey, weekSnaps[index]]),
        );

        for (const [weekKey, weekRef] of weekEntries) {
            const weekSnap = weekSnapByKey.get(weekKey);
            const currentStudents =
                weekSnap.exists && weekSnap.data()?.students &&
                typeof weekSnap.data().students === "object" ?
                    { ...weekSnap.data().students } :
                    {};

            contributionStates.forEach(({ uid, beforeContribution, afterContribution }) => {
                if (
                    beforeContribution?.weekKey !== weekKey &&
                    afterContribution?.weekKey !== weekKey
                ) {
                    return;
                }

                const currentEntry = sanitizeTeacherMissionStatsStudentEntry(
                    currentStudents[uid] || createEmptyTeacherMissionStatsStudentEntry(),
                ) || createEmptyTeacherMissionStatsStudentEntry();
                let focusItems = Array.isArray(currentEntry?.general?.focusItems) ?
                    [...currentEntry.general.focusItems] :
                    [];

                if (beforeContribution?.weekKey === weekKey) {
                    focusItems = focusItems.filter(
                        (item) => item?.missionId !== missionId,
                    );
                }

                if (afterContribution?.weekKey === weekKey) {
                    focusItems = focusItems.filter((item) => item?.missionId !== missionId);
                    focusItems = upsertTeacherMissionStatsFocusItems(
                        focusItems,
                        afterContribution.focusItem,
                    );
                } else {
                    focusItems = focusItems.sort(sortTeacherMissionStatsFocusItems);
                }

                if (!focusItems.length) {
                    delete currentStudents[uid];
                    return;
                }

                currentStudents[uid] = {
                    general: {
                        focusItems,
                    },
                };
            });

            const studentEntries = Object.entries(currentStudents || {})
                .reduce((acc, [studentUid, studentEntry]) => {
                    const sanitizedEntry = sanitizeTeacherMissionStatsStudentEntry(studentEntry);
                    if (sanitizedEntry) {
                        acc[studentUid] = sanitizedEntry;
                    }
                    return acc;
                }, {});

            if (!Object.keys(studentEntries).length) {
                tx.delete(weekRef);
                continue;
            }

            const weekWindow = contributionStates
                .map(({ beforeContribution, afterContribution }) =>
                    afterContribution?.weekKey === weekKey ?
                        afterContribution :
                        (beforeContribution?.weekKey === weekKey ? beforeContribution : null),
                )
                .find(Boolean);

            tx.set(
                weekRef,
                createTeacherMissionStatsWeekDocData(
                    classId,
                    weekKey,
                    weekWindow?.weekStart || null,
                    weekWindow?.weekEnd || null,
                    studentEntries,
                ),
                { merge: true },
            );
        }
    });
}

async function cleanupTeacherMissionMainWeeks(classId, weekKeys = [], guard = null) {
    const activeWeekKeys = new Set((weekKeys || []).filter(Boolean));
    const weekSnap = await db
        .collection(TEACHER_DASHBOARD_MISSION_MAIN_WEEK_COLLECTION_PATH(classId))
        .get();

    const staleRefs = weekSnap.docs
        .filter((docSnap) => !activeWeekKeys.has(docSnap.id))
        .map((docSnap) => docSnap.ref);

    if (!staleRefs.length) return;

    for (let index = 0; index < staleRefs.length; index += 400) {
        if (guard) {
            await db.runTransaction(async (tx) => {
                await guard(tx);
                staleRefs.slice(index, index + 400).forEach((ref) => tx.delete(ref));
            });
            continue;
        }
        const batch = db.batch();
        staleRefs.slice(index, index + 400).forEach((ref) => batch.delete(ref));
        await batch.commit();
    }
}

async function cleanupTeacherMissionStatuses(classId, missionIds = [], guard = null) {
    const activeMissionIds = new Set((missionIds || []).filter(Boolean));
    const statusSnap = await db
        .collection(TEACHER_DASHBOARD_MISSION_STATUS_COLLECTION_PATH(classId))
        .get();
    const staleRefs = statusSnap.docs
        .filter((docSnap) => !activeMissionIds.has(docSnap.id))
        .map((docSnap) => docSnap.ref);

    if (!staleRefs.length) return;

    for (let index = 0; index < staleRefs.length; index += 400) {
        if (guard) {
            await db.runTransaction(async (tx) => {
                await guard(tx);
                staleRefs.slice(index, index + 400).forEach((ref) => tx.delete(ref));
            });
            continue;
        }
        const batch = db.batch();
        staleRefs.slice(index, index + 400).forEach((ref) => batch.delete(ref));
        await batch.commit();
    }
}

async function syncTeacherMissionMainSummaryItem(
    classId,
    missionId,
    beforeMission = null,
    afterMission = null,
) {
    if (!classId || !missionId) return;

    const mainRef = db.doc(TEACHER_DASHBOARD_MISSION_MAIN_DOC_PATH(classId));
    const statusRef = db.doc(
        TEACHER_DASHBOARD_MISSION_STATUS_DOC_PATH(classId, missionId),
    );
    const beforeWeekWindow = beforeMission ? getTeacherMissionMainWeekWindow(beforeMission) : null;
    const afterWeekWindow = afterMission ? getTeacherMissionMainWeekWindow(afterMission) : null;
    const weekRefs = new Map();

    if (beforeWeekWindow?.weekKey) {
        weekRefs.set(
            beforeWeekWindow.weekKey,
            db.doc(TEACHER_DASHBOARD_MISSION_MAIN_WEEK_DOC_PATH(classId, beforeWeekWindow.weekKey)),
        );
    }
    if (afterWeekWindow?.weekKey) {
        weekRefs.set(
            afterWeekWindow.weekKey,
            db.doc(TEACHER_DASHBOARD_MISSION_MAIN_WEEK_DOC_PATH(classId, afterWeekWindow.weekKey)),
        );
    }

    await db.runTransaction(async (tx) => {
        await guardCanonicalMissionProjection(tx, db, classId, missionId, afterMission);
        const weekEntries = [...weekRefs.entries()];
        const [mainSnap, ...weekSnaps] = await Promise.all([
            tx.get(mainRef),
            ...weekEntries.map(([, weekRef]) => tx.get(weekRef)),
        ]);
        const weekSnapByKey = new Map(
            weekEntries.map(([weekKey], index) => [weekKey, weekSnaps[index]]),
        );
        const currentMain = mainSnap.data() || {};
        const usesDetachedStatus =
            currentMain?.statusSummaryMode ===
            MISSION_TEACHER_STATUS_MODE_DETACHED;

        if (afterMission) {
            tx.set(
                statusRef,
                createTeacherMissionStatusDocData(
                    classId,
                    missionId,
                    afterMission,
                ),
            );
        } else {
            tx.delete(statusRef);
        }

        if (usesDetachedStatus) return;

        let alwaysMissions = Array.isArray(currentMain?.alwaysMissions) ?
            [...currentMain.alwaysMissions] :
            [];

        if (beforeMission && isAlwaysMission(beforeMission)) {
            alwaysMissions = alwaysMissions.filter((item) => item?.id !== missionId);
        }
        if (afterMission && isAlwaysMission(afterMission)) {
            const nextAlwaysItem = buildTeacherMissionSummaryItem(classId, missionId, afterMission);
            alwaysMissions = [
                ...alwaysMissions.filter((item) => item?.id !== missionId),
                nextAlwaysItem,
            ].sort(sortTeacherAlwaysSummaryMissions);
        }

        tx.set(
            mainRef,
            {
                summaryVersion: MISSION_TEACHER_MAIN_SUMMARY_VERSION,
                weekStartsOn: "monday",
                alwaysMissions,
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );

        for (const [weekKey, weekRef] of weekEntries) {
            const weekSnap = weekSnapByKey.get(weekKey);
            const currentItems = Array.isArray(weekSnap.data()?.items) ?
                [...weekSnap.data().items] :
                [];
            let nextItems = currentItems.filter((item) => item?.id !== missionId);

            if (
                afterMission &&
                afterWeekWindow?.weekKey === weekKey &&
                !isAlwaysMission(afterMission)
            ) {
                nextItems.push(buildTeacherMissionSummaryItem(classId, missionId, afterMission));
            }

            if (!nextItems.length) {
                tx.delete(weekRef);
                continue;
            }

            const weekWindow =
                (afterWeekWindow?.weekKey === weekKey && afterWeekWindow) ||
                (beforeWeekWindow?.weekKey === weekKey && beforeWeekWindow);
            tx.set(
                weekRef,
                createTeacherMissionMainWeekDocData(
                    classId,
                    weekKey,
                    weekWindow?.weekStart || null,
                    weekWindow?.weekEnd || null,
                    nextItems,
                ),
                { merge: true },
            );
        }
    });
}

function getDashboardRegularMissionCutoff(now = new Date()) {
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - DASHBOARD_REGULAR_MISSION_WINDOW_DAYS);
    return cutoff;
}

function shouldIncludeDashboardRegularMission(mission, cutoff, now) {
    if (!mission || isAlwaysMission(mission)) return false;

    const start = toDateSafe(mission?.timeWindow?.start ?? mission?.startDate);
    const end = toDateSafe(mission?.timeWindow?.end ?? mission?.endDate);

    if (start && start >= cutoff) return true;
    if (end && end >= now) return true;
    if (!end) return true;
    if (toMillis(mission?.updatedAt) >= cutoff.getTime()) return true;
    if (toMillis(mission?.createdAt) >= cutoff.getTime()) return true;

    return false;
}

function createEmptyDashboardMissionSummary() {
    return {
        summaryVersion: MISSION_DASHBOARD_SUMMARY_VERSION,
        regularTotal: 0,
        regularCompleted: 0,
        regularMissions: [],
        alwaysMissions: [],
    };
}

function appendMissionToStudentDashboardSummary(
    summary,
    missionId,
    mission,
    studentUid,
    studentData,
    cutoff,
    now,
) {
    const regularEntry = buildDashboardRegularMissionEntry(
        missionId,
        mission,
        studentUid,
        studentData,
        cutoff,
        now,
    );
    if (regularEntry) {
        summary.regularMissions.push(regularEntry);
        summary.regularTotal += 1;
        if (MISSION_COMPLETED_STATUSES.has(regularEntry.completionStatus)) {
            summary.regularCompleted += 1;
        }
        return;
    }

    const alwaysEntry = buildDashboardAlwaysMissionEntry(
        missionId,
        mission,
        studentUid,
        studentData,
    );
    if (alwaysEntry) {
        summary.alwaysMissions.push(alwaysEntry);
    }
}

function getLatestTimestamp(currentValue, nextValue) {
    const currentDate = toDateSafe(currentValue);
    const nextDate = toDateSafe(nextValue);

    if (!nextDate) {
        return currentValue || null;
    }

    if (!currentDate || nextDate.getTime() > currentDate.getTime()) {
        return nextValue;
    }

    return currentValue || null;
}

function buildStudentDashboardMissionSummary(
    missionDocs,
    studentUid,
    studentData,
    cutoff,
    now,
) {
    const summary = createEmptyDashboardMissionSummary();

    missionDocs.forEach((missionDoc) => {
        const missionId = missionDoc.id;
        const mission = typeof missionDoc.data === "function" ?
            (missionDoc.data() || {}) :
            (missionDoc || {});

        appendMissionToStudentDashboardSummary(
            summary,
            missionId,
            mission,
            studentUid,
            studentData,
            cutoff,
            now,
        );
    });

    return summary;
}

async function recomputeStudentDashboardMissionSummary(classId, studentUid) {
    if (!classId || !studentUid) {
        throw new HttpsError("invalid-argument", "classId and studentUid are required.");
    }

    const summary = await recomputeStudentMissionProjections(classId, studentUid);

    return {
        classId,
        studentUid,
        regularTotal: summary.regularTotal,
        regularCompleted: summary.regularCompleted,
    };
}

function buildDashboardRegularMissionEntry(
    missionId,
    mission,
    studentUid,
    studentData,
    cutoff,
    now,
) {
    if (
        !shouldIncludeDashboardRegularMission(mission, cutoff, now) ||
        !isMissionEligibleForStudent(mission, studentUid, studentData)
    ) {
        return null;
    }

    const completionStatus = mission?.completions?.[studentUid]?.status || null;
    const completionSummary = createDashboardMissionCompletionSummary(
        mission?.completions?.[studentUid],
    );
    const startAt = toDateSafe(mission?.timeWindow?.start ?? mission?.startDate);
    const endAt = toDateSafe(mission?.timeWindow?.end ?? mission?.endDate);

    return {
        id: missionId,
        type: typeof mission?.type === "string" ? mission.type : "mission",
        title: getDashboardMissionTitle(mission),
        description: getDashboardMissionDescription(mission),
        startAt,
        endAt,
        timeWindow: {
            start: startAt,
            end: endAt,
        },
        createdAt: mission?.createdAt || null,
        updatedAt: mission?.updatedAt || null,
        rewards: sanitizeDashboardMissionRewards(mission?.rewards),
        autoApprove: mission?.autoApprove === true,
        requireSubmissionForm: mission?.requireSubmissionForm === true,
        allowLateSubmission: mission?.allowLateSubmission !== false,
        minCreditTier: getMissionMinTierRequirement(mission),
        completionStatus,
        stateStorageVersion: mission?.stateStorageVersion || 1,
        completion: completionSummary,
        mySubmission: completionSummary ? {
            id: completionSummary.submissionId || null,
            status: completionSummary.status || null,
            feedback: completionSummary.feedback || "",
        } : null,
    };
}

function buildDashboardAlwaysMissionEntry(
    missionId,
    mission,
    studentUid,
    studentData,
) {
    if (
        !isAlwaysMission(mission) ||
        !isMissionEligibleForStudent(mission, studentUid, studentData) ||
        !isMissionVisibleToStudent(mission)
    ) {
        return null;
    }

    return {
        id: missionId,
        type: "always",
        title: getDashboardMissionTitle(mission),
        description: getDashboardMissionDescription(mission),
        isActive: typeof mission?.isActive === "boolean" ? mission.isActive : true,
        availability: sanitizeAlwaysMissionAvailability(mission?.availability),
        autoApprove: mission?.autoApprove === true,
        requireSubmissionForm: mission?.requireSubmissionForm === true,
        rewards: sanitizeDashboardMissionRewards(mission?.rewards),
        createdAt: mission?.createdAt || null,
        updatedAt: mission?.updatedAt || null,
        displayOrder: Number.isFinite(Number(mission?.displayOrder)) ?
            Number(mission.displayOrder) :
            null,
        maxPerDay: Number.isFinite(Number(mission?.availability?.maxPerDay)) ?
            Number(mission.availability.maxPerDay) :
            (Number.isFinite(Number(mission?.maxPerDay)) ?
                Number(mission.maxPerDay) :
                null),
        minCreditTier: getMissionMinTierRequirement(mission),
    };
}

async function commitChunkedSetWrites(writes, chunkSize = 400) {
    for (let i = 0; i < writes.length; i += chunkSize) {
        const batch = db.batch();
        writes.slice(i, i + chunkSize).forEach(({ ref, data, options }) => {
            if (options) {
                batch.set(ref, data, options);
                return;
            }
            batch.set(ref, data);
        });
        await batch.commit();
    }
}

function canStudentSubmitMission(mission, studentUid, studentData, now) {
    if (!mission || !studentUid) return false;
    if (mission.type === "always") return false;

    const completion = mission.completions?.[studentUid];
    const status = completion?.status;
    const canResubmit =
        !status ||
        status === "not_submitted" ||
        MISSION_RESUBMIT_ALLOWED_STATUSES.has(status);
    if (!canResubmit) return false;

    if (!isMissionEligibleForStudent(mission, studentUid, studentData)) {
        return false;
    }

    const start = toDateSafe(mission?.timeWindow?.start ?? mission?.startDate);
    if (start && now < start) return false;

    return true;
}

function isMissionSummaryStudentParticipant(studentData = {}) {
    const role = studentData?.role;
    return role !== "teacher" && role !== "admin";
}

function isMissionDashboardParticipant(studentData = {}) {
    return studentData?.role !== "admin";
}

function serializeComparableValue(value) {
    if (value === null || value === undefined) return value;
    if (typeof value?.toDate === "function") return toMillis(value);
    if (value instanceof Date) return value.getTime();

    if (Array.isArray(value)) {
        return value.map((entry) => serializeComparableValue(entry));
    }

    if (typeof value === "object") {
        return Object.keys(value)
            .sort()
            .reduce((acc, key) => {
                acc[key] = serializeComparableValue(value[key]);
                return acc;
            }, {});
    }

    return value;
}

function getMissionStructuralComparableData(missionData = {}) {
    return serializeComparableValue(getMissionStructuralFields(missionData));
}

function hasMissionStructuralChanges(beforeData = {}, afterData = {}) {
    return JSON.stringify(getMissionStructuralComparableData(beforeData)) !==
        JSON.stringify(getMissionStructuralComparableData(afterData));
}

function getMissionCompletionStatus(completion) {
    const status = completion?.status;
    return typeof status === "string" ? status : null;
}

function getChangedMissionCompletionStudentUids(beforeData = {}, afterData = {}) {
    const beforeCompletions = beforeData?.completions || {};
    const afterCompletions = afterData?.completions || {};
    const studentUids = new Set([
        ...Object.keys(beforeCompletions),
        ...Object.keys(afterCompletions),
    ]);

    return [...studentUids].filter((studentUid) =>
        getMissionCompletionStatus(beforeCompletions[studentUid]) !==
        getMissionCompletionStatus(afterCompletions[studentUid]),
    );
}

function getChangedMissionStatsStudentUids(beforeData = {}, afterData = {}) {
    const beforeCompletions = beforeData?.completions || {};
    const afterCompletions = afterData?.completions || {};
    const beforeSubmissionsIndex = beforeData?.submissionsIndex || {};
    const afterSubmissionsIndex = afterData?.submissionsIndex || {};
    const studentUids = new Set([
        ...Object.keys(beforeCompletions),
        ...Object.keys(afterCompletions),
        ...Object.keys(beforeSubmissionsIndex),
        ...Object.keys(afterSubmissionsIndex),
    ]);

    return [...studentUids].filter((studentUid) =>
        JSON.stringify(
            serializeComparableValue({
                completion: beforeCompletions[studentUid] || null,
                submissionId: beforeSubmissionsIndex[studentUid] || null,
            }),
        ) !== JSON.stringify(
            serializeComparableValue({
                completion: afterCompletions[studentUid] || null,
                submissionId: afterSubmissionsIndex[studentUid] || null,
            }),
        ),
    );
}

function hasMissionSubmissionIndexChanges(beforeData = {}, afterData = {}) {
    return JSON.stringify(
        serializeComparableValue(beforeData?.submissionsIndex || {}),
    ) !== JSON.stringify(
        serializeComparableValue(afterData?.submissionsIndex || {}),
    );
}

function hasMissionStudentStructuralChanges(beforeData = {}, afterData = {}) {
    return hasMissionStudentEligibilityChanged(beforeData, afterData);
}

function createMissionDashboardSummaryWrite(classId, studentUid, summary, { directList = false } = {}) {
    if (directList) summary = compactHomeMissionSummary(summary);
    return {
        ref: db.doc(STUDENT_DASHBOARD_MISSION_SUMMARY_DOC_PATH(classId, studentUid)),
        data: {
            summaryVersion: MISSION_DASHBOARD_SUMMARY_VERSION,
            listReaderVersion: directList ? 3 : 2,
            regularTotal: Number(summary?.regularTotal || 0),
            regularCompleted: Number(summary?.regularCompleted || 0),
            regularMissions: Array.isArray(summary?.regularMissions) ?
                summary.regularMissions :
                [],
            alwaysMissions: Array.isArray(summary?.alwaysMissions) ?
                summary.alwaysMissions :
                [],
            updatedAt: FieldValue.serverTimestamp(),
        },
    };
}

async function recomputeStudentDashboardMissionSummariesForStudents(
    classId,
    students = [],
    { missionDocs: providedMissionDocs = null, now: providedNow = null } = {},
) {
    const normalizedStudents = students.filter(({ uid }) => Boolean(uid));
    if (!normalizedStudents.length) return;

    const missionDocs = Array.isArray(providedMissionDocs) ?
        providedMissionDocs :
        (await db.collection(`classes/${classId}/missions`).get()).docs;
    const resolvedMissionDocs = await readMissionDocsStudentStates(db, missionDocs, {
        studentUids: normalizedStudents.map(({ uid }) => uid),
    });
    const now = providedNow || new Date();
    const directList = usesDirectMissionList((await db.doc(`classes/${classId}`).get()).data());
    const cutoff = getDashboardRegularMissionCutoff(now);

    const writes = normalizedStudents.map(({ uid, data }) => {
        if (!isMissionDashboardParticipant(data)) {
            return createMissionDashboardSummaryWrite(
                classId,
                uid,
                createEmptyDashboardMissionSummary(),
                { directList },
            );
        }

        const summary = buildStudentDashboardMissionSummary(
            resolvedMissionDocs,
            uid,
            data || {},
            cutoff,
            now,
        );
        return createMissionDashboardSummaryWrite(classId, uid, summary, { directList });
    });

    await commitChunkedSetWrites(writes);
}

async function syncCanonicalStudentMissionProjection(classId, missionId, studentUid) {
    return db.runTransaction(async (tx) => {
        const missionRef = db.doc(`classes/${classId}/missions/${missionId}`);
        const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
        const summaryRef = db.doc(STUDENT_DASHBOARD_MISSION_SUMMARY_DOC_PATH(classId, studentUid));
        const actionRef = db.doc(getNotificationStateMainDocPath(classId, studentUid));
        const [missionSnap, studentSnap, summarySnap, actionSnap, classSnap] = await tx.getAll(missionRef, studentRef, summaryRef, actionRef, db.doc(`classes/${classId}`));
        const directList = usesDirectMissionList(classSnap.data());
        if (!studentSnap.exists) return true;
        if (!missionSnap.exists || missionSnap.data()?.stateStorageVersion !== 2) return false;
        const summary = summarySnap.data() || {};
        const oldEntries = Array.isArray(summary.regularMissions) ? summary.regularMissions : [];
        const previousEntry = oldEntries.find((entry) => entry.id === missionId);
        if (summary.summaryVersion !== MISSION_DASHBOARD_SUMMARY_VERSION || !previousEntry || !actionSnap.exists) return false;
        const student = studentSnap.data();
        const mission = await readMissionStudentStates(db, missionRef, missionSnap.data(), { tx, studentUids: [studentUid] });
        const oldMission = { ...mission, completions: { [studentUid]: previousEntry.completion || null } };
        const now = new Date();
        const oldCanSubmit = isMissionSummaryStudentParticipant(student) && canStudentSubmitMission(oldMission, studentUid, student, now);
        const newCanSubmit = isMissionSummaryStudentParticipant(student) && canStudentSubmitMission(mission, studentUid, student, now);
        const entry = buildDashboardRegularMissionEntry(missionId, mission, studentUid, student, getDashboardRegularMissionCutoff(now), now);
        const nextEntries = oldEntries.filter((current) => current.id !== missionId);
        if (entry) nextEntries.push(entry);
        const nextSummary = {
            ...summary, regularMissions: nextEntries, regularTotal: nextEntries.length,
            regularCompleted: nextEntries.filter((current) => MISSION_COMPLETED_STATUSES.has(current.completionStatus)).length,
        };
        const sameHomePayload = directList && summary.listReaderVersion === 3 &&
            JSON.stringify(serializeStateValue(compactHomeMissionSummary(summary))) ===
            JSON.stringify(serializeStateValue(compactHomeMissionSummary(nextSummary)));
        if (!sameHomePayload) tx.set(summaryRef,
            createMissionDashboardSummaryWrite(classId, studentUid, nextSummary, { directList }).data, { merge: true });
        tx.set(actionRef, createNotificationStateMainActionPatch({
            actionKey: "missions", updatedAt: FieldValue.serverTimestamp(),
            count: Math.max(0, Number(actionSnap.data()?.actions?.missions || 0) + Number(newCanSubmit) - Number(oldCanSubmit)),
        }), { merge: true });
        return true;
    });
}

async function incrementMissionNotificationSummary(
    classId,
    missionId = "",
    beforeMissionData = null,
    afterMissionData = null,
    { projectionMissionData = null } = {},
) {
    if (!classId) return;

    beforeMissionData = beforeMissionData ? normalizeMissionStateFields(beforeMissionData) : null;
    afterMissionData = afterMissionData ? normalizeMissionStateFields(afterMissionData) : null;

    if (!beforeMissionData || !afterMissionData) {
        await recomputeMissionNotificationSummary(classId);
        return;
    }

    if (hasMissionStructuralChanges(beforeMissionData, afterMissionData)) {
        await recomputeMissionNotificationSummary(classId);
        return;
    }

    const teacherPendingDelta =
        getTeacherPendingCountForMission(afterMissionData) -
        getTeacherPendingCountForMission(beforeMissionData);
    const affectedCompletionStudentUids = getChangedMissionCompletionStudentUids(
        beforeMissionData,
        afterMissionData,
    );
    const affectedStatsStudentUids = getChangedMissionStatsStudentUids(
        beforeMissionData,
        afterMissionData,
    );
    const hasSubmissionIndexChanges = hasMissionSubmissionIndexChanges(
        beforeMissionData,
        afterMissionData,
    );
    const hasTeacherStatusSummaryChanges =
        hasTeacherMissionStatusSummaryChanges(
            beforeMissionData,
            afterMissionData,
        );
    const affectedStudentUids = [
        ...new Set([
            ...affectedCompletionStudentUids,
            ...affectedStatsStudentUids,
        ]),
    ];

    const hasNotificationSummaryChanges = Boolean(
        teacherPendingDelta ||
        affectedStudentUids.length ||
        hasSubmissionIndexChanges
    );

    if (!hasNotificationSummaryChanges && !hasTeacherStatusSummaryChanges) {
        return;
    }

    const studentSnaps = await Promise.all(
        affectedStudentUids.map((studentUid) =>
            db.doc(`classes/${classId}/students/${studentUid}`).get(),
        ),
    );
    const affectedStudents = studentSnaps
        .filter((studentSnap) => studentSnap.exists)
        .map((studentSnap) => ({
            uid: studentSnap.id,
            data: studentSnap.data() || {},
        }));
    const affectedStatsStudents = affectedStudents.filter(({ data }) =>
        isMissionSummaryStudentParticipant(data),
    );

    if (hasNotificationSummaryChanges) {
        const summaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.missions));
        await db.runTransaction(async (tx) => {
            const summarySnap = await tx.get(summaryRef);
            if (!summarySnap.exists || !summarySnap.data()?.teacherPendingByMission) {
                throw new HttpsError("not-found", "Mission summary is missing.");
            }
            const summary = summarySnap.data() || {};
            const missionRef = db.doc(`classes/${classId}/missions/${missionId}`);
            const missionSnap = await tx.get(missionRef);
            const current = missionSnap.exists ? await readMissionStudentStates(db, missionRef, missionSnap.data(), { tx }) : null;
            // Store each mission's current contribution, rather than applying
            // event deltas. Retries, reversed delivery and full rebuilds can
            // then converge without double counting queued changes.
            const teacherPendingByMission = { ...summary.teacherPendingByMission };
            const pending = getTeacherPendingCountForMission(current);
            if (pending) teacherPendingByMission[missionId] = pending;
            else delete teacherPendingByMission[missionId];
            const teacherPendingCount = Object.values(teacherPendingByMission).reduce((total, count) => total + Number(count || 0), 0);

            tx.set(
                summaryRef,
                {
                    teacherPendingCount,
                    teacherPendingByMission,
                    teacherPendingBalance: FieldValue.delete(),
                    hasTeacherPending: teacherPendingCount > 0,
                    studentSubmitCounts: FieldValue.delete(),
                    hasStudentSubmit: FieldValue.delete(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );
        }).catch(async (error) => {
            if (error instanceof HttpsError && error.code === "not-found") {
                await recomputeMissionNotificationSummary(classId);
                return;
            }
            throw error;
        });
    }

    const remainingStudents = projectionMissionData?.stateStorageVersion === 2 ?
        (await Promise.all(affectedStudents.map(async (student) =>
            await syncCanonicalStudentMissionProjection(classId, missionId, student.uid) ? null : student))).filter(Boolean) : affectedStudents;
    if (remainingStudents.length) {
        if (projectionMissionData?.stateStorageVersion === 2) {
            await recomputeMissionNotificationSummary(classId);
            return;
        }
        const missionDocs = (
            await db.collection(`classes/${classId}/missions`).get()
        ).docs;
        await Promise.all([
            recomputeStudentDashboardMissionSummariesForStudents(
                classId,
                remainingStudents,
                { missionDocs },
            ),
            recomputeStudentMissionActionCountsForStudents(
                classId,
                remainingStudents,
                { missionDocs },
            ),
        ]);
    }

    if (missionId && hasTeacherStatusSummaryChanges && !usesDirectMissionList((await db.doc(`classes/${classId}`).get()).data())) {
        await syncTeacherMissionMainSummaryItem(
            classId,
            missionId,
            beforeMissionData,
            projectionMissionData || afterMissionData,
        );
    }
    if (missionId && affectedStatsStudents.length) {
        await syncTeacherMissionStatsSummaryItem(
            classId,
            missionId,
            beforeMissionData,
            projectionMissionData || afterMissionData,
            affectedStatsStudents,
        );
    }
}

async function recomputeMissionNotificationSummary(classId, options = {}) {
    if (!classId) return;

    const summaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.missions));
    const mainSummaryRef = db.doc(
        TEACHER_DASHBOARD_MISSION_MAIN_DOC_PATH(classId),
    );
    const studentsRef = db.collection(`classes/${classId}/students`);
    const missionsRef = db.collection(`classes/${classId}/missions`);

    const [studentSnap, missionSnap, mainSummarySnap, classSnap] = await Promise.all([
        studentsRef.get(),
        missionsRef.get(),
        mainSummaryRef.get(),
        db.doc(`classes/${classId}`).get(),
    ]);
    const directList = usesDirectMissionList(classSnap.data());

    const allStudents = studentSnap.docs.map((d) => ({
        uid: d.id,
        data: d.data() || {},
    }));
    const students = allStudents.filter(({ data }) => isMissionSummaryStudentParticipant(data));
    const dashboardParticipants = allStudents.filter(({ data }) =>
        isMissionDashboardParticipant(data),
    );
    const currentStatusMode = mainSummarySnap.data()?.statusSummaryMode || null;
    const includeEmbeddedStatus =
        options?.forceEmbeddedStatus === true ||
        currentStatusMode !== MISSION_TEACHER_STATUS_MODE_DETACHED;

    const studentSubmitCounts = buildZeroCountMap(allStudents);
    const studentDashboardSummaries = {};
    const teacherMainMissionDocs = [];
    for (const { uid } of dashboardParticipants) {
        studentDashboardSummaries[uid] = createEmptyDashboardMissionSummary();
    }

    const now = new Date();
    const cutoff = getDashboardRegularMissionCutoff(now);
    let teacherPendingCount = 0;
    const teacherPendingByMission = {};
    const resolvedMissionDocs = await readMissionDocsStudentStates(db, missionSnap.docs, { studentUids: allStudents.map(({ uid }) => uid) });

    resolvedMissionDocs.forEach((missionDoc) => {
        const missionId = missionDoc.id;
        const mission = missionDoc.data() || {};
        teacherMainMissionDocs.push(missionDoc);

        const pending = getTeacherPendingCountForMission(mission);
        teacherPendingCount += pending;
        if (pending) teacherPendingByMission[missionId] = pending;

        for (const { uid, data } of students) {
            if (canStudentSubmitMission(mission, uid, data, now)) {
                studentSubmitCounts[uid] = (studentSubmitCounts[uid] || 0) + 1;
            }
        }

        for (const { uid, data } of dashboardParticipants) {
            appendMissionToStudentDashboardSummary(
                studentDashboardSummaries[uid],
                missionId,
                mission,
                uid,
                data,
                cutoff,
                now,
            );
        }
    });

    const teacherMainSummaryState = buildTeacherMissionMainSummaryState(
        classId,
        teacherMainMissionDocs,
        { includeEmbeddedStatus },
    );
    const teacherStatsSummaryState = buildTeacherMissionStatsSummaryState(
        students,
        teacherMainMissionDocs,
    );
    const writes = [
        {
            ref: summaryRef,
            data: {
                teacherPendingCount,
                teacherPendingByMission,
                teacherPendingBalance: FieldValue.delete(),
                hasTeacherPending: teacherPendingCount > 0,
                studentSubmitCounts: FieldValue.delete(),
                hasStudentSubmit: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            options: { merge: true },
        },
        ...(!directList ? [createTeacherMissionMainSummaryMetaWrite(classId, teacherMainSummaryState)] : []),
        ...(directList ? [] : teacherMainSummaryState.weeks).map((weekState) =>
            createTeacherMissionMainWeekWrite(classId, weekState),
        ),
        ...(directList ? [] : teacherMainMissionDocs).map((missionDoc) =>
            createTeacherMissionStatusWrite(
                classId,
                missionDoc.id,
                missionDoc.data() || {},
            ),
        ),
        ...teacherStatsSummaryState.map((weekState) =>
            createTeacherMissionStatsWeekWrite(classId, weekState),
        ),
    ];

    dashboardParticipants.forEach(({ uid }) => {
        const summary = studentDashboardSummaries[uid] || createEmptyDashboardMissionSummary();
        writes.push({
            ...createMissionDashboardSummaryWrite(classId, uid, summary, { directList }),
        });
    });

    for (const [uid, count] of Object.entries(studentSubmitCounts)) writes.push({
        ref: db.doc(getNotificationStateMainDocPath(classId, uid)),
        data: createNotificationStateMainActionPatch({ actionKey: "missions", count, updatedAt: FieldValue.serverTimestamp() }),
        options: { merge: true },
    });
    const fingerprint = (docs) => JSON.stringify(serializeStateValue(docs.map((doc) => [doc.id, doc.data()]).sort(([a], [b]) => a.localeCompare(b))));
    const expectedMissions = fingerprint(missionSnap.docs);
    const expectedStudents = fingerprint(studentSnap.docs);
    const guardSources = async (tx) => {
        const currentMissions = await tx.get(missionsRef);
        const currentStudents = await tx.get(studentsRef);
        const currentMain = await tx.get(mainSummaryRef);
        if (fingerprint(currentMissions.docs) !== expectedMissions || fingerprint(currentStudents.docs) !== expectedStudents ||
            (currentMain.data()?.statusSummaryMode || MISSION_TEACHER_STATUS_MODE_EMBEDDED) !== (currentStatusMode || MISSION_TEACHER_STATUS_MODE_EMBEDDED)) {
            throw new Error("Mission projection source changed while rebuilding.");
        }
        for (const missionDoc of resolvedMissionDocs) {
            await guardCanonicalMissionProjection(tx, db, classId, missionDoc.id, missionDoc.data());
        }
    };
    for (let offset = 0; offset < writes.length; offset += 400) {
        await db.runTransaction(async (tx) => {
            await guardSources(tx);
            for (const write of writes.slice(offset, offset + 400)) tx.set(write.ref, write.data, write.options);
        });
    }
    if (!directList) await cleanupTeacherMissionMainWeeks(
        classId,
        teacherMainSummaryState.weeks.map((week) => week.weekKey),
        guardSources,
    );
    await cleanupTeacherMissionStatsWeeks(
        classId,
        teacherStatsSummaryState.map((week) => week.weekKey),
        guardSources,
    );
    if (!directList) await cleanupTeacherMissionStatuses(
        classId,
        teacherMainMissionDocs.map((missionDoc) => missionDoc.id),
        guardSources,
    );

}

function hasTeacherMissionStatusSummaryChanges(beforeData = {}, afterData = {}) {
    return JSON.stringify(buildTeacherMissionStatusPayload(beforeData)) !==
        JSON.stringify(buildTeacherMissionStatusPayload(afterData));
}

async function activateTeacherMissionDetachedStatusSummary(classId) {
    if (!classId) return;

    await db.doc(TEACHER_DASHBOARD_MISSION_MAIN_DOC_PATH(classId)).set(
        {
            summaryVersion: MISSION_TEACHER_MAIN_SUMMARY_VERSION,
            statusSummaryMode: MISSION_TEACHER_STATUS_MODE_DETACHED,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
}

async function restoreTeacherMissionEmbeddedStatusSummary(classId) {
    if (!classId) return;

    await recomputeMissionNotificationSummary(classId, {
        forceEmbeddedStatus: true,
    });
    await db.doc(TEACHER_DASHBOARD_MISSION_MAIN_DOC_PATH(classId)).set(
        {
            summaryVersion: MISSION_TEACHER_MAIN_SUMMARY_VERSION,
            statusSummaryMode: MISSION_TEACHER_STATUS_MODE_EMBEDDED,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
    await recomputeMissionNotificationSummary(classId);
}

async function assertMissionSummaryRebuildAccess(request, classId, scope) {
    const ctx = getAuthContext(request);
    if (!classId) {
        throw new HttpsError("invalid-argument", "classId is required.");
    }

    if (ctx.role === "admin") return ctx;

    if (!ctx.classId || ctx.classId !== classId) {
        throw new HttpsError("permission-denied", "Cross-class access is not allowed.");
    }

    if (scope === "self" && ctx.role === "student") {
        return ctx;
    }

    if (ctx.role === "teacher") return ctx;

    const canManageMission = await hasPermission(ctx.uid, classId, "mission_admin");
    if (!canManageMission) {
        throw new HttpsError("permission-denied", "Mission summary rebuild permission denied.");
    }

    return ctx;
}

async function assertAssemblySummaryRebuildAccess(request, classId, scope) {
    const ctx = getAuthContext(request);
    if (!classId) {
        throw new HttpsError("invalid-argument", "classId is required.");
    }

    if (ctx.role === "admin") return ctx;

    if (!ctx.classId || ctx.classId !== classId) {
        throw new HttpsError("permission-denied", "Cross-class access is not allowed.");
    }

    if (ctx.role === "teacher") return ctx;

    if (scope === "self" && ctx.role === "student") {
        const canViewAssembly = await hasPermission(
            ctx.uid,
            classId,
            ASSEMBLY_VIEW_PERMISSION,
        );
        if (!canViewAssembly) {
            throw new HttpsError(
                "permission-denied",
                "Assembly summary rebuild permission denied.",
            );
        }
        return ctx;
    }

    const canViewAssembly = await hasPermission(
        ctx.uid,
        classId,
        ASSEMBLY_VIEW_PERMISSION,
    );
    if (!canViewAssembly) {
        throw new HttpsError(
            "permission-denied",
            "Assembly summary rebuild permission denied.",
        );
    }

    return ctx;
}

async function assertNotificationStateRebuildAccess(request, classId, scope) {
    const ctx = getAuthContext(request);
    if (!classId) {
        throw new HttpsError("invalid-argument", "classId is required.");
    }

    if (ctx.role === "admin") return ctx;

    if (!ctx.classId || ctx.classId !== classId) {
        throw new HttpsError("permission-denied", "Cross-class access is not allowed.");
    }

    if (ctx.role === "teacher") {
        return ctx;
    }

    if (scope === "self" && ctx.role === "student") {
        return ctx;
    }

    throw new HttpsError(
        "permission-denied",
        "Notification state rebuild permission denied.",
    );
}

function getStudentUidFromGroupedDoc(ref) {
    return ref?.parent?.parent?.id || null;
}

function incrementCounter(map, key, amount = 1) {
    if (!key) return;
    map[key] = (map[key] || 0) + amount;
}

function getCountMapValue(map, key) {
    if (!key) return 0;
    const value = Number(map?.[key] || 0);
    return Number.isFinite(value) ? value : 0;
}

function toSafeNonNegativeCount(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return null;
    }
    return Math.max(0, Math.round(numericValue));
}

function getAssemblyVoteChoice(source = null) {
    const vote = typeof source === "string" ? source : source?.vote;
    return vote === "agree" || vote === "disagree" ? vote : null;
}

function isAssemblyBillVoting(billData = {}) {
    return billData?.status === "voting";
}

function getAssemblySummaryVersionNumber(summaryData = {}) {
    return Number(summaryData?.summaryVersion || 0);
}

function getAssemblyClassOpenVotingCount(summaryData = {}) {
    return toSafeNonNegativeCount(summaryData?.openVotingBillCount);
}

function getAssemblyUserVotedOpenCount(summaryData = {}) {
    return toSafeNonNegativeCount(summaryData?.votedOpenBillCount);
}

function getAssemblySummaryVoteChoices(summaryData = {}) {
    const source = summaryData?.voteChoicesByBill;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(source).filter(
            ([billId, vote]) =>
                Boolean(billId) && (vote === "agree" || vote === "disagree"),
        ),
    );
}

function createAssemblyRepairFallbackError(scope, message) {
    const error = new Error(message);
    error.code = "assembly-summary-repair";
    error.scope = scope === "user" ? "user" : "class";
    return error;
}

function isAssemblyRepairFallbackError(error) {
    return error?.code === "assembly-summary-repair";
}

function createAssemblyClassSummaryPayload(openVotingBillCount) {
    const normalizedOpenVotingBillCount = Math.max(
        0,
        Number(openVotingBillCount || 0),
    );

    return {
        summaryVersion: ASSEMBLY_SUMMARY_VERSION,
        openVotingBillCount: normalizedOpenVotingBillCount,
        hasPendingVotes: normalizedOpenVotingBillCount > 0,
        updatedAt: FieldValue.serverTimestamp(),
        votedOpenBillCounts: FieldValue.delete(),
    };
}

function createAssemblyUserSummaryPayload({
    votedOpenBillCount,
    voteChoicesByBill = null,
}) {
    const payload = {
        summaryVersion: ASSEMBLY_SUMMARY_VERSION,
        votedOpenBillCount: Math.max(0, Number(votedOpenBillCount || 0)),
        updatedAt: FieldValue.serverTimestamp(),
        openVotingBillCount: FieldValue.delete(),
        pendingVoteCount: FieldValue.delete(),
        hasPendingVotes: FieldValue.delete(),
        openVoteChoicesByBill: FieldValue.delete(),
    };

    if (voteChoicesByBill !== null) {
        payload.voteChoicesByBill = voteChoicesByBill;
    }

    return payload;
}

function getAssemblyStatusChangeDelta(beforeBillData = null, afterBillData = null) {
    return Number(isAssemblyBillVoting(afterBillData)) -
        Number(isAssemblyBillVoting(beforeBillData));
}

function getAssemblyValidVoterUids(voterDocs = []) {
    const voterUids = new Set();

    voterDocs.forEach((voterDoc) => {
        const voterData = voterDoc.data() || {};
        const voterUid = String(
            voterData.voterUid || voterDoc.id || "",
        ).trim();
        const vote = getAssemblyVoteChoice(voterData);

        if (!voterUid || !vote) {
            return;
        }

        voterUids.add(voterUid);
    });

    return [...voterUids];
}

function getAssemblyPendingVoteCount(openVotingBillCount, votedOpenBillCount = 0) {
    const normalizedOpenVotingBillCount =
        toSafeNonNegativeCount(openVotingBillCount);
    const normalizedVotedOpenBillCount =
        toSafeNonNegativeCount(votedOpenBillCount);

    if (normalizedOpenVotingBillCount == null) {
        return null;
    }

    return Math.max(
        0,
        normalizedOpenVotingBillCount -
            Math.min(
                normalizedOpenVotingBillCount,
                normalizedVotedOpenBillCount ?? 0,
            ),
    );
}

function buildAssemblyActionCounts(
    studentUids = [],
    openVotingBillCount = 0,
    votedOpenBillCounts = {},
) {
    return Object.fromEntries(
        studentUids
            .filter(Boolean)
            .map((studentUid) => [
                studentUid,
                Number(
                    getAssemblyPendingVoteCount(
                        openVotingBillCount,
                        getCountMapValue(votedOpenBillCounts, studentUid),
                    ) || 0,
                ),
            ]),
    );
}

async function syncAssemblyActionCountForStudentFromSummaries(classId, studentUid) {
    if (!classId || !studentUid) return 0;

    const classSummaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.assembly));
    const userSummaryRef = db.doc(
        ASSEMBLY_USER_SUMMARY_DOC_PATH(classId, studentUid),
    );
    const [classSummarySnap, userSummarySnap] = await Promise.all([
        classSummaryRef.get(),
        userSummaryRef.get(),
    ]);

    const classSummaryData = classSummarySnap.data() || {};
    const openVotingBillCount = getAssemblyClassOpenVotingCount(classSummaryData);
    if (openVotingBillCount == null) {
        const result = await recomputeAssemblyNotificationSummaryForUser(
            classId,
            studentUid,
        );
        return Number(result?.pendingVoteCount || 0);
    }

    let votedOpenBillCount = 0;
    if (userSummarySnap.exists) {
        const userSummaryData = userSummarySnap.data() || {};
        if (
            getAssemblySummaryVersionNumber(userSummaryData) <
            ASSEMBLY_SUMMARY_VERSION
        ) {
            const result = await recomputeAssemblyNotificationSummaryForUser(
                classId,
                studentUid,
            );
            return Number(result?.pendingVoteCount || 0);
        }

        const currentVotedOpenBillCount =
            getAssemblyUserVotedOpenCount(userSummaryData);
        if (currentVotedOpenBillCount == null) {
            const result = await recomputeAssemblyNotificationSummaryForUser(
                classId,
                studentUid,
            );
            return Number(result?.pendingVoteCount || 0);
        }

        votedOpenBillCount = currentVotedOpenBillCount;
    }

    const pendingVoteCount = Number(
        getAssemblyPendingVoteCount(openVotingBillCount, votedOpenBillCount) || 0,
    );
    await writeNotificationActionCount(
        classId,
        studentUid,
        "assembly",
        pendingVoteCount,
    );

    return pendingVoteCount;
}

async function syncAssemblyActionCountsForClassFromSummaries(classId) {
    if (!classId) return {};

    const classSummaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.assembly));
    const [classSummarySnap, existingUserSummariesSnap, studentsSnap] =
        await Promise.all([
            classSummaryRef.get(),
            db.collection(ASSEMBLY_USER_SUMMARY_COLLECTION_PATH(classId)).get(),
            db.collection(`classes/${classId}/students`).get(),
        ]);

    const classSummaryData = classSummarySnap.data() || {};
    const openVotingBillCount = getAssemblyClassOpenVotingCount(classSummaryData);
    if (openVotingBillCount == null) {
        await recomputeAssemblyNotificationSummary(classId);
        return {};
    }

    const votedOpenBillCounts = {};
    let hasInvalidUserSummary = false;
    existingUserSummariesSnap.forEach((docSnap) => {
        const userSummaryData = docSnap.data() || {};
        if (
            getAssemblySummaryVersionNumber(userSummaryData) <
            ASSEMBLY_SUMMARY_VERSION
        ) {
            hasInvalidUserSummary = true;
            return;
        }

        const votedOpenBillCount = getAssemblyUserVotedOpenCount(userSummaryData);
        if (votedOpenBillCount == null) {
            hasInvalidUserSummary = true;
            return;
        }

        votedOpenBillCounts[docSnap.id] = votedOpenBillCount;
    });

    if (hasInvalidUserSummary) {
        await recomputeAssemblyNotificationSummary(classId);
        return {};
    }

    const studentUids = studentsSnap.docs.map((docSnap) => docSnap.id).filter(Boolean);
    if (!studentUids.length) {
        return {};
    }

    const nextCounts = buildAssemblyActionCounts(
        studentUids,
        openVotingBillCount,
        votedOpenBillCounts,
    );
    await writeNotificationActionCounts(classId, "assembly", nextCounts, {});

    return nextCounts;
}

function isTaxBillPaid(bill) {
    if (!bill || typeof bill !== "object") return false;
    return bill.isPaid === true || bill.status === "paid";
}

function isUnreadNotification(notificationData) {
    if (!notificationData || typeof notificationData !== "object") return false;
    if (NOTICE_INBOX_EXCLUDED_TYPES.has(notificationData.type)) return false;
    return notificationData.isRead === false;
}

function getNoticeUnreadDelta(beforeData, afterData) {
    return Number(isUnreadNotification(afterData)) -
        Number(isUnreadNotification(beforeData));
}

function hasRelevantNoticeUnreadChange(beforeData, afterData) {
    return getNoticeUnreadDelta(beforeData, afterData) !== 0;
}

async function writeNoticeUnreadCount(classId, studentUid, unreadCount) {
    await writeNoticeUnreadCountProjection({
        dbClient: db,
        fieldValue: FieldValue,
        classId,
        studentUid,
        unreadCount,
    });
}

async function writeNotificationActionCount(classId, studentUid, actionKey, count) {
    if (!classId || !studentUid || !actionKey) return;

    const stateRef = db.doc(getNotificationStateMainDocPath(classId, studentUid));
    await stateRef.set(
        createNotificationStateMainActionPatch({
            actionKey,
            count,
            updatedAt: FieldValue.serverTimestamp(),
        }),
        { merge: true },
    );
}

async function writeNotificationActionCounts(
    classId,
    actionKey,
    nextCounts = {},
    previousCounts = {},
) {
    if (!classId || !actionKey) return;

    const targetStudentUids = [
        ...new Set([
            ...Object.keys(previousCounts || {}),
            ...Object.keys(nextCounts || {}),
        ]),
    ].filter(Boolean);

    if (!targetStudentUids.length) return;

    const writes = targetStudentUids.map((studentUid) => ({
        ref: db.doc(getNotificationStateMainDocPath(classId, studentUid)),
        data: createNotificationStateMainActionPatch({
            actionKey,
            count: Number(nextCounts?.[studentUid] || 0),
            updatedAt: FieldValue.serverTimestamp(),
        }),
        options: { merge: true },
    }));

    await commitChunkedSetWrites(writes);
}

async function listClassStudentRecords(classId) {
    if (!classId) return [];

    const studentsSnap = await db.collection(`classes/${classId}/students`).get();
    return studentsSnap.docs.map((docSnap) => ({
        uid: docSnap.id,
        data: docSnap.data() || {},
    })).filter(({ uid }) => Boolean(uid));
}

function buildZeroCountMap(studentRecords = []) {
    const zeroCounts = {};
    studentRecords.forEach(({ uid }) => {
        if (uid) {
            zeroCounts[uid] = 0;
        }
    });
    return zeroCounts;
}

async function recomputeStudentMissionActionCount(
    classId,
    studentUid,
    studentData = null,
) {
    if (!classId || !studentUid) return 0;

    let effectiveStudentData = studentData;
    if (!effectiveStudentData) {
        const studentSnap = await db.doc(`classes/${classId}/students/${studentUid}`).get();
        if (!studentSnap.exists) {
            throw new HttpsError("not-found", "Student not found.");
        }
        effectiveStudentData = studentSnap.data() || {};
    }

    await recomputeStudentMissionActionCountsForStudents(classId, [
        { uid: studentUid, data: effectiveStudentData },
    ]);
    return 0;
}

async function recomputeStudentCredentialsActionCount(classId, studentUid) {
    if (!classId || !studentUid) return 0;

    const pendingRequestsSnap = await db
        .collection(`classes/${classId}/titleRequests`)
        .where("status", "==", "pending")
        .where("studentUid", "==", studentUid)
        .get();

    const pendingCount = pendingRequestsSnap.size;
    await writeNotificationActionCount(classId, studentUid, "credentials", pendingCount);
    return pendingCount;
}

async function recomputeStudentRealEstateActionCount(classId, studentUid) {
    if (!classId || !studentUid) return 0;

    const layoutSnap = await readRealEstateLayout(db, db.doc(`classes/${classId}/real_estate/layout`), undefined, { includeSaleContracts: false });
    const groups = layoutSnap.exists ?
        (Array.isArray(layoutSnap.data()?.groups) ? layoutSnap.data().groups : []) :
        [];
    const todayStart = startOfDayInKST(new Date());

    let dueCount = 0;
    groups.forEach((group) => {
        (group?.desks || []).forEach((desk) => {
            if (String(desk?.studentId || "") !== studentUid) return;
            if (isRentDueForDesk(desk, todayStart)) {
                dueCount += 1;
            }
        });
    });

    await writeNotificationActionCount(classId, studentUid, "realestate", dueCount);
    return dueCount;
}

async function rebuildNotificationStateMainForStudent(
    classId,
    studentUid,
    studentData = null,
) {
    if (!classId || !studentUid) {
        throw new HttpsError("invalid-argument", "classId and studentUid are required.");
    }

    let effectiveStudentData = studentData;
    if (!effectiveStudentData) {
        const studentSnap = await db.doc(`classes/${classId}/students/${studentUid}`).get();
        if (!studentSnap.exists) {
            throw new HttpsError("not-found", "Student not found.");
        }
        effectiveStudentData = studentSnap.data() || {};
    }

    await Promise.all([
        recomputeNoticeNotificationSummary(classId, studentUid),
        recomputeStudentMissionActionCount(classId, studentUid, effectiveStudentData),
        recomputeStudentBankActionCount(classId, studentUid),
        recomputeStudentPoliceActionCount(classId, studentUid),
        recomputeTaxNotificationSummary(classId, studentUid),
        recomputeStudentCredentialsActionCount(classId, studentUid),
        recomputeSellerMarketplaceActionCount(classId, studentUid),
        recomputeStudentRealEstateActionCount(classId, studentUid),
        recomputeAssemblyNotificationSummaryForUser(classId, studentUid),
    ]);

    return {
        classId,
        studentUid,
    };
}

async function rebuildNotificationStateMainForClass(classId) {
    if (!classId) {
        throw new HttpsError("invalid-argument", "classId is required.");
    }

    const studentRecords = await listClassStudentRecords(classId);
    const studentUids = studentRecords.map(({ uid }) => uid).filter(Boolean);

    await Promise.all([
        recomputeMissionNotificationSummary(classId),
        recomputeBankNotificationSummary(classId),
        recomputeCredentialsNotificationSummary(classId),
        recomputePoliceNotificationSummary(classId),
        recomputeMarketplaceNotificationSummary(classId),
        recomputeRealEstateNotificationSummary(classId),
        recomputeAssemblyNotificationSummary(classId),
        ...studentUids.map((studentUid) =>
            recomputeNoticeNotificationSummary(classId, studentUid),
        ),
        ...studentUids.map((studentUid) =>
            recomputeTaxNotificationSummary(classId, studentUid),
        ),
    ]);

    return {
        classId,
        studentCount: studentUids.length,
    };
}

async function recomputeStudentMissionActionCountsForStudents(
    classId,
    students = [],
    { missionDocs: providedMissionDocs = null, now: providedNow = null } = {},
) {
    const normalizedStudents = students.filter(({ uid }) => Boolean(uid));
    if (!normalizedStudents.length) return;

    const missionDocs = Array.isArray(providedMissionDocs) ?
        providedMissionDocs :
        (await db.collection(`classes/${classId}/missions`).get()).docs;
    const resolvedMissionDocs = await readMissionDocsStudentStates(db, missionDocs, { studentUids: normalizedStudents.map(({ uid }) => uid) });
    const now = providedNow || new Date();

    const writes = normalizedStudents.map(({ uid, data }) => {
        let count = 0;

        if (isMissionSummaryStudentParticipant(data)) {
            resolvedMissionDocs.forEach((missionDoc) => {
                const mission = missionDoc.data() || {};
                if (canStudentSubmitMission(mission, uid, data || {}, now)) {
                    count += 1;
                }
            });
        }

        return {
            ref: db.doc(getNotificationStateMainDocPath(classId, uid)),
            data: createNotificationStateMainActionPatch({
                actionKey: "missions",
                count,
                updatedAt: FieldValue.serverTimestamp(),
            }),
            options: { merge: true },
        };
    });

    await commitChunkedSetWrites(writes);
}

async function recomputeStudentMissionProjections(
    classId,
    studentUid,
) {
    return db.runTransaction(async (tx) => {
        const studentSnap = await tx.get(db.doc(`classes/${classId}/students/${studentUid}`));
        const directList = usesDirectMissionList((await tx.get(db.doc(`classes/${classId}`))).data());
        if (!studentSnap.exists) throw new HttpsError("not-found", "Student not found in class.");
        const studentData = studentSnap.data() || {};
        const missionSnap = await tx.get(db.collection(`classes/${classId}/missions`));
        const missionDocs = await readMissionDocsStudentStates(db, missionSnap.docs, { tx, studentUids: [studentUid] });
        const now = new Date();
        const summary = isMissionDashboardParticipant(studentData) ? buildStudentDashboardMissionSummary(
            missionDocs, studentUid, studentData, getDashboardRegularMissionCutoff(now), now,
        ) : createEmptyDashboardMissionSummary();
        const count = isMissionSummaryStudentParticipant(studentData) ? missionDocs.filter((missionDoc) =>
            canStudentSubmitMission(missionDoc.data(), studentUid, studentData, now)).length : 0;
        const write = createMissionDashboardSummaryWrite(classId, studentUid, summary, { directList });
        tx.set(write.ref, write.data);
        tx.set(db.doc(getNotificationStateMainDocPath(classId, studentUid)), createNotificationStateMainActionPatch({
            actionKey: "missions", count, updatedAt: FieldValue.serverTimestamp(),
        }), { merge: true });
        return summary;
    });
}

async function recomputeNoticeNotificationSummary(
    classId,
    studentUid,
    beforeData = null,
    afterData = null,
) {
    if (!classId || !studentUid) return;

    if (
        (beforeData !== null || afterData !== null) &&
        !hasRelevantNoticeUnreadChange(beforeData, afterData)
    ) {
        return;
    }

    const unreadSnapshot = await db
        .collection(`classes/${classId}/students/${studentUid}/notifications`)
        .where("isRead", "==", false)
        .get();
    let unreadCount = 0;
    unreadSnapshot.forEach((docSnap) => {
        if (isUnreadNotification(docSnap.data() || {})) unreadCount += 1;
    });

    await writeNoticeUnreadCount(classId, studentUid, unreadCount);
}

async function recomputeTaxNotificationSummary(classId, studentUid) {
    if (!classId || !studentUid) return;

    const taxBillsSnap = await db
        .collection(`classes/${classId}/students/${studentUid}/taxBills`)
        .get();

    let unpaidCount = 0;
    taxBillsSnap.forEach((docSnap) => {
        if (!isTaxBillPaid(docSnap.data())) unpaidCount += 1;
    });

    await Promise.all([
        db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.tax)).set(
            {
                studentUnpaidTaxCounts: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        ),
        writeNotificationActionCount(classId, studentUid, "tax", unpaidCount),
    ]);
}

function getDeskWeeklyRent(desk) {
    const weeklyRent = Number(desk?.weeklyRent ?? desk?.rentPrice ?? 0);
    return Number.isFinite(weeklyRent) ? weeklyRent : 0;
}

function countInclusiveDaysForRent(startValue, endValue) {
    const startDate = startOfDayInKST(startValue);
    const endDate = startOfDayInKST(endValue);
    if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) return 0;
    return Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

function countExclusiveDaysForRent(startValue, endValue) {
    const startDate = startOfDayInKST(startValue);
    const endDate = startOfDayInKST(endValue);
    if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) return 0;
    return Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
}

function resolveTrackedPaidRentDays(desk, contractStartDate) {
    const explicitPaidDays = Math.max(0, Number(desk?.rentPaidDays || 0));
    if (Number.isFinite(explicitPaidDays) && explicitPaidDays > 0) {
        return Math.floor(explicitPaidDays);
    }

    const paidUntilDate = startOfDayInKST(toDateSafe(desk?.rentPaidUntil));
    if (!contractStartDate || !paidUntilDate) return 0;
    return countExclusiveDaysForRent(contractStartDate, paidUntilDate);
}

function isRentDueForDesk(desk, todayStart) {
    if (!desk || !desk.studentId) return false;
    if (desk?.isActive === false) return false;
    if (desk.ownerId && desk.ownerId === desk.studentId) return false;

    // User request: do not alert when rent is not configured.
    const weeklyRent = getDeskWeeklyRent(desk);
    if (weeklyRent <= 0) return false;

    const contractStartDate = startOfDayInKST(toDateSafe(desk?.rentStartAt));
    const contractLastDate = startOfDayInKST(toDateSafe(desk?.rentLastDateAt));
    const rentTenantId = String(desk?.rentTenantId || "").trim();
    const currentTenantId = String(desk?.studentId || "").trim();
    const hasConfiguredContract = Boolean(
        contractStartDate &&
        contractLastDate &&
        rentTenantId &&
        rentTenantId === currentTenantId,
    );

    if (hasConfiguredContract) {
        if (contractStartDate.getTime() > todayStart.getTime()) return false;
        const accrualEnd =
            contractLastDate.getTime() < todayStart.getTime()
                ? contractLastDate
                : todayStart;
        const accruedDays = countInclusiveDaysForRent(contractStartDate, accrualEnd);
        const paidDays = resolveTrackedPaidRentDays(desk, contractStartDate);
        return accruedDays > paidDays;
    }

    const paidUntil = toDateSafe(desk.rentPaidUntil);
    if (!paidUntil) return true;

    const paidUntilStart = startOfDayInKST(paidUntil);
    return paidUntilStart.getTime() <= todayStart.getTime();
}

async function recomputeRealEstateNotificationSummary(classId) {
    if (!classId) return;

    const summaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.realestate));
    const layoutRef = db.doc(`classes/${classId}/real_estate/layout`);
    const [layoutSnap, studentRecords] = await Promise.all([
        readRealEstateLayout(db, layoutRef, undefined, { includeSaleContracts: false }),
        listClassStudentRecords(classId),
    ]);
    const groups = layoutSnap.exists
        ? Array.isArray(layoutSnap.data()?.groups)
            ? layoutSnap.data().groups
            : []
        : [];

    const todayStart = startOfDayInKST(new Date());
    const studentRentDueCounts = buildZeroCountMap(studentRecords);
    let teacherPendingRentDueCount = 0;

    groups.forEach((group) => {
        (group?.desks || []).forEach((desk) => {
            if (!isRentDueForDesk(desk, todayStart)) return;
            incrementCounter(studentRentDueCounts, desk.studentId, 1);
            teacherPendingRentDueCount += 1;
        });
    });

    await Promise.all([
        summaryRef.set({
            teacherPendingRentDueCount,
            hasTeacherPendingRentDue: teacherPendingRentDueCount > 0,
            studentRentDueCounts: FieldValue.delete(),
            hasStudentRentDue: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        writeNotificationActionCounts(
            classId,
            "realestate",
            studentRentDueCounts,
            {},
        ),
    ]);
}

async function recomputeBankNotificationSummary(classId) {
    if (!classId) return;

    const summaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.bank));
    const pendingSavingsQ = db
        .collectionGroup("savings")
        .where("classId", "==", classId)
        .where("status", "==", "pending");

    const pendingLoansQ = db
        .collectionGroup("loans")
        .where("classId", "==", classId)
        .where("status", "==", "pending");

    const activeSavingsQ = db
        .collectionGroup("savings")
        .where("classId", "==", classId)
        .where("status", "==", "active");

    const ongoingLoansQ = db
        .collectionGroup("loans")
        .where("classId", "==", classId)
        .where("status", "==", "ongoing");

    const [pendingSavingsSnap, pendingLoansSnap, activeSavingsSnap, ongoingLoansSnap, studentRecords] =
        await Promise.all([
            pendingSavingsQ.get(),
            pendingLoansQ.get(),
            activeSavingsQ.get(),
            ongoingLoansQ.get(),
            listClassStudentRecords(classId),
        ]);

    const nowKSTStart = startOfDayInKST(new Date());
    const dueSoonThreshold = addCalendarDaysInKST(
        nowKSTStart,
        BANK_LOAN_ALERT_LEAD_DAYS,
    );

    const studentMaturityCounts = buildZeroCountMap(studentRecords);
    const studentLoanDueSoonCounts = buildZeroCountMap(studentRecords);

    activeSavingsSnap.forEach((savingDoc) => {
        const saving = savingDoc.data() || {};
        const maturityDate = calculateMaturityDate(saving);
        if (!maturityDate) return;

        const maturityDay = startOfDayInKST(maturityDate);
        if (maturityDay.getTime() > nowKSTStart.getTime()) return;

        const studentUid = getStudentUidFromGroupedDoc(savingDoc.ref);
        incrementCounter(studentMaturityCounts, studentUid, 1);
    });

    ongoingLoansSnap.forEach((loanDoc) => {
        const loan = loanDoc.data() || {};
        const repaymentDate = calculateRepaymentDate(loan);
        if (!repaymentDate) return;

        const repaymentDay = startOfDayInKST(repaymentDate);
        if (repaymentDay.getTime() > dueSoonThreshold.getTime()) return;

        const studentUid = getStudentUidFromGroupedDoc(loanDoc.ref);
        incrementCounter(studentLoanDueSoonCounts, studentUid, 1);
    });

    const studentActionCounts = buildZeroCountMap(studentRecords);
    const actionStudentUids = new Set([
        ...Object.keys(studentActionCounts),
        ...Object.keys(studentMaturityCounts),
        ...Object.keys(studentLoanDueSoonCounts),
    ]);

    actionStudentUids.forEach((uid) => {
        studentActionCounts[uid] =
            Number(studentMaturityCounts[uid] || 0) +
            Number(studentLoanDueSoonCounts[uid] || 0);
    });

    const pendingSavingsCount = pendingSavingsSnap.size;
    const pendingLoansCount = pendingLoansSnap.size;
    const managerPendingCount = pendingSavingsCount + pendingLoansCount;

    await Promise.all([
        summaryRef.set({
            managerPendingCount,
            pendingSavingsCount,
            pendingLoansCount,
            hasManagerPending: managerPendingCount > 0,
            studentMaturityCounts: FieldValue.delete(),
            studentLoanDueSoonCounts: FieldValue.delete(),
            studentActionCounts: FieldValue.delete(),
            hasStudentAction: FieldValue.delete(),
            loanAlertLeadDays: BANK_LOAN_ALERT_LEAD_DAYS,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true }),
        writeNotificationActionCounts(
            classId,
            "bank",
            studentActionCounts,
            {},
        ),
    ]);
}

// Full rebuild fallback kept for emergency/manual recovery flows.
// eslint-disable-next-line no-unused-vars
async function recomputeCredentialsNotificationSummary(classId) {
    if (!classId) return;

    const summaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.credentials));
    const [pendingRequestsSnap, studentRecords] = await Promise.all([
        db
            .collection(`classes/${classId}/titleRequests`)
            .where("status", "==", "pending")
            .get(),
        listClassStudentRecords(classId),
    ]);

    const studentPendingRequestCounts = buildZeroCountMap(studentRecords);
    pendingRequestsSnap.forEach((requestDoc) => {
        const requestData = requestDoc.data() || {};
        incrementCounter(studentPendingRequestCounts, requestData.studentUid, 1);
    });

    const teacherPendingRequestCount = pendingRequestsSnap.size;

    await Promise.all([
        summaryRef.set(
            {
                teacherPendingRequestCount,
                hasTeacherPendingRequest: teacherPendingRequestCount > 0,
                studentPendingRequestCounts: FieldValue.delete(),
                hasStudentPendingRequest: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        ),
        writeNotificationActionCounts(
            classId,
            "credentials",
            studentPendingRequestCounts,
            {},
        ),
    ]);
}

function getCredentialsRequestContribution(requestData) {
    if (!requestData || typeof requestData !== "object") {
        return {
            teacherPendingRequestCount: 0,
            studentUid: null,
            studentPendingRequestCount: 0,
        };
    }

    if (String(requestData.status || "") !== "pending") {
        return {
            teacherPendingRequestCount: 0,
            studentUid: null,
            studentPendingRequestCount: 0,
        };
    }

    const studentUid = String(requestData.studentUid || "").trim() || null;
    return {
        teacherPendingRequestCount: 1,
        studentUid,
        studentPendingRequestCount: studentUid ? 1 : 0,
    };
}

function hasCredentialsContributionChanged(beforeContribution, afterContribution) {
    return (
        Number(beforeContribution?.teacherPendingRequestCount || 0) !==
            Number(afterContribution?.teacherPendingRequestCount || 0) ||
        String(beforeContribution?.studentUid || "") !==
            String(afterContribution?.studentUid || "") ||
        Number(beforeContribution?.studentPendingRequestCount || 0) !==
            Number(afterContribution?.studentPendingRequestCount || 0)
    );
}

async function incrementCredentialsNotificationSummary(
    classId,
    beforeData = null,
    afterData = null,
) {
    if (!classId) return;

    const beforeContribution = getCredentialsRequestContribution(beforeData);
    const afterContribution = getCredentialsRequestContribution(afterData);

    if (!hasCredentialsContributionChanged(beforeContribution, afterContribution)) {
        return;
    }

    const summaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.credentials));
    const teacherPendingDelta =
        Number(afterContribution?.teacherPendingRequestCount || 0) -
        Number(beforeContribution?.teacherPendingRequestCount || 0);

    const affectedStudentUids = [
        ...new Set([
            beforeContribution.studentUid,
            afterContribution.studentUid,
        ].filter(Boolean)),
    ];

    await db.runTransaction(async (tx) => {
        const summarySnap = await tx.get(summaryRef);
        const summary = summarySnap.data() || {};

        const teacherPendingRequestCount = Math.max(
            0,
            Number(summary.teacherPendingRequestCount || 0) +
                teacherPendingDelta,
        );

        tx.set(
            summaryRef,
            {
                teacherPendingRequestCount,
                hasTeacherPendingRequest: teacherPendingRequestCount > 0,
                studentPendingRequestCounts: FieldValue.delete(),
                hasStudentPendingRequest: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    });

    if (affectedStudentUids.length > 0) {
        await Promise.all(
            affectedStudentUids.map((studentUid) =>
                recomputeStudentCredentialsActionCount(classId, studentUid),
            ),
        );
    }
}

function getSavingBankContribution(saving, nowKSTStart) {
    const contribution = {
        pendingSavings: 0,
        pendingLoans: 0,
        studentMaturity: 0,
        studentLoanDueSoon: 0,
    };

    if (!saving || typeof saving !== "object") return contribution;

    if (String(saving.status || "") === "pending") {
        contribution.pendingSavings = 1;
    }

    if (String(saving.status || "") !== "active") {
        return contribution;
    }

    const maturityDate = calculateMaturityDate(saving);
    if (!maturityDate) return contribution;

    const maturityDay = startOfDayInKST(maturityDate);
    if (maturityDay.getTime() <= nowKSTStart.getTime()) {
        contribution.studentMaturity = 1;
    }

    return contribution;
}

function getLoanBankContribution(loan, dueSoonThreshold) {
    const contribution = {
        pendingSavings: 0,
        pendingLoans: 0,
        studentMaturity: 0,
        studentLoanDueSoon: 0,
    };

    if (!loan || typeof loan !== "object") return contribution;

    if (String(loan.status || "") === "pending") {
        contribution.pendingLoans = 1;
    }

    if (String(loan.status || "") !== "ongoing") {
        return contribution;
    }

    const repaymentDate = calculateRepaymentDate(loan);
    if (!repaymentDate) return contribution;

    const repaymentDay = startOfDayInKST(repaymentDate);
    if (repaymentDay.getTime() <= dueSoonThreshold.getTime()) {
        contribution.studentLoanDueSoon = 1;
    }

    return contribution;
}

function getBankDocContribution(collectionId, docData, nowKSTStart, dueSoonThreshold) {
    if (collectionId === "savings") {
        return getSavingBankContribution(docData, nowKSTStart);
    }
    if (collectionId === "loans") {
        return getLoanBankContribution(docData, dueSoonThreshold);
    }
    return {
        pendingSavings: 0,
        pendingLoans: 0,
        studentMaturity: 0,
        studentLoanDueSoon: 0,
    };
}

function getBankContributionDelta(beforeContribution, afterContribution) {
    return {
        pendingSavings:
            Number(afterContribution?.pendingSavings || 0) -
            Number(beforeContribution?.pendingSavings || 0),
        pendingLoans:
            Number(afterContribution?.pendingLoans || 0) -
            Number(beforeContribution?.pendingLoans || 0),
        studentMaturity:
            Number(afterContribution?.studentMaturity || 0) -
            Number(beforeContribution?.studentMaturity || 0),
        studentLoanDueSoon:
            Number(afterContribution?.studentLoanDueSoon || 0) -
            Number(beforeContribution?.studentLoanDueSoon || 0),
    };
}

function hasBankContributionDelta(delta) {
    return Boolean(
        Number(delta?.pendingSavings || 0) ||
        Number(delta?.pendingLoans || 0) ||
        Number(delta?.studentMaturity || 0) ||
        Number(delta?.studentLoanDueSoon || 0),
    );
}

function buildBankSummaryDeltaPatch(delta) {
    const pendingSavingsDelta = Number(delta?.pendingSavings || 0);
    const pendingLoansDelta = Number(delta?.pendingLoans || 0);
    const managerPendingDelta = pendingSavingsDelta + pendingLoansDelta;

    const patch = {
        loanAlertLeadDays: BANK_LOAN_ALERT_LEAD_DAYS,
        updatedAt: FieldValue.serverTimestamp(),
    };

    if (pendingSavingsDelta) {
        patch.pendingSavingsCount = FieldValue.increment(pendingSavingsDelta);
    }

    if (pendingLoansDelta) {
        patch.pendingLoansCount = FieldValue.increment(pendingLoansDelta);
    }

    if (managerPendingDelta) {
        patch.managerPendingCount = FieldValue.increment(managerPendingDelta);
    }

    return patch;
}

async function recomputeStudentBankActionCount(classId, studentUid) {
    if (!classId || !studentUid) return 0;

    const [activeSavingsSnap, ongoingLoansSnap] = await Promise.all([
        db
            .collection(`classes/${classId}/students/${studentUid}/savings`)
            .where("status", "==", "active")
            .get(),
        db
            .collection(`classes/${classId}/students/${studentUid}/loans`)
            .where("status", "==", "ongoing")
            .get(),
    ]);

    const nowKSTStart = startOfDayInKST(new Date());
    const dueSoonThreshold = addCalendarDaysInKST(
        nowKSTStart,
        BANK_LOAN_ALERT_LEAD_DAYS,
    );

    let studentActionCount = 0;

    activeSavingsSnap.forEach((savingDoc) => {
        const maturityDate = calculateMaturityDate(savingDoc.data() || {});
        if (!maturityDate) return;

        const maturityDay = startOfDayInKST(maturityDate);
        if (maturityDay.getTime() <= nowKSTStart.getTime()) {
            studentActionCount += 1;
        }
    });

    ongoingLoansSnap.forEach((loanDoc) => {
        const repaymentDate = calculateRepaymentDate(loanDoc.data() || {});
        if (!repaymentDate) return;

        const repaymentDay = startOfDayInKST(repaymentDate);
        if (repaymentDay.getTime() <= dueSoonThreshold.getTime()) {
            studentActionCount += 1;
        }
    });

    await writeNotificationActionCount(classId, studentUid, "bank", studentActionCount);
    return studentActionCount;
}

async function incrementBankNotificationSummary(
    classId,
    studentUid,
    collectionId,
    beforeData,
    afterData,
) {
    if (!classId) return;
    if (!studentUid) {
        await recomputeBankNotificationSummary(classId);
        return;
    }

    const nowKSTStart = startOfDayInKST(new Date());
    const dueSoonThreshold = addCalendarDaysInKST(
        nowKSTStart,
        BANK_LOAN_ALERT_LEAD_DAYS,
    );

    const beforeContribution = getBankDocContribution(
        collectionId,
        beforeData,
        nowKSTStart,
        dueSoonThreshold,
    );
    const afterContribution = getBankDocContribution(
        collectionId,
        afterData,
        nowKSTStart,
        dueSoonThreshold,
    );
    const delta = getBankContributionDelta(beforeContribution, afterContribution);

    if (!hasBankContributionDelta(delta)) {
        return;
    }

    const summaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.bank));
    const patch = buildBankSummaryDeltaPatch(delta);
    await Promise.all([
        summaryRef.set(patch, { merge: true }),
        recomputeStudentBankActionCount(classId, studentUid),
    ]);
}

// Full rebuild fallback kept for emergency/manual recovery flows.
// eslint-disable-next-line no-unused-vars
async function recomputePoliceNotificationSummary(classId) {
    if (!classId) return;

    const summaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.police));
    const pendingReportsQ = db
        .collection(`classes/${classId}/policeReports`)
        .where("status", "==", "pending");

    const [pendingReportsSnap, studentRecords] = await Promise.all([
        pendingReportsQ.get(),
        listClassStudentRecords(classId),
    ]);

    let teacherPendingReportCount = 0;
    let policeAdminPendingReportCount = 0;
    pendingReportsSnap.forEach((reportDoc) => {
        const report = reportDoc.data() || {};
        teacherPendingReportCount += 1;
        if (!report.isSensitive) policeAdminPendingReportCount += 1;
    });

    const studentPoliceActionCounts = buildZeroCountMap(studentRecords);

    const hasTeacherPendingReport = teacherPendingReportCount > 0;
    const hasPoliceAdminPendingReport = policeAdminPendingReportCount > 0;

    await Promise.all([
        summaryRef.set(
            {
                teacherPendingReportCount,
                policeAdminPendingReportCount,
                hasTeacherPendingReport,
                hasPoliceAdminPendingReport,
                studentFineCounts: FieldValue.delete(),
                hasStudentFine: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        ),
        writeNotificationActionCounts(
            classId,
            "police",
            studentPoliceActionCounts,
            {},
        ),
    ]);
}

function getPoliceReportContribution(reportData) {
    if (!reportData || typeof reportData !== "object") {
        return {
            teacherPendingReportCount: 0,
            policeAdminPendingReportCount: 0,
        };
    }

    if (reportData.status !== "pending") {
        return {
            teacherPendingReportCount: 0,
            policeAdminPendingReportCount: 0,
        };
    }

    return {
        teacherPendingReportCount: 1,
        policeAdminPendingReportCount: reportData.isSensitive ? 0 : 1,
    };
}

function getPoliceReportDelta(beforeData, afterData) {
    const beforeContribution = getPoliceReportContribution(beforeData);
    const afterContribution = getPoliceReportContribution(afterData);

    return {
        teacherPendingReportCount:
            Number(afterContribution.teacherPendingReportCount || 0) -
            Number(beforeContribution.teacherPendingReportCount || 0),
        policeAdminPendingReportCount:
            Number(afterContribution.policeAdminPendingReportCount || 0) -
            Number(beforeContribution.policeAdminPendingReportCount || 0),
    };
}

function hasPoliceReportDelta(delta) {
    return Boolean(
        Number(delta?.teacherPendingReportCount || 0) ||
        Number(delta?.policeAdminPendingReportCount || 0),
    );
}

function getPoliceFineContribution(fineData) {
    if (!fineData || typeof fineData !== "object") {
        return { studentUid: null, count: 0 };
    }

    if (
        fineData.type !== "fine" ||
        fineData.status !== "applied" ||
        fineData.isCancelled === true
    ) {
        return { studentUid: null, count: 0 };
    }

    return {
        studentUid: String(fineData.studentUid || "").trim() || null,
        count: 1,
    };
}

function hasPoliceFineDelta(beforeContribution, afterContribution) {
    return beforeContribution.studentUid !== afterContribution.studentUid ||
        Number(beforeContribution.count || 0) !== Number(afterContribution.count || 0);
}

async function recomputeStudentPoliceActionCount(classId, studentUid) {
    if (!classId || !studentUid) return 0;

    await writeNotificationActionCount(classId, studentUid, "police", 0);
    return 0;
}

async function incrementPoliceNotificationSummary(
    classId,
    {
        reportBeforeData = null,
        reportAfterData = null,
        fineBeforeData = null,
        fineAfterData = null,
    } = {},
) {
    if (!classId) return;

    const reportDelta = getPoliceReportDelta(reportBeforeData, reportAfterData);
    const beforeFineContribution = getPoliceFineContribution(fineBeforeData);
    const afterFineContribution = getPoliceFineContribution(fineAfterData);

    if (
        !hasPoliceReportDelta(reportDelta) &&
        !hasPoliceFineDelta(beforeFineContribution, afterFineContribution)
    ) {
        return;
    }

    const summaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.police));
    const affectedStudentUids = [
        ...new Set([
            beforeFineContribution.studentUid,
            afterFineContribution.studentUid,
        ].filter(Boolean)),
    ];

    await db.runTransaction(async (tx) => {
        const summarySnap = await tx.get(summaryRef);
        const summary = summarySnap.data() || {};

        const teacherPendingReportCount = Math.max(
            0,
            Number(summary.teacherPendingReportCount || 0) +
                Number(reportDelta.teacherPendingReportCount || 0),
        );
        const policeAdminPendingReportCount = Math.max(
            0,
            Number(summary.policeAdminPendingReportCount || 0) +
                Number(reportDelta.policeAdminPendingReportCount || 0),
        );

        tx.set(
            summaryRef,
            {
                teacherPendingReportCount,
                policeAdminPendingReportCount,
                hasTeacherPendingReport: teacherPendingReportCount > 0,
                hasPoliceAdminPendingReport: policeAdminPendingReportCount > 0,
                studentFineCounts: FieldValue.delete(),
                hasStudentFine: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    });

    if (affectedStudentUids.length > 0) {
        await Promise.all(
            affectedStudentUids.map((studentUid) =>
                recomputeStudentPoliceActionCount(classId, studentUid),
            ),
        );
    }
}

// Full rebuild fallback kept for emergency/manual recovery flows.
// eslint-disable-next-line no-unused-vars
async function recomputeMarketplaceNotificationSummary(classId) {
    if (!classId) return;

    const summaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.marketplace));
    const studentRecords = await listClassStudentRecords(classId);
    const sellerPendingSaleAlertCounts = buildZeroCountMap(studentRecords);
    const collectPendingCount = async (collectionPath) => {
        const targetRef = db.collection(collectionPath);
        const [pendingStatusSnap, unapprovedSnap, soldAlertSnap] = await Promise.all([
            targetRef.where("status", "==", "pending").get(),
            targetRef.where("approved", "==", false).get(),
            targetRef
                .where("status", "==", "sold")
                .where("sellerSaleAlertPending", "==", true)
                .get(),
        ]);

        const pendingIds = new Set();

        pendingStatusSnap.forEach((docSnap) => {
            pendingIds.add(docSnap.id);
        });

        unapprovedSnap.forEach((docSnap) => {
            const item = docSnap.data() || {};
            const status = String(item.status || "");
            if (status !== "rejected") {
                pendingIds.add(docSnap.id);
            }
        });

        soldAlertSnap.forEach((docSnap) => {
            const item = docSnap.data() || {};
            const sellerId = String(item.sellerId || "").trim();
            if (!sellerId) return;
            sellerPendingSaleAlertCounts[sellerId] =
                Number(sellerPendingSaleAlertCounts[sellerId] || 0) + 1;
        });

        return pendingIds.size;
    };

    const [marketPendingCount, auctionPendingCount] = await Promise.all([
        collectPendingCount(`classes/${classId}/marketplace`),
        collectPendingCount(`classes/${classId}/auction`),
    ]);

    const managerPendingCount = marketPendingCount + auctionPendingCount;

    await Promise.all([
        summaryRef.set(
            {
                marketPendingCount,
                auctionPendingCount,
                managerPendingCount,
                hasManagerPending: managerPendingCount > 0,
                sellerPendingSaleAlertCounts: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        ),
        writeNotificationActionCounts(
            classId,
            "marketplace",
            sellerPendingSaleAlertCounts,
            {},
        ),
    ]);
}

function getMarketplaceManagerPendingContribution(docData) {
    if (!docData || typeof docData !== "object") {
        return 0;
    }

    const status = String(docData.status || "");
    return Number(
        status === "pending" ||
        (docData.approved === false && status !== "rejected"),
    );
}

function getMarketplaceSaleAlertContribution(docData) {
    if (!docData || typeof docData !== "object") {
        return { sellerId: null, count: 0 };
    }

    const sellerId = String(docData.sellerId || "").trim() || null;
    if (
        !sellerId ||
        String(docData.status || "") !== "sold" ||
        docData.sellerSaleAlertPending !== true
    ) {
        return { sellerId: null, count: 0 };
    }

    return { sellerId, count: 1 };
}

function hasMarketplaceContributionChanged(beforeContribution, afterContribution) {
    return (
        Number(beforeContribution?.managerPendingCount || 0) !==
            Number(afterContribution?.managerPendingCount || 0) ||
        String(beforeContribution?.sellerId || "") !==
            String(afterContribution?.sellerId || "") ||
        Number(beforeContribution?.sellerPendingSaleAlertCount || 0) !==
            Number(afterContribution?.sellerPendingSaleAlertCount || 0)
    );
}

async function recomputeSellerMarketplaceActionCount(classId, sellerId) {
    if (!classId || !sellerId) return 0;

    const [marketSnap, auctionSnap] = await Promise.all([
        db
            .collection(`classes/${classId}/marketplace`)
            .where("sellerId", "==", sellerId)
            .where("status", "==", "sold")
            .where("sellerSaleAlertPending", "==", true)
            .get(),
        db
            .collection(`classes/${classId}/auction`)
            .where("sellerId", "==", sellerId)
            .where("status", "==", "sold")
            .where("sellerSaleAlertPending", "==", true)
            .get(),
    ]);

    const pendingSaleAlertCount = marketSnap.size + auctionSnap.size;
    await writeNotificationActionCount(
        classId,
        sellerId,
        "marketplace",
        pendingSaleAlertCount,
    );

    return pendingSaleAlertCount;
}

async function incrementMarketplaceNotificationSummary(
    classId,
    collectionId,
    beforeData = null,
    afterData = null,
) {
    if (!classId) return;
    if (collectionId !== "marketplace" && collectionId !== "auction") return;

    const beforeContribution = {
        managerPendingCount: getMarketplaceManagerPendingContribution(beforeData),
        ...(() => {
            const saleAlert = getMarketplaceSaleAlertContribution(beforeData);
            return {
                sellerId: saleAlert.sellerId,
                sellerPendingSaleAlertCount: saleAlert.count,
            };
        })(),
    };
    const afterContribution = {
        managerPendingCount: getMarketplaceManagerPendingContribution(afterData),
        ...(() => {
            const saleAlert = getMarketplaceSaleAlertContribution(afterData);
            return {
                sellerId: saleAlert.sellerId,
                sellerPendingSaleAlertCount: saleAlert.count,
            };
        })(),
    };

    if (!hasMarketplaceContributionChanged(beforeContribution, afterContribution)) {
        return;
    }

    const summaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.marketplace));
    const managerPendingDelta =
        Number(afterContribution?.managerPendingCount || 0) -
        Number(beforeContribution?.managerPendingCount || 0);
    const affectedSellerIds = [
        ...new Set([
            beforeContribution.sellerId,
            afterContribution.sellerId,
        ].filter(Boolean)),
    ];

    await db.runTransaction(async (tx) => {
        const summarySnap = await tx.get(summaryRef);
        const summary = summarySnap.data() || {};

        const currentMarketPendingCount = Math.max(
            0,
            Number(summary.marketPendingCount || 0) +
                (collectionId === "marketplace" ? managerPendingDelta : 0),
        );
        const currentAuctionPendingCount = Math.max(
            0,
            Number(summary.auctionPendingCount || 0) +
                (collectionId === "auction" ? managerPendingDelta : 0),
        );
        const currentManagerPendingCount = Math.max(
            0,
            Number(summary.managerPendingCount || 0) + managerPendingDelta,
        );

        tx.set(
            summaryRef,
            {
                marketPendingCount: currentMarketPendingCount,
                auctionPendingCount: currentAuctionPendingCount,
                managerPendingCount: currentManagerPendingCount,
                hasManagerPending: currentManagerPendingCount > 0,
                sellerPendingSaleAlertCounts: FieldValue.delete(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
    });

    if (affectedSellerIds.length > 0) {
        await Promise.all(
            affectedSellerIds.map((sellerId) =>
                recomputeSellerMarketplaceActionCount(classId, sellerId),
            ),
        );
    }
}

async function recomputeAssemblyNotificationSummaryForUser(classId, studentUid) {
    const billsSnap = await db.collection(`classes/${classId}/assemblyBills`).get();
    const billDocs = billsSnap.docs.map((billDoc) => ({
        id: billDoc.id,
        ref: billDoc.ref,
        data: billDoc.data() || {},
    }));
    const openBillIds = new Set(
        billDocs
            .filter((billDoc) => billDoc.data?.status === "voting")
            .map((billDoc) => billDoc.id),
    );

    const voterSnaps = await Promise.all(
        billDocs.map((billDoc) =>
            billDoc.ref.collection("voters").doc(studentUid).get(),
        ),
    );

    const voteChoicesByBill = {};
    let votedOpenBillCount = 0;

    voterSnaps.forEach((voterSnap, index) => {
        if (!voterSnap.exists) {
            return;
        }

        const vote = getAssemblyVoteChoice(voterSnap.data() || {});
        if (!vote) {
            return;
        }

        const billId = billDocs[index]?.id;
        if (!billId) {
            return;
        }

        voteChoicesByBill[billId] = vote;
        if (openBillIds.has(billId)) {
            votedOpenBillCount += 1;
        }
    });

    const openVotingBillCount = Number(openBillIds.size || 0);
    const pendingVoteCount = Math.max(
        0,
        openVotingBillCount - votedOpenBillCount,
    );

    await Promise.all([
        db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.assembly)).set(
            createAssemblyClassSummaryPayload(openVotingBillCount),
            { merge: true },
        ),
        db.doc(ASSEMBLY_USER_SUMMARY_DOC_PATH(classId, studentUid)).set(
            createAssemblyUserSummaryPayload({
                votedOpenBillCount,
                voteChoicesByBill,
            }),
            { merge: true },
        ),
        writeNotificationActionCount(
            classId,
            studentUid,
            "assembly",
            pendingVoteCount,
        ),
    ]);

    return {
        classId,
        studentUid,
        openVotingBillCount,
        votedOpenBillCount,
        pendingVoteCount,
    };
}

async function recomputeAssemblyNotificationSummary(classId) {
    const [billsSnap, existingUserSummariesSnap, studentsSnap] = await Promise.all([
        db.collection(`classes/${classId}/assemblyBills`).get(),
        db.collection(ASSEMBLY_USER_SUMMARY_COLLECTION_PATH(classId)).get(),
        db.collection(`classes/${classId}/students`).get(),
    ]);

    const openBillIds = new Set(
        billsSnap.docs
            .filter((billDoc) => billDoc.data()?.status === "voting")
            .map((billDoc) => billDoc.id),
    );
    const votedOpenBillCounts = {};
    const voteChoicesByUser = {};

    await Promise.all(
        billsSnap.docs.map(async (billDoc) => {
            const votersSnap = await billDoc.ref.collection("voters").get();
            const isOpenBill = openBillIds.has(billDoc.id);

            votersSnap.forEach((voterDoc) => {
                const voterData = voterDoc.data() || {};
                const voterUid = String(
                    voterData.voterUid || voterDoc.id || "",
                ).trim();
                const vote = getAssemblyVoteChoice(voterData);

                if (!voterUid) return;
                if (!vote) return;

                voteChoicesByUser[voterUid] = voteChoicesByUser[voterUid] || {};
                voteChoicesByUser[voterUid][billDoc.id] = vote;

                if (!isOpenBill) {
                    return;
                }

                incrementCounter(votedOpenBillCounts, voterUid, 1);
            });
        }),
    );

    const openVotingBillCount = Number(openBillIds.size || 0);
    const userIds = new Set([
        ...Object.keys(voteChoicesByUser),
        ...existingUserSummariesSnap.docs.map((docSnap) => docSnap.id),
    ]);
    const studentUids = studentsSnap.docs.map((docSnap) => docSnap.id).filter(Boolean);

    const writes = [
        {
            ref: db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.assembly)),
            data: createAssemblyClassSummaryPayload(openVotingBillCount),
            options: { merge: true },
        },
    ];

    userIds.forEach((uid) => {
        const voteChoicesByBill = voteChoicesByUser[uid] || {};
        const votedOpenBillCount = getCountMapValue(votedOpenBillCounts, uid);

        writes.push({
            ref: db.doc(ASSEMBLY_USER_SUMMARY_DOC_PATH(classId, uid)),
            data: createAssemblyUserSummaryPayload({
                votedOpenBillCount,
                voteChoicesByBill,
            }),
            options: { merge: true },
        });
    });

    await Promise.all([
        commitChunkedSetWrites(writes),
        writeNotificationActionCounts(
            classId,
            "assembly",
            buildAssemblyActionCounts(
                studentUids,
                openVotingBillCount,
                votedOpenBillCounts,
            ),
            {},
        ),
    ]);
}

async function syncAssemblyNotificationSummaryForBillWrite(
    classId,
    billId,
    beforeBillData = null,
    afterBillData = null,
) {
    const openVotingBillCountDelta = getAssemblyStatusChangeDelta(
        beforeBillData,
        afterBillData,
    );
    if (!openVotingBillCountDelta) {
        return;
    }

    const classSummaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.assembly));
    const billRef = db.doc(`classes/${classId}/assemblyBills/${billId}`);

    try {
        await db.runTransaction(async (transaction) => {
            const classSummarySnap = await transaction.get(classSummaryRef);
            const classSummaryData = classSummarySnap.exists ?
                (classSummarySnap.data() || {}) :
                null;

            if (
                !classSummaryData ||
                getAssemblySummaryVersionNumber(classSummaryData) <
                    ASSEMBLY_SUMMARY_VERSION
            ) {
                throw createAssemblyRepairFallbackError(
                    "class",
                    "Assembly class summary is missing or outdated.",
                );
            }

            const currentOpenVotingBillCount =
                getAssemblyClassOpenVotingCount(classSummaryData);
            if (currentOpenVotingBillCount == null) {
                throw createAssemblyRepairFallbackError(
                    "class",
                    "Assembly class summary open count is invalid.",
                );
            }

            const votersSnap = await transaction.get(billRef.collection("voters"));
            const validVoterUids = getAssemblyValidVoterUids(votersSnap.docs);
            const userSummaryRefs = validVoterUids.map((uid) =>
                db.doc(ASSEMBLY_USER_SUMMARY_DOC_PATH(classId, uid)),
            );
            const userSummarySnaps = userSummaryRefs.length ?
                await transaction.getAll(...userSummaryRefs) :
                [];

            transaction.set(
                classSummaryRef,
                createAssemblyClassSummaryPayload(
                    currentOpenVotingBillCount + openVotingBillCountDelta,
                ),
                { merge: true },
            );

            userSummarySnaps.forEach((userSummarySnap, index) => {
                const userSummaryData = userSummarySnap.exists ?
                    (userSummarySnap.data() || {}) :
                    null;

                if (
                    !userSummaryData ||
                    getAssemblySummaryVersionNumber(userSummaryData) <
                        ASSEMBLY_SUMMARY_VERSION
                ) {
                    throw createAssemblyRepairFallbackError(
                        "class",
                        "Assembly user summary is missing or outdated.",
                    );
                }

                const currentVotedOpenBillCount =
                    getAssemblyUserVotedOpenCount(userSummaryData);
                if (currentVotedOpenBillCount == null) {
                    throw createAssemblyRepairFallbackError(
                        "class",
                        "Assembly user summary count is invalid.",
                    );
                }

                transaction.set(
                    userSummaryRefs[index],
                    createAssemblyUserSummaryPayload({
                        votedOpenBillCount:
                            currentVotedOpenBillCount + openVotingBillCountDelta,
                    }),
                    { merge: true },
                );
            });
        });

        await syncAssemblyActionCountsForClassFromSummaries(classId);
    } catch (error) {
        if (isAssemblyRepairFallbackError(error)) {
            await recomputeAssemblyNotificationSummary(classId);
            return;
        }

        throw error;
    }
}

async function syncAssemblyNotificationSummaryForVoteWrite(
    classId,
    billId,
    voterUid,
    beforeVoteData = null,
    afterVoteData = null,
) {
    const beforeVoteChoice = getAssemblyVoteChoice(beforeVoteData);
    const afterVoteChoice = getAssemblyVoteChoice(afterVoteData);

    if (beforeVoteChoice === afterVoteChoice) {
        return;
    }

    const billRef = db.doc(`classes/${classId}/assemblyBills/${billId}`);
    const classSummaryRef = db.doc(SUMMARY_DOC_PATH(classId, SUMMARY_KEYS.assembly));
    const userSummaryRef = db.doc(
        ASSEMBLY_USER_SUMMARY_DOC_PATH(classId, voterUid),
    );

    try {
        await db.runTransaction(async (transaction) => {
            const [billSnap, classSummarySnap, userSummarySnap] =
                await transaction.getAll(
                    billRef,
                    classSummaryRef,
                    userSummaryRef,
                );

            const userSummaryData = userSummarySnap.exists ?
                (userSummarySnap.data() || {}) :
                null;

            if (!billSnap.exists) {
                if (
                    afterVoteChoice ||
                    !userSummaryData ||
                    getAssemblySummaryVersionNumber(userSummaryData) <
                        ASSEMBLY_SUMMARY_VERSION
                ) {
                    return;
                }

                const currentVotedOpenBillCount =
                    getAssemblyUserVotedOpenCount(userSummaryData);
                if (currentVotedOpenBillCount == null) {
                    return;
                }

                const voteChoicesByBill =
                    getAssemblySummaryVoteChoices(userSummaryData);
                if (!voteChoicesByBill[billId]) {
                    return;
                }

                delete voteChoicesByBill[billId];
                transaction.set(
                    userSummaryRef,
                    createAssemblyUserSummaryPayload({
                        votedOpenBillCount: currentVotedOpenBillCount,
                        voteChoicesByBill,
                    }),
                    { merge: true },
                );
                return;
            }

            const classSummaryData = classSummarySnap.exists ?
                (classSummarySnap.data() || {}) :
                null;

            if (
                !classSummaryData ||
                getAssemblySummaryVersionNumber(classSummaryData) <
                    ASSEMBLY_SUMMARY_VERSION
            ) {
                throw createAssemblyRepairFallbackError(
                    "class",
                    "Assembly class summary is missing or outdated.",
                );
            }

            if (
                !userSummaryData ||
                getAssemblySummaryVersionNumber(userSummaryData) <
                    ASSEMBLY_SUMMARY_VERSION
            ) {
                throw createAssemblyRepairFallbackError(
                    "user",
                    "Assembly user summary is missing or outdated.",
                );
            }

            const currentOpenVotingBillCount =
                getAssemblyClassOpenVotingCount(classSummaryData);
            const currentVotedOpenBillCount =
                getAssemblyUserVotedOpenCount(userSummaryData);
            if (
                currentOpenVotingBillCount == null ||
                currentVotedOpenBillCount == null
            ) {
                throw createAssemblyRepairFallbackError(
                    "user",
                    "Assembly summary counts are invalid.",
                );
            }

            const voteChoicesByBill = getAssemblySummaryVoteChoices(userSummaryData);
            if (afterVoteChoice) {
                voteChoicesByBill[billId] = afterVoteChoice;
            } else {
                delete voteChoicesByBill[billId];
            }

            const votedOpenBillCountDelta = isAssemblyBillVoting(
                billSnap.data() || {},
            ) ?
                Number(Boolean(afterVoteChoice)) - Number(Boolean(beforeVoteChoice)) :
                0;

            transaction.set(
                userSummaryRef,
                createAssemblyUserSummaryPayload({
                    votedOpenBillCount:
                        currentVotedOpenBillCount + votedOpenBillCountDelta,
                    voteChoicesByBill,
                }),
                { merge: true },
            );
        });

        await syncAssemblyActionCountForStudentFromSummaries(classId, voterUid);
    } catch (error) {
        if (isAssemblyRepairFallbackError(error)) {
            if (error.scope === "class") {
                await recomputeAssemblyNotificationSummary(classId);
                return;
            }

            await recomputeAssemblyNotificationSummaryForUser(classId, voterUid);
            return;
        }

        throw error;
    }
}

async function recomputeCaseLibraryNotificationSummary() {
    const [postsSnap, requestsSnap] = await Promise.all([
        db.collectionGroup("caseLibraryPosts").get(),
        db.collectionGroup("caseLibraryRequests").get(),
    ]);

    let latestPostCreatedAt = null;
    let latestRequestCreatedAt = null;
    let latestActivityAt = null;

    postsSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const createdAt = data.createdAt || null;
        latestPostCreatedAt = getLatestTimestamp(latestPostCreatedAt, createdAt);
        latestActivityAt = getLatestTimestamp(latestActivityAt, createdAt);
    });

    requestsSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const createdAt = data.createdAt || null;
        latestRequestCreatedAt = getLatestTimestamp(latestRequestCreatedAt, createdAt);
        latestActivityAt = getLatestTimestamp(latestActivityAt, createdAt);
    });

    await db.doc(CASE_LIBRARY_SUMMARY_DOC_PATH).set(
        {
            postCount: Number(postsSnap.size || 0),
            requestCount: Number(requestsSnap.size || 0),
            hasPosts: postsSnap.size > 0,
            hasRequests: requestsSnap.size > 0,
            latestPostCreatedAt: latestPostCreatedAt || null,
            latestRequestCreatedAt: latestRequestCreatedAt || null,
            latestActivityAt: latestActivityAt || null,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
}

exports.syncRegularMissionStudentStateSummary = onDocumentWritten(
    { document: "classes/{classId}/students/{studentUid}/missionState/{missionId}", region: "asia-northeast3", retry: true },
    async (event) => {
        const { classId, missionId, studentUid } = event.params;
        const before = event.data?.before?.exists ? event.data.before.data() : null;
        const after = event.data?.after?.exists ? event.data.after.data() : null;
        if ((after || before)?.kind !== "regular" || (after || before)?.sourceStorageVersion !== 2) return;
        if (!before && Number(after?.revision || 0) === 0) return;
        const ref = db.doc(`classes/${classId}/missions/${missionId}`);
        const snap = await ref.get();
        if (!snap.exists || snap.data()?.stateStorageVersion !== 2) return;
        const current = await readMissionStudentStates(db, ref, snap.data());
        const withState = (state) => {
            const result = { ...current, completions: { ...current.completions }, submissionsIndex: { ...current.submissionsIndex } };
            if (state?.completion) result.completions[studentUid] = state.completion;
            else delete result.completions[studentUid];
            if (state?.submissionId) result.submissionsIndex[studentUid] = state.submissionId;
            else delete result.submissionsIndex[studentUid];
            return result;
        };
        await incrementMissionNotificationSummary(classId, missionId, withState(before), withState(after), {
            projectionMissionData: current,
        });
    },
);

exports.syncMissionNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/missions/{missionId}",
        region: "asia-northeast3",
        retry: true,
    },
    async (event) => {
        const { classId, missionId } = event.params;
        if (!classId || !missionId) return;

        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;

        // The cutover command rebuilds once per class after copying all tasks.
        // Migrated state creation is not a new submission or reward operation.
        if (beforeData?.stateStorageVersion !== 2 && afterData?.stateStorageVersion === 2 && afterData?.stateStorageMigratedAt) return;

        // During preparation, old clients may still edit legacy completion
        // feedback directly. Re-read the authoritative root in the transaction;
        // a delayed trigger must not copy an older event over newer state.
        if (afterData?.studentStateMirrorVersion === 1 && afterData.stateStorageVersion !== 2 && afterData.type !== "always") {
            const result = await prepareMissionStudentStates(
                db,
                db.doc(`classes/${classId}/missions/${missionId}`),
                { apply: true, FieldValue, requirePrepared: true },
            );
            if (result.outcome === "blocked") {
                throw new Error("Prepared mission state mirror reconciliation is blocked.");
            }
        }

        await incrementMissionNotificationSummary(
            classId,
            missionId,
            beforeData,
            afterData,
        );
    },
);

async function handleMissionSummaryOnStudentWrite(event) {
    const { classId, studentId } = event.params;
    if (!classId || !studentId) return;

    const beforeData = event.data?.before?.exists ?
        (event.data.before.data() || {}) :
        null;
    const afterData = event.data?.after?.exists ?
        (event.data.after.data() || {}) :
        null;

    if (!beforeData || !afterData) {
        await recomputeMissionNotificationSummary(classId);
        return;
    }

    if (!hasMissionStudentStructuralChanges(beforeData, afterData)) {
        return;
    }

    await recomputeStudentMissionProjections(
        classId,
        studentId,
        afterData,
    );
}

exports.__handleMissionSummaryOnStudentWrite =
    handleMissionSummaryOnStudentWrite;

exports.backfillMissionDashboardSummary = onCall(
    { region: "asia-northeast3", timeoutSeconds: 540 },
    async (request) => {
        const data = request.data || {};
        const requestedClassId = typeof data.classId === "string" ?
            data.classId.trim() :
            "";
        const requestedStudentUid = typeof data.studentUid === "string" ?
            data.studentUid.trim() :
            "";
        const scope = data.scope === "class" ? "class" : "self";
        const fallbackClassId = request.auth?.token?.classId || "";
        const classId = requestedClassId || fallbackClassId;

        const ctx = await assertMissionSummaryRebuildAccess(request, classId, scope);

        if (scope === "class") {
            await recomputeMissionNotificationSummary(classId);
            return { success: true, scope, classId };
        }

        const studentUid = requestedStudentUid || ctx.uid;
        if (
            ctx.role !== "admin" &&
            ctx.role !== "teacher" &&
            studentUid !== ctx.uid
        ) {
            throw new HttpsError(
                "permission-denied",
                "You can only rebuild your own mission dashboard summary.",
            );
        }

        const result = await recomputeStudentDashboardMissionSummary(classId, studentUid);
        return {
            success: true,
            scope,
            ...result,
        };
    },
);

exports.__recomputeMissionNotificationSummary = recomputeMissionNotificationSummary;
exports.__activateTeacherMissionDetachedStatusSummary =
    activateTeacherMissionDetachedStatusSummary;
exports.__restoreTeacherMissionEmbeddedStatusSummary =
    restoreTeacherMissionEmbeddedStatusSummary;
exports.__buildTeacherMissionStatusPayload = buildTeacherMissionStatusPayload;
exports.__recomputeNoticeNotificationSummary = recomputeNoticeNotificationSummary;
exports.__recomputeBankNotificationSummary = recomputeBankNotificationSummary;
exports.__recomputeCredentialsNotificationSummary = recomputeCredentialsNotificationSummary;
exports.__recomputeMarketplaceNotificationSummary = recomputeMarketplaceNotificationSummary;
exports.__recomputeRealEstateNotificationSummary = recomputeRealEstateNotificationSummary;
exports.__recomputeTaxNotificationSummary = recomputeTaxNotificationSummary;
exports.__recomputePoliceNotificationSummary = recomputePoliceNotificationSummary;
exports.__recomputeAssemblyNotificationSummary = recomputeAssemblyNotificationSummary;

exports.rebuildNotificationStateMain = onCall(
    { region: "asia-northeast3", timeoutSeconds: 540 },
    async (request) => {
        const data = request.data || {};
        const requestedClassId = typeof data.classId === "string" ?
            data.classId.trim() :
            "";
        const requestedStudentUid = typeof data.studentUid === "string" ?
            data.studentUid.trim() :
            "";
        const scope = data.scope === "class" ? "class" : "self";
        const fallbackClassId = request.auth?.token?.classId || "";
        const classId = requestedClassId || fallbackClassId;
        const ctx = await assertNotificationStateRebuildAccess(
            request,
            classId,
            scope,
        );

        if (scope === "class") {
            if (ctx.role !== "admin" && ctx.role !== "teacher") {
                throw new HttpsError(
                    "permission-denied",
                    "Only teachers can rebuild class notification state.",
                );
            }

            const result = await rebuildNotificationStateMainForClass(classId);
            return {
                success: true,
                scope,
                ...result,
            };
        }

        const studentUid = requestedStudentUid || ctx.uid;
        if (
            ctx.role !== "admin" &&
            ctx.role !== "teacher" &&
            studentUid !== ctx.uid
        ) {
            throw new HttpsError(
                "permission-denied",
                "You can only rebuild your own notification state.",
            );
        }

        const result = await rebuildNotificationStateMainForStudent(
            classId,
            studentUid,
        );
        return {
            success: true,
            scope,
            ...result,
        };
    },
);

exports.rebuildAssemblyNotificationSummary = onCall(
    { region: "asia-northeast3", timeoutSeconds: 540 },
    async (request) => {
        const data = request.data || {};
        const requestedClassId = typeof data.classId === "string" ?
            data.classId.trim() :
            "";
        const requestedStudentUid = typeof data.studentUid === "string" ?
            data.studentUid.trim() :
            "";
        const scope = data.scope === "class" ? "class" : "self";
        const fallbackClassId = request.auth?.token?.classId || "";
        const classId = requestedClassId || fallbackClassId;
        const ctx = await assertAssemblySummaryRebuildAccess(
            request,
            classId,
            scope,
        );

        if (scope === "class") {
            if (ctx.role !== "admin" && ctx.role !== "teacher") {
                throw new HttpsError(
                    "permission-denied",
                    "Only teachers can rebuild class assembly summaries.",
                );
            }

            await recomputeAssemblyNotificationSummary(classId);
            return { success: true, scope, classId };
        }

        const studentUid = requestedStudentUid || ctx.uid;
        if (
            ctx.role !== "admin" &&
            ctx.role !== "teacher" &&
            studentUid !== ctx.uid
        ) {
            throw new HttpsError(
                "permission-denied",
                "You can only rebuild your own assembly summary.",
            );
        }

        const result = await recomputeAssemblyNotificationSummaryForUser(
            classId,
            studentUid,
        );
        return {
            success: true,
            scope,
            ...result,
        };
    },
);

exports.syncNoticeNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/students/{studentUid}/notifications/{notificationId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId, studentUid } = event.params;
        if (!classId || !studentUid) return;

        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;

        await recomputeNoticeNotificationSummary(
            classId,
            studentUid,
            beforeData,
            afterData,
        );
    },
);

exports.syncTaxNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/students/{studentUid}/taxBills/{billId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId, studentUid } = event.params;
        if (!classId || !studentUid) return;

        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;
        if (!hasTaxNotificationContributionChanged(beforeData, afterData)) return;

        await recomputeTaxNotificationSummary(classId, studentUid);
    },
);

async function syncBankNotificationSummaryForCollection(event, collectionId) {
    const { classId, studentUid } = event.params;
    if (!classId || !studentUid) return;

    const beforeData = event.data?.before?.exists ?
        (event.data.before.data() || {}) :
        null;
    const afterData = event.data?.after?.exists ?
        (event.data.after.data() || {}) :
        null;

    // Skip writes that do not affect the bank summary contribution at all.
    if (!hasBankSummaryRelevantChange(collectionId, beforeData, afterData)) {
        return;
    }

    await incrementBankNotificationSummary(
        classId,
        studentUid,
        collectionId,
        beforeData,
        afterData,
    );
}

exports.syncBankSavingsNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/students/{studentUid}/savings/{docId}",
        region: "asia-northeast3",
    },
    async (event) => {
        await syncBankNotificationSummaryForCollection(event, "savings");
    },
);

exports.syncBankLoansNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/students/{studentUid}/loans/{docId}",
        region: "asia-northeast3",
    },
    async (event) => {
        await syncBankNotificationSummaryForCollection(event, "loans");
    },
);

exports.syncCredentialsNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/titleRequests/{requestId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId } = event.params;
        if (!classId) return;

        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;

        await incrementCredentialsNotificationSummary(
            classId,
            beforeData,
            afterData,
        );
    },
);

exports.syncPoliceReportNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/policeReports/{reportId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId } = event.params;
        if (!classId) return;
        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;

        await incrementPoliceNotificationSummary(classId, {
            reportBeforeData: beforeData,
            reportAfterData: afterData,
        });
    },
);

exports.syncPoliceFineNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/policeFineHistory/{fineId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId } = event.params;
        if (!classId) return;
        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;

        await incrementPoliceNotificationSummary(classId, {
            fineBeforeData: beforeData,
            fineAfterData: afterData,
        });
    },
);

exports.syncMarketplaceNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/marketplace/{itemId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId } = event.params;
        if (!classId) return;

        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;

        await incrementMarketplaceNotificationSummary(
            classId,
            "marketplace",
            beforeData,
            afterData,
        );
    },
);

exports.syncMarketplaceAuctionNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/auction/{itemId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId } = event.params;
        if (!classId) return;

        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;

        await incrementMarketplaceNotificationSummary(
            classId,
            "auction",
            beforeData,
            afterData,
        );
    },
);

exports.syncAssemblyNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/assemblyBills/{billId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId, billId } = event.params;
        if (!classId) return;

        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;

        await syncAssemblyNotificationSummaryForBillWrite(
            classId,
            billId,
            beforeData,
            afterData,
        );
    },
);

exports.syncAssemblyVoteNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/assemblyBills/{billId}/voters/{voterUid}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId, billId, voterUid } = event.params;
        if (!classId) return;

        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || {}) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || {}) :
            null;

        await syncAssemblyNotificationSummaryForVoteWrite(
            classId,
            billId,
            voterUid,
            beforeData,
            afterData,
        );
    },
);

exports.syncCaseLibraryPostNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/caseLibraryPosts/{postId}",
        region: "asia-northeast3",
    },
    async () => {
        await recomputeCaseLibraryNotificationSummary();
    },
);

exports.syncCaseLibraryRequestNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/caseLibraryRequests/{requestId}",
        region: "asia-northeast3",
    },
    async () => {
        await recomputeCaseLibraryNotificationSummary();
    },
);

exports.syncRealEstateNotificationSummary = onDocumentWritten(
    {
        document: "classes/{classId}/real_estate/layout",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId } = event.params;
        if (!classId) return;
        const before = event.data?.before?.data(), after = event.data?.after?.data();
        if (after?.storageSchemaVersion === 3 && before?.storageSchemaVersion === 3 && sameRealEstateSource(before.groups, after.groups)) return;
        await recomputeRealEstateNotificationSummary(classId);
    },
);

// Financial changes need not rewrite the lean layout document.
for (const [name, document] of [
    ['syncRealEstatePropertyNotifications', 'classes/{classId}/real_estate/properties/items/{deskId}'],
    ['syncRealEstateContractNotifications', 'classes/{classId}/real_estate/contracts/records/{contractId}'],
]) {
    exports[name] = onDocumentWritten({ document, region: 'asia-northeast3' }, async (event) => {
        const before = event.data?.before?.data(), after = event.data?.after?.data();
        if (name === 'syncRealEstateContractNotifications' && before?.kind !== 'rent' && after?.kind !== 'rent') return;
        if (name === 'syncRealEstatePropertyNotifications' && sameRealEstateSource(rentPropertyFields(before), rentPropertyFields(after))) return;
        if (event.params.classId) await recomputeRealEstateNotificationSummary(event.params.classId);
    });
}
