const {
    onDocumentUpdated,
    onDocumentCreated,
    onDocumentDeleted,
} = require("firebase-functions/v2/firestore");
const admin = require("../firebaseAdminCompat");
const { createNotificationsForUsers } = require("../utils/notificationUtils");

const NOTICE_DOCUMENT_PATH = "classes/{classId}/notices/{noticeId}";
const COMMENT_DOCUMENT_PATH = "classes/{classId}/notices/{noticeId}/comments/{commentId}";
const NEWS_DOCUMENT_PATH = "classes/{classId}/news/{newsId}";

const stripHtml = (value = "") =>
    String(value || "")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();

const buildNewsNotificationMessage = (news = {}) => {
    const plainContent = stripHtml(news?.content || "");
    const snippet = plainContent.slice(0, 90);

    if (snippet) {
        return `${snippet}${plainContent.length > 90 ? "..." : ""}`;
    }
    return "새 뉴스가 등록되었습니다.";
};

const isStudentRole = (role) => role !== "teacher" && role !== "admin";

exports.notifyNewsPublished = onDocumentCreated(
    {
        document: NEWS_DOCUMENT_PATH,
        region: "asia-northeast3",
    },
    async (event) => {
        const snap = event.data;
        if (!snap) return;

        const { classId, newsId } = event.params;
        if (!classId || !newsId) return;

        const news = snap.data() || {};
        if (news.isActive === false) return;

        const studentsSnap = await admin
            .firestore()
            .collection("classes")
            .doc(classId)
            .collection("students")
            .get();

        const selectedTargetUids = Array.isArray(news.popupTargetUids) ?
            [...new Set(news.popupTargetUids.map((uid) => String(uid || "").trim()).filter(Boolean))] :
            [];

        const recipients = studentsSnap.docs
            .filter((studentDoc) => {
                const studentData = studentDoc.data() || {};
                if (!isStudentRole(studentData.role)) return false;
                if (news.popupTarget === "selected_students" && selectedTargetUids.length > 0) {
                    return selectedTargetUids.includes(studentDoc.id);
                }
                return true;
            })
            .map((studentDoc) => studentDoc.id);

        if (!recipients.length) return;

        const plainTitle = String(news.title || "").trim();
        const categoryId = String(news.categoryId || "").trim();

        await createNotificationsForUsers(classId, recipients, {
            title: plainTitle || "새 뉴스",
            message: buildNewsNotificationMessage(news),
            type: "news_published",
            path: "/news",
            priority: news.priority === "high" ? "high" : "medium",
            categoryId,
            newsId,
            metadata: {
                newsId,
                categoryId,
                title: plainTitle || null,
                priority: news.priority || null,
            },
        });
    },
);

exports.updateLikesCount = onDocumentUpdated(NOTICE_DOCUMENT_PATH, (event) => {
    const beforeData = event.data.before.data();
    const afterData = event.data.after.data();

    if (JSON.stringify(beforeData.likes) === JSON.stringify(afterData.likes)) {
        console.log("Likes did not change. Exiting function.");
        return null;
    }

    const newLikesCount = afterData.likes?.length || 0;
    const oldLikesCount = beforeData.likes?.length || 0;
    const scoreChange = newLikesCount - oldLikesCount;
    const noticeRef = event.data.after.ref;

    return noticeRef.update({
        likesCount: newLikesCount,
        interactionScore: admin.firestore.FieldValue.increment(scoreChange),
    });
});

exports.incrementCommentCount = onDocumentCreated(COMMENT_DOCUMENT_PATH, (event) => {
    const { classId, noticeId } = event.params;
    const noticeRef = admin
        .firestore()
        .collection("classes")
        .doc(classId)
        .collection("notices")
        .doc(noticeId);

    return noticeRef.update({
        commentsCount: admin.firestore.FieldValue.increment(1),
        interactionScore: admin.firestore.FieldValue.increment(1),
    });
});

exports.decrementCommentCount = onDocumentDeleted(COMMENT_DOCUMENT_PATH, (event) => {
    const { classId, noticeId } = event.params;
    const noticeRef = admin
        .firestore()
        .collection("classes")
        .doc(classId)
        .collection("notices")
        .doc(noticeId);

    return noticeRef.update({
        commentsCount: admin.firestore.FieldValue.increment(-1),
        interactionScore: admin.firestore.FieldValue.increment(-1),
    });
});
