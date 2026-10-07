"use strict";

const https = require("firebase-functions/v2/https");
const admin = require("../firebaseAdminCompat");
const { context } = require("./classMaintenanceContext");
const { assertClassAvailable } = require("./classMaintenanceGuards");

const onCall = (...args) => {
    const handler = args.pop();
    return https.onCall(...args, (request) => context.run({ ...context.getStore(), startedAt: Date.now(), classIds: [] }, async () => {
        if (request.auth) {
            const tokenClass = request.auth.token?.classId;
            const supplied = [request.data?.classId, request.data?.classIdToAssign].filter((id) => typeof id === "string" && id);
            if (request.auth.token?.role !== "admin" && tokenClass && supplied.some((id) => id !== tokenClass)) {
                throw new https.HttpsError("permission-denied", "다른 학급의 데이터를 변경할 수 없습니다.");
            }
            const ids = tokenClass ? [...supplied, tokenClass] : request.auth.token?.role === "admin" ? supplied : [];
            for (const classId of new Set(ids.filter((id) => typeof id === "string" && id && !id.includes("/")))) {
                await assertClassAvailable(admin.firestore(), classId);
                context.getStore().classIds.push(classId);
            }
        }
        return handler(request);
    }));
};

module.exports = { ...https, onCall };
