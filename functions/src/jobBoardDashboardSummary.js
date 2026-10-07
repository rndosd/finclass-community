"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { getAuthContext, getUserData } = require("../utils/permissions");
const {
    areJobBoardDashboardSummariesEqual,
    hasJobBoardDashboardContributionChanged,
} = require("../utils/jobBoardDashboardProjection");

if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const SUMMARY_OPTS = {
    region: "asia-northeast3",
    memory: "512MiB",
    timeoutSeconds: 60,
};

const BACKFILL_OPTS = {
    region: "asia-northeast3",
    memory: "1GiB",
    timeoutSeconds: 540,
};

const BACKFILL_CONCURRENCY = 5;

const normalizeText = (value, fallback = "") => String(value ?? "").trim() || fallback;
const toNumber = (value) => {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
};

const toMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
};

const postActive = (post = {}) =>
    !["closed", "rejected", "cancelled"].includes(normalizeText(post.status, "recruiting")) &&
    !(normalizeText(post.status, "recruiting") === "recruiting" &&
        toMillis(post.applyDeadlineAt) > 0 &&
        toMillis(post.applyDeadlineAt) <= Date.now());

const applicationActive = (application = {}) =>
    ["applied", "selected", "submitted", "approved"].includes(normalizeText(application.status));

const applicationSelected = (application = {}) =>
    ["selected", "submitted", "approved"].includes(normalizeText(application.status));

const applicationNeedsRequesterAction = (application = {}) =>
    ["applied", "submitted", "approved"].includes(normalizeText(application.status));

const applicationNeedsWorkerAction = (application = {}) =>
    normalizeText(application.status) === "selected";

const requestActive = (request = {}) =>
    ["requested", "accepted", "completed"].includes(normalizeText(request.status));

const getOwnShareTotal = (application = {}, userUid = "") => {
    const shares = Array.isArray(application.paymentShares) ? application.paymentShares : [];
    const ownShare = shares.find((share) => normalizeText(share.uid) === userUid);
    return toNumber(ownShare?.amount);
};

const mapSnapshotRows = (snapshot) =>
    snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));

const getSummaryRef = (classId, userUid) =>
    db.doc(`classes/${classId}/jobBoardDashboardSummaries/${userUid}`);

const pushUid = (uidSet, value) => {
    const uid = normalizeText(value);
    if (uid) uidSet.add(uid);
};

const collectClassJobBoardUids = async (classId) => {
    const [
        studentsSnapshot,
        profilesSnapshot,
        postsSnapshot,
        applicationsSnapshot,
        servicesSnapshot,
        requestsSnapshot,
    ] = await Promise.all([
        db.collection(`classes/${classId}/students`).select().get(),
        db.collection(`classes/${classId}/jobBoardProfiles`).select().get(),
        db.collection(`classes/${classId}/jobPosts`).select("authorUid").get(),
        db.collectionGroup("applications")
            .where("classId", "==", classId)
            .select("applicantUid", "authorUid")
            .get(),
        db.collection(`classes/${classId}/jobSeekerServices`).select("ownerUid").get(),
        db.collectionGroup("requests")
            .where("classId", "==", classId)
            .select("requesterUid", "providerUid")
            .get(),
    ]);

    const uidSet = new Set();
    studentsSnapshot.docs.forEach((doc) => pushUid(uidSet, doc.id));
    profilesSnapshot.docs.forEach((doc) => pushUid(uidSet, doc.id));
    postsSnapshot.docs.forEach((doc) => pushUid(uidSet, doc.data()?.authorUid));
    applicationsSnapshot.docs.forEach((doc) => {
        pushUid(uidSet, doc.data()?.applicantUid);
        pushUid(uidSet, doc.data()?.authorUid);
    });
    servicesSnapshot.docs.forEach((doc) => pushUid(uidSet, doc.data()?.ownerUid));
    requestsSnapshot.docs.forEach((doc) => {
        const data = doc.data() || {};
        pushUid(uidSet, data.requesterUid);
        pushUid(uidSet, data.providerUid);
    });

    return Array.from(uidSet);
};

const runLimited = async (items, limit, task) => {
    const results = [];
    let cursor = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await task(items[index], index);
        }
    });

    await Promise.all(workers);
    return results;
};

const recomputeJobBoardDashboardSummary = async ({ classId, userUid }) => {
    if (!classId || !userUid) return null;

    const [
        profileSnapshot,
        postsSnapshot,
        applicationsSnapshot,
        authoredApplicationsSnapshot,
        servicesSnapshot,
        sentRequestsSnapshot,
        receivedRequestsSnapshot,
        currentSummarySnapshot,
    ] = await Promise.all([
        db.doc(`classes/${classId}/jobBoardProfiles/${userUid}`).get(),
        db.collection(`classes/${classId}/jobPosts`).where("authorUid", "==", userUid).get(),
        db.collectionGroup("applications")
            .where("classId", "==", classId)
            .where("applicantUid", "==", userUid)
            .get(),
        db.collectionGroup("applications")
            .where("classId", "==", classId)
            .where("authorUid", "==", userUid)
            .get(),
        db.collection(`classes/${classId}/jobSeekerServices`).where("ownerUid", "==", userUid).get(),
        db.collectionGroup("requests")
            .where("classId", "==", classId)
            .where("requesterUid", "==", userUid)
            .get(),
        db.collectionGroup("requests")
            .where("classId", "==", classId)
            .where("providerUid", "==", userUid)
            .get(),
        getSummaryRef(classId, userUid).get(),
    ]);

    const posts = mapSnapshotRows(postsSnapshot);
    const applications = mapSnapshotRows(applicationsSnapshot);
    const authoredApplications = mapSnapshotRows(authoredApplicationsSnapshot);
    const services = mapSnapshotRows(servicesSnapshot);
    const sentRequests = mapSnapshotRows(sentRequestsSnapshot);
    const receivedRequests = mapSnapshotRows(receivedRequestsSnapshot);
    const profile = profileSnapshot.exists ? profileSnapshot.data() || {} : {};

    const recruitPaidApplications = applications.filter((row) => row.status === "paid");
    const receivedPaidRequests = receivedRequests.filter((row) => row.status === "paid");
    const receivedCompletedRequests = receivedRequests.filter((row) =>
        ["completed", "paid"].includes(normalizeText(row.status)));
    const sentActiveRequests = sentRequests.filter(requestActive);
    const receivedActiveRequests = receivedRequests.filter(requestActive);

    const summary = {
        classId,
        userUid,
        recruit: {
            authoredTotalCount: posts.length,
            authoredActiveCount: posts.filter(postActive).length,
            applicantCount: posts.reduce((sum, post) => sum + toNumber(post.applicationCount), 0),
            applicantTotalCount: applications.length,
            appliedActiveCount: applications.filter(applicationActive).length,
            selectedCount: applications.filter(applicationSelected).length,
            workerActionCount: applications.filter(applicationNeedsWorkerAction).length,
            requesterActionCount: authoredApplications.filter(applicationNeedsRequesterAction).length,
            requesterPendingSelectionCount: authoredApplications.filter((row) => row.status === "applied").length,
            requesterPendingApprovalCount: authoredApplications.filter((row) => row.status === "submitted").length,
            requesterPendingPaymentCount: authoredApplications.filter((row) => row.status === "approved").length,
            paidCount: recruitPaidApplications.length,
            earnedAmount: recruitPaidApplications.reduce(
                (sum, application) => sum + getOwnShareTotal(application, userUid),
                0,
            ),
        },
        seeker: {
            serviceTotalCount: services.length,
            serviceActiveCount: services.filter((service) => service.status === "active").length,
            receivedRequestTotalCount: receivedRequests.length,
            receivedWaitingCount: receivedRequests.filter((request) => request.status === "requested").length,
            receivedAcceptedCount: receivedRequests.filter((request) => request.status === "accepted").length,
            providerActionCount: receivedRequests.filter((request) =>
                ["requested", "accepted"].includes(normalizeText(request.status))).length,
            receivedActiveCount: receivedActiveRequests.length,
            receivedCompletedCount: receivedCompletedRequests.length,
            receivedPaidCount: receivedPaidRequests.length,
            earnedAmount: receivedPaidRequests.reduce(
                (sum, request) => sum + toNumber(request.proposedRewardAmount),
                0,
            ),
            sentRequestTotalCount: sentRequests.length,
            sentActiveCount: sentActiveRequests.length,
            sentAcceptedCount: sentRequests.filter((request) => request.status === "accepted").length,
            sentCompletedCount: sentRequests.filter((request) => request.status === "completed").length,
            requesterActionCount: sentRequests.filter((request) => request.status === "completed").length,
        },
        rating: {
            average: toNumber(profile.requesterRatingAverage),
            count: toNumber(profile.requesterRatingCount),
        },
        updatedAt: FieldValue.serverTimestamp(),
    };

    const currentSummary = currentSummarySnapshot.exists ?
        currentSummarySnapshot.data() || {} :
        null;
    if (currentSummary && areJobBoardDashboardSummariesEqual(currentSummary, summary)) {
        return currentSummary;
    }

    await getSummaryRef(classId, userUid).set(summary, { merge: true });
    return summary;
};

const collectChangedUids = (...docs) =>
    Array.from(new Set(docs.flatMap((doc) => {
        if (!doc) return [];
        return [
            normalizeText(doc.authorUid),
            normalizeText(doc.applicantUid),
            normalizeText(doc.ownerUid),
            normalizeText(doc.requesterUid),
            normalizeText(doc.providerUid),
            normalizeText(doc.userUid),
        ].filter(Boolean);
    })));

const collectChangedFieldUids = (fieldName, ...docs) =>
    Array.from(new Set(docs
        .map((doc) => normalizeText(doc?.[fieldName]))
        .filter(Boolean)));

const arePatchValuesEqual = (current = {}, patch = {}) =>
    Object.entries(patch).every(([key, value]) =>
        JSON.stringify(current?.[key] ?? null) === JSON.stringify(value ?? null));

const applySummarySectionPatch = async ({
    classId,
    userUid,
    section,
    patch,
    currentSummarySnapshot,
}) => {
    if (!currentSummarySnapshot?.exists) {
        return recomputeJobBoardDashboardSummary({ classId, userUid });
    }

    const currentSummary = currentSummarySnapshot.data() || {};
    if (arePatchValuesEqual(currentSummary?.[section], patch)) {
        return currentSummary;
    }

    await getSummaryRef(classId, userUid).set(
        {
            [section]: patch,
            updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
    );
    return { ...currentSummary, [section]: { ...currentSummary?.[section], ...patch } };
};

const refreshPostSummary = async (classId, userUid) => {
    const [postsSnapshot, currentSummarySnapshot] = await Promise.all([
        db.collection(`classes/${classId}/jobPosts`)
            .where("authorUid", "==", userUid)
            .select("status", "applyDeadlineAt", "applicationCount")
            .get(),
        getSummaryRef(classId, userUid).get(),
    ]);
    const posts = mapSnapshotRows(postsSnapshot);

    return applySummarySectionPatch({
        classId,
        userUid,
        section: "recruit",
        patch: {
            authoredTotalCount: posts.length,
            authoredActiveCount: posts.filter(postActive).length,
            applicantCount: posts.reduce(
                (sum, post) => sum + toNumber(post.applicationCount),
                0,
            ),
        },
        currentSummarySnapshot,
    });
};

const refreshApplicantSummary = async (classId, userUid) => {
    const [applicationsSnapshot, currentSummarySnapshot] = await Promise.all([
        db.collectionGroup("applications")
            .where("classId", "==", classId)
            .where("applicantUid", "==", userUid)
            .select("status", "paymentShares")
            .get(),
        getSummaryRef(classId, userUid).get(),
    ]);
    const applications = mapSnapshotRows(applicationsSnapshot);
    const paidApplications = applications.filter((row) => row.status === "paid");

    return applySummarySectionPatch({
        classId,
        userUid,
        section: "recruit",
        patch: {
            applicantTotalCount: applications.length,
            appliedActiveCount: applications.filter(applicationActive).length,
            selectedCount: applications.filter(applicationSelected).length,
            workerActionCount: applications.filter(applicationNeedsWorkerAction).length,
            paidCount: paidApplications.length,
            earnedAmount: paidApplications.reduce(
                (sum, application) => sum + getOwnShareTotal(application, userUid),
                0,
            ),
        },
        currentSummarySnapshot,
    });
};

const refreshAuthoredApplicationSummary = async (classId, userUid) => {
    const [applicationsSnapshot, currentSummarySnapshot] = await Promise.all([
        db.collectionGroup("applications")
            .where("classId", "==", classId)
            .where("authorUid", "==", userUid)
            .select("status")
            .get(),
        getSummaryRef(classId, userUid).get(),
    ]);
    const applications = mapSnapshotRows(applicationsSnapshot);

    return applySummarySectionPatch({
        classId,
        userUid,
        section: "recruit",
        patch: {
            requesterActionCount: applications.filter(applicationNeedsRequesterAction).length,
            requesterPendingSelectionCount:
                applications.filter((row) => row.status === "applied").length,
            requesterPendingApprovalCount:
                applications.filter((row) => row.status === "submitted").length,
            requesterPendingPaymentCount:
                applications.filter((row) => row.status === "approved").length,
        },
        currentSummarySnapshot,
    });
};

const refreshServiceSummary = async (classId, userUid) => {
    const [servicesSnapshot, currentSummarySnapshot] = await Promise.all([
        db.collection(`classes/${classId}/jobSeekerServices`)
            .where("ownerUid", "==", userUid)
            .select("status")
            .get(),
        getSummaryRef(classId, userUid).get(),
    ]);
    const services = mapSnapshotRows(servicesSnapshot);

    return applySummarySectionPatch({
        classId,
        userUid,
        section: "seeker",
        patch: {
            serviceTotalCount: services.length,
            serviceActiveCount:
                services.filter((service) => service.status === "active").length,
        },
        currentSummarySnapshot,
    });
};

const refreshSentRequestSummary = async (classId, userUid) => {
    const [requestsSnapshot, currentSummarySnapshot] = await Promise.all([
        db.collectionGroup("requests")
            .where("classId", "==", classId)
            .where("requesterUid", "==", userUid)
            .select("status")
            .get(),
        getSummaryRef(classId, userUid).get(),
    ]);
    const requests = mapSnapshotRows(requestsSnapshot);

    return applySummarySectionPatch({
        classId,
        userUid,
        section: "seeker",
        patch: {
            sentRequestTotalCount: requests.length,
            sentActiveCount: requests.filter(requestActive).length,
            sentAcceptedCount:
                requests.filter((request) => request.status === "accepted").length,
            sentCompletedCount:
                requests.filter((request) => request.status === "completed").length,
            requesterActionCount:
                requests.filter((request) => request.status === "completed").length,
        },
        currentSummarySnapshot,
    });
};

const refreshReceivedRequestSummary = async (classId, userUid) => {
    const [requestsSnapshot, currentSummarySnapshot] = await Promise.all([
        db.collectionGroup("requests")
            .where("classId", "==", classId)
            .where("providerUid", "==", userUid)
            .select("status", "proposedRewardAmount")
            .get(),
        getSummaryRef(classId, userUid).get(),
    ]);
    const requests = mapSnapshotRows(requestsSnapshot);
    const paidRequests = requests.filter((request) => request.status === "paid");
    const completedRequests = requests.filter((request) =>
        ["completed", "paid"].includes(normalizeText(request.status)));

    return applySummarySectionPatch({
        classId,
        userUid,
        section: "seeker",
        patch: {
            receivedRequestTotalCount: requests.length,
            receivedWaitingCount:
                requests.filter((request) => request.status === "requested").length,
            receivedAcceptedCount:
                requests.filter((request) => request.status === "accepted").length,
            providerActionCount: requests.filter((request) =>
                ["requested", "accepted"].includes(normalizeText(request.status))).length,
            receivedActiveCount: requests.filter(requestActive).length,
            receivedCompletedCount: completedRequests.length,
            receivedPaidCount: paidRequests.length,
            earnedAmount: paidRequests.reduce(
                (sum, request) => sum + toNumber(request.proposedRewardAmount),
                0,
            ),
        },
        currentSummarySnapshot,
    });
};

const refreshChangedSummaries = async (event, kind) => {
    const classId = event.params.classId;
    const before = event.data?.before?.exists ? event.data.before.data() : null;
    const after = event.data?.after?.exists ? event.data.after.data() : null;
    if (!hasJobBoardDashboardContributionChanged(kind, before, after)) {
        return;
    }

    if (kind === "post") {
        const uids = collectChangedFieldUids("authorUid", before, after);
        await Promise.all(uids.map((userUid) => refreshPostSummary(classId, userUid)));
        return;
    }
    if (kind === "application") {
        const applicantUids = collectChangedFieldUids("applicantUid", before, after);
        const authorUids = collectChangedFieldUids("authorUid", before, after);
        await Promise.all([
            ...applicantUids.map((userUid) => refreshApplicantSummary(classId, userUid)),
            ...authorUids.map((userUid) =>
                refreshAuthoredApplicationSummary(classId, userUid)),
        ]);
        return;
    }
    if (kind === "service") {
        const uids = collectChangedFieldUids("ownerUid", before, after);
        await Promise.all(uids.map((userUid) => refreshServiceSummary(classId, userUid)));
        return;
    }
    if (kind === "request") {
        const requesterUids = collectChangedFieldUids("requesterUid", before, after);
        const providerUids = collectChangedFieldUids("providerUid", before, after);
        await Promise.all([
            ...requesterUids.map((userUid) => refreshSentRequestSummary(classId, userUid)),
            ...providerUids.map((userUid) => refreshReceivedRequestSummary(classId, userUid)),
        ]);
        return;
    }

    const uids = collectChangedUids(before, after);
    await Promise.all(uids.map((userUid) =>
        recomputeJobBoardDashboardSummary({ classId, userUid })));
};

const createChangedSummaryHandler = (kind) => async (event) =>
    refreshChangedSummaries(event, kind);

exports.refreshJobBoardDashboardSummary = onCall(SUMMARY_OPTS, async (request) => {
    const { classId, userUid } = request.data || {};
    const ctx = getAuthContext(request);
    const targetUid = normalizeText(userUid, ctx.uid);

    if (!classId || !targetUid) {
        throw new HttpsError("invalid-argument", "classId and userUid are required.");
    }
    if (ctx.role !== "admin" && ctx.role !== "teacher" && ctx.uid !== targetUid) {
        throw new HttpsError("permission-denied", "You cannot refresh another user's summary.");
    }
    if (ctx.role === "teacher" && ctx.classId && ctx.classId !== classId) {
        throw new HttpsError("permission-denied", "You cannot refresh another class.");
    }
    if (ctx.role === "student") {
        await getUserData(classId, ctx.uid);
    }

    await recomputeJobBoardDashboardSummary({ classId, userUid: targetUid });
    return { success: true };
});

exports.backfillJobBoardDashboardSummaries = onCall(BACKFILL_OPTS, async (request) => {
    const { classId } = request.data || {};
    const ctx = getAuthContext(request);
    const targetClassId = normalizeText(classId, ctx.classId);

    if (!targetClassId) {
        throw new HttpsError("invalid-argument", "classId is required.");
    }
    if (ctx.role !== "admin" && ctx.role !== "teacher") {
        throw new HttpsError("permission-denied", "Only teachers and admins can backfill summaries.");
    }
    if (ctx.role === "teacher" && ctx.classId && ctx.classId !== targetClassId) {
        throw new HttpsError("permission-denied", "You cannot backfill another class.");
    }

    const userUids = await collectClassJobBoardUids(targetClassId);
    await runLimited(userUids, BACKFILL_CONCURRENCY, (userUid) =>
        recomputeJobBoardDashboardSummary({ classId: targetClassId, userUid }));

    return {
        success: true,
        classId: targetClassId,
        backfilledCount: userUids.length,
    };
});

exports.onJobBoardDashboardPostWritten = onDocumentWritten(
    "classes/{classId}/jobPosts/{postId}",
    createChangedSummaryHandler("post"),
);

exports.onJobBoardDashboardApplicationWritten = onDocumentWritten(
    "classes/{classId}/jobPosts/{postId}/applications/{applicationId}",
    createChangedSummaryHandler("application"),
);

exports.onJobBoardDashboardProfileWritten = onDocumentWritten(
    "classes/{classId}/jobBoardProfiles/{userUid}",
    async (event) => {
        const before = event.data?.before?.exists ? event.data.before.data() : null;
        const after = event.data?.after?.exists ? event.data.after.data() : null;
        if (!hasJobBoardDashboardContributionChanged("profile", before, after)) {
            return;
        }
        const { classId, userUid } = event.params;
        const currentSummarySnapshot = await getSummaryRef(classId, userUid).get();
        await applySummarySectionPatch({
            classId,
            userUid,
            section: "rating",
            patch: {
                average: toNumber(after?.requesterRatingAverage),
                count: toNumber(after?.requesterRatingCount),
            },
            currentSummarySnapshot,
        });
    },
);

exports.onJobBoardDashboardServiceWritten = onDocumentWritten(
    "classes/{classId}/jobSeekerServices/{serviceId}",
    createChangedSummaryHandler("service"),
);

exports.onJobBoardDashboardRequestWritten = onDocumentWritten(
    "classes/{classId}/jobSeekerServices/{serviceId}/requests/{requestId}",
    createChangedSummaryHandler("request"),
);
