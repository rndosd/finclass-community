"use strict";

const { HttpsError } = require("firebase-functions/v2/https");

function assertTeacherClassScope(ctx, requestedClassId) {
    if (ctx?.role !== "teacher") {
        return ctx;
    }

    if (!ctx.classId) {
        throw new HttpsError(
            "failed-precondition",
            "Teacher accounts require a classId claim.",
        );
    }

    if (requestedClassId && ctx.classId !== requestedClassId) {
        throw new HttpsError(
            "permission-denied",
            "Teachers cannot access another class.",
        );
    }

    return ctx;
}

module.exports = {
    assertTeacherClassScope,
};
