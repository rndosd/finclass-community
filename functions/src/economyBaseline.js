"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");
const {
    buildStudentPayrollCachePatch,
    isActiveStudent,
    loadJobDefinitions,
    normalizeJobNames,
    rebuildEconomyBaselineCaches,
} = require("../utils/economyBaseline");

const db = admin.firestore();
const REGION = "asia-northeast3";
const STUDENT_DOC_BRIDGE_SOURCE = "student_doc_bridge";

function haveJobListsChanged(beforeData = {}, afterData = {}) {
    const beforeJobs = normalizeJobNames(beforeData.jobs || beforeData.job)
        .sort((left, right) => left.localeCompare(right));
    const afterJobs = normalizeJobNames(afterData.jobs || afterData.job)
        .sort((left, right) => left.localeCompare(right));

    if (beforeJobs.length !== afterJobs.length) return true;
    return beforeJobs.some((jobName, index) => jobName !== afterJobs[index]);
}

function haveStudentBaselineInputsChanged(beforeData = {}, afterData = {}) {
    const beforeRole = String(beforeData.role || "student").toLowerCase();
    const afterRole = String(afterData.role || "student").toLowerCase();
    if (beforeRole !== afterRole) return true;

    const beforeStatus = String(beforeData.status || "").toLowerCase();
    const afterStatus = String(afterData.status || "").toLowerCase();
    if (beforeStatus !== afterStatus) return true;

    const beforeExcluded =
        beforeData?.statsExclusion?.monetaryAggregates === true;
    const afterExcluded =
        afterData?.statsExclusion?.monetaryAggregates === true;
    if (beforeExcluded !== afterExcluded) return true;

    return haveJobListsChanged(beforeData, afterData);
}

function haveJobDefinitionSalaryInputsChanged(beforeData = {}, afterData = {}) {
    const beforeName = String(beforeData.name || "").trim();
    const afterName = String(afterData.name || "").trim();
    if (beforeName !== afterName) return true;

    const beforeSalary = Number(beforeData.baseSalary || 0);
    const afterSalary = Number(afterData.baseSalary || 0);
    if (beforeSalary !== afterSalary) return true;

    const beforeTarget = beforeData.targetHeadcount ?? null;
    const afterTarget = afterData.targetHeadcount ?? null;
    return String(beforeTarget) !== String(afterTarget);
}

function hasFreshPayrollCache(studentData = {}) {
    const payroll = studentData.payroll || {};
    return Number(payroll.salaryCacheVersion || 0) > 0 &&
        Number.isFinite(Number(payroll.currentWeeklySalary));
}

async function updateSingleStudentPayrollCache({
    classId,
    studentId,
    studentRef,
    studentData,
    jobDefinitions = null,
}) {
    if (!isActiveStudent(studentData)) return false;

    const resolvedJobDefinitions = Array.isArray(jobDefinitions)
        ? jobDefinitions
        : await loadJobDefinitions(classId);
    const patch = buildStudentPayrollCachePatch(
        studentData,
        resolvedJobDefinitions,
    );
    if (!patch) return false;

    await studentRef.update(patch);
    console.log(
        `[economyBaseline] updated payroll cache classId=${classId} studentId=${studentId}`,
    );
    return true;
}

async function handleStudentPayrollCacheFromStudentWrite(event) {
    const { classId, studentId } = event.params;
    const beforeExists = event.data?.before.exists;
    const afterExists = event.data?.after.exists;
    const beforeData = event.data?.before.data() || {};
    const afterData = afterExists ? event.data.after.data() || {} : {};
    const documentDeleted = beforeExists && !afterExists;

    if (!beforeExists && !afterExists) return null;

    const inputsChanged = documentDeleted ||
        haveStudentBaselineInputsChanged(beforeData, afterData);
    const cacheMissing = afterExists && !hasFreshPayrollCache(afterData);
    if (!inputsChanged && !cacheMissing) return null;

    if (afterExists) {
        await updateSingleStudentPayrollCache({
            classId,
            studentId,
            studentRef: event.data.after.ref,
            studentData: afterData,
        });
    }

    await rebuildEconomyBaselineCaches(classId, {
        source: "student_write",
        writeStudentCaches: false,
    });
    return null;
}

exports.__handleStudentPayrollCacheFromStudentWrite =
    handleStudentPayrollCacheFromStudentWrite;

exports.syncStudentPayrollCacheFromAssignment = onDocumentWritten(
    {
        document: "classes/{classId}/studentJobAssignments/{studentId}",
        region: REGION,
        cpu: "gcf_gen1",
    },
    async (event) => {
        const { classId, studentId } = event.params;
        const beforeData = event.data?.before.data() || {};
        const afterData = event.data?.after.exists
            ? event.data.after.data() || {}
            : {};

        if (!haveJobListsChanged(beforeData, afterData)) return null;
        if (
            beforeData.mirrorSource === STUDENT_DOC_BRIDGE_SOURCE ||
            afterData.mirrorSource === STUDENT_DOC_BRIDGE_SOURCE
        ) {
            // The student document trigger already refreshed the payroll cache and
            // class baseline. Avoid repeating the same class-wide rebuild when its
            // assignment mirror arrives.
            return null;
        }

        const studentRef = db.doc(`classes/${classId}/students/${studentId}`);
        const studentSnap = await studentRef.get();
        if (!studentSnap.exists) {
            await rebuildEconomyBaselineCaches(classId, {
                source: "student_assignment_write",
                writeStudentCaches: false,
            });
            return null;
        }

        const studentData = studentSnap.data() || {};
        await updateSingleStudentPayrollCache({
            classId,
            studentId,
            studentRef,
            studentData,
        });
        await rebuildEconomyBaselineCaches(classId, {
            source: "student_assignment_write",
            writeStudentCaches: false,
        });
        return null;
    },
);

exports.syncEconomyBaselineOnJobDefinitionWrite = onDocumentWritten(
    {
        document: "classes/{classId}/jobDefinitions/{jobId}",
        region: REGION,
        cpu: "gcf_gen1",
    },
    async (event) => {
        const beforeData = event.data?.before.data() || {};
        const afterData = event.data?.after.exists
            ? event.data.after.data() || {}
            : {};
        const { classId } = event.params;

        if (!haveJobDefinitionSalaryInputsChanged(beforeData, afterData)) {
            return null;
        }

        await rebuildEconomyBaselineCaches(classId, {
            source: "job_definition_write",
            writeStudentCaches: true,
        });
        return null;
    },
);

exports.backfillEconomyBaselineCaches = onCall(
    {
        region: REGION,
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    async (request) => {
        const classId = String(request.data?.classId || "").trim();
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        const result = await rebuildEconomyBaselineCaches(classId, {
            source: "manual_backfill",
            writeStudentCaches: true,
        });

        return {
            success: true,
            classId,
            totalStudents: result.totalStudents,
            activeStudentCount: result.activeStudentCount,
            updatedStudents: result.updatedStudents,
            baselineWeeklySalary: result.summary.baselineWeeklySalary,
            weeklyPayrollLiability: result.summary.weeklyPayrollLiability,
            assignedStudentCount: result.summary.assignedStudentCount,
            unassignedStudentCount: result.summary.unassignedStudentCount,
        };
    },
);
