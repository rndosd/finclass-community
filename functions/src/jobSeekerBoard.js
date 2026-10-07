"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const {
    assertTeacherOrAdminFromClaims,
    getAuthContext,
    getUserData,
} = require("../utils/permissions");
const { getGlobalConfig } = require("../utils/planManager");
const { stageActivityLog } = require("../utils/logUtils");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const JOB_SEEKER_BOARD_OPTS = {
    region: "asia-northeast3",
    cors: true,
    memory: "512MiB",
    timeoutSeconds: 60,
};

const SERVICE_STATUSES = new Set([
    "pending_approval",
    "active",
    "hidden",
    "deleted",
    "suspended",
]);
const OWNER_SERVICE_STATUSES = new Set(["active", "hidden", "deleted"]);
const PRICE_MODES = new Set(["fixed", "from", "negotiable"]);
const REQUEST_REVIEW_ACTIONS = new Set(["accept", "reject"]);
const normalizeText = (value, fallback = "") =>
    String(value ?? "").trim() || fallback;

const normalizeOptionalText = (value, maxLength = 2000) => {
    const text = normalizeText(value);
    return text ? text.slice(0, maxLength) : null;
};

const normalizeRequiredText = (value, fieldName, maxLength = 200) => {
    const text = normalizeText(value);
    if (!text) {
        throw new HttpsError("invalid-argument", `${fieldName} is required.`);
    }
    return text.slice(0, maxLength);
};

const normalizeAmount = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed));
};

const ensureEnumValue = (value, allowedValues, fieldName, fallback = "") => {
    const normalized = normalizeText(value, fallback);
    if (!normalized || !allowedValues.has(normalized)) {
        throw new HttpsError("invalid-argument", `${fieldName} is invalid.`);
    }
    return normalized;
};

const parseTimestamp = (value, fieldName) => {
    if (!value) return null;
    if (value instanceof Timestamp) return value;
    if (typeof value?.toDate === "function") {
        return Timestamp.fromDate(value.toDate());
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new HttpsError("invalid-argument", `${fieldName} is not a valid date.`);
    }

    return Timestamp.fromDate(parsed);
};

const isTeacherOrAdminRole = (role) => role === "teacher" || role === "admin";

const assertClassScope = async ({ classId, ctx }) => {
    if (!classId) {
        throw new HttpsError("invalid-argument", "classId is required.");
    }

    if (ctx.role === "admin") {
        return { role: "admin", name: "Admin", student: null };
    }

    if (ctx.role === "teacher") {
        if (ctx.classId && ctx.classId !== classId) {
            throw new HttpsError("permission-denied", "You cannot access another class.");
        }
        return { role: "teacher", name: "Teacher", student: null };
    }

    const student = await getUserData(classId, ctx.uid).catch(() => null);
    if (!student) {
        throw new HttpsError("permission-denied", "Class member was not found.");
    }

    return {
        role: normalizeText(student.role, "student"),
        name: normalizeText(student.name, "Student"),
        student,
    };
};

const assertStudentCaller = async ({ classId, ctx }) => {
    const student = await getUserData(classId, ctx.uid).catch(() => null);
    if (!student) {
        throw new HttpsError("not-found", "Student record was not found.");
    }
    if (student.role && student.role !== "student") {
        throw new HttpsError("permission-denied", "Only students can register services.");
    }
    return student;
};

const getCallerProfile = async ({ classId, request, ctx }) => {
    const scope = await assertClassScope({ classId, ctx });
    if (scope.student) {
        return {
            uid: ctx.uid,
            name: normalizeText(scope.student.name, "Student"),
            role: normalizeText(scope.student.role, "student"),
            studentNumber: normalizeText(scope.student.studentNumber),
        };
    }

    const fallbackName = scope.role === "admin" ? "Admin" : "Teacher";
    return {
        uid: ctx.uid,
        name: normalizeText(request.auth?.token?.name, fallbackName),
        role: scope.role,
        studentNumber: "",
    };
};

const getServiceRef = (classId, serviceId) =>
    db.doc(`classes/${classId}/jobSeekerServices/${serviceId}`);

const getRequestsCollection = (serviceRef) => serviceRef.collection("requests");

const sanitizeServiceInput = (service = {}, { current = {}, isUpdate = false } = {}) => {
    const merged = { ...current, ...service };
    const title = isUpdate && service.title === undefined
        ? normalizeText(current.title)
        : normalizeRequiredText(merged.title, "title", 80);
    const summary = isUpdate && service.summary === undefined
        ? normalizeText(current.summary)
        : normalizeRequiredText(merged.summary, "summary", 140);
    const description = isUpdate && service.description === undefined
        ? normalizeText(current.description)
        : normalizeRequiredText(merged.description, "description", 3000);
    const category = isUpdate && service.category === undefined
        ? normalizeText(current.category)
        : normalizeRequiredText(merged.category, "category", 40);
    const priceMode = ensureEnumValue(
        merged.priceMode,
        PRICE_MODES,
        "priceMode",
        "from",
    );

    return {
        title,
        summary,
        description,
        category,
        priceMode,
        priceAmount: priceMode === "negotiable"
            ? 0
            : normalizeAmount(merged.priceAmount, 0),
        availabilityText: normalizeOptionalText(merged.availabilityText, 160),
        averageDurationText: normalizeOptionalText(merged.averageDurationText, 80),
        strengthsText: normalizeOptionalText(merged.strengthsText, 1200),
        requirementsText: normalizeOptionalText(merged.requirementsText, 1200),
    };
};

const sanitizeRequestInput = (requestInput = {}, service = {}) => ({
    requestMessage: normalizeRequiredText(requestInput.requestMessage, "requestMessage", 1500),
    proposedRewardAmount: normalizeAmount(
        requestInput.proposedRewardAmount,
        normalizeAmount(service.priceAmount, 0),
    ),
    dueAt: parseTimestamp(requestInput.dueAt, "dueAt"),
    note: normalizeOptionalText(requestInput.note, 1000),
});

const assertCanManageService = ({ ctx, classId, service }) => {
    if (isTeacherOrAdminRole(ctx.role)) {
        if (ctx.role === "teacher" && ctx.classId && ctx.classId !== classId) {
            throw new HttpsError("permission-denied", "You cannot manage another class.");
        }
        return;
    }

    if (normalizeText(service.ownerUid) !== ctx.uid) {
        throw new HttpsError("permission-denied", "Only the service owner can manage it.");
    }
};

const assertCanReviewRequest = ({ ctx, classId, requestDoc }) => {
    if (isTeacherOrAdminRole(ctx.role)) {
        if (ctx.role === "teacher" && ctx.classId && ctx.classId !== classId) {
            throw new HttpsError("permission-denied", "You cannot manage another class.");
        }
        return;
    }

    if (normalizeText(requestDoc.providerUid) !== ctx.uid) {
        throw new HttpsError("permission-denied", "Only the provider can review this request.");
    }
};

const assertCanCompleteRequest = ({ ctx, classId, requestDoc }) => {
    if (isTeacherOrAdminRole(ctx.role)) {
        if (ctx.role === "teacher" && ctx.classId && ctx.classId !== classId) {
            throw new HttpsError("permission-denied", "You cannot manage another class.");
        }
        return;
    }

    if (
        normalizeText(requestDoc.providerUid) !== ctx.uid &&
        normalizeText(requestDoc.requesterUid) !== ctx.uid
    ) {
        throw new HttpsError("permission-denied", "Only participants can complete this request.");
    }
};

const writeServiceMetric = (transaction, serviceRef, metricField) => {
    transaction.update(serviceRef, {
        [metricField]: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
    });
};

exports.createJobSeekerService = onCall(JOB_SEEKER_BOARD_OPTS, async (request) => {
    const { classId, service } = request.data || {};
    if (!classId || !service) {
        throw new HttpsError("invalid-argument", "classId and service are required.");
    }

    const ctx = getAuthContext(request);
    const owner = await assertStudentCaller({ classId, ctx });
    const normalizedService = sanitizeServiceInput(service);
    const status = "pending_approval";
    const serviceRef = db.collection(`classes/${classId}/jobSeekerServices`).doc();

    await serviceRef.set({
        classId,
        serviceId: serviceRef.id,
        ownerUid: ctx.uid,
        ownerName: normalizeText(owner.name, "Student"),
        ownerStudentNumber: normalizeText(owner.studentNumber),
        ...normalizedService,
        status,
        requestCount: 0,
        acceptedCount: 0,
        completedCount: 0,
        paidCount: 0,
        ratingAverage: 0,
        ratingCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true, serviceId: serviceRef.id, status };
});

exports.updateJobSeekerService = onCall(JOB_SEEKER_BOARD_OPTS, async (request) => {
    const { classId, serviceId, updates } = request.data || {};
    if (!classId || !serviceId || !updates) {
        throw new HttpsError(
            "invalid-argument",
            "classId, serviceId, and updates are required.",
        );
    }

    const ctx = getAuthContext(request);
    const serviceRef = getServiceRef(classId, serviceId);

    await db.runTransaction(async (transaction) => {
        const serviceSnapshot = await transaction.get(serviceRef);
        if (!serviceSnapshot.exists) {
            throw new HttpsError("not-found", "Service was not found.");
        }

        const currentService = serviceSnapshot.data();
        assertCanManageService({ ctx, classId, service: currentService });
        if (
            normalizeText(currentService.status) === "suspended" &&
            !isTeacherOrAdminRole(ctx.role)
        ) {
            throw new HttpsError("permission-denied", "Suspended services cannot be edited.");
        }

        const normalizedService = sanitizeServiceInput(updates, {
            current: currentService,
            isUpdate: true,
        });
        const currentStatus = normalizeText(currentService.status, "active");
        const requestedStatus = updates.status === undefined
            ? currentStatus
            : normalizeText(updates.status, currentStatus);
        let nextStatus = currentStatus;
        if (isTeacherOrAdminRole(ctx.role)) {
            nextStatus = ensureEnumValue(
                requestedStatus,
                SERVICE_STATUSES,
                "status",
                currentStatus,
            );
        } else if (requestedStatus === "deleted") {
            nextStatus = "deleted";
        } else if (currentStatus === "pending_approval") {
            nextStatus = "pending_approval";
        } else {
            nextStatus = ensureEnumValue(
                requestedStatus,
                OWNER_SERVICE_STATUSES,
                "status",
                currentStatus,
            );
        }

        transaction.update(serviceRef, {
            ...normalizedService,
            status: nextStatus,
            updatedAt: FieldValue.serverTimestamp(),
        });
    });

    return { success: true };
});

exports.moderateJobSeekerService = onCall(JOB_SEEKER_BOARD_OPTS, async (request) => {
    const { classId, serviceId, status, moderationNote } = request.data || {};
    if (!classId || !serviceId || !status) {
        throw new HttpsError(
            "invalid-argument",
            "classId, serviceId, and status are required.",
        );
    }

    const ctx = assertTeacherOrAdminFromClaims(request, { classId });
    const nextStatus = ensureEnumValue(status, SERVICE_STATUSES, "status", "hidden");

    await getServiceRef(classId, serviceId).update({
        status: nextStatus,
        moderationNote: normalizeOptionalText(moderationNote, 1000),
        moderatedAt: FieldValue.serverTimestamp(),
        moderatedByUid: ctx.uid,
        updatedAt: FieldValue.serverTimestamp(),
    });

    return { success: true };
});

exports.createJobSeekerRequest = onCall(JOB_SEEKER_BOARD_OPTS, async (request) => {
    const { classId, serviceId, request: requestInput } = request.data || {};
    if (!classId || !serviceId || !requestInput) {
        throw new HttpsError(
            "invalid-argument",
            "classId, serviceId, and request are required.",
        );
    }

    const ctx = getAuthContext(request);
    const requester = await getCallerProfile({ classId, request, ctx });
    const serviceRef = getServiceRef(classId, serviceId);
    const requestRef = getRequestsCollection(serviceRef).doc();

    await db.runTransaction(async (transaction) => {
        const serviceSnapshot = await transaction.get(serviceRef);
        if (!serviceSnapshot.exists) {
            throw new HttpsError("not-found", "Service was not found.");
        }

        const service = serviceSnapshot.data();
        if (normalizeText(service.status) !== "active") {
            throw new HttpsError(
                "failed-precondition",
                "This service is not accepting requests.",
            );
        }
        if (normalizeText(service.ownerUid) === ctx.uid) {
            throw new HttpsError("failed-precondition", "You cannot request your own service.");
        }

        const normalizedRequest = sanitizeRequestInput(requestInput, service);
        transaction.set(requestRef, {
            classId,
            requestId: requestRef.id,
            serviceId,
            serviceTitle: normalizeText(service.title, "Service"),
            requesterUid: requester.uid,
            requesterName: requester.name,
            requesterRole: requester.role,
            requesterStudentNumber: requester.studentNumber,
            providerUid: normalizeText(service.ownerUid),
            providerName: normalizeText(service.ownerName, "Provider"),
            ...normalizedRequest,
            status: "requested",
            rejectionReason: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            acceptedAt: null,
            rejectedAt: null,
            completedAt: null,
            paidAt: null,
        });
        writeServiceMetric(transaction, serviceRef, "requestCount");
    });

    return { success: true, requestId: requestRef.id };
});

exports.reviewJobSeekerRequest = onCall(JOB_SEEKER_BOARD_OPTS, async (request) => {
    const { classId, serviceId, requestId, action, rejectionReason } = request.data || {};
    if (!classId || !serviceId || !requestId || !action) {
        throw new HttpsError(
            "invalid-argument",
            "classId, serviceId, requestId, and action are required.",
        );
    }

    const ctx = getAuthContext(request);
    const normalizedAction = ensureEnumValue(action, REQUEST_REVIEW_ACTIONS, "action");
    const serviceRef = getServiceRef(classId, serviceId);
    const requestRef = getRequestsCollection(serviceRef).doc(requestId);

    await db.runTransaction(async (transaction) => {
        const [serviceSnapshot, requestSnapshot] = await Promise.all([
            transaction.get(serviceRef),
            transaction.get(requestRef),
        ]);
        if (!serviceSnapshot.exists || !requestSnapshot.exists) {
            throw new HttpsError("not-found", "Request was not found.");
        }

        const requestDoc = requestSnapshot.data();
        assertCanReviewRequest({ ctx, classId, requestDoc });
        if (normalizeText(requestDoc.status) !== "requested") {
            throw new HttpsError(
                "failed-precondition",
                "Only requested items can be reviewed.",
            );
        }

        if (normalizedAction === "accept") {
            transaction.update(requestRef, {
                status: "accepted",
                acceptedAt: FieldValue.serverTimestamp(),
                rejectedAt: null,
                rejectionReason: null,
                updatedAt: FieldValue.serverTimestamp(),
            });
            writeServiceMetric(transaction, serviceRef, "acceptedCount");
            return;
        }

        transaction.update(requestRef, {
            status: "rejected",
            rejectedAt: FieldValue.serverTimestamp(),
            rejectionReason: normalizeOptionalText(rejectionReason, 1000),
            updatedAt: FieldValue.serverTimestamp(),
        });
    });

    return { success: true };
});

exports.completeJobSeekerRequest = onCall(JOB_SEEKER_BOARD_OPTS, async (request) => {
    const { classId, serviceId, requestId } = request.data || {};
    if (!classId || !serviceId || !requestId) {
        throw new HttpsError(
            "invalid-argument",
            "classId, serviceId, and requestId are required.",
        );
    }

    const ctx = getAuthContext(request);
    const serviceRef = getServiceRef(classId, serviceId);
    const requestRef = getRequestsCollection(serviceRef).doc(requestId);

    await db.runTransaction(async (transaction) => {
        const [serviceSnapshot, requestSnapshot] = await Promise.all([
            transaction.get(serviceRef),
            transaction.get(requestRef),
        ]);
        if (!serviceSnapshot.exists || !requestSnapshot.exists) {
            throw new HttpsError("not-found", "Request was not found.");
        }

        const requestDoc = requestSnapshot.data();
        assertCanCompleteRequest({ ctx, classId, requestDoc });
        if (normalizeText(requestDoc.status) !== "accepted") {
            throw new HttpsError(
                "failed-precondition",
                "Only accepted requests can be completed.",
            );
        }

        transaction.update(requestRef, {
            status: "completed",
            completedAt: FieldValue.serverTimestamp(),
            completedByUid: ctx.uid,
            updatedAt: FieldValue.serverTimestamp(),
        });
        writeServiceMetric(transaction, serviceRef, "completedCount");
    });

    return { success: true };
});

exports.payJobSeekerRequestReward = onCall(JOB_SEEKER_BOARD_OPTS, async (request) => {
    const { classId, serviceId, requestId, note } = request.data || {};
    if (!classId || !serviceId || !requestId) {
        throw new HttpsError(
            "invalid-argument",
            "classId, serviceId, and requestId are required.",
        );
    }

    const ctx = assertTeacherOrAdminFromClaims(request, { classId });
    const classRef = db.doc(`classes/${classId}`);
    const serviceRef = getServiceRef(classId, serviceId);
    const requestRef = getRequestsCollection(serviceRef).doc(requestId);
    const paymentRef = db.collection(`classes/${classId}/jobSeekerPayments`).doc();
    const payerName = normalizeText(request.auth?.token?.name, "Teacher");
    const globalConfig = await getGlobalConfig();

    await db.runTransaction(async (transaction) => {
        const [classSnapshot, serviceSnapshot, requestSnapshot] = await Promise.all([
            transaction.get(classRef),
            transaction.get(serviceRef),
            transaction.get(requestRef),
        ]);
        if (!classSnapshot.exists || !serviceSnapshot.exists || !requestSnapshot.exists) {
            throw new HttpsError("not-found", "Payment target was not found.");
        }

        const classData = classSnapshot.data() || {};
        const service = serviceSnapshot.data();
        const requestDoc = requestSnapshot.data();
        const currentStatus = normalizeText(requestDoc.status);
        if (!["accepted", "completed"].includes(currentStatus)) {
            throw new HttpsError(
                "failed-precondition",
                "Only accepted or completed requests can be paid.",
            );
        }

        const amount = normalizeAmount(requestDoc.proposedRewardAmount, 0);
        const providerUid = normalizeText(requestDoc.providerUid);
        const providerName = normalizeText(requestDoc.providerName, service.ownerName || "Provider");
        const currencyField = "cash";
        const currencyUnit = normalizeText(
            classData.currencyUnit || classData.currencySettings?.name,
            "unit",
        );
        const planType = classData.planType || "FREE";
        const logContext = { config: globalConfig, planType, serviceName: "jobBoard" };

        transaction.set(
            db.doc(`classes/${classId}/students/${providerUid}`),
            {
                assets: {
                    [currencyField]: FieldValue.increment(amount),
                },
                lastUpdated: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );
        stageActivityLog(
            transaction,
            classId,
            {
                studentUid: providerUid,
                type: "income",
                category: "job_board",
                amount,
                description: `'${normalizeText(service.title, requestDoc.serviceTitle || "서비스")}' 구직 의뢰 보상`,
                relatedDoc: { collection: "jobSeekerPayments", id: paymentRef.id },
                currency: currencyUnit,
                grossAmount: amount,
                withheldAmount: 0,
                netAmount: amount,
                incomeSettlement: {
                    sourceKey: "jobBoardReward",
                    eligible: amount > 0,
                    grossAmount: amount,
                    taxableAmount: amount,
                    withheldAmount: 0,
                    netAmount: amount,
                },
            },
            {
                ...logContext,
                customId: `job_seeker_reward_${paymentRef.id}_${providerUid}`,
            },
        );
        transaction.set(paymentRef, {
            classId,
            paymentId: paymentRef.id,
            serviceId,
            requestId,
            serviceTitle: normalizeText(service.title, requestDoc.serviceTitle || "Service"),
            totalAmount: amount,
            recipientUids: [providerUid],
            recipientNames: [providerName],
            currencyField,
            currencyUnit,
            note: normalizeOptionalText(note, 1000),
            paidByUid: ctx.uid,
            paidByName: payerName,
            paidAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        });
        transaction.update(requestRef, {
            status: "paid",
            paymentId: paymentRef.id,
            paidAt: FieldValue.serverTimestamp(),
            paidByUid: ctx.uid,
            paidByName: payerName,
            updatedAt: FieldValue.serverTimestamp(),
        });
        transaction.update(serviceRef, {
            paidCount: FieldValue.increment(1),
            ...(currentStatus === "accepted"
                ? { completedCount: FieldValue.increment(1) }
                : {}),
            updatedAt: FieldValue.serverTimestamp(),
        });
    });

    return { success: true, paymentId: paymentRef.id };
});
