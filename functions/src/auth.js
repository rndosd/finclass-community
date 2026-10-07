// src/auth.js

const admin = require("../firebaseAdminCompat");
const db = admin.firestore();
const { readRealEstateLayout, writeRealEstateLayout } = require("../utils/realEstateStorage");
const { fingerprint: realEstateFingerprint } = require("../utils/realEstateStorageSchema");
const authAdmin = admin.auth();
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const { randomUUID } = require("crypto");
const { getStudentMissionSubmissions } = require("../utils/studentMissionSubmissions");
const { assertRoleFromClaims } = require("../utils/permissions");
const { TOKEN_PERMISSION_MAP } = require("../utils/permissionCatalog");
const {
    GOOGLE_TEACHER_REGISTRATION_ACTION,
    resolveExistingGoogleTeacherRegistration,
} = require("../utils/teacherRegistration");
const ENFORCE_APPCHECK = process.env.ENFORCE_APPCHECK === "true";

const assertTeacherOrAdmin = (auth) => {
    const ctx = assertRoleFromClaims(
        { auth },
        ["teacher", "admin"],
        { requireClassForTeacher: true },
    );
    return { callerRole: ctx.role, callerClassId: ctx.classId, callerUid: ctx.uid };
};

const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();
const normalizeText = (value) => String(value ?? "").trim();
const normalizeSchoolName = (value) =>
    normalizeText(value)
        .replace(/\s*(?:\uCD08\uB4F1\uD559\uAD50|\uCD08)+\s*$/u, "")
        .trim();

const buildClassDocId = ({ schoolName, grade, classNum }) => {
    const normalizedSchoolName = normalizeSchoolName(schoolName);
    const normalizedGrade = normalizeText(grade);
    const normalizedClassNum = normalizeText(classNum);

    if (!normalizedSchoolName || !normalizedGrade || !normalizedClassNum) {
        return "";
    }

    return `${normalizedSchoolName}\uCD08 ${normalizedGrade}-${normalizedClassNum}`;
};

const parseClassDocId = (value) => {
    const normalized = normalizeText(value).replace(/\s+/g, " ");
    if (!normalized) return null;

    const strictMatch = normalized.match(
        /^(.+)(?:\uCD08\uB4F1\uD559\uAD50|\uCD08)\s*([^-]+)\s*-\s*(.+)$/u,
    );
    if (strictMatch) {
        return {
            schoolName: normalizeSchoolName(strictMatch[1]),
            grade: normalizeText(strictMatch[2]),
            classNum: normalizeText(strictMatch[3]),
        };
    }

    const markerIndex = normalized.lastIndexOf("\uCD08");
    if (markerIndex < 0) return null;

    const schoolName = normalizeSchoolName(normalized.slice(0, markerIndex));
    const classPart = normalizeText(normalized.slice(markerIndex + 1));
    const separatorIndex = classPart.indexOf("-");
    if (separatorIndex < 0) {
        return {
            schoolName,
            grade: "",
            classNum: "",
        };
    }

    return {
        schoolName,
        grade: normalizeText(classPart.slice(0, separatorIndex)),
        classNum: normalizeText(classPart.slice(separatorIndex + 1)),
    };
};

const normalizeClassDocId = (value) => {
    const parsed = parseClassDocId(value);
    if (!parsed) {
        return normalizeText(value).replace(/\s+/g, " ");
    }

    return buildClassDocId(parsed) || normalizeText(value).replace(/\s+/g, " ");
};
const RECENT_LOGIN_MAX_AGE_SEC = 10 * 60;
const AUTH_SWITCH_SESSION_COLLECTION = "switchSessions";
const AUTH_SWITCH_TTL_MS = 10 * 60 * 1000;
const DELETE_BATCH_CHUNK_SIZE = 400;

const hasOwnKey = (obj, key) =>
    !!obj && Object.prototype.hasOwnProperty.call(obj, key);

const normalizePermissionClaims = (permissions) => {
    if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) {
        return {};
    }

    return Object.entries(permissions).reduce((acc, [key, value]) => {
        if (value === true) {
            acc[TOKEN_PERMISSION_MAP[key] || key] = true;
        }
        return acc;
    }, {});
};

const buildInlineCustomClaims = (baseClaims = {}, overrides = {}) => {
    const nextClaims = {};

    ["role", "classId", "isApproved", "plan"].forEach((key) => {
        const value =
            overrides[key] !== undefined ? overrides[key] : baseClaims?.[key];
        if (value !== undefined) {
            nextClaims[key] = value;
        }
    });

    const permissionSource =
        overrides.permissions !== undefined
            ? overrides.permissions
            : baseClaims?.permissions;
    const permissions = normalizePermissionClaims(permissionSource);
    if (Object.keys(permissions).length > 0) {
        nextClaims.permissions = permissions;
    }

    return nextClaims;
};

const commitFirestoreOpsInChunks = async (operations, chunkSize = DELETE_BATCH_CHUNK_SIZE) => {
    for (const op of operations) if (op.type === "delete") await db.recursiveDelete(op.ref);
    const updates = operations.filter((op) => op.type === "update");
    for (let i = 0; i < updates.length; i += chunkSize) {
        const batch = db.batch();
        updates.slice(i, i + chunkSize).forEach((op) => batch.update(op.ref, op.data));
        await batch.commit();
    }
};

const normalizeStudentUid = (value) => String(value ?? "").trim();

const queueDeleteOperation = (operationsMap, ref) => {
    if (!ref?.path || operationsMap.has(ref.path)) return;
    operationsMap.set(ref.path, { type: "delete", ref });
};

const createStudentSharedCleanupSummary = () => ({
    storeRedemptionsDeleted: 0,
    policeFineHistoryDeleted: 0,
    reflectionDocsDeleted: 0,
    arcadeUsageDeletedCount: 0,
    donationStatsDeletedCount: 0,
    realEstateLayoutUpdatedCount: 0,
    realEstateSeatAssignmentsCleared: 0,
    realEstateOwnershipsCleared: 0,
    realEstatePurchaseRequestsCleared: 0,
});

const mergeStudentSharedCleanupSummary = (baseSummary, partialSummary = {}) => {
    Object.keys(baseSummary).forEach((key) => {
        baseSummary[key] += Number(partialSummary[key] || 0);
    });
    return baseSummary;
};

const cleanupStudentSharedClassData = async (classId, studentUid) => {
    const summary = createStudentSharedCleanupSummary();
    const storeRedemptionsRef = db.collection(`classes/${classId}/storeRedemptions`);
    const policeFineHistoryRef = db.collection(`classes/${classId}/policeFineHistory`);
    const reflectionsRef = db.collection(`classes/${classId}/reflections`);
    const arcadeUsageRef = db.doc(`classes/${classId}/arcade/config/usage/${studentUid}`);
    const donationStatsRef = db.doc(`classes/${classId}/donationStats/${studentUid}`);
    const realEstateLayoutRef = db.doc(`classes/${classId}/real_estate/layout`);

    const [
        storeRedemptionsSnap,
        policeFineHistorySnap,
        directReflectionSnap,
        arcadeUsageSnap,
        donationStatsSnap,
        realEstateLayoutSnap,
    ] = await Promise.all([
        storeRedemptionsRef.where("studentUid", "==", studentUid).get(),
        policeFineHistoryRef.where("studentUid", "==", studentUid).get(),
        reflectionsRef.where("studentUid", "==", studentUid).get(),
        arcadeUsageRef.get(),
        donationStatsRef.get(),
        readRealEstateLayout(db, realEstateLayoutRef),
    ]);

    const reflectionRefsByHistory = policeFineHistorySnap.docs.map((docSnap) =>
        reflectionsRef.doc(docSnap.id),
    );
    const reflectionByHistorySnaps = reflectionRefsByHistory.length
        ? await db.getAll(...reflectionRefsByHistory)
        : [];

    const operationMap = new Map();
    const reflectionDeleteRefMap = new Map();

    storeRedemptionsSnap.forEach((docSnap) => {
        queueDeleteOperation(operationMap, docSnap.ref);
    });
    policeFineHistorySnap.forEach((docSnap) => {
        queueDeleteOperation(operationMap, docSnap.ref);
    });
    directReflectionSnap.forEach((docSnap) => {
        queueDeleteOperation(operationMap, docSnap.ref);
        reflectionDeleteRefMap.set(docSnap.ref.path, docSnap.ref);
    });
    reflectionByHistorySnaps.forEach((docSnap) => {
        if (!docSnap.exists) return;
        queueDeleteOperation(operationMap, docSnap.ref);
        reflectionDeleteRefMap.set(docSnap.ref.path, docSnap.ref);
    });
    queueDeleteOperation(operationMap, arcadeUsageRef);
    queueDeleteOperation(operationMap, donationStatsRef);

    if (operationMap.size > 0) {
        await commitFirestoreOpsInChunks([...operationMap.values()]);
    }

    summary.storeRedemptionsDeleted = storeRedemptionsSnap.size;
    summary.policeFineHistoryDeleted = policeFineHistorySnap.size;
    summary.reflectionDocsDeleted = reflectionDeleteRefMap.size;
    summary.arcadeUsageDeletedCount = arcadeUsageSnap.exists ? 1 : 0;
    summary.donationStatsDeletedCount = donationStatsSnap.exists ? 1 : 0;

    if (realEstateLayoutSnap.exists) {
        const layoutData = realEstateLayoutSnap.data() || {};
        const groups = Array.isArray(layoutData.groups) ? layoutData.groups : [];
        let layoutChanged = false;

        const updatedGroups = groups.map((group) => {
            const desks = Array.isArray(group?.desks) ? group.desks : [];
            let groupChanged = false;

            const updatedDesks = desks.map((desk) => {
                if (!desk || typeof desk !== "object") return desk;

                let deskChanged = false;
                let nextDesk = desk;
                const ensureDeskPatch = () => {
                    if (!deskChanged) {
                        nextDesk = { ...desk };
                        deskChanged = true;
                    }
                };

                if (desk.studentId === studentUid) {
                    ensureDeskPatch();
                    nextDesk.studentId = null;
                    nextDesk.studentName = null;
                    nextDesk.rentPaidUntil = null;
                    nextDesk.rentContractId = null;
                    nextDesk.rentStartAt = null;
                    nextDesk.rentLastDateAt = null;
                    nextDesk.rentTenantId = null;
                    nextDesk.rentTenantName = null;
                    nextDesk.rentPaidDays = 0;
                    nextDesk.rentPaidAmount = 0;
                    summary.realEstateSeatAssignmentsCleared += 1;
                }

                if (desk.rentTenantId === studentUid) {
                    ensureDeskPatch();
                    nextDesk.rentTenantId = null;
                    nextDesk.rentTenantName = null;
                    nextDesk.rentContractId = null;
                    nextDesk.rentStartAt = null;
                    nextDesk.rentLastDateAt = null;
                    nextDesk.rentPaidUntil = null;
                    nextDesk.rentPaidDays = 0;
                    nextDesk.rentPaidAmount = 0;
                }

                if (desk.ownerId === studentUid) {
                    ensureDeskPatch();
                    nextDesk.ownerId = null;
                    nextDesk.ownerName = null;
                    nextDesk.ownerSinceAt = null;
                    nextDesk.ownerSource = null;
                    nextDesk.ownerUpdatedAt = null;
                    nextDesk.isForSale = false;
                    nextDesk.askingPrice = 0;
                    nextDesk.tradeStatus = "idle";
                    nextDesk.buyerId = null;
                    nextDesk.contractState = null;
                    summary.realEstateOwnershipsCleared += 1;
                } else if (desk.buyerId === studentUid) {
                    ensureDeskPatch();
                    nextDesk.buyerId = null;
                    nextDesk.contractState = null;
                    nextDesk.tradeStatus = nextDesk.isForSale ? "on_sale" : "idle";
                    summary.realEstatePurchaseRequestsCleared += 1;
                }

                if (!deskChanged) return desk;
                groupChanged = true;
                layoutChanged = true;
                return nextDesk;
            });

            if (!groupChanged) return group;
            return {
                ...group,
                desks: updatedDesks,
            };
        });

        if (layoutChanged) {
            await writeRealEstateLayout(db, realEstateLayoutRef, {
                groups: updatedGroups,
            }, { expectedFingerprint: realEstateFingerprint(layoutData) });
            summary.realEstateLayoutUpdatedCount = 1;
        }
    }

    return summary;
};

const cleanupOrphanedSharedHistoryForClass = async (
    classId,
    existingStudentUids = new Set(),
) => {
    const summary = createStudentSharedCleanupSummary();
    const storeRedemptionsRef = db.collection(`classes/${classId}/storeRedemptions`);
    const policeFineHistoryRef = db.collection(`classes/${classId}/policeFineHistory`);
    const reflectionsRef = db.collection(`classes/${classId}/reflections`);

    const [storeRedemptionsSnap, policeFineHistorySnap, reflectionsSnap] =
        await Promise.all([
            storeRedemptionsRef.get(),
            policeFineHistoryRef.get(),
            reflectionsRef.get(),
        ]);

    const operationMap = new Map();
    const orphanFineHistoryIds = new Set();
    const reflectionDeleteRefMap = new Map();

    storeRedemptionsSnap.forEach((docSnap) => {
        const studentUid = normalizeStudentUid(docSnap.data()?.studentUid);
        if (!studentUid || existingStudentUids.has(studentUid)) return;
        queueDeleteOperation(operationMap, docSnap.ref);
        summary.storeRedemptionsDeleted += 1;
    });

    policeFineHistorySnap.forEach((docSnap) => {
        const studentUid = normalizeStudentUid(docSnap.data()?.studentUid);
        if (!studentUid || existingStudentUids.has(studentUid)) return;
        queueDeleteOperation(operationMap, docSnap.ref);
        orphanFineHistoryIds.add(docSnap.id);
        summary.policeFineHistoryDeleted += 1;
    });

    reflectionsSnap.forEach((docSnap) => {
        const studentUid = normalizeStudentUid(docSnap.data()?.studentUid);
        const isMissingStudent = studentUid && !existingStudentUids.has(studentUid);
        const isOrphanedFineReflection = orphanFineHistoryIds.has(docSnap.id);
        if (!isMissingStudent && !isOrphanedFineReflection) return;
        queueDeleteOperation(operationMap, docSnap.ref);
        reflectionDeleteRefMap.set(docSnap.ref.path, docSnap.ref);
    });

    if (operationMap.size > 0) {
        await commitFirestoreOpsInChunks([...operationMap.values()]);
    }

    summary.reflectionDocsDeleted = reflectionDeleteRefMap.size;
    return summary;
};

const cleanupStudentMissionSharedData = async (classId, studentUid) => {
    const missionsRef = db.collection(`classes/${classId}/missions`);
    const [missionSnap, submissionSnap] = await Promise.all([
        missionsRef.get(),
        getStudentMissionSubmissions(missionsRef, studentUid),
    ]);

    const operations = [];
    const queuedDeletePaths = new Set();
    const summary = {
        missionsUpdated: 0,
        missionSubmissionsDeleted: 0,
    };

    missionSnap.forEach((missionDoc) => {
        operations.push({ type: "delete", ref: missionDoc.ref.collection("students").doc(studentUid) });
        const missionData = missionDoc.data() || {};
        const patch = {};
        let shouldUpdate = false;

        const completionData = missionData?.completions?.[studentUid] || null;
        const submissionId =
            (hasOwnKey(missionData?.submissionsIndex, studentUid)
                ? missionData.submissionsIndex?.[studentUid]
                : null) ||
            completionData?.submissionId ||
            null;

        if (hasOwnKey(missionData?.completions, studentUid)) {
            patch[`completions.${studentUid}`] = FieldValue.delete();
            shouldUpdate = true;
        }
        if (hasOwnKey(missionData?.submissionsIndex, studentUid)) {
            patch[`submissionsIndex.${studentUid}`] = FieldValue.delete();
            shouldUpdate = true;
        }
        if (hasOwnKey(missionData?.lastAttempts, studentUid)) {
            patch[`lastAttempts.${studentUid}`] = FieldValue.delete();
            shouldUpdate = true;
        }
        if (
            Array.isArray(missionData?.targetStudentUids) &&
            missionData.targetStudentUids.includes(studentUid)
        ) {
            patch.targetStudentUids = FieldValue.arrayRemove(studentUid);
            shouldUpdate = true;
        }

        if (submissionId) {
            const submissionRef = missionDoc.ref
                .collection("submissions")
                .doc(String(submissionId));
            if (!queuedDeletePaths.has(submissionRef.path)) {
                operations.push({
                    type: "delete",
                    ref: submissionRef,
                });
                queuedDeletePaths.add(submissionRef.path);
                summary.missionSubmissionsDeleted += 1;
            }
        }

        if (shouldUpdate) {
            patch.updatedAt = FieldValue.serverTimestamp();
            operations.push({
                type: "update",
                ref: missionDoc.ref,
                data: patch,
            });
            summary.missionsUpdated += 1;
        }
    });

    submissionSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        if (data.classId !== classId && !docSnap.ref.path.startsWith(`classes/${classId}/`)) return;
        if (queuedDeletePaths.has(docSnap.ref.path)) return;
        operations.push({ type: "delete", ref: docSnap.ref });
        queuedDeletePaths.add(docSnap.ref.path);
        summary.missionSubmissionsDeleted += 1;
    });

    if (operations.length > 0) {
        await commitFirestoreOpsInChunks(operations);
    }

    return summary;
};

const deleteStudentAccountCascade = async (classId, studentUid, { allowMissing = false } = {}) => {
    const studentRef = db.doc(`classes/${classId}/students/${studentUid}`);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists && !allowMissing) throw new HttpsError("not-found", "학생을 찾을 수 없습니다.");
    if (studentSnap.exists && studentSnap.data().role !== "student") throw new HttpsError("permission-denied", "학생 계정만 삭제할 수 있습니다.");
    const missionCleanup = await cleanupStudentMissionSharedData(classId, studentUid);
    const sharedCleanup = await cleanupStudentSharedClassData(classId, studentUid);
    // A failure is fatal. Keep the parent until all mandatory cleanup succeeds.
    await db.recursiveDelete(db.doc(`classes/${classId}/subscriptions/${studentUid}`));
    for (const col of await studentRef.listCollections()) await db.recursiveDelete(col);
    await db.recursiveDelete(db.doc(`classes/${classId}/studentJobAssignments/${studentUid}`));
    try { await authAdmin.deleteUser(studentUid); }
    catch (error) { if (error.code !== "auth/user-not-found") throw error; }
    await db.recursiveDelete(db.doc(`users/${studentUid}`));
    await db.recursiveDelete(studentRef);
    return { ...missionCleanup, ...sharedCleanup, studentTreeDeleted: true };
};

const { createClassMaintenance } = require("../utils/classMaintenance");
const { syncCustomClaims } = require("../utils/permissionSync");
const classMaintenance = createClassMaintenance({
    db, auth: authAdmin, FieldValue, cleanupStudent: deleteStudentAccountCascade,
    syncClaims: (uid, permissions) => syncCustomClaims(uid, permissions, { authNotFoundBehavior: "throw" }),

    finalizeClass: require("../utils/classMaintenanceProjections").finalizeClass,
});


const cleanupDeletedStudentOrphansForClass = async (classId) => {
    const studentsRef = db.collection(`classes/${classId}/students`);
    const subscriptionsRef = db.collection(`classes/${classId}/subscriptions`);

    const [studentDocRefs, subscriptionSnap] = await Promise.all([
        studentsRef.listDocuments(),
        subscriptionsRef.get(),
    ]);

    const studentSnaps = studentDocRefs.length
        ? await Promise.all(studentDocRefs.map((ref) => ref.get()))
        : [];

    const existingStudentUids = new Set();
    const orphanStudentRefs = [];

    studentSnaps.forEach((docSnap) => {
        if (docSnap.exists) {
            existingStudentUids.add(docSnap.id);
            return;
        }
        orphanStudentRefs.push(docSnap.ref);
    });

    const orphanSubscriptionRefs = [];
    subscriptionSnap.forEach((docSnap) => {
        if (!existingStudentUids.has(docSnap.id)) {
            orphanSubscriptionRefs.push(docSnap.ref);
        }
    });

    const sharedCleanupSummary = createStudentSharedCleanupSummary();
    const orphanCandidateUids = new Set([
        ...orphanStudentRefs.map((ref) => ref.id),
        ...orphanSubscriptionRefs.map((ref) => ref.id),
    ]);

    for (const orphanStudentUid of orphanCandidateUids) {
        const partialSummary = await cleanupStudentSharedClassData(
            classId,
            orphanStudentUid,
        );
        mergeStudentSharedCleanupSummary(
            sharedCleanupSummary,
            partialSummary,
        );
    }

    for (const studentRef of orphanStudentRefs) {
        await db.recursiveDelete(studentRef);
    }

    if (orphanSubscriptionRefs.length > 0) {
        await commitFirestoreOpsInChunks(
            orphanSubscriptionRefs.map((ref) => ({ type: "delete", ref })),
        );
    }

    const orphanedSharedHistorySummary = await cleanupOrphanedSharedHistoryForClass(
        classId,
        existingStudentUids,
    );
    mergeStudentSharedCleanupSummary(
        sharedCleanupSummary,
        orphanedSharedHistorySummary,
    );

    return {
        orphanStudentCount: orphanStudentRefs.length,
        orphanSubscriptionCount: orphanSubscriptionRefs.length,
        cleanedStudentUids: orphanStudentRefs.map((ref) => ref.id),
        cleanedSubscriptionUids: orphanSubscriptionRefs.map((ref) => ref.id),
        ...sharedCleanupSummary,
    };
};

const assertRecentLogin = (authToken) => {
    const authTime = Number(authToken?.auth_time || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!authTime || nowSec - authTime > RECENT_LOGIN_MAX_AGE_SEC) {
        throw new HttpsError(
            "failed-precondition",
            "보안을 위해 다시 로그인한 뒤 탈퇴를 진행해 주세요.",
        );
    }
};

const validateTeacherSignupPayload = ({ name, classDocId, password = null }) => {
    if (!name || !classDocId) {
        throw new HttpsError("invalid-argument", "?꾩닔 ?뺣낫媛 ?꾨씫?섏뿀?듬땲??");
    }
    if (name.length < 2 || name.length > 40) {
        throw new HttpsError("invalid-argument", "?대쫫? 2~40?먯뿬???⑸땲??");
    }
    if (classDocId.length < 2 || classDocId.length > 80) {
        throw new HttpsError("invalid-argument", "?숆툒 ?쒓린??2~80?먯뿬???⑸땲??");
    }
    if (password !== null && password.length < 6) {
        throw new HttpsError("invalid-argument", "鍮꾨?踰덊샇??6???댁긽?댁뼱???⑸땲??");
    }
};

const createApprovedTeacherProfile = async ({
    teacherUid,
    teacherName,
    teacherEmail,
    classDocId,
    privacyAgreed = true,
    emailVerificationRequired = false,
    requestedClassId = randomUUID(),
    keepExistingCreatedAt = false,
}) => {
    const generatedClassId = db.collection("classes").doc().id;
    const now = FieldValue.serverTimestamp();
    const normalizedTeacherName =
        normalizeText(teacherName) || "\uAD50\uC0AC";
    const normalizedClassDocId = normalizeClassDocId(classDocId);
    const parsedClassInfo = parseClassDocId(normalizedClassDocId);

    const userDocRef = db.doc(`users/${teacherUid}`);
    const classDocRef = db.doc(`classes/${generatedClassId}`);
    const teacherInClassRef = db.doc(
        `classes/${generatedClassId}/students/${teacherUid}`,
    );

    const userPayload = {
        uid: teacherUid,
        name: normalizedTeacherName,
        email: teacherEmail,
        role: "teacher",
        status: "approved",
        requestedClassId,
        classDocId: normalizedClassDocId,
        classId: generatedClassId,
        privacyAgreed,
        agreedAt: privacyAgreed ? now : null,
        emailVerificationRequired: emailVerificationRequired === true,
    };
    if (!keepExistingCreatedAt) {
        userPayload.createdAt = now;
    }

    const batch = db.batch();
    batch.set(userDocRef, userPayload, { merge: true });
    batch.set(classDocRef, {
        classDocId: normalizedClassDocId,
        teacherUid,
        teacherName: normalizedTeacherName,
        teacherDisplayName: normalizedTeacherName,
        ...(parsedClassInfo?.schoolName
            ? { schoolName: parsedClassInfo.schoolName }
            : {}),
        ...(parsedClassInfo?.grade ? { grade: parsedClassInfo.grade } : {}),
        ...(parsedClassInfo?.classNum
            ? { classNum: parsedClassInfo.classNum }
            : {}),
        currencyUnit: "\uCF54\uC778",
        createdAt: now,
    });
    batch.set(teacherInClassRef, {
        uid: teacherUid,
        name: normalizedTeacherName,
        role: "teacher",
        studentNumber: 0,
        job: "교사",
        creditScore: 700,
        assets: {
            cash: 10000,
            deposit: 0,
            loan: 0,
            missionToken: 0,
            stockValue: { value: 0 },
        },
        createdAt: now,
    });
    await batch.commit();

    await authAdmin.setCustomUserClaims(teacherUid, {
        role: "teacher",
        classId: generatedClassId,
        isApproved: true,
    });

    return generatedClassId;
};

const assertTeacherEmailVerifiedBeforeApproval = async (teacherUid) => {
    const userDocSnap = await db.doc(`users/${teacherUid}`).get();
    const shouldRequireVerification =
        userDocSnap.exists &&
        userDocSnap.data()?.emailVerificationRequired === true;
    if (!shouldRequireVerification) return;

    const authUser = await authAdmin.getUser(teacherUid);
    const providerIds = new Set(
        (authUser.providerData || []).map((provider) => provider.providerId),
    );
    const isPasswordSignup = providerIds.has("password");
    if (isPasswordSignup && !authUser.emailVerified) {
        throw new HttpsError(
            "failed-precondition",
            "교사 이메일 인증이 완료된 계정만 승인할 수 있습니다.",
        );
    }
};

/**
 * ?뱀젙 ?ъ슜?먯뿉寃?'admin' ??븷??遺?ы븯???⑥닔 (理쒖큹 1???ㅽ뻾??
 */
const addAdminRoleLegacy = onCall(async (request) => {
    // ?대찓?쇱쓣 諛쏆븘 ?대떦 ?ъ슜?먮? 李얠뒿?덈떎.
    const email = request.data.email;
    try {
        const user = await authAdmin.getUserByEmail(email);
        // ?대떦 ?ъ슜?먯뿉寃?'admin' ??븷??而ㅼ뒪? ?대젅?꾩쑝濡??ㅼ젙?⑸땲??
        await authAdmin.setCustomUserClaims(user.uid, { role: "admin" });
        return {
            message: `?깃났! ${email} ?ъ슜?먯뿉寃?admin ??븷??遺?щ릺?덉뒿?덈떎.`,
        };
    } catch (error) {
        console.error("Error setting custom claim:", error);
        throw new HttpsError("internal", "??븷 ?ㅼ젙 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
    }
});

// ??3. 援먯궗 怨꾩젙 ?붿껌 泥섎━ ?⑥닔
// Legacy admin role grant endpoint is disabled.
void addAdminRoleLegacy;
exports.addAdminRole = onCall(async () => {
    throw new HttpsError(
        "failed-precondition",
        "addAdminRole function is disabled.",
    );
});

exports.requestTeacherAccount = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        enforceAppCheck: ENFORCE_APPCHECK,
    },
    async (request) => {
        // 비로그인 상태에서만 가입 요청을 허용합니다.
        if (request.auth) {
            throw new HttpsError("failed-precondition", "이미 로그인된 계정입니다.");
        }

        const name = normalizeText(request.data?.name);
        const email = normalizeEmail(request.data?.email);
        const password = String(request.data?.password || "");
        const classDocId = normalizeClassDocId(request.data?.classDocId);
        const privacyAgreed = request.data?.privacyAgreed === true;

        if (!email || !password) {
            throw new HttpsError("invalid-argument", "이메일/비밀번호가 필요합니다.");
        }
        validateTeacherSignupPayload({ name, classDocId, password });

        // classId는 서버에서 생성해 위조 입력을 차단합니다.
        const requestedClassId = randomUUID();

        try {
            const userExists = await authAdmin.getUserByEmail(email).catch((err) => {
                if (err.code === "auth/user-not-found") return null;
                throw err;
            });
            if (userExists) {
                throw new HttpsError("already-exists", "auth/email-already-exists");
            }

            const newUser = await authAdmin.createUser({
                email,
                password,
                displayName: name,
            });

            await createApprovedTeacherProfile({
                teacherUid: newUser.uid,
                teacherName: name,
                teacherEmail: email,
                classDocId,
                privacyAgreed,
                emailVerificationRequired: true,
                requestedClassId,
            });

            return { success: true, message: "교사 계정 설정이 완료되었습니다." };
        } catch (error) {
            console.error("requestTeacherAccount error:", error);
            throw new HttpsError("internal", error.message || "서버 오류 발생");
        }
    },
);

/**
 * 愿由ъ옄媛 '?뱀씤 ?湲? ?곹깭??援먯궗瑜?理쒖쥌 ?뱀씤?섍퀬,
 * ?대떦 援먯궗???숆툒怨?愿??臾몄꽌瑜??앹꽦?⑸땲??
 * @param {object} data - ?대씪?댁뼵?몄뿉???꾨떖???곗씠?? { teacherUid, requestedClassId, teacherName }
 * @param {object} context - ?⑥닔瑜??몄텧???ъ슜?먯쓽 ?몄쬆 ?뺣낫.
 * @returns {object} ?깃났 ?먮뒗 ?ㅽ뙣 硫붿떆吏
 */
exports.approveTeacher = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        enforceAppCheck: ENFORCE_APPCHECK,
    },
    async (request) => {
        if (request.auth?.token.role !== "admin") {
            throw new HttpsError(
                "permission-denied",
                "???묒뾽???섑뻾?????덈뒗 沅뚰븳???놁뒿?덈떎.",
            );
        }

        const { teacherUid, requestedClassDocId, teacherName } = request.data;
        const normalizedClassDocId = normalizeClassDocId(requestedClassDocId);
        const normalizedTeacherName =
            normalizeText(teacherName) || "\uAD50\uC0AC";
        const parsedClassInfo = parseClassDocId(normalizedClassDocId);

        if (!teacherUid || !normalizedClassDocId || !normalizedTeacherName) {
            throw new HttpsError("invalid-argument", "?꾩닔 ?뺣낫媛 ?꾨씫?섏뿀?듬땲??");
        }

        try {
            // ??怨좎쑀??Firestore-safe classId ?앹꽦
            const generatedClassId = db.collection("classes").doc().id;

            // ??Firestore 寃쎈줈 吏??
            const userDocRef = db.doc(`users/${teacherUid}`);
            const classDocRef = db.doc(`classes/${generatedClassId}`);
            const studentDocRef = db.doc(
                `classes/${generatedClassId}/students/${teacherUid}`,
            );

            const userSnap = await userDocRef.get();
            if (!userSnap.exists || userSnap.data().status !== "pending") {
                throw new HttpsError(
                    "failed-precondition",
                    "議댁옱?섏? ?딄굅???뱀씤 ?湲?以묒씠 ?꾨땶 ?ъ슜?먯엯?덈떎.",
                );
            }
            await assertTeacherEmailVerifiedBeforeApproval(teacherUid);

            const batch = db.batch();
            const now = FieldValue.serverTimestamp();

            // ??1. users ?낅뜲?댄듃 (classId ???
            batch.update(userDocRef, {
                status: "approved",
                classId: generatedClassId,
            });

            // ??2. classes 臾몄꽌 ?앹꽦 (?쒖떆???대쫫???ы븿)
            batch.set(classDocRef, {
                classDocId: normalizedClassDocId, // ex. 서울구남초 6-3
                teacherUid,
                teacherName: normalizedTeacherName,
                teacherDisplayName: normalizedTeacherName,
                ...(parsedClassInfo?.schoolName
                    ? { schoolName: parsedClassInfo.schoolName }
                    : {}),
                ...(parsedClassInfo?.grade ? { grade: parsedClassInfo.grade } : {}),
                ...(parsedClassInfo?.classNum
                    ? { classNum: parsedClassInfo.classNum }
                    : {}),
                currencyUnit: "\uCF54\uC778",
                createdAt: now,
            });

            // ??3. students ?섏쐞 而щ젆?섏뿉 援먯궗 ?깅줉
            batch.set(studentDocRef, {
                uid: teacherUid,
                name: normalizedTeacherName,
                role: "teacher",
                studentNumber: 0,
                job: "援먯궗",
                creditScore: 700,
                assets: {
                    cash: 10000,
                    deposit: 0,
                    loan: 0,
                    missionToken: 0,
                    stockValue: { value: 0 },
                },
                createdAt: now,
            });

            await batch.commit();

            // ??4. 而ㅼ뒪? ?대젅???낅뜲?댄듃
            await authAdmin.setCustomUserClaims(teacherUid, {
                role: "teacher",
                classId: generatedClassId,
                isApproved: true,
            });

            return {
                success: true,
                classId: generatedClassId,
                classDocId: normalizedClassDocId,
            };
        } catch (error) {
            console.error("approveTeacher error:", error);
            throw new HttpsError("internal", "援먯궗 ?뱀씤 以??ㅻ쪟 諛쒖깮");
        }
    },
);

/**
 * ??[異붽?] 援먯궗 媛??嫄곗젅 諛?怨꾩젙 ??젣 ?⑥닔
 * - 愿由ъ옄 沅뚰븳 ?뺤씤 ??Firestore 臾몄꽌? Auth 怨꾩젙??紐⑤몢 ??젣?⑸땲??
 */
exports.rejectTeacher = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        enforceAppCheck: ENFORCE_APPCHECK,
    },
    async (request) => {
        // 1. 留덉뒪??愿由ъ옄 沅뚰븳 ?뺤씤
        if (request.auth?.token.role !== "admin") {
            throw new HttpsError("permission-denied", "嫄곗젅 泥섎━ 沅뚰븳???놁뒿?덈떎.");
        }

        const { teacherUid } = request.data;
        if (!teacherUid) {
            throw new HttpsError("invalid-argument", "???UID媛 ?꾨씫?섏뿀?듬땲??");
        }

        console.log(`[Reject] 援먯궗 嫄곗젅 ?쒖옉 - UID: ${teacherUid}`);

        try {
            // 2. Firestore 臾몄꽌 ??젣 (users 而щ젆??
            await db.doc(`users/${teacherUid}`).delete();
            console.log(`[Reject] Firestore 臾몄꽌 ??젣 ?꾨즺: ${teacherUid}`);

            // 3. Firebase Auth ?ъ슜??怨꾩젙 ??젣
            // 怨꾩젙源뚯? ??젣?댁빞 ?대떦 ?대찓?쇰줈 ?섏쨷???ㅼ떆 ?좎껌??媛?ν빀?덈떎.
            await authAdmin.deleteUser(teacherUid).catch((err) => {
                if (err.code === "auth/user-not-found") {
                    console.warn(
                        `[Reject] Auth 怨꾩젙???대? 議댁옱?섏? ?딆쓬: ${teacherUid}`,
                    );
                    return;
                }
                throw err;
            });
            console.log(`[Reject] Auth 怨꾩젙 ??젣 ?꾨즺: ${teacherUid}`);

            return {
                success: true,
                message: "媛???붿껌??嫄곗젅?섍퀬 紐⑤뱺 ?곗씠?곕? ??젣?덉뒿?덈떎.",
            };
        } catch (error) {
            console.error("[Reject] 嫄곗젅 泥섎━ 以??쒕쾭 ?ㅻ쪟:", error);
            throw new HttpsError(
                "internal",
                error.message || "嫄곗젅 泥섎━ 以??ㅻ쪟 諛쒖깮",
            );
        }
    },
);

const normalizeGender = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return null;

    const lowered = raw.toLowerCase();
    if (
        lowered === "male" ||
        lowered === "m" ||
        lowered === "man" ||
        lowered === "boy" ||
        raw === "남" ||
        raw === "남자" ||
        raw === "남성"
    ) {
        return "male";
    }
    if (
        lowered === "female" ||
        lowered === "f" ||
        lowered === "woman" ||
        lowered === "girl" ||
        raw === "여" ||
        raw === "여자" ||
        raw === "여성"
    ) {
        return "female";
    }
    return null;
};

const parseStudentNumber = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return null;

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
};

const formatStudentAccountCreateError = (error) => {
    const code = error?.errorInfo?.code || error?.code || "";

    switch (code) {
        case "auth/email-already-exists":
            return "이미 사용 중인 이메일입니다. 기존 계정이 남아 있는지 확인해 주세요.";
        case "auth/invalid-email":
            return "올바른 이메일 형식이 아닙니다.";
        case "auth/invalid-password":
        case "auth/weak-password":
            return "비밀번호는 6자 이상이어야 합니다.";
        default:
            return error?.message || "학생 계정 생성 중 오류가 발생했습니다.";
    }
};

// ?숈깮 怨꾩젙 ?쇨큵 ?앹꽦
/**
 * ??[?몄텧 媛???⑥닔] ?숈깮 怨꾩젙???쇨큵 ?앹꽦?⑸땲?? (v2 onCall 諛⑹떇)
 */
exports.createStudentAccounts = onCall(
    { region: "asia-northeast3", memory: "256MiB", timeoutSeconds: 120 },
    async (request) => {
        if (!request.auth)
            throw new HttpsError("unauthenticated", "?몄쬆???꾩슂?⑸땲??");

        const { callerRole, callerClassId } = assertTeacherOrAdmin(request.auth);
        const { students, classIdToAssign, initialCapital } = request.data || {};
        const finalClassId =
            callerRole === "teacher" ? callerClassId : classIdToAssign;

        if (!Array.isArray(students) || students.length === 0) {
            throw new HttpsError("invalid-argument", "?숈깮 ?뺣낫媛 ?놁뒿?덈떎.");
        }

        if (!finalClassId) {
            throw new HttpsError(
                "invalid-argument",
                "classIdToAssign is required for admin callers.",
            );
        }

        const results = []; // ??寃곌낵瑜??댁쓣 諛곗뿴 異붽?

        const seenEmails = new Set();

        for (const rawStudent of students) {
            const email = normalizeEmail(rawStudent?.email);
            const password = String(rawStudent?.password ?? "").trim();
            const name = normalizeText(rawStudent?.name);
            const studentNumber = parseStudentNumber(rawStudent?.studentNumber);
            const normalizedGender = normalizeGender(rawStudent?.gender);

            if (!name || !email) {
                results.push({
                    status: "error",
                    name,
                    email,
                    message: "이름과 이메일을 모두 입력해 주세요.",
                });
                continue;
            }

            if (seenEmails.has(email)) {
                results.push({
                    status: "error",
                    name,
                    email,
                    message: "같은 요청에 중복된 이메일이 있습니다.",
                });
                continue;
            }
            seenEmails.add(email);

            if (password.length < 6) {
                results.push({
                    status: "error",
                    name,
                    email,
                    message: "비밀번호는 6자 이상이어야 합니다.",
                });
                continue;
            }

            let createdUserUid = null;

            try {
                const userRecord = await authAdmin.createUser({
                    email,
                    password,
                    displayName: name,
                });
                createdUserUid = userRecord.uid;

                await authAdmin.setCustomUserClaims(userRecord.uid, {
                    role: "student",
                    isApproved: true,
                    classId: finalClassId,
                });

                const studentRef = db.doc(
                    `classes/${finalClassId}/students/${userRecord.uid}`,
                );
                const userRef = db.doc(`users/${userRecord.uid}`);
                const batch = db.batch();

                const studentData = {
                    uid: userRecord.uid,
                    name,
                    email,
                    role: "student",
                    studentNumber: studentNumber ?? 0,
                    classId: finalClassId,
                    privacyAgreed: false,
                    agreedAt: null,
                    createdAt: FieldValue.serverTimestamp(),
                    assets: {
                        cash: Number(initialCapital) || 0,
                        deposit: 0,
                        loan: 0,
                        missionToken: 0,
                        stockValue: { value: 0 },
                    },
                };
                if (normalizedGender) studentData.gender = normalizedGender;

                batch.set(studentRef, studentData);
                const userDocData = {
                    uid: userRecord.uid,
                    name,
                    email,
                    role: "student",
                    classId: finalClassId,
                    privacyAgreed: false,
                    agreedAt: null,
                };
                if (normalizedGender) userDocData.gender = normalizedGender;
                batch.set(userRef, userDocData);
                await batch.commit();

                // ???깃났 寃곌낵 湲곕줉
                results.push({ status: "success", name, email });
            } catch (error) {
                console.error(`怨꾩젙 ?앹꽦 ?ㅽ뙣: ${email}`, error);
                // ???ㅽ뙣 寃곌낵 湲곕줉
                if (createdUserUid) {
                    try {
                        await authAdmin.deleteUser(createdUserUid);
                    } catch (rollbackError) {
                        console.error(
                            `[createStudentAccounts] rollback failed for ${email}`,
                            rollbackError,
                        );
                    }
                }
                results.push({
                    status: "error",
                    name,
                    email,
                    message: formatStudentAccountCreateError(error),
                });
            }
        }


        // ???섏젙??諛섑솚媛? ?꾨줎?몄뿏?쒓? 湲곕떎由щ뒗 results瑜??ы븿?댁꽌 ?꾨떖
        return {
            success: results.some((item) => item.status === "success"),
            results,
        };
    },
);

// ???숈깮 怨꾩젙 ?쇨큵 ??젣 ?⑥닔
exports.deleteStudentAccounts = onCall(
    {
        region: "asia-northeast3",
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    (request) => classMaintenance.execute(request, "delete"),
);

// 鍮꾨?踰덊샇 珥덇린??(onCall 諛⑹떇 - CORS ?먮룞 ?닿껐)
exports.cleanupDeletedStudentOrphans = onCall(
    {
        region: "asia-northeast3",
        memory: "512MiB",
        timeoutSeconds: 300,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const { callerRole, callerClassId } = assertTeacherOrAdmin(request.auth);
        const { classId } = request.data || {};
        if (!classId) {
            throw new HttpsError("invalid-argument", "classId가 필요합니다.");
        }

        if (callerRole === "teacher" && classId !== callerClassId) {
            throw new HttpsError(
                "permission-denied",
                "Teacher can only clean orphan data in their own class.",
            );
        }

        return cleanupDeletedStudentOrphansForClass(classId);
    },
);

exports.resetPassword = onCall(
    {
        region: "asia-northeast3",
        memory: "256MiB",
        timeoutSeconds: 60,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const callerUid = request.auth.uid;
        console.info(`Password reset request from UID: ${callerUid}`);

        const callerDoc = await db.collection("users").doc(callerUid).get();
        if (!callerDoc.exists) {
            throw new HttpsError("not-found", "요청한 사용자 정보를 찾을 수 없습니다.");
        }

        const callerData = callerDoc.data();
        const callerRole = request.auth.token?.role || null;
        const callerClassId = request.auth.token?.classId || null;

        if (callerRole !== "admin" && callerRole !== "teacher") {
            throw new HttpsError("permission-denied", "비밀번호를 초기화할 권한이 없습니다.");
        }

        if (callerRole === "teacher" && !callerClassId) {
            throw new HttpsError(
                "failed-precondition",
                "담당 학급 정보가 없어 요청을 처리할 수 없습니다.",
            );
        }

        const { uid: targetUidToReset } = request.data;
        if (!targetUidToReset) {
            throw new HttpsError("invalid-argument", "초기화할 대상 UID가 필요합니다.");
        }

        const targetDocRef = db.collection("users").doc(targetUidToReset);
        const targetDocSnap = await targetDocRef.get();
        if (!targetDocSnap.exists) {
            throw new HttpsError("not-found", "대상 사용자 정보를 찾을 수 없습니다.");
        }

        const targetData = targetDocSnap.data();
        const targetAuthRecord = await authAdmin.getUser(targetUidToReset);
        const targetRole = targetAuthRecord.customClaims?.role || targetData.role;
        const targetClassId =
            targetAuthRecord.customClaims?.classId ||
            targetData.classId ||
            targetData.className ||
            null;

        if (callerRole === "teacher") {
            const isSameClassStudent =
                targetRole === "student" && targetClassId === callerClassId;

            if (!isSameClassStudent) {
                console.warn(
                    `Teacher ${callerUid} (Class: ${callerClassId}) attempted unauthorized reset of ${targetUidToReset} (Role: ${targetRole}, Class: ${targetClassId})`,
                );
                throw new HttpsError(
                    "permission-denied",
                    "교사는 본인 학급 학생의 비밀번호만 초기화할 수 있습니다.",
                );
            }
        }

        try {
            await authAdmin.updateUser(targetUidToReset, { password: "123456" });

            await targetDocRef.update({
                forcePasswordChange: true,
                passwordLastResetBy: callerUid,
                passwordLastResetAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            const isSelfReset = callerUid === targetUidToReset;
            const targetDisplayName =
                targetData.name || targetData.email || targetUidToReset;
            const callerDisplayName =
                callerData.name || callerData.email || callerUid;

            const logMessage = isSelfReset
                ? `Self password reset by ${callerDisplayName} (UID: ${callerUid})`
                : `Password reset for ${targetDisplayName} (UID: ${targetUidToReset}) by ${callerDisplayName} (UID: ${callerUid})`;

            console.info(logMessage);

            const responseMessage = isSelfReset
                ? "비밀번호가 '123456'으로 초기화되었습니다. 다음 로그인 시 새 비밀번호로 변경해 주세요."
                : `${targetDisplayName}의 비밀번호가 '123456'으로 초기화되었습니다. 다음 로그인 시 새 비밀번호로 변경해 주세요.`;

            return {
                success: true,
                message: responseMessage,
                isSelfReset: isSelfReset,
            };
        } catch (error) {
            console.error(
                `Password reset error for ${targetData.name || targetData.email} (UID: ${targetUidToReset}):`,
                error,
            );
            throw new HttpsError(
                "internal",
                error.message || "비밀번호 초기화 중 오류가 발생했습니다.",
            );
        }
    },
);
exports.registerGoogleTeacher = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        enforceAppCheck: ENFORCE_APPCHECK,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "인증이 필요합니다.");
        }

        const uid = request.auth.uid;
        const email = normalizeEmail(request.auth.token?.email);
        const provider = request.auth.token?.firebase?.sign_in_provider || "";
        const name = normalizeText(request.data?.name) || normalizeText(request.auth.token?.name) || "이름 없음";
        const classDocId = normalizeClassDocId(request.data?.classDocId);
        const privacyAgreed = request.data?.privacyAgreed === true;

        if (!email) {
            throw new HttpsError("failed-precondition", "인증 계정 이메일을 확인할 수 없습니다.");
        }
        if (provider !== "google.com") {
            throw new HttpsError("permission-denied", "Google 로그인 계정만 요청할 수 있습니다.");
        }
        validateTeacherSignupPayload({ name, classDocId });

        const requestedClassId = randomUUID();

        try {
            const userDoc = await db.doc(`users/${uid}`).get();
            if (userDoc.exists) {
                const existing = userDoc.data() || {};
                const registrationAction =
                    resolveExistingGoogleTeacherRegistration(existing);
                if (
                    registrationAction ===
                    GOOGLE_TEACHER_REGISTRATION_ACTION.REJECT_ROLE_CONFLICT
                ) {
                    throw new HttpsError(
                        "already-exists",
                        "이미 학생 또는 다른 역할의 계정으로 사용 중인 이메일입니다.",
                    );
                }
                if (registrationAction === GOOGLE_TEACHER_REGISTRATION_ACTION.COMPLETE) {
                    const classId = await createApprovedTeacherProfile({
                        teacherUid: uid,
                        teacherName: existing.name || name,
                        teacherEmail: existing.email || email,
                        classDocId: existing.classDocId || classDocId,
                        privacyAgreed: existing.privacyAgreed === true || privacyAgreed,
                        requestedClassId: existing.requestedClassId || requestedClassId,
                        keepExistingCreatedAt: true,
                    });
                    return { success: true, classId, message: "교사 계정 설정이 완료되었습니다." };
                }
                return { success: true, message: "이미 등록된 계정입니다." };
            }

            await createApprovedTeacherProfile({
                teacherUid: uid,
                teacherName: name,
                teacherEmail: email,
                classDocId,
                privacyAgreed,
                requestedClassId,
            });

            return { success: true, message: "교사 계정 설정이 완료되었습니다." };
        } catch (error) {
            if (error instanceof HttpsError) throw error;
            throw new HttpsError("internal", "서버 오류 발생");
        }
    },
);

// --- [?좉퇋 異붽?] 4. 媛쒖씤?뺣낫 ?숈쓽 ?낅뜲?댄듃 ?⑥닔 (?앹뾽?? ---
// ?ъ슜?먭? ?앹뾽?먯꽌 '?숈쓽' 踰꾪듉???꾨Ⅴ硫????⑥닔瑜??몄텧?섏뿬 DB??湲곕줉???④퉩?덈떎.
/**
 * [선생님 본인 탈퇴]
 * - 본인 선생님 계정만 허용
 * - 최근 로그인(auth_time) 검증
 * - 학생/기타 구성원이 남아 있으면 탈퇴 차단
 * - 학급 문서를 정리한 뒤 Auth 계정을 삭제
 */
exports.deleteMyTeacherAccount = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        enforceAppCheck: ENFORCE_APPCHECK,
        memory: "512MiB",
        timeoutSeconds: 180,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const callerUid = request.auth.uid;
        const callerRole = request.auth.token?.role;
        if (callerRole !== "teacher") {
            throw new HttpsError(
                "permission-denied",
                "현재는 선생님 계정만 직접 탈퇴할 수 있습니다.",
            );
        }

        assertRecentLogin(request.auth.token);

        const userRef = db.doc(`users/${callerUid}`);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            throw new HttpsError("not-found", "사용자 정보를 찾을 수 없습니다.");
        }

        const userData = userSnap.data() || {};
        const classId = userData.classId || request.auth.token?.classId;
        if (!classId) {
            throw new HttpsError(
                "failed-precondition",
                "학급 정보가 없어 탈퇴를 진행할 수 없습니다.",
            );
        }

        const classRef = db.doc(`classes/${classId}`);
        const classSnap = await classRef.get();
        if (!classSnap.exists) {
            await userRef.delete().catch(() => { });
            await authAdmin.deleteUser(callerUid).catch((err) => {
                if (err?.code !== "auth/user-not-found") throw err;
            });
            return { success: true, deletedClass: false };
        }

        const classData = classSnap.data() || {};
        if (classData.teacherUid && classData.teacherUid !== callerUid) {
            throw new HttpsError(
                "permission-denied",
                "본인이 소유한 학급만 탈퇴할 수 있습니다.",
            );
        }

        const studentsSnap = await db.collection(`classes/${classId}/students`).get();
        const remainingMembers = studentsSnap.docs.filter(
            (docSnap) => docSnap.id !== callerUid,
        );
        if (remainingMembers.length > 0) {
            throw new HttpsError(
                "failed-precondition",
                "학생 또는 다른 구성원이 남아 있어 탈퇴할 수 없습니다. 먼저 학급 정리를 완료해 주세요.",
            );
        }

        await db.recursiveDelete(classRef);
        await userRef.delete().catch(() => { });

        await authAdmin.deleteUser(callerUid).catch((err) => {
            if (err?.code !== "auth/user-not-found") throw err;
        });

        return { success: true, deletedClass: true };
    },
);

exports.updatePrivacyAgreement = onCall(
    { region: "asia-northeast3", cors: true },
    async (request) => {
        // 1. ?몄쬆 ?뺤씤
        if (!request.auth) {
            console.error("[Privacy] ?몄쬆?섏? ?딆? ?ъ슜???묎렐");
            throw new HttpsError("unauthenticated", "?몄쬆???꾩슂?⑸땲??");
        }

        const uid = request.auth.uid;
        const { privacyAgreed } = request.data;
        console.log(`[Privacy] ?쒖옉 - UID: ${uid}, ?숈쓽?щ?: ${privacyAgreed}`);

        try {
            const userRef = db.doc(`users/${uid}`);
            const userSnap = await userRef.get();

            if (!userSnap.exists) {
                console.error(`[Privacy] ?ㅻ쪟: users/${uid} 臾몄꽌媛 議댁옱?섏? ?딆쓬`);
                throw new HttpsError("not-found", "?ъ슜??臾몄꽌瑜?李얠쓣 ???놁뒿?덈떎.");
            }

            const userData = userSnap.data();
            console.log(
                `[Privacy] ?ъ슜???뺣낫 ?뺤씤?? ${userData.name}, ??븷: ${userData.role}`,
            );

            const batch = db.batch();
            const now = FieldValue.serverTimestamp();

            // 1. 猷⑦듃 users 臾몄꽌 ?낅뜲?댄듃 (set merge ?ъ슜?쇰줈 ???덉쟾?섍쾶)
            batch.set(
                userRef,
                {
                    privacyAgreed: true,
                    agreedAt: now,
                },
                { merge: true },
            );
            console.log(`[Privacy] users/${uid} ?낅뜲?댄듃 以鍮??꾨즺`);

            // 2. ?숈깮??寃쎌슦 ?숆툒 ??臾몄꽌 ?낅뜲?댄듃
            if (userData.role === "student" && userData.classId) {
                const studentRef = db.doc(
                    `classes/${userData.classId}/students/${uid}`,
                );
                batch.set(
                    studentRef,
                    {
                        privacyAgreed: true,
                        agreedAt: now,
                    },
                    { merge: true },
                );
                console.log(
                    `[Privacy] ?숈깮 ?숆툒 臾몄꽌 ?낅뜲?댄듃 以鍮? classes/${userData.classId}`,
                );
            }

            // 3. 援먯궗??寃쎌슦 ?숆툒 ??臾몄꽌 ?낅뜲?댄듃
            if (
                userData.role === "teacher" &&
                userData.classId &&
                userData.status === "approved"
            ) {
                const teacherInClassRef = db.doc(
                    `classes/${userData.classId}/students/${uid}`,
                );
                batch.set(
                    teacherInClassRef,
                    {
                        privacyAgreed: true,
                        agreedAt: now,
                    },
                    { merge: true },
                );
                console.log(
                    `[Privacy] 援먯궗 ?숆툒 臾몄꽌 ?낅뜲?댄듃 以鍮? classes/${userData.classId}`,
                );
            }

            await batch.commit();
            console.log(`[Privacy] 紐⑤뱺 ?곗씠??????깃났 (Batch Commit)`);

            return { success: true };
        } catch (error) {
            console.error("[Privacy] ?ㅽ뻾 以??덉쇅 諛쒖깮:", error);
            throw new HttpsError("internal", error.message);
        }
    },
);

/**
 * [?숇뀈??留덈Т由? ?숆툒 ?곗씠??珥덇린???⑥닔
 * - 蹂댁〈: ?숆툒 湲곕낯 ?ㅼ젙(?꾨뱶), 援먯궗 Auth 怨꾩젙, 猷⑦듃 users ??援먯궗 臾몄꽌, ?숆툒 ??援먯궗 student 臾몄꽌
 * - ??젣: ?숈깮 Auth 怨꾩젙, 猷⑦듃 users ???숈깮 臾몄꽌, ?숆툒 ?섏쐞 紐⑤뱺 而щ젆??(taxDaily, bank ??
 */
exports.startSwitchToStudent = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        enforceAppCheck: ENFORCE_APPCHECK,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const ctx = assertRoleFromClaims(
            request,
            ["teacher", "admin"],
            { requireClassForTeacher: true },
        );

        if (ctx.token?.sw === true) {
            throw new HttpsError(
                "failed-precondition",
                "이미 전환된 세션입니다.",
            );
        }

        const targetStudentUid = normalizeText(request.data?.targetStudentUid);
        const requestedClassId = normalizeText(request.data?.classId);
        if (!targetStudentUid) {
            throw new HttpsError(
                "invalid-argument",
                "targetStudentUid가 필요합니다.",
            );
        }
        if (targetStudentUid === ctx.uid) {
            throw new HttpsError(
                "failed-precondition",
                "본인 계정으로는 전환할 수 없습니다.",
            );
        }

        let classId = requestedClassId || ctx.classId || null;
        if (!classId) {
            const userSnap = await db.doc(`users/${ctx.uid}`).get();
            classId = userSnap.data()?.classId || null;
        }
        if (!classId) {
            throw new HttpsError(
                "failed-precondition",
                "학급 정보(classId)를 확인할 수 없습니다.",
            );
        }
        if (ctx.role === "teacher" && ctx.classId && ctx.classId !== classId) {
            throw new HttpsError(
                "permission-denied",
                "다른 학급 학생으로는 전환할 수 없습니다.",
            );
        }

        const targetStudentRef = db.doc(`classes/${classId}/students/${targetStudentUid}`);
        const callerInClassRef = db.doc(`classes/${classId}/students/${ctx.uid}`);
        const callerUserRef = db.doc(`users/${ctx.uid}`);

        const [
            targetStudentSnap,
            callerInClassSnap,
            callerUserSnap,
            targetAuthRecord,
        ] = await Promise.all([
            targetStudentRef.get(),
            callerInClassRef.get(),
            callerUserRef.get(),
            authAdmin.getUser(targetStudentUid),
        ]);

        if (!targetStudentSnap.exists) {
            throw new HttpsError("not-found", "해당 학생을 찾을 수 없습니다.");
        }

        const targetStudent = targetStudentSnap.data() || {};
        if ((targetStudent.role || "student") !== "student") {
            throw new HttpsError(
                "failed-precondition",
                "학생 계정으로만 전환할 수 있습니다.",
            );
        }

        if (ctx.role === "teacher") {
            if (!callerInClassSnap.exists) {
                throw new HttpsError(
                    "permission-denied",
                    "학급 소속 교사만 전환할 수 있습니다.",
                );
            }
            const callerClassRole = callerInClassSnap.data()?.role || null;
            if (callerClassRole !== "teacher" && callerClassRole !== "admin") {
                throw new HttpsError(
                    "permission-denied",
                    "학급 소속 교사만 전환할 수 있습니다.",
                );
            }
        }

        const callerUserData = callerUserSnap.exists ? callerUserSnap.data() : {};
        const teacherName =
            callerInClassSnap.data()?.name ||
            callerUserData?.name ||
            request.auth.token?.name ||
            "";

        const sessionId = randomUUID();
        const expiresAtMs = Date.now() + AUTH_SWITCH_TTL_MS;
        const sessionRef = db
            .collection(AUTH_SWITCH_SESSION_COLLECTION)
            .doc(sessionId);

        await sessionRef.set({
            sessionId,
            classId,
            teacherUid: ctx.uid,
            teacherRole: ctx.role,
            teacherName: teacherName || null,
            targetStudentUid,
            targetStudentName: targetStudent.name || null,
            targetStudentNumber: targetStudent.studentNumber ?? null,
            status: "issued",
            createdAt: FieldValue.serverTimestamp(),
            expiresAt: admin.firestore.Timestamp.fromMillis(expiresAtMs),
            consumedAt: null,
        });

        const switchToken = await authAdmin.createCustomToken(targetStudentUid, {
            ...buildInlineCustomClaims(targetAuthRecord.customClaims, {
                role: targetStudent.role || "student",
                classId,
                isApproved: true,
                permissions: normalizePermissionClaims(
                    targetAuthRecord.customClaims?.permissions ||
                    targetStudent.permissions,
                ),
            }),
            sw: true,
            switchSessionId: sessionId,
            originTeacherUid: ctx.uid,
            originTeacherRole: ctx.role,
            originClassId: classId,
        });

        return {
            success: true,
            token: switchToken,
            sessionId,
            expiresAtMs,
            teacher: {
                uid: ctx.uid,
                role: ctx.role,
                name: teacherName || "",
                classId,
            },
            student: {
                uid: targetStudentUid,
                name: targetStudent.name || "",
                studentNumber: targetStudent.studentNumber ?? null,
            },
        };
    },
);

exports.returnToTeacher = onCall(
    {
        region: "asia-northeast3",
        cors: true,
        enforceAppCheck: ENFORCE_APPCHECK,
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
        }

        const token = request.auth.token || {};
        if (token.sw !== true) {
            throw new HttpsError(
                "permission-denied",
                "전환 세션이 아닙니다.",
            );
        }

        const switchSessionId = normalizeText(token.switchSessionId);
        const originTeacherUid = normalizeText(token.originTeacherUid);
        if (!switchSessionId || !originTeacherUid) {
            throw new HttpsError(
                "failed-precondition",
                "전환 세션 정보가 유효하지 않습니다.",
            );
        }

        const sessionRef = db
            .collection(AUTH_SWITCH_SESSION_COLLECTION)
            .doc(switchSessionId);

        await db.runTransaction(async (tx) => {
            const sessionSnap = await tx.get(sessionRef);
            if (!sessionSnap.exists) {
                throw new HttpsError(
                    "not-found",
                    "전환 세션을 찾을 수 없습니다.",
                );
            }

            const sessionData = sessionSnap.data() || {};
            if (sessionData.teacherUid !== originTeacherUid) {
                throw new HttpsError(
                    "permission-denied",
                    "전환 세션 소유자가 일치하지 않습니다.",
                );
            }
            if (sessionData.targetStudentUid !== request.auth.uid) {
                throw new HttpsError(
                    "permission-denied",
                    "전환 대상이 일치하지 않습니다.",
                );
            }

            const expiresAtMs =
                typeof sessionData.expiresAt?.toMillis === "function"
                    ? sessionData.expiresAt.toMillis()
                    : 0;
            if (!expiresAtMs || expiresAtMs <= Date.now()) {
                throw new HttpsError(
                    "failed-precondition",
                    "전환 세션이 만료되었습니다.",
                );
            }
            if (sessionData.consumedAt) {
                throw new HttpsError(
                    "failed-precondition",
                    "이미 사용된 전환 세션입니다.",
                );
            }

            tx.update(sessionRef, {
                status: "consumed",
                consumedAt: FieldValue.serverTimestamp(),
                consumedByUid: request.auth.uid,
            });
        });

        const teacherAuthRecord = await authAdmin.getUser(originTeacherUid);
        const teacherToken = await authAdmin.createCustomToken(
            originTeacherUid,
            buildInlineCustomClaims(teacherAuthRecord.customClaims),
        );

        return {
            success: true,
            token: teacherToken,
        };
    },
);

exports.resetMyClassData = onCall(
    {
        region: "asia-northeast3",
        memory: "512MiB",
        timeoutSeconds: 540,
    },
    (request) => classMaintenance.execute(request, "full"),
);

/**
 * [?꾩껜 ?숇뀈??留덈Т由? ?쒖뒪????紐⑤뱺 ?숆툒 ?곗씠???쇨큵 珥덇린??
 * - 沅뚰븳: admin留??몄텧 媛???꾩슂 ??superAdmin/allowlist濡?媛뺥솕 沅뚯옣)
 * - 蹂댁〈: classes/{classId} 臾몄꽌(?꾨뱶), 紐⑤뱺 teacher-role students 臾몄꽌, 援먯궗 Auth/users 臾몄꽌(??젣 ????
 * - ??젣: ?숈깮 Auth 怨꾩젙, users/{uid} ?숈깮 臾몄꽌, classes/{classId} ?섏쐞 而щ젆???꾨?(??students??遺꾧린 泥섎━)
 */
exports.globalResetAllClasses = onCall(
    {
        region: "asia-northeast3",
        memory: "1GiB",
        timeoutSeconds: 540,
    },
    async (request) => {
        if (request.auth?.token?.role !== "admin") {
            throw new HttpsError(
                "permission-denied",
                "???묒뾽? ?쒖뒪??珥앷큵 愿由ъ옄留??섑뻾?????덉뒿?덈떎."
            );
        }

        console.log("--- ?뢾 ?꾩껜 ?숆툒 ?곗씠??珥덇린???쒖옉 ---");

        try {
            const classesSnap = await db.collection("classes").get();
            const totalClasses = classesSnap.size;
            let processedCount = 0;

            if (totalClasses === 0) return { message: "珥덇린?뷀븷 ?숆툒???놁뒿?덈떎." };

            // helper: Firestore batch 500 ?쒗븳 遺꾪븷
            const commitBatchedDeletes = async (docRefs, chunkSize = 450) => {
                for (let i = 0; i < docRefs.length; i += chunkSize) {
                    const batch = db.batch();
                    docRefs.slice(i, i + chunkSize).forEach((ref) => batch.delete(ref));
                    await batch.commit();
                }
            };

            // helper: Auth deleteUsers 1000 ?쒗븳 遺꾪븷
            const deleteAuthUsersInChunks = async (uids, chunkSize = 1000) => {
                const chunks = [];
                for (let i = 0; i < uids.length; i += chunkSize) {
                    chunks.push(uids.slice(i, i + chunkSize));
                }
                await Promise.all(chunks.map((c) => authAdmin.deleteUsers(c)));
            };

            for (const classDoc of classesSnap.docs) {
                const classId = classDoc.id;
                const classData = classDoc.data() || {};
                const teacherUid = classData.teacherUid; // ?숆툒 臾몄꽌????λ맂 援먯궗 UID

                const classRef = db.doc(`classes/${classId}`);
                const collections = await classRef.listCollections();

                for (const col of collections) {
                    if (col.id === "students") {
                        // ??students 而щ젆??泥섎━
                        const studentRefs = await col.listDocuments();

                        const studentUidsForAuth = [];   // "吏꾩쭨 ?숈깮"留?
                        const userDocsToDelete = [];     // users/{uid} delete ???

                        for (const docRef of studentRefs) {
                            // role ?먮떒???꾪빐 臾몄꽌 ?곗씠???쎄린
                            const snap = await docRef.get();
                            const data = snap.data() || {};
                            const role = data.role;

                            const isMainTeacherDoc = teacherUid && docRef.id === teacherUid;
                            const isTeacherRole = role === "teacher"; // ???듭떖: teacher-role? ??젣 湲덉?

                            if (isMainTeacherDoc) {
                                // ?뙚 ?숆툒?????援먯궗 臾몄꽌: ?섏쐞 而щ젆????젣 + (?먰븯硫? ?꾨뱶 由ъ뀑
                                const subCols = await docRef.listCollections();
                                for (const subCol of subCols) {
                                    await db.recursiveDelete(subCol);
                                }

                                // resetMyClassData? ?숈씪?섍쾶 "???援먯궗"??由ъ뀑 (?먯튂 ?딆쑝硫???update瑜?鍮쇰㈃ ??
                                await docRef.update({
                                    job: "援먯궗",
                                    jobs: ["援먯궗"],
                                    creditScore: 700,
                                    assets: {
                                        cash: 10000,
                                        deposit: 0,
                                        loan: 0,
                                        missionToken: 0,
                                        stockValue: { value: 0 },
                                    },
                                    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                                });

                                continue;
                            }

                            if (isTeacherRole) {
                                // ??(遺援먯궗/?뚯뒪?멸탳???? teacher-role: 臾몄꽌 蹂댁〈, ?섏쐞 而щ젆?섎쭔 ??젣
                                const subCols = await docRef.listCollections();
                                for (const subCol of subCols) {
                                    await db.recursiveDelete(subCol);
                                }

                                // ?뵏 湲곕낯? "?꾨뱶 ?좎?"媛 ???덉쟾??
                                // 留뚯빟 teacher-role?????援먯궗泥섎읆 由ъ뀑?섍퀬 ?띠쑝硫??ш린 update 異붽??섎㈃ ??
                                continue;
                            }

                            // ??洹??몃뒗 "?숈깮"?쇰줈 泥섎━: 臾몄꽌+?섏쐞 ??젣, Auth/users ??젣 ??곸뿉 ?ы븿
                            studentUidsForAuth.push(docRef.id);
                            userDocsToDelete.push(db.doc(`users/${docRef.id}`));
                            await db.recursiveDelete(docRef);
                        }

                        // ?숈깮 Auth/users ??젣
                        if (studentUidsForAuth.length > 0) {
                            await deleteAuthUsersInChunks(studentUidsForAuth, 1000);
                            await commitBatchedDeletes(userDocsToDelete, 450);
                        }
                    } else {
                        // ??students ??紐⑤뱺 ?섏쐞 而щ젆?섏? ?듭㎏濡???젣 (???섎룄?濡?
                        await db.recursiveDelete(col);
                    }
                }

                processedCount++;
                console.log(`[${processedCount}/${totalClasses}] ?숆툒 ?꾨즺: ${classId}`);
            }

            console.log("--- ???꾩껜 珥덇린???꾨즺 ---");
            return {
                success: true,
                message: `珥?${processedCount}媛쒖쓽 ?숆툒 ?곗씠???뺣━媛 ?꾨즺?섏뿀?듬땲??`,
            };
        } catch (error) {
            console.error("globalResetAllClasses Error:", error);
            throw new HttpsError("internal", "?꾩껜 珥덇린??以??쒕쾭 ?ㅻ쪟媛 諛쒖깮?덉뒿?덈떎.");
        }
    }
);



exports.resetClassActivityData = onCall(
    { region: "asia-northeast3", memory: "512MiB", timeoutSeconds: 540 },
    (request) => classMaintenance.execute(request, "activity"),
);
exports.getClassMaintenanceState = onCall(
    { region: "asia-northeast3" },
    (request) => classMaintenance.getState(request),
);
