"use strict";

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("../firebaseAdminCompat");
const {
    computeJobPermissionsFromLookup,
    getStudentJobNames,
    mergePermissionMaps,
    permissionMapsEqual,
    resolveManualPermissions,
    resolveJobPermissions,
    sanitizePermissionMap,
    syncStudentPermissionState,
} = require("../utils/permissionSync");
const {
    clearUserCache,
    mustBeTeacherOrTaxAdmin,
} = require("../utils/permissions");
const {
    createStudentJobAssignmentCommand,
    normalizeAssignments,
} = require("../utils/jobPermissionReconcileCommand");

const db = admin.firestore();
const EMPTY_JOB_VALUE = "\uC5C6\uC74C";
const JOB_PERMISSION_INDEX_SUMMARY_VERSION = 2;
const JOB_PERMISSION_INDEX_CACHE_TTL_MS = 30 * 1000;
const jobPermissionIndexCache = new Map();

const jobPermissionIndexRef = (classId) =>
    db.doc(`classes/${classId}/systemSummary/jobPermissionIndex`);
const studentRef = (classId, studentId) =>
    db.doc(`classes/${classId}/students/${studentId}`);

const isPlainObject = (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const sortedJobNames = (studentData = {}) =>
    getStudentJobNames(studentData).sort((left, right) => left.localeCompare(right));

const haveJobAssignmentsChanged = (beforeData = {}, afterData = {}) => {
    const beforeJobs = sortedJobNames(beforeData);
    const afterJobs = sortedJobNames(afterData);
    if (beforeJobs.length !== afterJobs.length) return true;
    return beforeJobs.some((jobName, index) => jobName !== afterJobs[index]);
};

const buildStudentJobSummary = (jobSourceData = {}) => {
    const jobs = getStudentJobNames(jobSourceData);

    return {
        jobs,
        job: jobs[0] || EMPTY_JOB_VALUE,
    };
};

const buildStudentJobSummaryUpdate = (
    studentData = {},
    jobSourceData = {},
) => {
    const currentSummary = buildStudentJobSummary(studentData);
    const nextSummary = buildStudentJobSummary(jobSourceData);

    const hasJobsChanged =
        currentSummary.jobs.length !== nextSummary.jobs.length ||
        currentSummary.jobs.some((jobName, index) => jobName !== nextSummary.jobs[index]);
    if (!hasJobsChanged && currentSummary.job === nextSummary.job) {
        return null;
    }

    return nextSummary;
};

const normalizeLinkedPermissionKeys = (jobDefinition = {}) =>
    Array.isArray(jobDefinition?.linkedPermissionKeys)
        ? [...new Set(
            jobDefinition.linkedPermissionKeys
                .map((key) => String(key || "").trim())
                .filter(Boolean),
        )].sort()
        : [];

const haveJobDefinitionPermissionsChanged = (beforeData = {}, afterData = {}) => {
    const beforeName = String(beforeData?.name || "").trim();
    const afterName = String(afterData?.name || "").trim();
    if (beforeName !== afterName) return true;

    const beforeKeys = normalizeLinkedPermissionKeys(beforeData);
    const afterKeys = normalizeLinkedPermissionKeys(afterData);
    if (beforeKeys.length !== afterKeys.length) return true;

    return beforeKeys.some((key, index) => key !== afterKeys[index]);
};

const loadJobDefinitions = async (classId) => {
    const snapshot = await db.collection(`classes/${classId}/jobDefinitions`).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

const normalizeJobDefinitionForIndex = (jobDefinition = {}) => {
    const name = String(jobDefinition?.name || "").trim();
    if (!name) return null;

    return {
        name,
        linkedPermissionKeys: normalizeLinkedPermissionKeys(jobDefinition),
    };
};

const normalizeJobDefinitionsForIndex = (jobDefinitions = []) =>
    jobDefinitions
        .map((jobDefinition) => normalizeJobDefinitionForIndex(jobDefinition))
        .filter(Boolean)
        .sort((left, right) => left.name.localeCompare(right.name));

const buildJobPermissionLookup = (jobDefinitions = []) =>
    normalizeJobDefinitionsForIndex(jobDefinitions).reduce(
        (lookup, jobDefinition) => {
            lookup[jobDefinition.name] = jobDefinition.linkedPermissionKeys;
            return lookup;
        },
        {},
    );

const buildLegacyJobDefinitionsFromLookup = (jobPermissionLookup = {}) =>
    Object.keys(jobPermissionLookup)
        .sort((left, right) => left.localeCompare(right))
        .map((name) => ({
            name,
            linkedPermissionKeys: jobPermissionLookup[name],
        }));

const normalizeJobPermissionLookup = (jobPermissionLookup = {}) => {
    if (!isPlainObject(jobPermissionLookup)) return null;

    return Object.entries(jobPermissionLookup).reduce(
        (lookup, [rawName, rawPermissionKeys]) => {
            const name = String(rawName || "").trim();
            if (!name) return lookup;

            lookup[name] = normalizeLinkedPermissionKeys({
                linkedPermissionKeys: rawPermissionKeys,
            });
            return lookup;
        },
        {},
    );
};

const getCachedJobPermissionLookupFromIndex = (classId) => {
    const cached = jobPermissionIndexCache.get(classId);
    if (!cached) return null;
    if (Date.now() - cached.cachedAt > JOB_PERMISSION_INDEX_CACHE_TTL_MS) {
        jobPermissionIndexCache.delete(classId);
        return null;
    }
    return cached.jobPermissionLookup;
};

const cacheJobPermissionLookupFromIndex = (
    classId,
    jobPermissionLookup = {},
) => {
    jobPermissionIndexCache.set(classId, {
        jobPermissionLookup,
        cachedAt: Date.now(),
    });
};

const loadJobPermissionLookupFromIndex = async (classId) => {
    const cachedJobPermissionLookup =
        getCachedJobPermissionLookupFromIndex(classId);
    if (cachedJobPermissionLookup) {
        return cachedJobPermissionLookup;
    }

    const snapshot = await jobPermissionIndexRef(classId).get();
    if (!snapshot.exists) return null;

    const data = snapshot.data() || {};
    const normalizedJobPermissionLookup = normalizeJobPermissionLookup(
        data.jobPermissionLookup,
    );
    if (normalizedJobPermissionLookup) {
        cacheJobPermissionLookupFromIndex(classId, normalizedJobPermissionLookup);
        return normalizedJobPermissionLookup;
    }

    if (!Array.isArray(data.jobDefinitions)) return null;

    const fallbackJobPermissionLookup = buildJobPermissionLookup(
        data.jobDefinitions,
    );
    cacheJobPermissionLookupFromIndex(classId, fallbackJobPermissionLookup);
    return fallbackJobPermissionLookup;
};

const rebuildJobPermissionIndex = async (classId, jobDefinitions = null) => {
    const resolvedJobDefinitions = Array.isArray(jobDefinitions)
        ? jobDefinitions
        : await loadJobDefinitions(classId);
    const jobPermissionLookup = buildJobPermissionLookup(
        resolvedJobDefinitions,
    );

    await jobPermissionIndexRef(classId).set({
        summaryVersion: JOB_PERMISSION_INDEX_SUMMARY_VERSION,
        jobPermissionLookup,
        jobDefinitions: buildLegacyJobDefinitionsFromLookup(jobPermissionLookup),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    cacheJobPermissionLookupFromIndex(classId, jobPermissionLookup);

    return jobPermissionLookup;
};

const loadJobPermissionLookupForStudentSync = async (
    classId,
    studentData = {},
) => {
    if (getStudentJobNames(studentData).length === 0) {
        return {};
    }

    const jobPermissionLookup = await loadJobPermissionLookupFromIndex(classId);
    if (jobPermissionLookup) {
        return jobPermissionLookup;
    }

    return rebuildJobPermissionIndex(classId);
};

const loadStudentsForPermissionReconcile = async (classId, studentUids) => {
    const refs = studentUids.map((studentId) => studentRef(classId, studentId));
    if (refs.length === 0) return [];

    const snapshots = await db.getAll(...refs);
    const missingStudentIds = snapshots
        .filter((snapshot) => !snapshot.exists)
        .map((snapshot) => snapshot.id);
    if (missingStudentIds.length > 0) {
        throw new HttpsError(
            "not-found",
            `학생 정보를 찾을 수 없습니다: ${missingStudentIds.join(", ")}`,
        );
    }

    return snapshots.map((snapshot) => ({
        uid: snapshot.id,
        data: snapshot.data() || {},
        ref: snapshot.ref,
    }));
};

const assignStudentJobsAndPermissions = createStudentJobAssignmentCommand({
    loadJobPermissionLookup: async (classId) =>
        buildJobPermissionLookup(await loadJobDefinitions(classId)),
    loadStudents: loadStudentsForPermissionReconcile,
    synchronizeStudent: async (input) => syncStudentPermissionState({
        ...input,
        authNotFoundBehavior: "ignore",
    }),
    writeAssignment: async ({ classId, studentUid, jobs, source }) => {
        await assignmentRef(classId, studentUid).set({
            studentUid,
            jobs,
            job: jobs[0] || EMPTY_JOB_VALUE,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            ...(source ? { source } : {}),
        }, { merge: true });
    },
});

const assertJobPermissionCommandRequest = async ({
    request,
    classId,
    targetCount,
    emptyTargetMessage,
}) => {
    if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }
    if (!classId) {
        throw new HttpsError("invalid-argument", "학급 ID가 필요합니다.");
    }
    if (targetCount === 0) {
        throw new HttpsError("invalid-argument", emptyTargetMessage);
    }
    if (targetCount > 300) {
        throw new HttpsError(
            "invalid-argument",
            "한 번에 최대 300명까지 처리할 수 있습니다.",
        );
    }

    await mustBeTeacherOrTaxAdmin(classId, request.auth.uid, {
        requireSalaryPower: true,
    });
};

const buildStudentJobPermissionSyncPlan = (
    studentData = {},
    nextJobPermissions = {},
) => {
    const currentJobPermissions = resolveJobPermissions(studentData);
    const currentMergedPermissions = sanitizePermissionMap(studentData.permissions);
    const nextManualPermissions = resolveManualPermissions(studentData);
    const nextMergedPermissions = mergePermissionMaps(
        nextManualPermissions,
        nextJobPermissions,
    );

    const needsJobPermissionWrite = !permissionMapsEqual(
        currentJobPermissions,
        nextJobPermissions,
    );
    const needsMergedPermissionWrite = !permissionMapsEqual(
        currentMergedPermissions,
        nextMergedPermissions,
    );

    return {
        needsJobPermissionWrite,
        needsMergedPermissionWrite,
    };
};

const writeStudentJobPermissionsOnly = async ({
    classId,
    studentId,
    studentRef,
    jobPermissions,
    studentJobSummaryUpdate = null,
}) => {
    await studentRef.set(
        {
            ...(studentJobSummaryUpdate || {}),
            jobPermissions,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
    clearUserCache(classId, studentId);
};

const writeStudentJobSummaryOnly = async ({
    studentRef,
    studentJobSummaryUpdate = null,
}) => {
    if (!studentJobSummaryUpdate) return;

    await studentRef.set(
        {
            ...studentJobSummaryUpdate,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
};

const assignmentRef = (classId, studentId) =>
    db.doc(`classes/${classId}/studentJobAssignments/${studentId}`);

async function handleStudentJobAssignmentMirror(event) {
    const beforeData = event.data?.before.data() || {};
    const afterData = event.data?.after.exists
        ? event.data.after.data() || {}
        : {};
    const { classId, studentId } = event.params;

    if (!haveJobAssignmentsChanged(beforeData, afterData)) {
        return null;
    }

    if (!event.data?.after.exists) {
        await assignmentRef(classId, studentId).delete();
        return null;
    }

    if ((afterData.role || "student") !== "student") {
        return null;
    }

    const studentJobSummary = buildStudentJobSummary(afterData);
    await assignmentRef(classId, studentId).set({
        studentUid: studentId,
        ...studentJobSummary,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        mirrorSource: "student_doc_bridge",
    }, { merge: true });

    return null;
}

exports.__handleStudentJobAssignmentMirror =
    handleStudentJobAssignmentMirror;

exports.syncStudentJobPermissions = onDocumentWritten(
    {
        document: "classes/{classId}/studentJobAssignments/{studentId}",
        cpu: "gcf_gen1",
    },
    async (event) => {
        const beforeData = event.data?.before.data() || {};
        const afterData = event.data?.after.exists
            ? event.data.after.data() || {}
            : {};
        const { classId, studentId } = event.params;
        const targetStudentRef = studentRef(classId, studentId);

        if (!event.data?.before.exists && !event.data?.after.exists) {
            return null;
        }
        if (!haveJobAssignmentsChanged(beforeData, afterData)) return null;

        const studentSnapshot = await targetStudentRef.get();
        if (!studentSnapshot.exists) return null;

        const studentData = studentSnapshot.data() || {};
        if ((studentData.role || "student") !== "student") return null;
        const studentJobSummaryUpdate = buildStudentJobSummaryUpdate(
            studentData,
            afterData,
        );
        const effectiveStudentData = studentJobSummaryUpdate
            ? { ...studentData, ...studentJobSummaryUpdate }
            : studentData;

        const jobPermissionLookup = await loadJobPermissionLookupForStudentSync(
            classId,
            effectiveStudentData,
        );
        const jobPermissions = computeJobPermissionsFromLookup(
            effectiveStudentData,
            jobPermissionLookup,
        );
        const syncPlan = buildStudentJobPermissionSyncPlan(
            effectiveStudentData,
            jobPermissions,
        );

        if (
            !syncPlan.needsJobPermissionWrite &&
            !syncPlan.needsMergedPermissionWrite
        ) {
            await writeStudentJobSummaryOnly({
                studentRef: targetStudentRef,
                studentJobSummaryUpdate,
            });
            return null;
        }

        if (
            syncPlan.needsJobPermissionWrite &&
            !syncPlan.needsMergedPermissionWrite
        ) {
            await writeStudentJobPermissionsOnly({
                classId,
                studentId,
                studentRef: targetStudentRef,
                jobPermissions,
                studentJobSummaryUpdate,
            });
            return null;
        }

        await syncStudentPermissionState({
            classId,
            targetUid: studentId,
            studentData: effectiveStudentData,
            studentRef: targetStudentRef,
            jobPermissions,
            authNotFoundBehavior: "ignore",
            extraUpdates: studentJobSummaryUpdate,
        });

        return null;
    },
);

exports.assignStudentJobs = onCall(
    {
        cpu: "gcf_gen1",
        maxInstances: 10,
        timeoutSeconds: 300,
    },
    async (request) => {
        const classId = String(request.data?.classId || "").trim();
        const source = String(request.data?.source || "").trim();
        const assignments = normalizeAssignments(request.data?.assignments);
        await assertJobPermissionCommandRequest({
            request,
            classId,
            targetCount: assignments.length,
            emptyTargetMessage: "직업 배정 대상이 필요합니다.",
        });

        return assignStudentJobsAndPermissions({
            classId,
            source,
            assignments,
        });
    },
);

exports.syncJobDefinitionPermissionAssignments = onDocumentWritten(
    {
        document: "classes/{classId}/jobDefinitions/{jobId}",
        cpu: "gcf_gen1",
    },
    async (event) => {
        const beforeData = event.data?.before.data() || {};
        const afterData = event.data?.after.data() || {};
        const { classId } = event.params;

        if (!haveJobDefinitionPermissionsChanged(beforeData, afterData)) {
            return null;
        }

        const [jobDefinitions, studentsSnapshot] = await Promise.all([
            loadJobDefinitions(classId),
            db.collection(`classes/${classId}/students`).get(),
        ]);
        const jobPermissionLookup = await rebuildJobPermissionIndex(
            classId,
            jobDefinitions,
        );

        for (const studentDoc of studentsSnapshot.docs) {
            const studentData = studentDoc.data() || {};
            if ((studentData.role || "student") !== "student") continue;

            const jobPermissions = computeJobPermissionsFromLookup(
                studentData,
                jobPermissionLookup,
            );

            await syncStudentPermissionState({
                classId,
                targetUid: studentDoc.id,
                studentData,
                studentRef: studentDoc.ref,
                jobPermissions,
                authNotFoundBehavior: "ignore",
            });
        }

        return null;
    },
);
