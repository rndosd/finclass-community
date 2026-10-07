"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("../firebaseAdminCompat");
const { assertRoleFromClaims } = require("../utils/permissions");
const {
    sanitizePermissionMap,
    syncStudentPermissionState,
} = require("../utils/permissionSync");

exports.updateUserPermissions = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "로그인이 필요합니다.");
    }

    const callerCtx = assertRoleFromClaims(request, ["teacher", "admin"]);
    const callerRole = callerCtx.role;
    if (callerRole !== "teacher" && callerRole !== "admin") {
        throw new HttpsError(
            "permission-denied",
            "권한 수정은 선생님만 가능합니다.",
        );
    }

    const { targetUid, classId, permissions } = request.data;
    if (
        typeof permissions !== "object" ||
        permissions === null ||
        Array.isArray(permissions)
    ) {
        throw new HttpsError("invalid-argument", "permissions must be an object.");
    }

    if (!targetUid || !classId || !permissions) {
        throw new HttpsError("invalid-argument", "파라미터가 올바르지 않습니다.");
    }

    if (callerRole === "teacher" && callerCtx.classId !== classId) {
        throw new HttpsError(
            "permission-denied",
            "Teacher can only update permissions in their own class.",
        );
    }

    try {
        const studentRef = admin
            .firestore()
            .doc(`classes/${classId}/students/${targetUid}`);

        const studentSnap = await studentRef.get();
        if (!studentSnap.exists) {
            throw new HttpsError(
                "not-found",
                `Student not found for uid: ${targetUid}`,
            );
        }

        const studentData = studentSnap.data() || {};
        if (studentData.role !== "student") {
            throw new HttpsError(
                "permission-denied",
                "Only student permissions can be updated.",
            );
        }

        const sanitizedPermissions = sanitizePermissionMap(
            permissions,
            studentData.manualPermissions || studentData.permissions,
        );

        const syncResult = await syncStudentPermissionState({
            classId,
            targetUid,
            manualPermissions: sanitizedPermissions,
            studentData,
            studentRef,
            ensureClaims: true,
        });

        return {
            success: true,
            shrunkCount: Object.values(syncResult.permissions || {}).filter(Boolean).length,
            message: "권한 저장과 토큰 동기화가 완료되었습니다.",
        };
    } catch (error) {
        if (error instanceof HttpsError) {
            throw error;
        }

        console.error("Permission Sync Error:", error);
        throw new HttpsError(
            "internal",
            error?.message || "서버 오류로 인해 권한 수정에 실패했습니다.",
        );
    }
});
