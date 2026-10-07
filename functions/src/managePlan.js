const { onDocumentUpdated } = require("firebase-functions/v2/firestore");

const admin = require("../firebaseAdminCompat");
const { logger } = require("firebase-functions");


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
