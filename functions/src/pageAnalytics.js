"use strict";

const admin = require("../firebaseAdminCompat");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { normalizeMissionStateFields } = require("../utils/missionStudentState");
const { completionDates, markDates } = require("../utils/pageAnalytics/missionDirty");
const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const {
    BACKFILL_START_DATE,
    KST,
} = require("../utils/pageAnalytics/common");
const {
    rebuildDailyAnalytics,
    runScheduledDailyAnalytics,
} = require("../utils/pageAnalytics");

const db = admin.firestore();

exports.collectDailyPageAnalytics = onSchedule(
    {
        schedule: "40 0 * * 2-6",
        timeZone: KST,
        region: "asia-northeast3",
        memory: "1GiB",
        timeoutSeconds: 540,
    },
    async () => {
        try {
            const result = await runScheduledDailyAnalytics(db, {
                source: "scheduled",
                startDate: BACKFILL_START_DATE,
                repairMissionHistory: true,
            });
            const failures = result.results.filter((row) => row.error);
            console.log(
                `[pageAnalyticsDaily] date=${result.date} rows=${result.results.length} failures=${failures.length}`,
            );
            if (failures.length) {
                console.error("[pageAnalyticsDaily] failures", failures);
            }
            return result;
        } catch (error) {
            console.error("[pageAnalyticsDaily] scheduled run failed", error);
            return null;
        }
    },
);

exports.markAlwaysMissionAnalyticsDirty = onDocumentWritten({
    document: "classes/{classId}/students/{studentUid}/missionState/{missionId}/days/{dayKey}",
    region: "asia-northeast3", retry: true,
}, async (event) => {
    await markDates(db, event.params.classId, [event.params.dayKey], event.id);
});

exports.markRegularMissionAnalyticsDirty = onDocumentWritten({
    document: "classes/{classId}/students/{studentUid}/missionState/{missionId}",
    region: "asia-northeast3", retry: true,
}, async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    if ((after || before)?.kind !== "regular") return;
    await markDates(db, event.params.classId,
        [...completionDates(before?.completion || {}), ...completionDates(after?.completion || {})], event.id);
});

exports.markLegacyMissionAnalyticsDirty = onDocumentWritten({
    document: "classes/{classId}/missions/{missionId}", region: "asia-northeast3", retry: true,
}, async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : {};
    const after = event.data?.after?.exists ? event.data.after.data() : {};
    if ((after.type || before.type) === "always" || (after.stateStorageVersion || before.stateStorageVersion) === 2) return;
    const previous = normalizeMissionStateFields(before, { strict: true }).completions || {};
    const current = normalizeMissionStateFields(after, { strict: true }).completions || {};
    const dates = [];
    for (const uid of new Set([...Object.keys(previous), ...Object.keys(current)])) {
        if (JSON.stringify(previous[uid]) === JSON.stringify(current[uid])) continue;
        dates.push(...completionDates(previous[uid]), ...completionDates(current[uid]));
    }
    await markDates(db, event.params.classId, dates, event.id);
});

exports.rebuildPageAnalyticsDaily = onCall(
    {
        region: "asia-northeast3",
        memory: "1GiB",
        timeoutSeconds: 540,
    },
    async (request) => {
        let classId = String(request.data?.classId || request.auth?.token?.classId || "").trim();
        const ctx = assertTeacherOrAdminFromClaims(request, {
            classId: classId || null,
            requireClassForTeacher: false,
        });

        if (ctx.role === "teacher") {
            classId = classId || String(ctx.classId || "").trim();
            if (!classId) {
                throw new HttpsError("failed-precondition", "Teacher requests require classId.");
            }
        }

        return rebuildDailyAnalytics(db, {
            classId,
            domain: request.data?.domain,
            startDate: request.data?.startDate || BACKFILL_START_DATE,
            endDate: request.data?.endDate,
            dryRun: request.data?.dryRun === true,
            limit: Number(request.data?.limit || 0) || 0,
            source: request.data?.source || "callable_backfill",
        });
    },
);
