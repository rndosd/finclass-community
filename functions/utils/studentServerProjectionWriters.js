"use strict";

const {
    getNotificationStateMainDocPath,
    createNotificationStateMainInboxPatch,
} = require("./notificationState");

const toNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

function stageDailyStudentHistoryWrites({
    batch,
    dbClient,
    classId,
    studentsSnapshot,
    today,
    fieldValue,
}) {
    studentsSnapshot.forEach((studentDoc) => {
        const student = studentDoc.data() || {};
        const assets = student.assets || {};

        batch.set(
            dbClient.doc(
                `classes/${classId}/students/${studentDoc.id}/assetHistory/${today}`,
            ),
            {
                date: today,
                netWorth: toNumber(assets.totalNetWorth),
                timestamp: fieldValue.serverTimestamp(),
            },
        );

        batch.set(
            dbClient.doc(
                `classes/${classId}/students/${studentDoc.id}/creditHistory/${today}`,
            ),
            {
                classId,
                studentUid: studentDoc.id,
                date: today,
                score: toNumber(student.creditScore),
                timestamp: fieldValue.serverTimestamp(),
            },
        );
    });
}

async function writeNoticeUnreadCount({
    dbClient,
    fieldValue,
    classId,
    studentUid,
    unreadCount,
}) {
    const summaryRef = dbClient.doc(
        `classes/${classId}/notificationSummary/notices`,
    );
    const stateRef = dbClient.doc(
        getNotificationStateMainDocPath(classId, studentUid),
    );
    const normalizedUnreadCount = Math.max(0, Number(unreadCount || 0));

    await Promise.all([
        summaryRef.set({
            studentUnreadCounts: fieldValue.delete(),
            updatedAt: fieldValue.serverTimestamp(),
        }, { merge: true }),
        stateRef.set(
            createNotificationStateMainInboxPatch({
                unreadCount: normalizedUnreadCount,
                updatedAt: fieldValue.serverTimestamp(),
            }),
            { merge: true },
        ),
    ]);
}

module.exports = {
    stageDailyStudentHistoryWrites,
    writeNoticeUnreadCount,
};
