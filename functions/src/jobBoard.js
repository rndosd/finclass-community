"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("../utils/maintenanceHttps");
const {
    assertTeacherOrAdminFromClaims,
    getAuthContext,
    getUserData,
} = require("../utils/permissions");
const { stageTaxIncome } = require("../utils/taxIncome");
const { getGlobalConfig } = require("../utils/planManager");
const { getWithholdingPolicy } = require("../utils/taxPolicy");
const { buildIncomeTaxSnapshot } = require("../utils/incomeTaxUtils");
const { stageActivityLog } = require("../utils/logUtils");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const { createMaintenanceDb } = require("../utils/maintenanceDb");
const db = createMaintenanceDb(admin.firestore());
const FieldValue = admin.firestore.FieldValue;
const Timestamp = admin.firestore.Timestamp;

const JOB_BOARD_OPTS = {
    region: "asia-northeast3",
    memory: "512MiB",
    timeoutSeconds: 60,
};

const POST_STATUSES = new Set([
    "pending_approval",
    "draft",
    "recruiting",
    "closed",
    "rejected",
    "cancelled",
]);
const MANUAL_POST_STATUSES = new Set(["recruiting", "closed"]);
const MODERATED_POST_STATUSES = new Set(["pending_approval", "rejected"]);

const LEGACY_CLOSED_POST_STATUSES = new Set([
    "reviewing",
    "selected",
    "in_progress",
    "submitted",
    "approved",
    "paid",
]);

const TARGET_TYPES = new Set(["individual", "team"]);
const SELECTION_TYPES = new Set(["first_come", "simple", "application"]);

const ACTIVE_APPLICATION_STATUSES = new Set([
    "applied",
    "selected",
    "submitted",
    "approved",
    "paid",
]);

const SELECTED_APPLICATION_STATUSES = new Set([
    "selected",
    "submitted",
    "approved",
    "paid",
]);

const SUBMITTED_APPLICATION_STATUSES = new Set([
    "submitted",
    "approved",
    "paid",
]);

const APPROVED_APPLICATION_STATUSES = new Set(["approved", "paid"]);
const RATING_STATUSES = new Set(["published", "hidden", "deleted"]);

const DEFAULT_JOB_BOARD_SETTINGS = Object.freeze({
    allowStudentPosts: false,
    requireStudentPostApproval: true,
    enableRatings: false,
});

const normalizeText = (value, fallback = "") =>
    String(value ?? "").trim() || fallback;

const normalizeBoolean = (value, fallback = false) =>
    typeof value === "boolean" ? value : fallback;

const normalizeOptionalText = (value) => {
    const normalized = normalizeText(value);
    return normalized || null;
};

const normalizePositiveInteger = (value, fallback = 1) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.round(parsed));
};

const normalizeNonNegativeInteger = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed));
};

const normalizeCurrencyAmount = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed));
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

const ensureEnumValue = (value, allowedValues, fieldName, fallback) => {
    const normalized = normalizeText(value, fallback || "");
    if (!normalized || !allowedValues.has(normalized)) {
        throw new HttpsError("invalid-argument", `${fieldName} is invalid.`);
    }
    return normalized;
};

const getJobBoardSettings = (classData = {}) => {
    const rawSettings = classData?.settings?.jobBoard || {};
    return {
        allowStudentPosts: normalizeBoolean(
            rawSettings.allowStudentPosts,
            DEFAULT_JOB_BOARD_SETTINGS.allowStudentPosts,
        ),
        requireStudentPostApproval: normalizeBoolean(
            rawSettings.requireStudentPostApproval,
            DEFAULT_JOB_BOARD_SETTINGS.requireStudentPostApproval,
        ),
        enableRatings: normalizeBoolean(
            rawSettings.enableRatings,
            DEFAULT_JOB_BOARD_SETTINGS.enableRatings,
        ),
    };
};

const isTeacherOrAdminRole = (role) => role === "teacher" || role === "admin";

const normalizeSelectionTypeValue = (value, fallback = "application") => {
    const normalized = normalizeText(value, fallback);
    return normalized || fallback;
};

const normalizeRewardModeValue = (value, fallback = "per_person") => {
    const normalized = normalizeText(value, fallback);
    return normalized === "team_equal" ? "split_equal" : normalized;
};

const getRewardModeForSlots = (slots) =>
    normalizePositiveInteger(slots, 1) > 1 ? "split_equal" : "per_person";

const normalizePostStatusValue = (value, fallback = "recruiting") => {
    const normalized = normalizeText(value, fallback);
    return LEGACY_CLOSED_POST_STATUSES.has(normalized) ? "closed" : normalized;
};

const resolveTeacherPostStatus = ({ currentStatus, requestedStatus }) => {
    const normalizedCurrent = normalizePostStatusValue(currentStatus, "recruiting");

    if (requestedStatus === undefined) {
        return normalizedCurrent;
    }

    const normalizedRequested = normalizePostStatusValue(
        requestedStatus,
        normalizedCurrent,
    );

    if (normalizedRequested === "cancelled") {
        return "cancelled";
    }

    if (normalizedRequested === normalizedCurrent) {
        return normalizedCurrent;
    }

    if (MODERATED_POST_STATUSES.has(normalizedCurrent)) {
        throw new HttpsError(
            "failed-precondition",
            "Pending approval or rejected posts must be handled with moderation actions.",
        );
    }

    if (
        !MANUAL_POST_STATUSES.has(normalizedRequested) &&
        normalizedRequested !== "cancelled"
    ) {
        throw new HttpsError(
            "invalid-argument",
            "Only recruiting, closed, or cancelled can be changed directly.",
        );
    }

    return normalizedRequested;
};

const resolveStudentPostStatus = ({
    currentStatus,
    requestedStatus,
    requireStudentPostApproval,
    isStatusOnlyUpdate = false,
}) => {
    const normalizedCurrent = normalizePostStatusValue(currentStatus, "recruiting");
    const normalizedRequested = normalizePostStatusValue(
        requestedStatus,
        normalizedCurrent,
    );

    if (normalizedRequested === "cancelled") return "cancelled";

    if (MODERATED_POST_STATUSES.has(normalizedCurrent)) {
        if (isStatusOnlyUpdate) {
            return normalizedCurrent;
        }
        return requireStudentPostApproval ? "pending_approval" : "recruiting";
    }

    if (normalizedRequested === "closed") return "closed";
    if (normalizedRequested === "recruiting") {
        if (
            requireStudentPostApproval &&
            ["pending_approval", "rejected"].includes(normalizedCurrent)
        ) {
            return "pending_approval";
        }
        return "recruiting";
    }

    return isStatusOnlyUpdate
        ? normalizedCurrent
        : requireStudentPostApproval
            ? "pending_approval"
            : "recruiting";
};

const isPublicPostStatus = (status) =>
    !["draft", "pending_approval", "rejected"].includes(
        normalizePostStatusValue(status),
    );

const normalizeRatingValue = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new HttpsError("invalid-argument", "rating is invalid.");
    }

    const rounded = Math.round(parsed);
    if (rounded < 1 || rounded > 5) {
        throw new HttpsError("invalid-argument", "rating must be between 1 and 5.");
    }

    return rounded;
};

const normalizeRatingStatus = (value, fallback = "published") =>
    ensureEnumValue(value, RATING_STATUSES, "ratingStatus", fallback);

const sanitizePostInput = (post = {}, { isUpdate = false } = {}) => {
    const title = normalizeText(post.title);
    const description = normalizeText(post.description);
    ensureEnumValue(post.targetType, TARGET_TYPES, "targetType", "individual");
    const targetType = "individual";
    const selectionType = ensureEnumValue(
        normalizeSelectionTypeValue(post.selectionType, "application"),
        SELECTION_TYPES,
        "selectionType",
        "application",
    );
    const status = ensureEnumValue(
        normalizePostStatusValue(post.status, "recruiting"),
        POST_STATUSES,
        "status",
        "recruiting",
    );
    const slots = normalizePositiveInteger(post.slots, 1);
    const rewardMode = getRewardModeForSlots(slots);
    const rewardAmount = normalizeCurrencyAmount(post.rewardAmount, 0);
    const applyDeadlineAt = parseTimestamp(post.applyDeadlineAt, "applyDeadlineAt");
    if (!isUpdate && !title) {
        throw new HttpsError("invalid-argument", "title is required.");
    }
    if (!isUpdate && !description) {
        throw new HttpsError("invalid-argument", "description is required.");
    }
    return {
        title,
        description,
        targetType,
        selectionType,
        rewardMode,
        status,
        slots,
        rewardAmount,
        applyDeadlineAt,
        isPublished: isPublicPostStatus(status),
    };
};

const getPostRef = (classId, postId) => db.doc(`classes/${classId}/jobPosts/${postId}`);
const getJobBoardProfileRef = (classId, uid) =>
    db.doc(`classes/${classId}/jobBoardProfiles/${uid}`);
const getJobBoardRatingsCollection = (classId) =>
    db.collection(`classes/${classId}/jobBoardRatings`);
const getJobBoardRatingRef = (classId, ratingId) =>
    db.doc(`classes/${classId}/jobBoardRatings/${ratingId}`);

const getApplicationsCollection = (postRef) => postRef.collection("applications");

const mapDoc = (docSnapshot) => ({
    id: docSnapshot.id,
    ...docSnapshot.data(),
});

const computePostMetrics = (applications = [], slots = 1) => {
    const metrics = {
        applicationCount: 0,
        selectedCount: 0,
        submittedCount: 0,
        approvedCount: 0,
        paidCount: 0,
        availableSlots: Math.max(0, normalizePositiveInteger(slots, 1)),
    };

    applications.forEach((application) => {
        const status = normalizeText(application.status);
        if (status !== "withdrawn") metrics.applicationCount += 1;
        if (SELECTED_APPLICATION_STATUSES.has(status)) metrics.selectedCount += 1;
        if (SUBMITTED_APPLICATION_STATUSES.has(status)) metrics.submittedCount += 1;
        if (APPROVED_APPLICATION_STATUSES.has(status)) metrics.approvedCount += 1;
        if (status === "paid") metrics.paidCount += 1;
    });

    metrics.availableSlots = Math.max(
        0,
        normalizePositiveInteger(slots, 1) - metrics.selectedCount,
    );

    return metrics;
};

const buildUpdatedApplications = (applications, nextApplication) =>
    applications
        .filter((application) => application.id !== nextApplication.id)
        .concat(nextApplication);

const updatePostMetrics = (transaction, postRef, post, applications, extra = {}) => {
    const metrics = computePostMetrics(applications, post.slots);
    transaction.update(postRef, {
        applicationCount: metrics.applicationCount,
        selectedCount: metrics.selectedCount,
        submittedCount: metrics.submittedCount,
        approvedCount: metrics.approvedCount,
        paidCount: metrics.paidCount,
        availableSlots: metrics.availableSlots,
        updatedAt: FieldValue.serverTimestamp(),
        ...extra,
    });
    return metrics;
};

const ensureStudentCaller = async (classId, uid) => {
    const callerData = await getUserData(classId, uid).catch(() => null);
    if (!callerData) {
        throw new HttpsError("not-found", "Student record was not found.");
    }
    if (callerData.role && callerData.role !== "student") {
        throw new HttpsError("permission-denied", "Only students can apply.");
    }
    return callerData;
};

const ensureStudentMembers = async (classId, memberUids = []) => {
    const uniqueUids = [
        ...new Set(
            memberUids
                .filter((entry) => typeof entry === "string")
                .map((entry) => normalizeText(entry))
                .filter(Boolean),
        ),
    ];

    if (uniqueUids.length === 0) {
        throw new HttpsError("invalid-argument", "At least one member is required.");
    }

    const members = await Promise.all(
        uniqueUids.map(async (uid) => {
            const student = await getUserData(classId, uid).catch(() => null);
            if (!student) {
                throw new HttpsError("not-found", `Student ${uid} was not found.`);
            }
            if (student.role && student.role !== "student") {
                throw new HttpsError("invalid-argument", "Only students can apply.");
            }
            return {
                uid,
                name: normalizeText(student.name, "Student"),
            };
        }),
    );

    return {
        memberUids: members.map((member) => member.uid),
        memberNames: members.map((member) => member.name),
    };
};

const sanitizeApplicationInput = async ({
    classId,
    callerUid,
    callerData,
    application = {},
}) => {
    const { memberUids, memberNames } = await ensureStudentMembers(
        classId,
        [callerUid],
    );

    return {
        applicantUid: callerUid,
        applicantName: normalizeText(callerData.name, "Student"),
        applicantType: "individual",
        studentUid: callerUid,
        studentName: normalizeText(callerData.name, "Student"),
        studentNumber: normalizeText(callerData.studentNumber),
        teamName: null,
        memberUids,
        memberNames,
        roleSummary: null,
        motivation: normalizeOptionalText(application.motivation),
        experience: normalizeOptionalText(application.experience),
        plan: normalizeOptionalText(application.plan),
    };
};

const ensurePostAcceptingApplications = (post) => {
    if (!post) {
        throw new HttpsError("not-found", "Job post was not found.");
    }
    if (normalizePostStatusValue(post.status) !== "recruiting") {
        throw new HttpsError(
            "failed-precondition",
            "This job post is not accepting applications.",
        );
    }
    if (post.applyDeadlineAt && post.applyDeadlineAt.toMillis() < Date.now()) {
        throw new HttpsError("failed-precondition", "Application deadline has passed.");
    }
};

const assertNoMemberConflict = ({
    applications,
    nextMemberUids,
    ignoreApplicationId = "",
}) => {
    const nextMembers = new Set(nextMemberUids || []);
    const hasConflict = applications.some((application) => {
        if (application.id === ignoreApplicationId) return false;
        if (!ACTIVE_APPLICATION_STATUSES.has(normalizeText(application.status))) {
            return false;
        }
        return (application.memberUids || []).some((uid) => nextMembers.has(uid));
    });

    if (hasConflict) {
        throw new HttpsError(
            "failed-precondition",
            "This student already has an active application for this post.",
        );
    }
};

const getEqualSplitRewardApplications = (applications = [], currentApplication = {}) => {
    const currentId = normalizeText(currentApplication.id);
    const candidates = applications
        .filter((application) =>
            SELECTED_APPLICATION_STATUSES.has(normalizeText(application.status)) ||
            normalizeText(application.id) === currentId)
        .map((application) =>
            normalizeText(application.id) === currentId
                ? { ...application, ...currentApplication, id: currentId || application.id }
                : application);

    if (!candidates.some((application) => normalizeText(application.id) === currentId)) {
        candidates.push(currentApplication);
    }

    return candidates.sort((left, right) =>
        normalizeText(left.id).localeCompare(normalizeText(right.id)));
};

const buildPaymentShares = ({ post, application, applications = [] }) => {
    const totalRewardAmount = normalizeCurrencyAmount(post.rewardAmount, 0);
    const recipientUid = normalizeText(application.applicantUid);
    const recipientName = normalizeText(application.applicantName, "Student");

    if (normalizeRewardModeValue(post.rewardMode, "per_person") !== "split_equal") {
        return [{
            uid: recipientUid,
            name: recipientName,
            amount: totalRewardAmount,
        }];
    }

    const rewardApplications = getEqualSplitRewardApplications(applications, application);
    const recipientCount = rewardApplications.length;
    if (recipientCount === 0) {
        throw new HttpsError(
            "failed-precondition",
            "Split payment cannot be calculated without selected applicants.",
        );
    }

    const recipientIndex = rewardApplications.findIndex(
        (entry) => normalizeText(entry.id) === normalizeText(application.id),
    );
    if (recipientIndex < 0) {
        throw new HttpsError("failed-precondition", "Payment target is not selected.");
    }

    const baseShare = Math.floor(totalRewardAmount / recipientCount);
    const remainder = totalRewardAmount % recipientCount;

    return [{
        uid: recipientUid,
        name: recipientName,
        amount: baseShare + (recipientIndex < remainder ? 1 : 0),
    }];
};

const getApplicationRatingTargets = (application = {}) => {
    const memberUids = Array.isArray(application.memberUids) && application.memberUids.length
        ? application.memberUids
        : [application.applicantUid].filter(Boolean);
    const memberNames = Array.isArray(application.memberNames) && application.memberNames.length
        ? application.memberNames
        : [application.applicantName].filter(Boolean);

    return memberUids.map((uid, index) => ({
        uid: normalizeText(uid),
        name: normalizeText(memberNames[index], application.applicantName || "Student"),
    }));
};

const getPostAuthorContext = async ({ classId, request, ctx }) => {
    if (isTeacherOrAdminRole(ctx.role)) {
        const teacherData = await getUserData(classId, ctx.uid).catch(() => null);
        const authorName = normalizeText(
            request.auth?.token?.name,
            normalizeText(teacherData?.name, "Teacher"),
        );

        return {
            authorUid: ctx.uid,
            authorName,
            authorRole: ctx.role || "teacher",
            teacherUid: ctx.uid,
            teacherName: authorName,
        };
    }

    const callerData = await ensureStudentCaller(classId, ctx.uid);
    return {
        authorUid: ctx.uid,
        authorName: normalizeText(callerData.name, "Student"),
        authorRole: "student",
        teacherUid: null,
        teacherName: null,
    };
};

const getJobBoardProfileOwnerContext = async ({ classId, request, ctx }) => {
    if (isTeacherOrAdminRole(ctx.role)) {
        const fallbackName = ctx.role === "admin" ? "Admin" : "Teacher";
        return {
            userUid: ctx.uid,
            displayName: normalizeText(request.auth?.token?.name, fallbackName),
            role: normalizeText(ctx.role, "teacher"),
        };
    }

    const callerData = await getUserData(classId, ctx.uid).catch(() => null);
    if (!callerData) {
        throw new HttpsError("not-found", "Profile owner was not found.");
    }

    return {
        userUid: ctx.uid,
        displayName: normalizeText(callerData.name, "Student"),
        role: normalizeText(callerData.role, "student"),
    };
};

const assertCanManagePostAsRequester = ({ ctx, classId, post }) => {
    if (isTeacherOrAdminRole(ctx.role)) {
        if (ctx.role === "teacher" && ctx.classId && ctx.classId !== classId) {
            throw new HttpsError("permission-denied", "You cannot manage another class.");
        }
        return;
    }

    if (normalizeText(post?.authorUid) !== normalizeText(ctx.uid)) {
        throw new HttpsError(
            "permission-denied",
            "Only the requester can manage this post.",
        );
    }
};

exports.updateJobBoardProfile = onCall(JOB_BOARD_OPTS, async (request) => {
    const { classId, profile } = request.data || {};
    if (!classId) {
        throw new HttpsError("invalid-argument", "classId is required.");
    }

    const ctx = getAuthContext(request);
    if (
        isTeacherOrAdminRole(ctx.role) &&
        ctx.role === "teacher" &&
        ctx.classId &&
        ctx.classId !== classId
    ) {
        throw new HttpsError("permission-denied", "You cannot edit another class profile.");
    }

    const owner = await getJobBoardProfileOwnerContext({ classId, request, ctx });
    const profileRef = getJobBoardProfileRef(classId, owner.userUid);
    const strengthTags = Array.isArray(profile?.strengthTags)
        ? [...new Set(
            profile.strengthTags
                .map((entry) => normalizeText(entry))
                .filter(Boolean),
        )].slice(0, 12)
        : [];
    const preferredRoles = Array.isArray(profile?.preferredRoles)
        ? [...new Set(
            profile.preferredRoles
                .map((entry) => normalizeText(entry))
                .filter(Boolean),
        )].slice(0, 8)
        : [];

    await profileRef.set({
        userUid: owner.userUid,
        displayName: owner.displayName,
        role: owner.role,
        bio: normalizeOptionalText(profile?.bio),
        workStyle: normalizeOptionalText(profile?.workStyle),
        strengthTags,
        preferredRoles,
        updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { success: true };
});

const getRatingsWithReplacement = (
    ratingsSnapshot,
    {
        ratingId = "",
        replacementRating = null,
    } = {},
) => {
    const normalizedRatingId = normalizeText(ratingId);
    const ratings = ratingsSnapshot.docs
        .map((snapshot) => ({
            ratingId: normalizeText(snapshot.data()?.ratingId, snapshot.id),
            ...snapshot.data(),
        }))
        .filter((entry) =>
            !normalizedRatingId || normalizeText(entry.ratingId) !== normalizedRatingId);

    if (
        replacementRating &&
        normalizeText(replacementRating.status, "published") === "published"
    ) {
        ratings.push({
            ...replacementRating,
            ratingId: normalizedRatingId || normalizeText(replacementRating.ratingId),
        });
    }

    return ratings;
};

const writeRequesterProfileSummary = (
    transaction,
    {
        classId,
        requesterUid,
        requesterName = "Requester",
        requesterRole = "teacher",
        ratings = [],
    },
) => {
    const requesterRatingCount = ratings.length;
    const requesterRatingTotal = ratings.reduce(
        (sum, rating) => sum + normalizeNonNegativeInteger(rating.rating, 0),
        0,
    );
    const requesterRatingAverage = requesterRatingCount
        ? Number((requesterRatingTotal / requesterRatingCount).toFixed(2))
        : 0;

    transaction.set(
        getJobBoardProfileRef(classId, requesterUid),
        {
            userUid: requesterUid,
            userName: normalizeText(requesterName, "Requester"),
            userRole: normalizeText(requesterRole, "teacher"),
            requesterRatingCount,
            requesterRatingTotal,
            requesterRatingAverage,
            lastRatedAt: requesterRatingCount ? FieldValue.serverTimestamp() : null,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
};

exports.createJobBoardPost = onCall(JOB_BOARD_OPTS, async (request) => {
    const { classId, post } = request.data || {};
    if (!classId || !post) {
        throw new HttpsError("invalid-argument", "classId and post are required.");
    }

    const ctx = getAuthContext(request);
    if (ctx.role === "teacher" && ctx.classId && ctx.classId !== classId) {
        throw new HttpsError("permission-denied", "You cannot create posts in another class.");
    }
    const classSnapshot = await db.doc(`classes/${classId}`).get();
    if (!classSnapshot.exists) {
        throw new HttpsError("not-found", "Class was not found.");
    }

    const settings = getJobBoardSettings(classSnapshot.data() || {});
    const isTeacherAuthor = isTeacherOrAdminRole(ctx.role);
    if (!isTeacherAuthor && !settings.allowStudentPosts) {
        throw new HttpsError(
            "permission-denied",
            "Students cannot create job posts in this class.",
        );
    }

    const authorContext = await getPostAuthorContext({ classId, request, ctx });
    const normalizedPost = sanitizePostInput(post);
    const nextStatus = isTeacherAuthor
        ? "recruiting"
        : settings.requireStudentPostApproval
            ? "pending_approval"
            : "recruiting";
    const postRef = db.collection(`classes/${classId}/jobPosts`).doc();

    await postRef.set({
        classId,
        ...normalizedPost,
        status: nextStatus,
        isPublished: isPublicPostStatus(nextStatus),
        applicationCount: 0,
        selectedCount: 0,
        submittedCount: 0,
        approvedCount: 0,
        paidCount: 0,
        availableSlots: normalizedPost.slots,
        ...authorContext,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        publishedAt: isPublicPostStatus(nextStatus)
            ? FieldValue.serverTimestamp()
            : null,
        lastStatusChangedAt: FieldValue.serverTimestamp(),
    });

    return {
        success: true,
        postId: postRef.id,
        status: nextStatus,
        settings,
    };
});

exports.updateJobBoardPost = onCall(JOB_BOARD_OPTS, async (request) => {
    const { classId, postId, updates } = request.data || {};
    if (!classId || !postId || !updates) {
        throw new HttpsError(
            "invalid-argument",
            "classId, postId, and updates are required.",
        );
    }

    const ctx = getAuthContext(request);
    const postRef = getPostRef(classId, postId);

    await db.runTransaction(async (transaction) => {
        const [classSnapshot, postSnapshot, applicationsSnapshot] = await Promise.all([
            transaction.get(db.doc(`classes/${classId}`)),
            transaction.get(postRef),
            transaction.get(getApplicationsCollection(postRef)),
        ]);

        if (!classSnapshot.exists) {
            throw new HttpsError("not-found", "Class was not found.");
        }
        if (!postSnapshot.exists) {
            throw new HttpsError("not-found", "Job post was not found.");
        }

        const currentPost = postSnapshot.data();
        const settings = getJobBoardSettings(classSnapshot.data() || {});
        const isTeacherEditor = isTeacherOrAdminRole(ctx.role);
        const updateKeys = Object.keys(updates).filter((key) => updates[key] !== undefined);
        const isStatusOnlyUpdate =
            updateKeys.length > 0 && updateKeys.every((key) => key === "status");
        const nextStatus = isTeacherEditor
            ? resolveTeacherPostStatus({
                currentStatus: currentPost.status,
                requestedStatus: updates.status,
            })
            : resolveStudentPostStatus({
                currentStatus: currentPost.status,
                requestedStatus: updates.status,
                requireStudentPostApproval: settings.requireStudentPostApproval,
                isStatusOnlyUpdate,
            });
        const normalizedPost = sanitizePostInput(
            {
                ...currentPost,
                ...updates,
                status: nextStatus,
            },
            { isUpdate: true },
        );
        const applications = applicationsSnapshot.docs.map(mapDoc);
        const metrics = computePostMetrics(applications, normalizedPost.slots);

        if (!isTeacherEditor) {
            if (!settings.allowStudentPosts) {
                throw new HttpsError("permission-denied", "Student posts are disabled.");
            }
            if (ctx.role !== "student") {
                throw new HttpsError("permission-denied", "Only authors can edit this post.");
            }
            if (currentPost.authorUid !== ctx.uid || currentPost.authorRole !== "student") {
                throw new HttpsError("permission-denied", "Only the student author can edit this post.");
            }
            if (metrics.applicationCount > 0 && !isStatusOnlyUpdate) {
                throw new HttpsError(
                    "failed-precondition",
                    "Posts with applications can only be updated by a teacher.",
                );
            }
        } else if (ctx.role === "teacher" && ctx.classId && ctx.classId !== classId) {
            throw new HttpsError("permission-denied", "You cannot update another class.");
        }

        if (metrics.selectedCount > normalizedPost.slots) {
            throw new HttpsError(
                "failed-precondition",
                "slots cannot be less than the current selected count.",
            );
        }

        transaction.update(postRef, {
            ...normalizedPost,
            qualificationNotes: FieldValue.delete(),
            workDeadlineAt: FieldValue.delete(),
            applicationCount: metrics.applicationCount,
            selectedCount: metrics.selectedCount,
            submittedCount: metrics.submittedCount,
            approvedCount: metrics.approvedCount,
            paidCount: metrics.paidCount,
            availableSlots: metrics.availableSlots,
            updatedAt: FieldValue.serverTimestamp(),
            publishedAt:
                currentPost.publishedAt ||
                (!isPublicPostStatus(normalizedPost.status)
                    ? null
                    : FieldValue.serverTimestamp()),
            lastStatusChangedAt:
                currentPost.status !== normalizedPost.status
                    ? FieldValue.serverTimestamp()
                    : currentPost.lastStatusChangedAt || null,
        });
    });

    return { success: true };
});

exports.moderateJobBoardPost = onCall(JOB_BOARD_OPTS, async (request) => {
    const { classId, postId, action } = request.data || {};
    if (!classId || !postId || !action) {
        throw new HttpsError(
            "invalid-argument",
            "classId, postId, and action are required.",
        );
    }

    const ctx = assertTeacherOrAdminFromClaims(request, { classId });
    const moderatorName = normalizeText(request.auth?.token?.name, "Teacher");
    const postRef = getPostRef(classId, postId);

    await db.runTransaction(async (transaction) => {
        const postSnapshot = await transaction.get(postRef);
        if (!postSnapshot.exists) {
            throw new HttpsError("not-found", "Job post was not found.");
        }

        const post = postSnapshot.data();
        if (normalizeText(post.authorRole) !== "student") {
            throw new HttpsError(
                "failed-precondition",
                "Only student-authored posts can be moderated.",
            );
        }

        const currentStatus = normalizePostStatusValue(post.status, "recruiting");
        let nextStatus = currentStatus;

        if (action === "approve") {
            if (!MODERATED_POST_STATUSES.has(currentStatus)) {
                throw new HttpsError(
                    "failed-precondition",
                    "Only pending approval or rejected posts can be approved.",
                );
            }
            nextStatus = "recruiting";
        } else if (action === "reject") {
            if (currentStatus !== "pending_approval") {
                throw new HttpsError(
                    "failed-precondition",
                    "Only pending approval posts can be rejected.",
                );
            }
            nextStatus = "rejected";
        } else {
            throw new HttpsError("invalid-argument", "Unsupported action.");
        }

        transaction.update(postRef, {
            status: nextStatus,
            isPublished: isPublicPostStatus(nextStatus),
            publishedAt: isPublicPostStatus(nextStatus)
                ? post.publishedAt || FieldValue.serverTimestamp()
                : null,
            moderatedAt: FieldValue.serverTimestamp(),
            moderatedByUid: ctx.uid,
            moderatedByName: moderatorName,
            moderationAction: action,
            updatedAt: FieldValue.serverTimestamp(),
            lastStatusChangedAt: FieldValue.serverTimestamp(),
        });
    });

    return { success: true };
});

exports.submitJobBoardApplication = onCall(JOB_BOARD_OPTS, async (request) => {
    const { classId, postId, application } = request.data || {};
    if (!classId || !postId) {
        throw new HttpsError("invalid-argument", "classId and postId are required.");
    }

    const ctx = getAuthContext(request);
    const callerData = await ensureStudentCaller(classId, ctx.uid);
    const postRef = getPostRef(classId, postId);
    const applicationRef = postRef.collection("applications").doc(ctx.uid);
    let wasUpdated = false;

    await db.runTransaction(async (transaction) => {
        const [postSnapshot, applicationSnapshot, applicationsSnapshot] = await Promise.all([
            transaction.get(postRef),
            transaction.get(applicationRef),
            transaction.get(getApplicationsCollection(postRef)),
        ]);

        if (!postSnapshot.exists) {
            throw new HttpsError("not-found", "Job post was not found.");
        }

        const post = postSnapshot.data();
        ensurePostAcceptingApplications(post);
        if (normalizeText(post.authorUid) === ctx.uid) {
            throw new HttpsError(
                "failed-precondition",
                "Authors cannot apply to their own posts.",
            );
        }

        const applications = applicationsSnapshot.docs.map(mapDoc);
        const existingApplication = applicationSnapshot.exists
            ? applicationSnapshot.data()
            : null;
        const existingApplicationStatus = normalizeText(existingApplication?.status);
        const isEditingApplication = existingApplicationStatus === "applied";

        if (
            existingApplication &&
            ACTIVE_APPLICATION_STATUSES.has(existingApplicationStatus) &&
            !isEditingApplication
        ) {
            throw new HttpsError(
                "failed-precondition",
                "You already have an active application for this post.",
            );
        }

        const sanitizedApplication = await sanitizeApplicationInput({
            classId,
            callerUid: ctx.uid,
            callerData,
            application,
        });

        assertNoMemberConflict({
            applications,
            nextMemberUids: sanitizedApplication.memberUids,
            ignoreApplicationId: ctx.uid,
        });

        const metricsBefore = computePostMetrics(applications, post.slots);
        if (
            !isEditingApplication &&
            metricsBefore.selectedCount >= normalizePositiveInteger(post.slots, 1)
        ) {
            throw new HttpsError(
                "failed-precondition",
                "This post is already full.",
            );
        }

        const selectionType = normalizeSelectionTypeValue(post.selectionType, "application");
        const isFirstComePost = selectionType === "first_come";
        const nextStatus = isEditingApplication
            ? "applied"
            : isFirstComePost
                ? "selected"
                : "applied";
        wasUpdated = isEditingApplication;
        const applicationData = {
            classId,
            postId,
            postTitle: normalizeText(post.title, "Job post"),
            targetType: "individual",
            selectionType,
            rewardMode: normalizeRewardModeValue(post.rewardMode, "per_person"),
            rewardAmount: normalizeCurrencyAmount(post.rewardAmount, 0),
            authorUid: normalizeText(post.authorUid),
            authorName: normalizeText(post.authorName, "Requester"),
            authorRole: normalizeText(post.authorRole, "teacher"),
            ...sanitizedApplication,
            status: nextStatus,
            appliedAt: existingApplication?.appliedAt || FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            editedAt: isEditingApplication ? FieldValue.serverTimestamp() : null,
            selectedAt: isFirstComePost && !isEditingApplication ? FieldValue.serverTimestamp() : null,
            selectedByUid: isFirstComePost && !isEditingApplication ? ctx.uid : null,
            selectedByName: isFirstComePost && !isEditingApplication
                ? normalizeText(callerData.name || callerData.displayName, "Student")
                : null,
            rejectedAt: null,
            rejectionReason: null,
            submittedAt: null,
            submissionText: null,
            approvedAt: null,
            approvedByUid: null,
            approvedByName: null,
            paidAt: null,
            paymentId: null,
            paymentShares: null,
            requesterRating: null,
            requesterReview: null,
            requesterRatingStatus: null,
            requesterRatedAt: null,
            requesterRatedByUid: null,
            requesterRatedByName: null,
            requesterRatingModerationNote: null,
            requesterRatingModeratedAt: null,
            requesterRatingModeratedByUid: null,
            requesterRatingModeratedByName: null,
        };

        transaction.set(applicationRef, applicationData);

        const nextApplications = buildUpdatedApplications(applications, {
            ...applicationData,
            id: ctx.uid,
        });
        updatePostMetrics(transaction, postRef, post, nextApplications);
    });

    return { success: true, updated: wasUpdated };
});

exports.withdrawJobBoardApplication = onCall(JOB_BOARD_OPTS, async (request) => {
    const { classId, postId } = request.data || {};
    if (!classId || !postId) {
        throw new HttpsError("invalid-argument", "classId and postId are required.");
    }

    const ctx = getAuthContext(request);
    await ensureStudentCaller(classId, ctx.uid);
    const postRef = getPostRef(classId, postId);
    const applicationRef = postRef.collection("applications").doc(ctx.uid);

    await db.runTransaction(async (transaction) => {
        const [postSnapshot, applicationSnapshot, applicationsSnapshot] = await Promise.all([
            transaction.get(postRef),
            transaction.get(applicationRef),
            transaction.get(getApplicationsCollection(postRef)),
        ]);

        if (!postSnapshot.exists || !applicationSnapshot.exists) {
            throw new HttpsError("not-found", "Application was not found.");
        }

        const post = postSnapshot.data();
        const application = applicationSnapshot.data();
        const status = normalizeText(application.status);
        if (!["applied", "selected"].includes(status)) {
            throw new HttpsError(
                "failed-precondition",
                "Only applied or selected applications can be withdrawn.",
            );
        }

        transaction.update(applicationRef, {
            status: "withdrawn",
            updatedAt: FieldValue.serverTimestamp(),
        });

        const nextApplications = buildUpdatedApplications(
            applicationsSnapshot.docs.map(mapDoc),
            { ...application, id: ctx.uid, status: "withdrawn" },
        );
        updatePostMetrics(transaction, postRef, post, nextApplications);
    });

    return { success: true };
});

exports.reviewJobBoardApplication = onCall(JOB_BOARD_OPTS, async (request) => {
    const { classId, postId, applicationId, action, rejectionReason } =
        request.data || {};
    if (!classId || !postId || !applicationId || !action) {
        throw new HttpsError(
            "invalid-argument",
            "classId, postId, applicationId, and action are required.",
        );
    }

    const ctx = getAuthContext(request);
    const postRef = getPostRef(classId, postId);
    const applicationRef = postRef.collection("applications").doc(applicationId);

    await db.runTransaction(async (transaction) => {
        const [postSnapshot, applicationSnapshot, applicationsSnapshot] = await Promise.all([
            transaction.get(postRef),
            transaction.get(applicationRef),
            transaction.get(getApplicationsCollection(postRef)),
        ]);

        if (!postSnapshot.exists || !applicationSnapshot.exists) {
            throw new HttpsError("not-found", "Application was not found.");
        }

        const post = postSnapshot.data();
        assertCanManagePostAsRequester({ ctx, classId, post });
        const application = applicationSnapshot.data();
        const reviewerName = normalizeText(
            request.auth?.token?.name,
            normalizeText(post.authorName, "Requester"),
        );
        const currentStatus = normalizeText(application.status);
        const applications = applicationsSnapshot.docs.map(mapDoc);

        if (action === "select") {
            if (currentStatus !== "applied") {
                throw new HttpsError(
                    "failed-precondition",
                    "Only applied applications can be selected.",
                );
            }
            const metrics = computePostMetrics(applications, post.slots);
            if (metrics.selectedCount >= normalizePositiveInteger(post.slots, 1)) {
                throw new HttpsError("failed-precondition", "This post is already full.");
            }

            assertNoMemberConflict({
                applications: applications.filter((entry) =>
                    SELECTED_APPLICATION_STATUSES.has(normalizeText(entry.status))),
                nextMemberUids: application.memberUids || [],
                ignoreApplicationId: applicationId,
            });

            transaction.update(applicationRef, {
                status: "selected",
                selectedAt: FieldValue.serverTimestamp(),
                selectedByUid: ctx.uid,
                selectedByName: reviewerName,
                rejectedAt: null,
                rejectionReason: null,
                updatedAt: FieldValue.serverTimestamp(),
            });

            const nextApplications = buildUpdatedApplications(applications, {
                ...application,
                id: applicationId,
                status: "selected",
            });
            updatePostMetrics(transaction, postRef, post, nextApplications);
            return;
        }

        if (action === "reject") {
            if (!["applied", "selected"].includes(currentStatus)) {
                throw new HttpsError(
                    "failed-precondition",
                    "Only applied or selected applications can be rejected.",
                );
            }

            transaction.update(applicationRef, {
                status: "rejected",
                rejectedAt: FieldValue.serverTimestamp(),
                rejectionReason: normalizeOptionalText(rejectionReason),
                selectedAt: null,
                selectedByUid: null,
                selectedByName: null,
                updatedAt: FieldValue.serverTimestamp(),
            });

            const nextApplications = buildUpdatedApplications(applications, {
                ...application,
                id: applicationId,
                status: "rejected",
            });
            updatePostMetrics(transaction, postRef, post, nextApplications);
            return;
        }

        throw new HttpsError("invalid-argument", "Unsupported action.");
    });

    return { success: true };
});

exports.submitJobBoardWork = onCall(JOB_BOARD_OPTS, async (request) => {
    const { classId, postId, submissionText } = request.data || {};
    if (!classId || !postId) {
        throw new HttpsError("invalid-argument", "classId and postId are required.");
    }

    const ctx = getAuthContext(request);
    await ensureStudentCaller(classId, ctx.uid);
    const postRef = getPostRef(classId, postId);
    const applicationRef = postRef.collection("applications").doc(ctx.uid);

    await db.runTransaction(async (transaction) => {
        const [postSnapshot, applicationSnapshot, applicationsSnapshot] = await Promise.all([
            transaction.get(postRef),
            transaction.get(applicationRef),
            transaction.get(getApplicationsCollection(postRef)),
        ]);

        if (!postSnapshot.exists || !applicationSnapshot.exists) {
            throw new HttpsError("not-found", "Application was not found.");
        }

        const post = postSnapshot.data();
        const application = applicationSnapshot.data();
        if (application.applicantUid !== ctx.uid) {
            throw new HttpsError(
                "permission-denied",
                "Only the lead applicant can submit work.",
            );
        }
        if (normalizeText(application.status) !== "selected") {
            throw new HttpsError(
                "failed-precondition",
                "Only selected applications can submit work.",
            );
        }

        transaction.update(applicationRef, {
            status: "submitted",
            submissionText: normalizeOptionalText(submissionText),
            submittedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        const nextApplications = buildUpdatedApplications(
            applicationsSnapshot.docs.map(mapDoc),
            { ...application, id: ctx.uid, status: "submitted" },
        );
        updatePostMetrics(transaction, postRef, post, nextApplications);
    });

    return { success: true };
});

exports.approveJobBoardSubmission = onCall(JOB_BOARD_OPTS, async (request) => {
    const { classId, postId, applicationId } = request.data || {};
    if (!classId || !postId || !applicationId) {
        throw new HttpsError(
            "invalid-argument",
            "classId, postId, and applicationId are required.",
        );
    }

    const ctx = getAuthContext(request);
    const postRef = getPostRef(classId, postId);
    const applicationRef = postRef.collection("applications").doc(applicationId);

    await db.runTransaction(async (transaction) => {
        const [postSnapshot, applicationSnapshot, applicationsSnapshot] = await Promise.all([
            transaction.get(postRef),
            transaction.get(applicationRef),
            transaction.get(getApplicationsCollection(postRef)),
        ]);

        if (!postSnapshot.exists || !applicationSnapshot.exists) {
            throw new HttpsError("not-found", "Submitted application was not found.");
        }

        const post = postSnapshot.data();
        assertCanManagePostAsRequester({ ctx, classId, post });
        const application = applicationSnapshot.data();
        const approverName = normalizeText(
            request.auth?.token?.name,
            normalizeText(post.authorName, "Requester"),
        );
        if (normalizeText(application.status) !== "submitted") {
            throw new HttpsError(
                "failed-precondition",
                "Only submitted applications can be approved.",
            );
        }

        transaction.update(applicationRef, {
            status: "approved",
            approvedAt: FieldValue.serverTimestamp(),
            approvedByUid: ctx.uid,
            approvedByName: approverName,
            updatedAt: FieldValue.serverTimestamp(),
        });

        const nextApplications = buildUpdatedApplications(
            applicationsSnapshot.docs.map(mapDoc),
            { ...application, id: applicationId, status: "approved" },
        );
        updatePostMetrics(transaction, postRef, post, nextApplications);
    });

    return { success: true };
});

exports.payJobBoardReward = onCall(JOB_BOARD_OPTS, async (request) => {
    const { classId, postId, applicationId, note } = request.data || {};
    if (!classId || !postId || !applicationId) {
        throw new HttpsError(
            "invalid-argument",
            "classId, postId, and applicationId are required.",
        );
    }

    const ctx = assertTeacherOrAdminFromClaims(request, { classId });
    const payerName = normalizeText(request.auth?.token?.name, "Teacher");
    const classRef = db.doc(`classes/${classId}`);
    const postRef = getPostRef(classId, postId);
    const applicationRef = postRef.collection("applications").doc(applicationId);
    const paymentRef = db.collection(`classes/${classId}/jobPayments`).doc();
    const globalConfig = await getGlobalConfig();

    await db.runTransaction(async (transaction) => {
        const [
            classSnapshot,
            postSnapshot,
            applicationSnapshot,
            applicationsSnapshot,
        ] = await Promise.all([
            transaction.get(classRef),
            transaction.get(postRef),
            transaction.get(applicationRef),
            transaction.get(getApplicationsCollection(postRef)),
        ]);

        if (!classSnapshot.exists || !postSnapshot.exists || !applicationSnapshot.exists) {
            throw new HttpsError("not-found", "Payment target was not found.");
        }

        const classData = classSnapshot.data() || {};
        const post = postSnapshot.data();
        const application = applicationSnapshot.data();
        const currentStatus = normalizeText(application.status);
        if (!["selected", "submitted", "approved"].includes(currentStatus)) {
            throw new HttpsError(
                "failed-precondition",
                "Only selected, submitted, or approved applications can be paid.",
            );
        }
        if (application.paidAt) {
            throw new HttpsError("failed-precondition", "This application is already paid.");
        }

        const currencyField = "cash";
        const currencyUnit = normalizeText(
            classData.currencyUnit || classData.currencySettings?.name,
            "unit",
        );
        const planType = classData.planType || "FREE";
        const logContext = { config: globalConfig, planType, serviceName: "jobBoard" };
        const withholdingPolicy = getWithholdingPolicy(classData, "jobBoardReward") || {};
        const applications = applicationsSnapshot.docs.map(mapDoc);
        const grossPaymentShares = buildPaymentShares({
            post,
            application: { ...application, id: applicationId },
            applications,
        });
        const paymentShares = grossPaymentShares.map((share) => {
            const taxSnapshot = buildIncomeTaxSnapshot({
                sourceKey: "jobBoardReward",
                grossAmount: share.amount,
                policy: withholdingPolicy,
            });
            return {
                ...share,
                grossAmount: taxSnapshot.grossAmount,
                withheldAmount: taxSnapshot.withheldAmount,
                netAmount: taxSnapshot.netAmount,
                amount: taxSnapshot.netAmount,
                incomeTax: taxSnapshot.incomeTax,
            };
        });
        const withholdingLines = paymentShares
            .filter((share) => share.withheldAmount > 0)
            .map((share) => ({
                id: `${paymentRef.id}_${share.uid}`,
                amount: share.withheldAmount,
                source: "job_board_reward_withholding",
                taxType: "income_tax",
                description: `잡보드 보상 원천징수 - ${normalizeText(post.title, "Job post")}`,
                studentUid: share.uid,
                studentName: share.name,
                relatedDoc: { collection: "jobPayments", id: paymentRef.id },
                externalId: paymentRef.id,
                meta: {
                    postId,
                    applicationId,
                    incomeTax: share.incomeTax,
                },
            }));
        const totalWithheldAmount = withholdingLines.reduce(
            (sum, line) => sum + Number(line.amount || 0),
            0,
        );

        paymentShares.forEach((share) => {
            const studentRef = db.doc(`classes/${classId}/students/${share.uid}`);
            transaction.set(
                studentRef,
                {
                    assets: {
                        [currencyField]: FieldValue.increment(share.amount),
                    },
                    lastUpdated: FieldValue.serverTimestamp(),
                },
                { merge: true },
            );

            stageActivityLog(
                transaction,
                classId,
                {
                    studentUid: share.uid,
                    type: "income",
                    category: "job_board",
                    amount: share.amount,
                    description: `'${normalizeText(post.title, "구인 공고")}' 구인게시판 보상`,
                    relatedDoc: { collection: "jobPayments", id: paymentRef.id },
                    currency: currencyUnit,
                    grossAmount: share.grossAmount,
                    withheldAmount: share.withheldAmount,
                    netAmount: share.netAmount,
                    incomeTax: share.incomeTax,
                    incomeSettlement: {
                        sourceKey: "jobBoardReward",
                        eligible: share.grossAmount > 0,
                        grossAmount: share.grossAmount,
                        taxableAmount: share.grossAmount,
                        withheldAmount: share.withheldAmount,
                        netAmount: share.netAmount,
                    },
                },
                {
                    ...logContext,
                    customId: `job_board_reward_${paymentRef.id}_${share.uid}`,
                },
            );
        });

        transaction.set(paymentRef, {
            classId,
            postId,
            applicationId,
            postTitle: normalizeText(post.title, "Job post"),
            targetType: "individual",
            rewardMode: normalizeRewardModeValue(post.rewardMode, "per_person"),
            totalAmount: normalizeCurrencyAmount(post.rewardAmount, 0),
            grossTotalAmount: grossPaymentShares.reduce(
                (sum, share) => sum + Number(share.amount || 0),
                0,
            ),
            totalWithheldAmount,
            netTotalAmount: paymentShares.reduce(
                (sum, share) => sum + Number(share.amount || 0),
                0,
            ),
            paymentShares,
            recipientUids: paymentShares.map((share) => share.uid),
            recipientNames: paymentShares.map((share) => share.name),
            currencyField,
            currencyUnit,
            note: normalizeOptionalText(note),
            paidByUid: ctx.uid,
            paidByName: payerName,
            paidAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        });

        if (totalWithheldAmount > 0) {
            stageTaxIncome(
                transaction,
                classId,
                {
                    amount: totalWithheldAmount,
                    source: "job_board_reward_withholding",
                    taxType: "income_tax",
                    description: `잡보드 보상 원천징수 - ${normalizeText(post.title, "Job post")}`,
                },
                ctx.uid,
                {
                    config: globalConfig,
                    planType,
                    serviceName: "jobBoard",
                    classData,
                    sourceKey: "jobBoardReward",
                    customId: `job_board_reward_withholding_${paymentRef.id}`,
                    aggregateMeta: {
                        group: "job_board_reward_withholding",
                        batchKey: paymentRef.id,
                        pageKey: "jobBoard",
                        actorUid: ctx.uid,
                        actorName: payerName,
                        mode: "pay_job_board_reward",
                    },
                    detailLines: withholdingLines,
                },
            );
        }

        transaction.update(applicationRef, {
            status: "paid",
            paymentId: paymentRef.id,
            paymentShares,
            completionConfirmedAt:
                application.completionConfirmedAt || FieldValue.serverTimestamp(),
            completionConfirmedByUid:
                application.completionConfirmedByUid || ctx.uid,
            completionConfirmedByName:
                application.completionConfirmedByName || payerName,
            approvedAt: application.approvedAt || FieldValue.serverTimestamp(),
            approvedByUid: application.approvedByUid || ctx.uid,
            approvedByName: application.approvedByName || payerName,
            paidAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        const nextApplications = buildUpdatedApplications(
            applications,
            { ...application, id: applicationId, status: "paid" },
        );
        updatePostMetrics(transaction, postRef, post, nextApplications);
    });

    return { success: true };
});

exports.submitJobBoardWorkerRating = onCall(JOB_BOARD_OPTS, async (request) => {
    const { classId, postId, applicationId, targetUid, rating, review } = request.data || {};
    if (!classId || !postId || !applicationId || !targetUid) {
        throw new HttpsError(
            "invalid-argument",
            "classId, postId, applicationId, and targetUid are required.",
        );
    }

    const ctx = getAuthContext(request);
    const normalizedTargetUid = normalizeText(targetUid);
    const normalizedRating = normalizeRatingValue(rating);
    const postRef = getPostRef(classId, postId);
    const applicationRef = postRef.collection("applications").doc(applicationId);

    await db.runTransaction(async (transaction) => {
        const [classSnapshot, postSnapshot, applicationSnapshot] = await Promise.all([
            transaction.get(db.doc(`classes/${classId}`)),
            transaction.get(postRef),
            transaction.get(applicationRef),
        ]);

        if (!classSnapshot.exists || !postSnapshot.exists || !applicationSnapshot.exists) {
            throw new HttpsError("not-found", "Rating target was not found.");
        }

        const settings = getJobBoardSettings(classSnapshot.data() || {});
        if (!settings.enableRatings) {
            throw new HttpsError(
                "failed-precondition",
                "Ratings are disabled for this class.",
            );
        }

        const post = postSnapshot.data();
        const application = applicationSnapshot.data();
        if (normalizeText(post.authorUid) !== ctx.uid) {
            throw new HttpsError(
                "permission-denied",
                "Only the requester can rate this worker.",
            );
        }
        if (
            isTeacherOrAdminRole(ctx.role) &&
            ctx.classId &&
            ctx.classId !== classId
        ) {
            throw new HttpsError("permission-denied", "You cannot rate another class.");
        }
        if (!isTeacherOrAdminRole(ctx.role)) {
            await ensureStudentCaller(classId, ctx.uid);
        }
        if (normalizeText(application.status) !== "paid") {
            throw new HttpsError(
                "failed-precondition",
                "You can rate the worker only after payment is completed.",
            );
        }

        const target = getApplicationRatingTargets(application).find(
            (entry) => normalizeText(entry.uid) === normalizedTargetUid,
        );
        if (!target) {
            throw new HttpsError("not-found", "Worker was not found in this application.");
        }

        const ratingId = `${postId}__${applicationId}__${normalizedTargetUid}`;
        const ratingRef = getJobBoardRatingRef(classId, ratingId);
        const ratingsQuery = getJobBoardRatingsCollection(classId)
            .where("targetUid", "==", normalizedTargetUid)
            .where("status", "==", "published");
        const [existingRatingSnapshot, ratingsSnapshot] = await Promise.all([
            transaction.get(ratingRef),
            transaction.get(ratingsQuery),
        ]);
        if (existingRatingSnapshot.exists) {
            throw new HttpsError(
                "failed-precondition",
                "You already submitted a rating for this worker.",
            );
        }

        const ratingData = {
            classId,
            ratingId,
            ratingScope: "worker",
            postId,
            applicationId,
            postTitle: normalizeText(post.title, "Job post"),
            targetUid: normalizedTargetUid,
            targetName: normalizeText(target.name, "Student"),
            targetRole: "student",
            raterUid: normalizeText(post.authorUid),
            raterName: normalizeText(
                post.authorName,
                normalizeText(post.teacherName, "Requester"),
            ),
            raterRole: normalizeText(post.authorRole, "teacher"),
            rating: normalizedRating,
            review: normalizeOptionalText(review),
            status: "published",
            moderationNote: null,
            moderatedAt: null,
            moderatedByUid: null,
            moderatedByName: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        transaction.set(ratingRef, ratingData);

        writeRequesterProfileSummary(transaction, {
            classId,
            requesterUid: normalizedTargetUid,
            requesterName: normalizeText(target.name, "Student"),
            requesterRole: "student",
            ratings: getRatingsWithReplacement(ratingsSnapshot, {
                ratingId,
                replacementRating: ratingData,
            }),
        });
    });

    return { success: true };
});

exports.submitJobBoardRating = onCall(JOB_BOARD_OPTS, async (request) => {
    const { classId, postId, rating, review } = request.data || {};
    if (!classId || !postId) {
        throw new HttpsError("invalid-argument", "classId and postId are required.");
    }

    const ctx = getAuthContext(request);
    const callerData = await ensureStudentCaller(classId, ctx.uid);
    const normalizedRating = normalizeRatingValue(rating);
    const postRef = getPostRef(classId, postId);
    const applicationRef = postRef.collection("applications").doc(ctx.uid);
    const ratingId = `${postId}__${ctx.uid}`;
    const ratingRef = getJobBoardRatingRef(classId, ratingId);

    await db.runTransaction(async (transaction) => {
        const [classSnapshot, postSnapshot, applicationSnapshot] = await Promise.all([
            transaction.get(db.doc(`classes/${classId}`)),
            transaction.get(postRef),
            transaction.get(applicationRef),
        ]);

        if (!classSnapshot.exists || !postSnapshot.exists || !applicationSnapshot.exists) {
            throw new HttpsError("not-found", "Rating target was not found.");
        }

        const settings = getJobBoardSettings(classSnapshot.data() || {});
        if (!settings.enableRatings) {
            throw new HttpsError(
                "failed-precondition",
                "Ratings are disabled for this class.",
            );
        }

        const post = postSnapshot.data();
        const application = applicationSnapshot.data();
        if (normalizeText(application.applicantUid) !== ctx.uid) {
            throw new HttpsError(
                "permission-denied",
                "Only the lead applicant can rate the requester.",
            );
        }
        if (normalizeText(application.status) !== "paid") {
            throw new HttpsError(
                "failed-precondition",
                "You can rate the requester only after payment is completed.",
            );
        }
        if (application.requesterRatedAt) {
            throw new HttpsError("failed-precondition", "You already submitted a rating.");
        }
        if (normalizeText(post.authorUid) === ctx.uid) {
            throw new HttpsError(
                "failed-precondition",
                "You cannot rate your own requester profile.",
            );
        }

        const targetUid = normalizeText(post.authorUid);
        const ratingsQuery = getJobBoardRatingsCollection(classId)
            .where("targetUid", "==", targetUid)
            .where("status", "==", "published");
        const ratingsSnapshot = await transaction.get(ratingsQuery);
        const ratingData = {
            classId,
            ratingId,
            ratingScope: "requester",
            postId,
            applicationId: ctx.uid,
            postTitle: normalizeText(post.title, "Job post"),
            targetUid,
            targetName: normalizeText(post.authorName, "Requester"),
            targetRole: normalizeText(post.authorRole, "teacher"),
            raterUid: ctx.uid,
            raterName: normalizeText(callerData.name, "Student"),
            rating: normalizedRating,
            review: normalizeOptionalText(review),
            status: "published",
            moderationNote: null,
            moderatedAt: null,
            moderatedByUid: null,
            moderatedByName: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        transaction.update(applicationRef, {
            requesterRating: normalizedRating,
            requesterReview: normalizeOptionalText(review),
            requesterRatingStatus: "published",
            requesterRatedAt: FieldValue.serverTimestamp(),
            requesterRatedByUid: ctx.uid,
            requesterRatedByName: normalizeText(callerData.name, "Student"),
            requesterRatingModerationNote: null,
            requesterRatingModeratedAt: null,
            requesterRatingModeratedByUid: null,
            requesterRatingModeratedByName: null,
            updatedAt: FieldValue.serverTimestamp(),
        });

        transaction.set(
            ratingRef,
            ratingData,
            { merge: true },
        );

        writeRequesterProfileSummary(transaction, {
            classId,
            requesterUid: targetUid,
            requesterName: normalizeText(post.authorName, "Requester"),
            requesterRole: normalizeText(post.authorRole, "teacher"),
            ratings: getRatingsWithReplacement(ratingsSnapshot, {
                ratingId,
                replacementRating: ratingData,
            }),
        });
    });

    return { success: true };
});

exports.moderateJobBoardRating = onCall(JOB_BOARD_OPTS, async (request) => {
    const {
        classId,
        ratingId,
        action,
        rating,
        review,
        moderationNote,
    } = request.data || {};
    if (!classId || !ratingId || !action) {
        throw new HttpsError(
            "invalid-argument",
            "classId, ratingId, and action are required.",
        );
    }

    const ctx = assertTeacherOrAdminFromClaims(request, { classId });
    const moderatorName = normalizeText(request.auth?.token?.name, "Teacher");
    const ratingRef = getJobBoardRatingRef(classId, ratingId);

    await db.runTransaction(async (transaction) => {
        const ratingSnapshot = await transaction.get(ratingRef);
        if (!ratingSnapshot.exists) {
            throw new HttpsError("not-found", "Rating was not found.");
        }

        const ratingData = ratingSnapshot.data();
        const applicationRef = getPostRef(classId, ratingData.postId)
            .collection("applications")
            .doc(ratingData.applicationId);
        const normalizedNote =
            moderationNote === undefined
                ? ratingData.moderationNote || null
                : normalizeOptionalText(moderationNote);
        let nextStatus = normalizeRatingStatus(ratingData.status || "published");
        let nextRatingValue = ratingData.rating;
        let nextReviewValue = ratingData.review;

        if (action === "update") {
            nextRatingValue = normalizeRatingValue(rating ?? ratingData.rating);
            nextReviewValue = normalizeOptionalText(
                review !== undefined ? review : ratingData.review,
            );
        } else if (action === "hide") {
            nextStatus = "hidden";
        } else if (action === "publish") {
            nextStatus = "published";
        } else if (action === "delete") {
            nextStatus = "deleted";
        } else {
            throw new HttpsError("invalid-argument", "Unsupported moderation action.");
        }

        if ((ratingData.ratingScope || "requester") === "requester") {
            const applicationSnapshot = await transaction.get(applicationRef);
            if (!applicationSnapshot.exists) {
                throw new HttpsError("not-found", "Linked application was not found.");
            }
        }

        const ratingsQuery = getJobBoardRatingsCollection(classId)
            .where("targetUid", "==", normalizeText(ratingData.targetUid))
            .where("status", "==", "published");
        const ratingsSnapshot = await transaction.get(ratingsQuery);
        const nextRatingData = {
            ...ratingData,
            ratingId,
            rating: nextRatingValue,
            review: nextReviewValue,
            status: nextStatus,
        };

        transaction.update(ratingRef, {
            rating: nextRatingValue,
            review: nextReviewValue,
            status: nextStatus,
            moderationNote: normalizedNote,
            moderatedAt: FieldValue.serverTimestamp(),
            moderatedByUid: ctx.uid,
            moderatedByName: moderatorName,
            updatedAt: FieldValue.serverTimestamp(),
        });

        if ((ratingData.ratingScope || "requester") === "requester") {
            transaction.update(applicationRef, {
                requesterRating: nextRatingValue,
                requesterReview: nextReviewValue,
                requesterRatingStatus: nextStatus,
                requesterRatingModerationNote: normalizedNote,
                requesterRatingModeratedAt: FieldValue.serverTimestamp(),
                requesterRatingModeratedByUid: ctx.uid,
                requesterRatingModeratedByName: moderatorName,
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        writeRequesterProfileSummary(transaction, {
            classId,
            requesterUid: normalizeText(ratingData.targetUid),
            requesterName: normalizeText(ratingData.targetName, "Requester"),
            requesterRole: normalizeText(ratingData.targetRole, "teacher"),
            ratings: getRatingsWithReplacement(ratingsSnapshot, {
                ratingId,
                replacementRating: nextRatingData,
            }),
        });
    });

    return { success: true };
});
