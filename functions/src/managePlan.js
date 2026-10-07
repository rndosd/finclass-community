const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("../firebaseAdminCompat");
const { logger } = require("firebase-functions");
const { assertAdminFromClaims } = require("../utils/permissions");

/**
 * 학급 planType이 변경되면 담당 교사의 custom claims.plan을 동기화합니다.
 */
exports.syncPlanToCustomClaims = onDocumentUpdated(
    "classes/{classId}",
    async (event) => {
        const beforeData = event.data.before.data();
        const afterData = event.data.after.data();

        if (beforeData.planType === afterData.planType) {
            return null;
        }

        const teacherId = afterData.teacherUid;
        const newPlan = afterData.planType || "FREE";

        if (!teacherId) {
            logger.warn(`학급 ${event.params.classId}에 teacherUid가 없습니다.`);
            return null;
        }

        try {
            const user = await admin.auth().getUser(teacherId);
            const currentClaims = user.customClaims || {};

            await admin.auth().setCustomUserClaims(teacherId, {
                ...currentClaims,
                plan: newPlan,
            });

            logger.log(`교사(${teacherId})의 플랜 클레임을 ${newPlan}로 갱신했습니다.`);
        } catch (error) {
            logger.error("Custom Claims 자동 갱신 중 오류:", error);
        }
    },
);

/**
 * 관리자 UI에서 교사들의 실제 custom claims.plan 값을 조회합니다.
 */
exports.getTeachersAuthClaims = onCall(async (request) => {
    assertAdminFromClaims(request);

    const { teacherUids } = request.data || {};
    if (!Array.isArray(teacherUids) || teacherUids.length === 0) {
        return {};
    }

    try {
        const claimsMap = {};

        await Promise.all(
            teacherUids.map(async (uid) => {
                if (!uid) return;
                try {
                    const user = await admin.auth().getUser(uid);
                    claimsMap[uid] = user.customClaims?.plan || "FREE";
                } catch (error) {
                    logger.error(`교사(${uid}) 클레임 조회 실패:`, error);
                    claimsMap[uid] = "ERROR";
                }
            }),
        );

        return claimsMap;
    } catch (error) {
        logger.error("교사 클레임 일괄 조회 중 서버 오류:", error);
        throw new HttpsError(
            "internal",
            "교사 클레임 조회 중 서버 오류가 발생했습니다.",
        );
    }
});
