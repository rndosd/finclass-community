"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("../utils/maintenanceScheduler");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const { mustBeTeacherOrTaxAdmin } = require("../utils/permissions");
const {
    advanceWeeklyPayrollSchedule,
    normalizePayrollAutomationInput,
    resolveFirstPayrollRunAt,
    selectPayrollTargetUids,
} = require("../utils/payrollAutomation");
const { executePayrollBatch } = require("./payroll").__private;

const AUTOMATION_FIELD = "settings.payrollAutomation";
const RUN_COLLECTION = "payrollAutomationRuns";
const LEASE_MS = 12 * 60 * 1000;

function timestampToDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeTimestamp(value) {
    const date = timestampToDate(value);
    return date ? date.toISOString() : null;
}

function serializeSettings(settings = {}) {
    return {
        ...settings,
        nextRunAt: serializeTimestamp(settings.nextRunAt),
        updatedAt: serializeTimestamp(settings.updatedAt),
        lastRun: settings.lastRun ? {
            ...settings.lastRun,
            completedAt: serializeTimestamp(settings.lastRun.completedAt),
        } : null,
    };
}

function toSafeErrorMessage(error) {
    const message = String(error?.message || error || "자동 급여 처리에 실패했습니다.").trim();
    return message.slice(0, 500);
}

function buildRunId(periodStartDate) {
    return `weekly_${periodStartDate}`;
}

async function updateAutomationSettings({ classId, actorUid, input, now = new Date() }) {
    const normalized = normalizePayrollAutomationInput(input);
    const classRef = db.doc(`classes/${classId}`);
    const nextRunDate = normalized.enabled
        ? resolveFirstPayrollRunAt({
            periodStartDate: normalized.periodStartDate,
            firstPaymentDate: normalized.firstPaymentDate,
            numberOfWeeks: normalized.numberOfWeeks,
            dayOfWeek: normalized.dayOfWeek,
            time: normalized.time,
            now,
        })
        : null;
    const stored = await db.runTransaction(async (tx) => {
        const classSnap = await tx.get(classRef);
        if (!classSnap.exists) {
            throw new HttpsError("not-found", "학급 정보를 찾을 수 없습니다.");
        }

        const existing = classSnap.data()?.settings?.payrollAutomation || {};
        const nextSettings = {
            ...normalized,
            version: 2,
            revision: Math.max(0, Number(existing.revision || 0)) + 1,
            configuredByUid: actorUid,
            nextRunAt: nextRunDate ? Timestamp.fromDate(nextRunDate) : null,
            updatedAt: FieldValue.serverTimestamp(),
            lastRun: existing.lastRun || null,
        };
        tx.update(classRef, { [AUTOMATION_FIELD]: nextSettings });
        return nextSettings;
    });
    return {
        ...stored,
        updatedAt: Timestamp.fromDate(now),
    };
}

async function acquireRun({ classRef, runRef, now }) {
    return db.runTransaction(async (tx) => {
        const [classSnap, runSnap] = await Promise.all([
            tx.get(classRef),
            tx.get(runRef),
        ]);
        if (!classSnap.exists) return null;

        const settings = classSnap.data()?.settings?.payrollAutomation || {};
        const nextRunAt = timestampToDate(settings.nextRunAt);
        if (settings.enabled !== true || !nextRunAt || nextRunAt.getTime() > now.getTime()) {
            return null;
        }
        if (runRef.id !== buildRunId(settings.periodStartDate)) return null;

        const existingRun = runSnap.exists ? runSnap.data() || {} : {};
        const leaseUntil = timestampToDate(existingRun.leaseUntil);
        if (
            existingRun.status === "running" &&
            leaseUntil &&
            leaseUntil.getTime() > now.getTime()
        ) {
            return null;
        }
        if (["completed", "partial_failed"].includes(existingRun.status)) {
            return null;
        }

        const runId = runRef.id;
        tx.set(runRef, {
            classId: classRef.id,
            runId,
            status: "running",
            periodStartDate: settings.periodStartDate,
            paymentDate: settings.firstPaymentDate || null,
            numberOfWeeks: settings.numberOfWeeks || 1,
            configurationRevision: Number(settings.revision || 0),
            targetMode: settings.targetMode || "all_jobs",
            selectedJobNames: settings.selectedJobNames || [],
            configuredByUid: settings.configuredByUid || null,
            scheduledFor: settings.nextRunAt,
            startedAt: existingRun.startedAt || FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            leaseUntil: Timestamp.fromDate(new Date(now.getTime() + LEASE_MS)),
            attemptCount: FieldValue.increment(1),
        }, { merge: true });

        return { settings, runId };
    });
}

async function pauseInvalidAutomation({ classRef, settings, error }) {
    const lastRun = {
        status: "failed",
        periodStartDate: settings.periodStartDate || null,
        successCount: 0,
        failureCount: 0,
        targetCount: 0,
        error: toSafeErrorMessage(error),
        completedAt: FieldValue.serverTimestamp(),
    };
    await db.runTransaction(async (tx) => {
        const classSnap = await tx.get(classRef);
        if (!classSnap.exists) return;
        const currentSettings = classSnap.data()?.settings?.payrollAutomation || {};
        if (Number(currentSettings.revision || 0) !== Number(settings.revision || 0)) {
            return;
        }
        tx.update(classRef, {
            [AUTOMATION_FIELD]: {
                ...currentSettings,
                enabled: false,
                nextRunAt: null,
                lastRun,
                updatedAt: FieldValue.serverTimestamp(),
            },
        });
    });
}

async function processClassAutomation(classSnapshot, now = new Date()) {
    const classRef = classSnapshot.ref;
    const initialSettings = classSnapshot.data()?.settings?.payrollAutomation || {};
    let nextRunAt = timestampToDate(initialSettings.nextRunAt);
    if (initialSettings.enabled !== true || !nextRunAt || nextRunAt.getTime() > now.getTime()) {
        return { skipped: true };
    }

    let normalized;
    try {
        normalized = normalizePayrollAutomationInput(initialSettings);
        await mustBeTeacherOrTaxAdmin(classRef.id, initialSettings.configuredByUid, {
            teacherOnly: true,
        });
    } catch (error) {
        await pauseInvalidAutomation({ classRef, settings: initialSettings, error });
        return { paused: true, error: toSafeErrorMessage(error) };
    }

    const runId = buildRunId(normalized.periodStartDate);
    const runRef = classRef.collection(RUN_COLLECTION).doc(runId);
    const acquired = await acquireRun({ classRef, runRef, now });
    if (!acquired) return { skipped: true };
    normalized = normalizePayrollAutomationInput(acquired.settings);
    if (acquired.settings.configuredByUid !== initialSettings.configuredByUid) {
        await mustBeTeacherOrTaxAdmin(classRef.id, acquired.settings.configuredByUid, {
            teacherOnly: true,
        });
    }
    nextRunAt = timestampToDate(acquired.settings.nextRunAt);
    if (!nextRunAt) throw new Error("다음 자동 지급 시각이 없습니다.");

    const studentsSnapshot = await classRef.collection("students").get();
    const students = studentsSnapshot.docs.map((snapshot) => ({
        uid: snapshot.id,
        ...snapshot.data(),
    }));
    const studentUids = selectPayrollTargetUids(students, normalized);

    await runRef.set({
        targetCount: studentUids.length,
        targetStudentUids: studentUids,
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    const batchResult = await executePayrollBatch({
        classId: classRef.id,
        studentUids,
        paymentStartDate: normalized.periodStartDate,
        numberOfWeeks: normalized.numberOfWeeks,
        actorUid: acquired.settings.configuredByUid,
        actorName: "정기 급여 자동 지급",
        allowOverlapOverride: false,
        executionMode: "automation",
        automationRunId: runId,
    });

    const results = batchResult.results || [];
    const successResults = results.filter((result) => result.success === true);
    const failedResults = results.filter((result) => result.success !== true);
    const alreadyProcessedCount = successResults.filter(
        (result) => result.alreadyProcessed === true,
    ).length;
    const runStatus = failedResults.length > 0 ? "partial_failed" : "completed";
    const schedule = advanceWeeklyPayrollSchedule({
        periodStartDate: normalized.periodStartDate,
        firstPaymentDate: normalized.firstPaymentDate,
        nextRunAt,
        numberOfWeeks: normalized.numberOfWeeks,
    });
    const lastRun = {
        runId,
        status: runStatus,
        periodStartDate: normalized.periodStartDate,
        paymentDate: normalized.firstPaymentDate || null,
        targetCount: studentUids.length,
        successCount: successResults.length,
        failureCount: failedResults.length,
        alreadyProcessedCount,
        completedAt: FieldValue.serverTimestamp(),
    };

    await db.runTransaction(async (tx) => {
        const currentClassSnap = await tx.get(classRef);
        const currentSettings = currentClassSnap.data()?.settings?.payrollAutomation || {};
        const sameRevision =
            Number(currentSettings.revision || 0) ===
            Number(acquired.settings.revision || 0);

        tx.set(runRef, {
            status: runStatus,
            successCount: successResults.length,
            failureCount: failedResults.length,
            alreadyProcessedCount,
            failedStudents: failedResults.slice(0, 100).map((result) => ({
                studentUid: result.studentUid,
                error: toSafeErrorMessage(result.error),
            })),
            completedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            leaseUntil: null,
        }, { merge: true });

        if (sameRevision) {
            tx.update(classRef, {
                [AUTOMATION_FIELD]: {
                    ...currentSettings,
                    periodStartDate: schedule.periodStartDate,
                    firstPaymentDate: schedule.firstPaymentDate,
                    nextRunAt: Timestamp.fromDate(schedule.nextRunAt),
                    lastRun,
                    updatedAt: FieldValue.serverTimestamp(),
                },
            });
        }
    });

    console.log("[PayrollAutomation] run completed", {
        classId: classRef.id,
        runId,
        status: runStatus,
        targetCount: studentUids.length,
        successCount: successResults.length,
        failureCount: failedResults.length,
        alreadyProcessedCount,
    });
    return { runId, status: runStatus };
}

exports.updatePayrollAutomationSettings = onCall(
    {
        region: "asia-northeast3",
        memory: "256MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "인증이 필요합니다.");
        }
        const classId = String(request.data?.classId || "").trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "학급 정보가 필요합니다.");
        }
        await mustBeTeacherOrTaxAdmin(classId, request.auth.uid, {
            teacherOnly: true,
        });

        try {
            const stored = await updateAutomationSettings({
                classId,
                actorUid: request.auth.uid,
                input: request.data?.settings || {},
            });
            return { success: true, settings: serializeSettings(stored) };
        } catch (error) {
            if (error instanceof HttpsError) throw error;
            throw new HttpsError("invalid-argument", toSafeErrorMessage(error));
        }
    },
);

exports.processScheduledPayrollAutomations = onSchedule(
    {
        schedule: "every 10 minutes",
        timeZone: "Asia/Seoul",
        cpu: "gcf_gen1",
        memory: "512MiB",
        maxInstances: 1,
        timeoutSeconds: 540,
    },
    async () => {
        const now = new Date();
        const classesSnapshot = await db.collection("classes")
            .where("settings.payrollAutomation.enabled", "==", true)
            .get();
        const results = [];

        for (const classSnapshot of classesSnapshot.docs) {
            try {
                results.push({
                    classId: classSnapshot.id,
                    ...(await processClassAutomation(classSnapshot, now)),
                });
            } catch (error) {
                console.error("[PayrollAutomation] class run failed", {
                    classId: classSnapshot.id,
                    message: toSafeErrorMessage(error),
                    stack: error?.stack || null,
                });
                results.push({
                    classId: classSnapshot.id,
                    error: toSafeErrorMessage(error),
                });
            }
        }

        console.log("[PayrollAutomation] scheduler completed", {
            checkedClassCount: classesSnapshot.size,
            results,
        });
    },
);

exports.__private = {
    acquireRun,
    buildRunId,
    processClassAutomation,
    serializeSettings,
    updateAutomationSettings,
};
