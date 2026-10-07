"use strict";

const admin = require("../firebaseAdminCompat");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { createNotification } = require("../utils/notificationUtils");

const db = admin.firestore();

const NOTIFICATION_TYPES = Object.freeze({
    postComment: "case_library_post_comment",
    postReply: "case_library_post_reply",
    postRecommend: "case_library_post_recommend",
    requestAnswer: "case_library_request_answer",
    requestReply: "case_library_request_reply",
});

function normalizeText(value, fallback = "") {
    const normalized = String(value || "").trim();
    return normalized || fallback;
}

function buildContentSnippet(content, maxLength = 48) {
    const normalized = normalizeText(content).replace(/\s+/g, " ");
    if (!normalized) return "";
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength).trim()}...`;
}

function buildTeacherActorLabel({
    classLabel,
    authorName,
    teacherNamePublic,
}) {
    const safeClassLabel = normalizeText(classLabel, "다른 학급");
    if (teacherNamePublic === false) {
        return `${safeClassLabel} 교사`;
    }

    const safeAuthorName = normalizeText(authorName);
    return safeAuthorName ? `${safeClassLabel} ${safeAuthorName}` : `${safeClassLabel} 교사`;
}

async function getClassLabel(classId) {
    const safeClassId = normalizeText(classId);
    if (!safeClassId) return "다른 학급";

    try {
        const classSnap = await db.doc(`classes/${safeClassId}`).get();
        if (!classSnap.exists) return "다른 학급";

        const classData = classSnap.data() || {};
        return normalizeText(
            classData.className || classData.name || classData.teacherDisplayName,
            "다른 학급",
        );
    } catch (error) {
        console.error("[caseLibraryNotifications] failed to load class label:", {
            classId: safeClassId,
            message: error?.message,
        });
        return "다른 학급";
    }
}

async function flushNotificationTasks(tasks, contextLabel) {
    if (!Array.isArray(tasks) || tasks.length === 0) return;

    const results = await Promise.allSettled(tasks);
    const rejected = results.filter((result) => result.status === "rejected");

    if (rejected.length > 0) {
        console.error(`[caseLibraryNotifications] ${contextLabel} notification failures:`, rejected.map((result) => ({
            message: result.reason?.message || String(result.reason || ""),
        })));
    }
}

exports.notifyCaseLibraryCommentCreated = onDocumentCreated(
    {
        document: "classes/{classId}/caseLibraryPosts/{postId}/comments/{commentId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId, postId, commentId } = event.params;
        const comment = event.data?.data() || {};
        const actorUid = normalizeText(comment.authorUid);

        if (!classId || !postId || !commentId || !actorUid) return;

        const postRef = db.doc(`classes/${classId}/caseLibraryPosts/${postId}`);
        const parentId = normalizeText(comment.parentId);
        const parentRef = parentId ?
            db.doc(`classes/${classId}/caseLibraryPosts/${postId}/comments/${parentId}`) :
            null;

        const [postSnap, parentSnap] = await Promise.all([
            postRef.get(),
            parentRef ? parentRef.get() : Promise.resolve(null),
        ]);

        if (!postSnap.exists) return;

        const post = postSnap.data() || {};
        const parent = parentSnap?.exists ? (parentSnap.data() || {}) : null;
        const actorLabel = buildTeacherActorLabel(comment);
        const postTitle = normalizeText(post.title, "운영사례");
        const contentSnippet = buildContentSnippet(comment.content);
        const parentAuthorUid = normalizeText(parent?.authorUid);
        const postAuthorUid = normalizeText(post.authorUid);
        const tasks = [];

        if (parentAuthorUid && parentAuthorUid !== actorUid) {
            tasks.push(
                createNotification(classId, {
                    uid: parentAuthorUid,
                    type: NOTIFICATION_TYPES.postReply,
                    title: "내 댓글에 답글이 달렸어요",
                    message: contentSnippet ?
                        `${actorLabel}님이 '${postTitle}'에서 "${contentSnippet}"라고 답글을 남겼어요.` :
                        `${actorLabel}님이 '${postTitle}'에서 답글을 남겼어요.`,
                    path: `/case-library/${postId}`,
                    priority: "medium",
                    metadata: {
                        postId,
                        commentId,
                        parentId,
                        sourceClassId: classId,
                    },
                }),
            );
        }

        if (postAuthorUid &&
            postAuthorUid !== actorUid &&
            postAuthorUid !== parentAuthorUid) {
            tasks.push(
                createNotification(classId, {
                    uid: postAuthorUid,
                    type: NOTIFICATION_TYPES.postComment,
                    title: "운영사례에 댓글이 달렸어요",
                    message: contentSnippet ?
                        `${actorLabel}님이 '${postTitle}'에 "${contentSnippet}"라고 남겼어요.` :
                        `${actorLabel}님이 '${postTitle}'에 댓글을 남겼어요.`,
                    path: `/case-library/${postId}`,
                    priority: "medium",
                    metadata: {
                        postId,
                        commentId,
                        sourceClassId: classId,
                    },
                }),
            );
        }

        await flushNotificationTasks(tasks, "post comment");
    },
);

exports.notifyCaseLibraryPostRecommended = onDocumentCreated(
    {
        document: "classes/{storageClassId}/caseLibraryRecommendedPosts/{actorUid}/posts/{engagementId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { storageClassId, actorUid } = event.params;
        const engagement = event.data?.data() || {};
        const targetClassId = normalizeText(engagement.sourceClassId || storageClassId);
        const postId = normalizeText(engagement.postId);

        if (!storageClassId || !targetClassId || !postId || !actorUid) return;

        const postSnap = await db
            .doc(`classes/${targetClassId}/caseLibraryPosts/${postId}`)
            .get();

        if (!postSnap.exists) return;

        const post = postSnap.data() || {};
        const postAuthorUid = normalizeText(post.authorUid);
        if (!postAuthorUid || postAuthorUid === actorUid) return;

        const actorClassLabel = await getClassLabel(storageClassId);
        const postTitle = normalizeText(post.title, "운영사례");

        await flushNotificationTasks(
            [
                createNotification(targetClassId, {
                    uid: postAuthorUid,
                    type: NOTIFICATION_TYPES.postRecommend,
                    title: "운영사례가 추천을 받았어요",
                    message: `${actorClassLabel} 교사님이 '${postTitle}'을 추천했어요.`,
                    path: `/case-library/${postId}`,
                    priority: "low",
                    metadata: {
                        postId,
                        sourceClassId: targetClassId,
                        actorClassId: storageClassId,
                    },
                }),
            ],
            "post recommend",
        );
    },
);

exports.notifyCaseLibraryRequestCommentCreated = onDocumentCreated(
    {
        document: "classes/{classId}/caseLibraryRequests/{requestId}/requestComments/{commentId}",
        region: "asia-northeast3",
    },
    async (event) => {
        const { classId, requestId, commentId } = event.params;
        const comment = event.data?.data() || {};
        const actorUid = normalizeText(comment.authorUid);

        if (!classId || !requestId || !commentId || !actorUid) return;

        const requestRef = db.doc(`classes/${classId}/caseLibraryRequests/${requestId}`);
        const parentId = normalizeText(comment.parentId);
        const parentRef = parentId ?
            db.doc(
                `classes/${classId}/caseLibraryRequests/${requestId}/requestComments/${parentId}`,
            ) :
            null;

        const [requestSnap, parentSnap] = await Promise.all([
            requestRef.get(),
            parentRef ? parentRef.get() : Promise.resolve(null),
        ]);

        if (!requestSnap.exists) return;

        const request = requestSnap.data() || {};
        const parent = parentSnap?.exists ? (parentSnap.data() || {}) : null;
        const actorLabel = buildTeacherActorLabel(comment);
        const requestTitle = normalizeText(request.title, "사례 요청");
        const contentSnippet = buildContentSnippet(comment.content);
        const parentAuthorUid = normalizeText(parent?.authorUid);
        const requestAuthorUid = normalizeText(request.authorUid);
        const tasks = [];

        if (parentAuthorUid && parentAuthorUid !== actorUid) {
            tasks.push(
                createNotification(classId, {
                    uid: parentAuthorUid,
                    type: NOTIFICATION_TYPES.requestReply,
                    title: "내 답변에 의견이 달렸어요",
                    message: contentSnippet ?
                        `${actorLabel}님이 '${requestTitle}'에서 "${contentSnippet}"라고 남겼어요.` :
                        `${actorLabel}님이 '${requestTitle}'에서 의견을 남겼어요.`,
                    path: `/case-library/requests/${requestId}`,
                    priority: "medium",
                    metadata: {
                        requestId,
                        commentId,
                        parentId,
                        sourceClassId: classId,
                    },
                }),
            );
        }

        if (requestAuthorUid &&
            requestAuthorUid !== actorUid &&
            requestAuthorUid !== parentAuthorUid) {
            tasks.push(
                createNotification(classId, {
                    uid: requestAuthorUid,
                    type: NOTIFICATION_TYPES.requestAnswer,
                    title: "사례 요청에 답변이 달렸어요",
                    message: contentSnippet ?
                        `${actorLabel}님이 '${requestTitle}'에 "${contentSnippet}"라고 남겼어요.` :
                        `${actorLabel}님이 '${requestTitle}'에 답변을 남겼어요.`,
                    path: `/case-library/requests/${requestId}`,
                    priority: "medium",
                    metadata: {
                        requestId,
                        commentId,
                        sourceClassId: classId,
                    },
                }),
            );
        }

        await flushNotificationTasks(tasks, "request comment");
    },
);
