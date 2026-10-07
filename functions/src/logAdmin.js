"use strict";

const admin = require("../firebaseAdminCompat");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { assertTeacherOrAdminFromClaims } = require("../utils/permissions");

const db = admin.firestore();
const MAX_LOG_IDS_PER_REQUEST = 200;

const normalizeLogIds = (value, fieldName) => {
    if (!Array.isArray(value)) {
        throw new HttpsError(
            "invalid-argument",
            `${fieldName} must be an array.`,
        );
    }

    return Array.from(
        new Set(
            value
                .map((item) => String(item || "").trim())
                .filter(Boolean),
        ),
    );
};

exports.bulkDeleteStudentLogs = onCall(
    { region: "asia-northeast3" },
    async (request) => {
        const { data } = request;
        const {
            classId,
            studentUid,
            creditLogIds = [],
            activityLogIds = [],
        } = data || {};

        if (!classId || !studentUid) {
            throw new HttpsError(
                "invalid-argument",
                "classId and studentUid are required.",
            );
        }

        assertTeacherOrAdminFromClaims(request, { classId });

        const normalizedCreditIds = normalizeLogIds(creditLogIds, "creditLogIds");
        const normalizedActivityIds = normalizeLogIds(
            activityLogIds,
            "activityLogIds",
        );

        const totalRequestedCount =
            normalizedCreditIds.length + normalizedActivityIds.length;

        if (totalRequestedCount === 0) {
            throw new HttpsError(
                "invalid-argument",
                "At least one log id is required.",
            );
        }

        if (totalRequestedCount > MAX_LOG_IDS_PER_REQUEST) {
            throw new HttpsError(
                "invalid-argument",
                `You can delete up to ${MAX_LOG_IDS_PER_REQUEST} logs at a time.`,
            );
        }

        const creditRefs = normalizedCreditIds.map((id) =>
            db.doc(`classes/${classId}/students/${studentUid}/creditLogs/${id}`),
        );
        const activityRefs = normalizedActivityIds.map((id) =>
            db.doc(`classes/${classId}/students/${studentUid}/activityLogs/${id}`),
        );
        const refs = [...creditRefs, ...activityRefs];

        const snapshots = refs.length > 0 ? await db.getAll(...refs) : [];
        const batch = db.batch();

        let deletedCreditCount = 0;
        let deletedActivityCount = 0;

        snapshots.forEach((snap, index) => {
            if (!snap.exists) return;

            batch.delete(refs[index]);

            if (index < creditRefs.length) {
                deletedCreditCount += 1;
            } else {
                deletedActivityCount += 1;
            }
        });

        if (deletedCreditCount === 0 && deletedActivityCount === 0) {
            return {
                success: true,
                deletedCreditCount: 0,
                deletedActivityCount: 0,
                message: "삭제할 기록을 찾지 못했습니다.",
            };
        }

        await batch.commit();

        return {
            success: true,
            deletedCreditCount,
            deletedActivityCount,
            message: `신용로그 ${deletedCreditCount}건, 활동로그 ${deletedActivityCount}건을 삭제했습니다.`,
        };
    },
);
