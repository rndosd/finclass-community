"use strict";

const admin = require("../firebaseAdminCompat");
const { HttpsError } = require("firebase-functions/v2/https");
const { clearUserCache } = require("./permissions");
const {
    TOKEN_PERMISSION_MAP,
    KNOWN_PERMISSION_KEYS,
    IMPLIED_PERMISSION_MAP,
    applyImpliedPermissions,
} = require("./permissionCatalog");

const db = admin.firestore();

const isPlainObject = (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const sanitizePermissionMap = (input = {}, fallback = {}) => {
    const safeInput = isPlainObject(input) ? input : {};
    const safeFallback = isPlainObject(fallback) ? fallback : {};
    const result = {};

    KNOWN_PERMISSION_KEYS.forEach((key) => {
        if (typeof safeInput[key] === "boolean") {
            result[key] = safeInput[key];
            return;
        }

        if (typeof safeFallback[key] === "boolean") {
            result[key] = safeFallback[key];
        }
    });

    return applyImpliedPermissions(result);
};

const mergePermissionMaps = (...sources) => {
    const result = {};

    KNOWN_PERMISSION_KEYS.forEach((key) => {
        result[key] = sources.some((source) => source?.[key] === true);
    });

    return result;
};

const permissionMapsEqual = (left = {}, right = {}) =>
    KNOWN_PERMISSION_KEYS.every(
        (key) => Boolean(left?.[key]) === Boolean(right?.[key]),
    );

const buildTokenPermissions = (permissions = {}) => {
    const tokenPermissions = {};

    KNOWN_PERMISSION_KEYS.forEach((key) => {
        if (permissions[key] === true && TOKEN_PERMISSION_MAP[key]) {
            tokenPermissions[TOKEN_PERMISSION_MAP[key]] = true;
        }
    });

    return tokenPermissions;
};

const resolveManualPermissions = (studentData = {}) =>
    sanitizePermissionMap(studentData.manualPermissions, studentData.permissions);

const resolveJobPermissions = (studentData = {}) =>
    sanitizePermissionMap(studentData.jobPermissions);

const normalizeJobName = (value) => {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "object" && value !== null) {
        return String(value.name || value.id || "").trim();
    }
    return String(value).trim();
};

const getStudentJobNames = (studentData = {}) => {
    const names = new Set();
    const jobs = Array.isArray(studentData.jobs) ? studentData.jobs : [];

    jobs.forEach((job) => {
        const normalized = normalizeJobName(job);
        if (normalized) names.add(normalized);
    });

    const singleJob = normalizeJobName(studentData.job);
    if (singleJob) names.add(singleJob);

    return Array.from(names);
};

const buildPermissionMapFromKeys = (keys = []) => {
    const result = {};
    KNOWN_PERMISSION_KEYS.forEach((key) => {
        result[key] = false;
    });

    if (!Array.isArray(keys)) return result;

    keys.forEach((key) => {
        if (KNOWN_PERMISSION_KEYS.includes(key)) {
            result[key] = true;
        }
    });

    return result;
};

const expandJobLinkedPermissionKeys = (keys = []) => {
    const expandedKeys = new Set();

    if (!Array.isArray(keys)) return [];

    keys.forEach((key) => {
        if (!KNOWN_PERMISSION_KEYS.includes(key)) return;

        expandedKeys.add(key);

        const impliedKeys = IMPLIED_PERMISSION_MAP[key] || [];
        impliedKeys.forEach((impliedKey) => {
            if (KNOWN_PERMISSION_KEYS.includes(impliedKey)) {
                expandedKeys.add(impliedKey);
            }
        });
    });

    return Array.from(expandedKeys);
};

const computeJobPermissionsFromDefinitions = (studentData = {}, jobDefinitions = []) => {
    const jobNames = new Set(getStudentJobNames(studentData));
    const linkedPermissionKeys = new Set();

    jobDefinitions.forEach((jobDefinition) => {
        const jobName = normalizeJobName(jobDefinition?.name);
        if (!jobName || !jobNames.has(jobName)) return;

        if (Array.isArray(jobDefinition?.linkedPermissionKeys)) {
            jobDefinition.linkedPermissionKeys.forEach((permissionKey) => {
                if (KNOWN_PERMISSION_KEYS.includes(permissionKey)) {
                    linkedPermissionKeys.add(permissionKey);
                }
            });
        }
    });

    return buildPermissionMapFromKeys(
        expandJobLinkedPermissionKeys(Array.from(linkedPermissionKeys)),
    );
};

const computeJobPermissionsFromLookup = (
    studentData = {},
    jobPermissionLookup = {},
) => {
    const jobNames = getStudentJobNames(studentData);
    const linkedPermissionKeys = new Set();

    jobNames.forEach((jobName) => {
        const normalizedJobName = normalizeJobName(jobName);
        if (!normalizedJobName) return;

        const permissionKeys = jobPermissionLookup?.[normalizedJobName];
        if (!Array.isArray(permissionKeys)) return;

        permissionKeys.forEach((permissionKey) => {
            if (KNOWN_PERMISSION_KEYS.includes(permissionKey)) {
                linkedPermissionKeys.add(permissionKey);
            }
        });
    });

    return buildPermissionMapFromKeys(
        expandJobLinkedPermissionKeys(Array.from(linkedPermissionKeys)),
    );
};

const syncCustomClaims = async (
    targetUid,
    mergedPermissions,
    { authNotFoundBehavior = "throw", authClient = null } = {},
) => {
    const resolvedAuthClient = authClient || admin.auth();
    let userRecord;

    try {
        userRecord = await resolvedAuthClient.getUser(targetUid);
    } catch (error) {
        if (error?.code === "auth/user-not-found" && authNotFoundBehavior === "ignore") {
            console.warn(`[PermissionSync] auth user missing for ${targetUid}`);
            return { skipped: true };
        }

        if (error?.code === "auth/user-not-found") {
            throw new HttpsError(
                "not-found",
                "해당 학생의 인증 계정을 찾을 수 없습니다.",
            );
        }

        throw error;
    }

    const existingClaims = userRecord.customClaims || {};
    const nextTokenPermissions = buildTokenPermissions(mergedPermissions);
    const existingTokenPermissions = isPlainObject(existingClaims.permissions)
        ? existingClaims.permissions
        : {};
    const tokenPermissionsMatch =
        Object.keys(existingTokenPermissions).length === Object.keys(nextTokenPermissions).length &&
        Object.entries(nextTokenPermissions).every(
            ([key, value]) => existingTokenPermissions[key] === value,
        );

    if (tokenPermissionsMatch) {
        return { skipped: false, updated: false };
    }

    await resolvedAuthClient.setCustomUserClaims(targetUid, {
        ...existingClaims,
        permissions: nextTokenPermissions,
    });

    return { skipped: false, updated: true };
};

const syncStudentPermissionState = async ({
    classId,
    targetUid,
    manualPermissions,
    jobPermissions,
    studentData = null,
    studentRef = null,
    authNotFoundBehavior = "throw",
    ensureClaims = false,
    extraUpdates = null,
}) => {
    const resolvedStudentRef =
        studentRef || db.doc(`classes/${classId}/students/${targetUid}`);
    const resolvedStudentData = studentData ||
        (await resolvedStudentRef.get()).data();

    if (!resolvedStudentData) {
        throw new HttpsError("not-found", "학생 문서를 찾을 수 없습니다.");
    }

    const nextManualPermissions =
        manualPermissions !== undefined
            ? sanitizePermissionMap(
                manualPermissions,
                resolveManualPermissions(resolvedStudentData),
            )
            : resolveManualPermissions(resolvedStudentData);

    const nextJobPermissions =
        jobPermissions !== undefined
            ? sanitizePermissionMap(
                jobPermissions,
                resolveJobPermissions(resolvedStudentData),
            )
            : resolveJobPermissions(resolvedStudentData);

    const nextMergedPermissions = mergePermissionMaps(
        nextManualPermissions,
        nextJobPermissions,
    );

    const currentManualPermissions = isPlainObject(resolvedStudentData.manualPermissions)
        ? resolvedStudentData.manualPermissions
        : resolvedStudentData.permissions;
    const currentJobPermissions = isPlainObject(resolvedStudentData.jobPermissions)
        ? resolvedStudentData.jobPermissions
        : {};
    const currentMergedPermissions = isPlainObject(resolvedStudentData.permissions)
        ? resolvedStudentData.permissions
        : {};
    const hasMergedPermissionChange = !permissionMapsEqual(
        currentMergedPermissions,
        nextMergedPermissions,
    );

    const updates = {};
    if (!permissionMapsEqual(currentManualPermissions, nextManualPermissions)) {
        updates.manualPermissions = nextManualPermissions;
    }
    if (!permissionMapsEqual(currentJobPermissions, nextJobPermissions)) {
        updates.jobPermissions = nextJobPermissions;
    }
    if (hasMergedPermissionChange) {
        updates.permissions = nextMergedPermissions;
    }
    if (isPlainObject(extraUpdates)) {
        Object.entries(extraUpdates).forEach(([key, value]) => {
            if (value !== undefined) {
                updates[key] = value;
            }
        });
    }

    if (Object.keys(updates).length > 0) {
        updates.lastUpdated = admin.firestore.FieldValue.serverTimestamp();
        await resolvedStudentRef.set(updates, { merge: true });
        clearUserCache(classId, targetUid);
    }

    let claimsUpdated = false;
    if (hasMergedPermissionChange || ensureClaims) {
        const claimsResult = await syncCustomClaims(targetUid, nextMergedPermissions, {
            authNotFoundBehavior,
        });
        claimsUpdated = claimsResult.updated === true;
    }

    return {
        manualPermissions: nextManualPermissions,
        jobPermissions: nextJobPermissions,
        permissions: nextMergedPermissions,
        updated: Object.keys(updates).length > 0,
        claimsUpdated,
    };
};

module.exports = {
    TOKEN_PERMISSION_MAP,
    KNOWN_PERMISSION_KEYS,
    sanitizePermissionMap,
    mergePermissionMaps,
    permissionMapsEqual,
    buildTokenPermissions,
    resolveManualPermissions,
    resolveJobPermissions,
    getStudentJobNames,
    computeJobPermissionsFromDefinitions,
    computeJobPermissionsFromLookup,
    syncCustomClaims,
    syncStudentPermissionState,
};
