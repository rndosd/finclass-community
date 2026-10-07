"use strict";

const admin = require("../firebaseAdminCompat");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");

const db = admin.firestore();
const REGION = "asia-northeast3";
const SUMMARY_COLLECTION_ID = "sharedCaseLibraryPostSummaries";
const SUMMARY_VERSION = 1;
const CASE_LIBRARY_POST_PATH = "classes/{classId}/caseLibraryPosts/{postId}";

function normalizeString(value) {
    return String(value || "").trim();
}

function sanitizeStringList(list) {
    if (!Array.isArray(list)) {
        return [];
    }

    return list
        .map((item) => normalizeString(item))
        .filter(Boolean);
}

function toMetricValue(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
}

function stripHtml(html) {
    return normalizeString(html)
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function buildCaseLibrarySummary(input, maxLength = 180) {
    const plainText = stripHtml(input);
    if (!plainText) {
        return "";
    }

    if (plainText.length <= maxLength) {
        return plainText;
    }

    return `${plainText.slice(0, maxLength).trim()}...`;
}

function buildSummaryId(classId, postId) {
    const normalizedClassId = normalizeString(classId);
    const normalizedPostId = normalizeString(postId);

    if (!normalizedClassId || !normalizedPostId) {
        return "";
    }

    return `${normalizedClassId}__${normalizedPostId}`;
}

function getSummaryRef(classId, postId) {
    return db.collection(SUMMARY_COLLECTION_ID).doc(buildSummaryId(classId, postId));
}

function resolveSummaryClassId({
    eventClassId = "",
    beforeData = null,
    afterData = null,
}) {
    const afterClassId = normalizeString(afterData?.classId);
    if (afterClassId) {
        return afterClassId;
    }

    const beforeClassId = normalizeString(beforeData?.classId);
    if (beforeClassId) {
        return beforeClassId;
    }

    return normalizeString(eventClassId);
}

function buildSummaryDocData(classId, postId, data = {}) {
    const metrics = data.metrics || {};
    const saveCount = toMetricValue(metrics.saveCount ?? data.saveCount);
    const viewCount = toMetricValue(metrics.viewCount ?? data.viewCount);
    const recommendCount = toMetricValue(
        metrics.recommendCount ?? data.recommendCount,
    );
    const commentCount = toMetricValue(metrics.commentCount ?? data.commentCount);
    const applyCount = toMetricValue(metrics.applyCount ?? data.applyCount);
    const resolvedClassId = normalizeString(classId || data.classId);

    return {
        summaryVersion: SUMMARY_VERSION,
        summaryType: "caseLibraryPost",
        postId: normalizeString(postId),
        sourceClassId: resolvedClassId,
        classId: resolvedClassId,
        pageType: normalizeString(data.pageType || "police"),
        postKind: data.postKind === "template" ? "template" : "post",
        requestId: normalizeString(data.requestId),
        title: normalizeString(data.title),
        summary: normalizeString(
            data.summary || buildCaseLibrarySummary(data.bodyText || data.bodyHtml),
        ),
        authorUid: normalizeString(data.authorUid),
        authorName: normalizeString(data.authorName),
        classLabel: normalizeString(data.classLabel || data.roleLabel),
        teacherNamePublic:
            typeof data.teacherNamePublic === "boolean" ? data.teacherNamePublic : true,
        featured: Boolean(data.featured),
        templateEnabled: Boolean(data.templateEnabled || data.postKind === "template"),
        templateScopeIds: sanitizeStringList(data.templateScopeIds),
        template:
            data.template && typeof data.template === "object" ?
                {
                    includedScopes: sanitizeStringList(data.template.includedScopes),
                    excludedScopes: sanitizeStringList(data.template.excludedScopes),
                    targetHint: normalizeString(data.template.targetHint),
                } :
                null,
        metrics: {
            saveCount,
            viewCount,
            recommendCount,
            commentCount,
            applyCount,
        },
        saveCount,
        viewCount,
        recommendCount,
        commentCount,
        applyCount,
        createdAt: data.createdAt || null,
        updatedAt: data.updatedAt || data.createdAt || null,
        publishedAt: data.publishedAt || data.createdAt || null,
        lastActivityAt: data.lastActivityAt || null,
        sourceUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
}

async function syncCaseLibraryPostSummary({
    classId,
    postId,
    beforeData = null,
    afterData = null,
}) {
    if (!classId || !postId) {
        return { summaryId: "", status: "skipped" };
    }

    const summaryRef = getSummaryRef(classId, postId);

    if (!afterData) {
        await summaryRef.delete();
        return {
            summaryId: summaryRef.id,
            status: "deleted",
        };
    }

    const nextSummaryData = buildSummaryDocData(classId, postId, afterData);

    if (beforeData) {
        const previousSummaryData = buildSummaryDocData(classId, postId, beforeData);
        const keys = Object.keys(nextSummaryData);
        const didChange = keys.some((key) => {
            const beforeValue = JSON.stringify(previousSummaryData[key] ?? null);
            const afterValue = JSON.stringify(nextSummaryData[key] ?? null);
            return beforeValue !== afterValue;
        });

        if (!didChange) {
            return {
                summaryId: summaryRef.id,
                status: "unchanged",
            };
        }
    }

    await summaryRef.set(nextSummaryData, { merge: true });
    return {
        summaryId: summaryRef.id,
        status: "updated",
    };
}

async function rebuildCaseLibraryPostSummariesForClass(classId) {
    const normalizedClassId = normalizeString(classId);
    if (!normalizedClassId) {
        throw new HttpsError("invalid-argument", "classId is required.");
    }

    const [postsSnap, summariesSnap] = await Promise.all([
        db.collection(`classes/${normalizedClassId}/caseLibraryPosts`).get(),
        db.collection(SUMMARY_COLLECTION_ID)
            .where("sourceClassId", "==", normalizedClassId)
            .get(),
    ]);

    const postIds = new Set();
    let updatedCount = 0;
    let deletedCount = 0;

    for (const postSnap of postsSnap.docs) {
        postIds.add(postSnap.id);
        const result = await syncCaseLibraryPostSummary({
            classId: normalizedClassId,
            postId: postSnap.id,
            afterData: postSnap.data() || {},
        });

        if (result.status === "updated") {
            updatedCount += 1;
        }
    }

    const deleteTargets = summariesSnap.docs.filter((summarySnap) => {
        const postId = normalizeString(summarySnap.data()?.postId);
        return postId && !postIds.has(postId);
    });

    for (let index = 0; index < deleteTargets.length; index += 400) {
        const batch = db.batch();
        deleteTargets.slice(index, index + 400).forEach((summarySnap) => {
            batch.delete(summarySnap.ref);
        });
        await batch.commit();
    }

    deletedCount = deleteTargets.length;

    return {
        classId: normalizedClassId,
        deletedCount,
        postCount: postsSnap.size,
        summaryCount: Math.max(postsSnap.size, summariesSnap.size - deletedCount),
        summaryVersion: SUMMARY_VERSION,
        updatedCount,
    };
}

exports.syncCaseLibraryPostSummary = onDocumentWritten(
    {
        document: CASE_LIBRARY_POST_PATH,
        region: REGION,
    },
    async (event) => {
        const { classId: eventClassId, postId } = event.params;
        if (!postId) {
            return;
        }

        const beforeData = event.data?.before?.exists ?
            (event.data.before.data() || null) :
            null;
        const afterData = event.data?.after?.exists ?
            (event.data.after.data() || null) :
            null;
        const classId = resolveSummaryClassId({
            eventClassId,
            beforeData,
            afterData,
        });

        if (!classId) {
            console.warn(
                "[caseLibraryPostSummaries] skipped summary sync due to missing classId",
                {
                    eventClassId: normalizeString(eventClassId),
                    postId,
                },
            );
            return;
        }

        if (normalizeString(eventClassId) && normalizeString(eventClassId) !== classId) {
            console.warn(
                "[caseLibraryPostSummaries] event classId differed from document classId; using document classId",
                {
                    eventClassId: normalizeString(eventClassId),
                    postId,
                    resolvedClassId: classId,
                },
            );
        }

        await syncCaseLibraryPostSummary({
            classId,
            postId,
            beforeData,
            afterData,
        });
    },
);

exports.rebuildCaseLibraryPostSummariesForClass = onCall(
    {
        region: REGION,
        memory: "512MiB",
        timeoutSeconds: 180,
    },
    async (request) => {
        const requestedClassId = normalizeString(request.data?.classId);
        const fallbackClassId = normalizeString(request.auth?.token?.classId);
        const classId = requestedClassId || fallbackClassId;

        if (!classId) {
            throw new HttpsError("invalid-argument", "classId is required.");
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        const result = await rebuildCaseLibraryPostSummariesForClass(classId);
        return {
            success: true,
            ...result,
        };
    },
);

exports.__syncCaseLibraryPostSummary = syncCaseLibraryPostSummary;
exports.__rebuildCaseLibraryPostSummariesForClass = rebuildCaseLibraryPostSummariesForClass;
